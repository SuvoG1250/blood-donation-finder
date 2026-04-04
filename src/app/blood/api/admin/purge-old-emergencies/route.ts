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

type Body = { days_old?: number };

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
      .select("can_edit_site_settings")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!Boolean((permRow as { can_edit_site_settings?: boolean } | null)?.can_edit_site_settings)) {
      return json({ error: "Forbidden: site settings permission required" }, 403);
    }
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  let daysOld = typeof body.days_old === "number" ? body.days_old : null;
  if (daysOld === null || Number.isNaN(daysOld)) {
    const { data: settingRow } = await adminClient
      .from("public_site_settings")
      .select("setting_value")
      .eq("setting_key", "emergency_retention_days")
      .maybeSingle();
    const parsed = parseInt((settingRow as { setting_value?: string } | null)?.setting_value ?? "365", 10);
    daysOld = Number.isFinite(parsed) && parsed > 0 ? parsed : 365;
  }
  daysOld = Math.max(30, Math.min(3650, Math.floor(daysOld)));

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - daysOld);
  const cutoffIso = cutoff.toISOString();

  const { data: toDelete, error: selErr } = await adminClient
    .from("emergency_requests")
    .select("request_id")
    .in("status", ["fulfilled", "expired", "cancelled"])
    .lt("created_at", cutoffIso)
    .limit(2000);

  if (selErr) return json({ error: selErr.message }, 500);

  const ids = (toDelete ?? []).map((r) => (r as { request_id: string }).request_id);
  if (ids.length === 0) {
    return json({ ok: true, deleted: 0, days_old: daysOld, cutoff: cutoffIso });
  }

  const { error: delErr } = await adminClient
    .from("emergency_requests")
    .delete()
    .in("request_id", ids);

  if (delErr) return json({ error: delErr.message }, 500);

  await logSuperAdminAction(adminClient, {
    actor_user_id: callerUserId,
    action_type: "emergency_retention_purge",
    target_kind: "emergency_request",
    target_id: null,
    metadata: { deleted: ids.length, days_old: daysOld, cutoff: cutoffIso },
  });

  return json({ ok: true, deleted: ids.length, days_old: daysOld, cutoff: cutoffIso });
}
