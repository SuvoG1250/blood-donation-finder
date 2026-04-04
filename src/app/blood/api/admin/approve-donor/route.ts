import { createClient } from "@supabase/supabase-js";
import { getMailjetConfig, sendMailjetMessage } from "@/lib/mailjet";
import { fillHtmlTemplate, fillTemplate } from "@/lib/emailTemplateEngine";

type Body = { donor_user_id?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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

  const { data: donor, error: donorErr } = await adminClient
    .from("donors")
    .select("user_id,name,id_card_verified")
    .eq("user_id", donorUserId)
    .maybeSingle();
  if (donorErr || !donor) return json({ error: "Donor not found" }, 404);
  if (donor.id_card_verified) return json({ error: "Donor is already approved" }, 409);

  const { data: authUserRes, error: authUserErr } = await adminClient.auth.admin.getUserById(donorUserId);
  const donorEmail = authUserRes?.user?.email;
  if (authUserErr || !donorEmail) return json({ error: "Donor auth user not found or missing email" }, 400);
  const { error: unbanErr } = await adminClient.auth.admin.updateUserById(donorUserId, {
    ban_duration: "none",
  });
  if (unbanErr) return json({ error: `Failed to activate donor user: ${unbanErr.message}` }, 500);

  const reviewedAt = new Date().toISOString();
  const { error: donorUpdateErr } = await adminClient
    .from("donors")
    .update({ id_card_verified: true, reviewed_at: reviewedAt, reviewed_by: callerUserId })
    .eq("user_id", donorUserId);
  if (donorUpdateErr) return json({ error: `Failed to update donors row: ${donorUpdateErr.message}` }, 500);

  await adminClient.from("donor_verification_events").insert({
    donor_user_id: donorUserId,
    admin_user_id: callerUserId,
    verified_at: reviewedAt,
    note: "Approved",
  });

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

  let emailResult: { sent: boolean; error?: string; mailjetConfigured?: boolean } | null = null;
  if (mj.ok) {
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color: #111;">
        <h2 style="margin:0 0 12px 0; font-size: 20px;">Welcome${donor.name ? `, ${donor.name}` : ""}</h2>
        <p style="margin:0 0 12px 0;">Your donor registration has been <b>approved</b>.</p>
        <p style="margin:0 0 12px 0;">You can sign in with the password you set when you registered.</p>
        ${
          appUrl
            ? `<p style="margin:0 0 12px 0;">
                <a href="${appUrl}/sign-in" style="color:#b91c1c;">Sign in</a>
                &nbsp;·&nbsp;
                <a href="${appUrl}/donor/dashboard" style="color:#b91c1c;">Donor dashboard</a>
              </p>`
            : ""
        }
        <p style="margin:12px 0 0 0; color:#525252; font-size:12px;">This message was sent because an administrator approved your profile on Raktodaan.</p>
      </div>
    `;
    const text = [
      `Welcome${donor.name ? `, ${donor.name}` : ""}`,
      "",
      "Your donor registration has been approved.",
      "You can sign in with the password you set when you registered.",
      appUrl ? `Sign in: ${appUrl}/sign-in` : "",
      appUrl ? `Donor dashboard: ${appUrl}/donor/dashboard` : "",
      "",
      "This message was sent because an administrator approved your profile on Raktodaan.",
    ]
      .filter(Boolean)
      .join("\n");

    const vars = {
      displayName: donor.name ? `, ${donor.name}` : "",
      signInUrl: appUrl ? `${appUrl}/sign-in` : "",
      dashboardUrl: appUrl ? `${appUrl}/donor/dashboard` : "",
    };

    let subject = "Your Raktodaan donor profile is approved";
    let preheader = "Your donor registration was approved — sign in to continue.";
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
      .eq("template_key", "donor_approved_welcome")
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
        toName: donor.name ?? null,
        subject,
        html: htmlToSend,
        text: textToSend,
        preheader,
        customId: `donor_approved:${donorUserId}`,
      });
      emailResult = { sent: true, mailjetConfigured: true };
      await logEmailEvent(adminClient, {
        event_type: "donor_approved_welcome",
        actor_user_id: callerUserId,
        target_user_id: donorUserId,
        target_email: donorEmail,
        status: "sent",
        metadata: { mailjet: "sent" },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Mailjet send failed";
      emailResult = { sent: false, error: msg, mailjetConfigured: true };
      await logEmailEvent(adminClient, {
        event_type: "donor_approved_welcome",
        actor_user_id: callerUserId,
        target_user_id: donorUserId,
        target_email: donorEmail,
        status: "failed",
        error_message: msg,
        metadata: { mailjet: "api_error" },
      });
    }
  } else {
    emailResult = { sent: false, error: mj.reason, mailjetConfigured: false };
    await logEmailEvent(adminClient, {
      event_type: "donor_approved_welcome",
      actor_user_id: callerUserId,
      target_user_id: donorUserId,
      target_email: donorEmail,
      status: "skipped",
      error_message: mj.reason,
      metadata: { reason: "mailjet_env_missing" },
    });
  }

  return json({ ok: true, emailResult });
}

