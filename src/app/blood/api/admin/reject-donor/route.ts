import { createClient } from "@supabase/supabase-js";
import { escapeHtmlText, getMailjetConfig, sendMailjetMessage } from "@/lib/mailjet";
import { fillHtmlTemplate, fillTemplate } from "@/lib/emailTemplateEngine";

type Body = { donor_user_id?: string; rejection_reason?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function logEmailEvent(
  adminClient: unknown,
  row: {
    event_type: string;
    actor_user_id?: string | null;
    target_user_id?: string | null;
    target_email?: string | null;
    status: "sent" | "failed" | "skipped";
    error_message?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const client = adminClient as {
    from: (table: string) => { insert: (values: never) => Promise<unknown> };
  };
  try {
    await client.from("user_email_event_logs").insert({
      event_type: row.event_type,
      actor_user_id: row.actor_user_id ?? null,
      target_user_id: row.target_user_id ?? null,
      target_email: row.target_email ?? null,
      status: row.status,
      error_message: row.error_message ?? null,
      metadata: row.metadata ?? {},
    } as never);
  } catch {
    // non-blocking audit write
  }
}

async function getCallerUserIdOrThrow(opts: {
  supabaseUrl: string;
  anonKey: string;
  jwt: string;
}): Promise<{ user_id: string }> {
  const resp = await fetch(`${opts.supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: opts.anonKey,
      Authorization: `Bearer ${opts.jwt}`,
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(text || `Auth user fetch failed (${resp.status})`);
  }
  const json = JSON.parse(text) as { id?: string };
  if (!json?.id) throw new Error("Auth user id missing");
  return { user_id: json.id };
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Missing Authorization bearer token" }, 401);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  let callerUserId: string;
  try {
    callerUserId = (await getCallerUserIdOrThrow({ supabaseUrl, anonKey, jwt })).user_id;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unauthorized caller";
    return json({ error: `Unauthorized caller: ${msg}` }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: adminRow, error: adminErr } = await adminClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", callerUserId)
    .maybeSingle();
  if (adminErr) return json({ error: `Admin check failed: ${adminErr.message}` }, 500);
  if (!adminRow) return json({ error: "Forbidden: admin only" }, 403);

  const body = (await req.json().catch(() => ({}))) as Body;
  const donorUserId = body.donor_user_id;
  if (!donorUserId) return json({ error: "Missing donor_user_id" }, 400);
  const rejectionReason = (body.rejection_reason ?? "").trim() || null;
  const reviewedAt = new Date().toISOString();
  const { data: authUserRes } = await adminClient.auth.admin.getUserById(donorUserId);
  const donorEmail = authUserRes?.user?.email ?? null;
  const { data: donor } = await adminClient
    .from("donors")
    .select("name")
    .eq("user_id", donorUserId)
    .maybeSingle();

  const { error: donorUpdateErr } = await adminClient
    .from("donors")
    .update({
      id_card_verified: false,
      reviewed_at: reviewedAt,
      reviewed_by: callerUserId,
      rejection_reason: rejectionReason,
    })
    .eq("user_id", donorUserId);
  if (donorUpdateErr) return json({ error: `Failed to update donors row: ${donorUpdateErr.message}` }, 500);

  await adminClient.from("donor_verification_events").insert({
    donor_user_id: donorUserId,
    admin_user_id: callerUserId,
    verified_at: reviewedAt,
    note: rejectionReason ? `Rejected: ${rejectionReason}` : "Rejected",
  });

  const { error: banErr } = await adminClient.auth.admin.updateUserById(donorUserId, {
    ban_duration: "876000h",
  });
  if (banErr) return json({ error: `Failed to lock user: ${banErr.message}` }, 500);

  const { error: profileUpdateErr } = await adminClient
    .from("profiles")
    .update({
      must_change_password: false,
      temp_password_set_at: null,
      temp_password_expires_at: null,
    })
    .eq("user_id", donorUserId);
  if (profileUpdateErr) return json({ error: `Failed to update profiles row: ${profileUpdateErr.message}` }, 500);

  const mj = getMailjetConfig();
  const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  let emailResult: { sent: boolean; error?: string } | null = null;

  const reasonPlain = rejectionReason ?? "Not provided";
  const reasonHtml = escapeHtmlText(reasonPlain);

  if (mj.ok && donorEmail) {
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color: #111;">
        <h2 style="margin:0 0 12px 0; font-size: 18px;">Donor registration update</h2>
        <p style="margin:0 0 12px 0;">Hi${donor?.name ? ` ${escapeHtmlText(donor.name)}` : ""},</p>
        <p style="margin:0 0 12px 0;">Your donor registration could not be approved at this time.</p>
        <p style="margin:0 0 12px 0;"><b>Reason:</b> ${reasonHtml}</p>
        ${
          appUrl
            ? `<p style="margin:0 0 12px 0;"><a href="${appUrl}/donor/onboarding" style="color:#b91c1c;">Submit registration again</a></p>`
            : ""
        }
        <p style="margin:12px 0 0 0; color:#525252; font-size:12px;">This message was sent regarding your Raktodaan donor application.</p>
      </div>
    `;
    const text = [
      `Donor registration update${donor?.name ? ` for ${donor.name}` : ""}`,
      "",
      "Your donor registration could not be approved at this time.",
      `Reason: ${reasonPlain}`,
      appUrl ? `Submit again: ${appUrl}/donor/onboarding` : "",
      "",
      "This message was sent regarding your Raktodaan donor application.",
    ]
      .filter(Boolean)
      .join("\n");

    const vars = {
      displayName: donor?.name ? ` ${donor.name}` : "",
      reason: reasonPlain,
      onboardingUrl: appUrl ? `${appUrl}/donor/onboarding` : "",
    };

    let subject = "Update on your Raktodaan donor registration";
    let preheader = "Your donor registration could not be approved — details inside.";
    let htmlToSend = html;
    let textToSend = text;

    type TemplateRow = {
      subject_template: string | null;
      preheader_template: string | null;
      html_template: string | null;
      text_template: string | null;
    };

    const { data: tplRow } = await adminClient
      .from("email_templates")
      .select("subject_template,preheader_template,html_template,text_template")
      .eq("template_key", "donor_rejected_notice")
      .maybeSingle();
    if (tplRow) {
      const t = tplRow as TemplateRow;
      subject = fillTemplate(t.subject_template ?? subject, vars);
      preheader = fillTemplate(
        t.preheader_template ?? preheader,
        vars,
      );
      htmlToSend = fillHtmlTemplate(t.html_template ?? html, vars);
      textToSend = fillTemplate(t.text_template ?? text, vars);
    }

    try {
      await sendMailjetMessage(mj.config, {
        toEmail: donorEmail,
        toName: donor?.name ?? null,
        subject,
        html: htmlToSend,
        text: textToSend,
        preheader,
        customId: `donor_rejected:${donorUserId}`,
      });
      emailResult = { sent: true };
      await logEmailEvent(adminClient, {
        event_type: "donor_rejected_notice",
        actor_user_id: callerUserId,
        target_user_id: donorUserId,
        target_email: donorEmail,
        status: "sent",
        metadata: { reason: rejectionReason },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Mailjet send failed";
      emailResult = { sent: false, error: msg };
      await logEmailEvent(adminClient, {
        event_type: "donor_rejected_notice",
        actor_user_id: callerUserId,
        target_user_id: donorUserId,
        target_email: donorEmail,
        status: "failed",
        error_message: msg,
        metadata: { reason: rejectionReason },
      });
    }
  } else {
    const errMsg = !donorEmail
      ? "Donor email not available"
      : !mj.ok
        ? mj.reason
        : "Email not sent";
    emailResult = { sent: false, error: errMsg };
    await logEmailEvent(adminClient, {
      event_type: "donor_rejected_notice",
      actor_user_id: callerUserId,
      target_user_id: donorUserId,
      target_email: donorEmail,
      status: "skipped",
      error_message: errMsg,
      metadata: { reason: rejectionReason, mailjet: !mj.ok ? "env_missing" : "no_email" },
    });
  }

  return json({ ok: true, emailResult });
}

