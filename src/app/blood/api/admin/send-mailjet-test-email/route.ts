import { createClient } from "@supabase/supabase-js";
import { getMailjetConfig, sendMailjetMessage } from "@/lib/mailjet";

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
  if (!resp.ok) throw new Error(text || `Auth user fetch failed (${resp.status})`);
  const data = JSON.parse(text) as { id?: string };
  if (!data?.id) throw new Error("Auth user id missing");
  return { user_id: data.id };
}

type Body = { to_email?: string };

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Missing Authorization bearer token" }, 401);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(
      { error: "Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" },
      500,
    );
  }

  let callerUserId: string;
  try {
    callerUserId = (await getCallerUserIdOrThrow({ supabaseUrl, anonKey, jwt })).user_id;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unauthorized caller";
    return json({ error: `Unauthorized caller: ${msg}` }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: roleRow, error: roleErr } = await adminClient
    .from("admin_users")
    .select("admin_role")
    .eq("user_id", callerUserId)
    .maybeSingle();
  if (roleErr) return json({ error: `Super admin check failed: ${roleErr.message}` }, 500);
  if ((roleRow as { admin_role?: string } | null)?.admin_role !== "super_admin") {
    const { data: permRow } = await adminClient
      .from("admin_permissions")
      .select("can_send_mailjet_test_email")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!Boolean((permRow as { can_send_mailjet_test_email?: boolean } | null)?.can_send_mailjet_test_email)) {
      return json({ error: "Forbidden: Mailjet test permission required" }, 403);
    }
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const toEmail = (body.to_email ?? "").trim();
  if (!toEmail) return json({ error: "Missing to_email" }, 400);

  const mj = getMailjetConfig();
  if (!mj.ok) {
    await adminClient.from("user_email_event_logs").insert({
      event_type: "mailjet_test_email",
      actor_user_id: callerUserId,
      target_user_id: null,
      target_email: toEmail,
      status: "skipped",
      error_message: mj.reason,
      metadata: { reason: "mailjet_env_missing" },
    });
    return json({ ok: true, skipped: true, reason: mj.reason });
  }

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color:#111;">
      <h2 style="margin:0 0 10px 0; font-size:18px;">Mailjet test email</h2>
      <p style="margin:0 0 10px 0;">If you received this, Mailjet configuration and sending are working.</p>
      <p style="margin:0; color:#555; font-size:12px;">Raktodaan system test.</p>
    </div>
  `;
  const text = [
    "Mailjet test email",
    "If you received this, Mailjet configuration and sending are working.",
    "Raktodaan system test.",
  ].join("\n");

  const preheader = "Raktodaan system test — no action needed.";

  try {
    await sendMailjetMessage(mj.config, {
      toEmail,
      subject: "Raktodaan: Mailjet test email",
      html,
      text,
      preheader,
      customId: `mailjet_test:${callerUserId}`,
    });

    await adminClient.from("user_email_event_logs").insert({
      event_type: "mailjet_test_email",
      actor_user_id: callerUserId,
      target_user_id: null,
      target_email: toEmail,
      status: "sent",
      error_message: null,
      metadata: { mailjet: "sent" },
    });

    return json({ ok: true, sent: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Mailjet test send failed";
    try {
      await adminClient.from("user_email_event_logs").insert({
        event_type: "mailjet_test_email",
        actor_user_id: callerUserId,
        target_user_id: null,
        target_email: toEmail,
        status: "failed",
        error_message: msg,
        metadata: { mailjet: "api_error" },
      });
    } catch {
      // non-blocking
    }
    return json({ ok: true, sent: false, error: msg });
  }
}

