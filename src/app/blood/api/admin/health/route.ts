import { createClient } from "@supabase/supabase-js";
import { getMailjetConfig } from "@/lib/mailjet";

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

export async function GET(req: Request) {
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
      .select("can_view_system_health")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!Boolean((permRow as { can_view_system_health?: boolean } | null)?.can_view_system_health)) {
      return json({ error: "Forbidden: system health permission required" }, 403);
    }
  }

  const mj = getMailjetConfig();
  const mailjetConfigured = mj.ok;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const failedEmailsP = adminClient
    .from("user_email_event_logs")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", since);

  const openEmergenciesP = adminClient
    .from("emergency_requests")
    .select("request_id", { count: "exact", head: true })
    .eq("status", "open");

  const notifyFailedP = adminClient
    .from("emergency_notification_logs")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", since);

  const escalatedOpenP = adminClient
    .from("emergency_requests")
    .select("request_id", { count: "exact", head: true })
    .eq("status", "open")
    .not("escalated_at", "is", null);

  const oldestOpenP = adminClient
    .from("emergency_requests")
    .select("created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const [failedEmailsR, openEmergenciesR, notifyFailedR, escalatedOpenR, oldestOpenR] = await Promise.all([
    failedEmailsP,
    openEmergenciesP,
    notifyFailedP,
    escalatedOpenP,
    oldestOpenP,
  ]);

  if (failedEmailsR.error) {
    return json({ error: failedEmailsR.error.message }, 500);
  }
  if (openEmergenciesR.error) {
    return json({ error: openEmergenciesR.error.message }, 500);
  }
  if (notifyFailedR.error) {
    return json({ error: notifyFailedR.error.message }, 500);
  }
  if (escalatedOpenR.error) {
    return json({ error: escalatedOpenR.error.message }, 500);
  }
  if (oldestOpenR.error) {
    return json({ error: oldestOpenR.error.message }, 500);
  }

  const oldestOpenCreatedAt =
    (oldestOpenR.data as { created_at?: string } | null)?.created_at ?? null;
  let oldestOpenAgeMinutes: number | null = null;
  if (oldestOpenCreatedAt) {
    const ms = new Date(oldestOpenCreatedAt).getTime();
    if (!Number.isNaN(ms)) {
      oldestOpenAgeMinutes = Math.max(0, Math.floor((Date.now() - ms) / (60 * 1000)));
    }
  }

  return json({
    ok: true,
    mailjetConfigured,
    userEmailFailures24h: failedEmailsR.count ?? 0,
    openEmergencies: openEmergenciesR.count ?? 0,
    emergencyNotifySendFailures24h: notifyFailedR.count ?? 0,
    escalatedOpenEmergencies: escalatedOpenR.count ?? 0,
    oldestOpenAgeMinutes,
  });
}
