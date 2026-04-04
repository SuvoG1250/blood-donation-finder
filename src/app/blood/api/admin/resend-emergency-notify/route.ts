import { createClient } from "@supabase/supabase-js";
import { logSuperAdminAction } from "@/lib/superAdminAudit";

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

type Body = { request_id?: string };

const RESEND_COOLDOWN_MS = 60 * 60 * 1000;

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
      .select("can_resend_emergency_notify")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!Boolean((permRow as { can_resend_emergency_notify?: boolean } | null)?.can_resend_emergency_notify)) {
      return json({ error: "Forbidden: re-notify permission required" }, 403);
    }
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const requestId = body.request_id;
  if (!requestId) return json({ error: "Missing request_id" }, 400);

  const sinceIso = new Date(Date.now() - RESEND_COOLDOWN_MS).toISOString();
  const { data: recentResend, error: auditErr } = await adminClient
    .from("super_admin_audit_logs")
    .select("id")
    .eq("action_type", "emergency_notify_resend")
    .eq("target_id", requestId)
    .gte("created_at", sinceIso)
    .limit(1);

  if (auditErr) {
    return json({ error: `Rate check failed: ${auditErr.message}` }, 500);
  }

  if (recentResend && recentResend.length > 0) {
    return json(
      { error: "This request was re-notified within the last hour. Try again later." },
      429,
    );
  }

  const upstream = await fetch(`${supabaseUrl}/functions/v1/notify-donors-on-emergency`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      apikey: anonKey,
    },
    body: JSON.stringify({ request_id: requestId }),
  });

  const text = await upstream.text();
  let parsed: { error?: string; ok?: boolean } = {};
  try {
    parsed = text ? (JSON.parse(text) as { error?: string; ok?: boolean }) : {};
  } catch {
    parsed = {};
  }

  if (!upstream.ok) {
    return json(
      { error: parsed?.error ?? text.slice(0, 300) ?? `Notify failed (${upstream.status})` },
      502,
    );
  }

  await logSuperAdminAction(adminClient, {
    actor_user_id: callerUserId,
    action_type: "emergency_notify_resend",
    target_kind: "emergency_request",
    target_id: requestId,
    metadata: { request_id: requestId, edge_ok: parsed?.ok ?? true },
  });

  return json({ ok: true });
}
