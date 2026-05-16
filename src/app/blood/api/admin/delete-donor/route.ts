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
  if (!resp.ok) {
    throw new Error(text || `Auth user fetch failed (${resp.status})`);
  }
  const json = JSON.parse(text) as { id?: string };
  if (!json?.id) throw new Error("Auth user id missing");
  return { user_id: json.id };
}

type Body = { donor_user_id?: string };

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth) {
    return json({ error: "Missing Authorization bearer token" }, 401);
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey =
    process.env.SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl) {
    return json({ error: "Missing SUPABASE_URL" }, 500);
  }
  if (!anonKey || !serviceRoleKey) {
    return json({ error: "Missing SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const jwt = auth.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Missing Authorization bearer token" }, 401);

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
      .select("can_delete_donor")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!Boolean((permRow as { can_delete_donor?: boolean } | null)?.can_delete_donor)) {
      return json({ error: "Forbidden: delete donor permission required" }, 403);
    }
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const donorUserId = body.donor_user_id;
  if (!donorUserId) return json({ error: "Missing donor_user_id" }, 400);

  const { data: donorSnap } = await adminClient
    .from("donors")
    .select("name,blood_group,district,contact_number")
    .eq("user_id", donorUserId)
    .maybeSingle();

  // Hard delete user-linked rows so no personal data remains in logs/history tables
  // that otherwise keep rows via ON DELETE SET NULL.
  const purgeByUserId = async (table: string, col: string) => {
    const { error } = await adminClient.from(table).delete().eq(col, donorUserId);
    if (error) throw new Error(`${table}.${col} purge failed: ${error.message}`);
  };

  const cleanupBucket = async (bucket: string) => {
    const { data: objects } = await adminClient.storage.from(bucket).list(donorUserId);
    const names = (objects ?? []).map((o) => o.name);
    const paths = names.map((name) => `${donorUserId}/${name}`);
    if (paths.length === 0) return;
    await adminClient.storage.from(bucket).remove(paths);
  };

  await cleanupBucket("donor-ids");
  await cleanupBucket("donor-photos");

  // Purge rows where this user appears as owner/actor/target/rater.
  await purgeByUserId("donor_ratings", "donor_user_id");
  await purgeByUserId("donor_ratings", "rater_user_id");
  await purgeByUserId("donor_notification_prefs", "donor_user_id");
  await purgeByUserId("donor_webpush_subscriptions", "donor_user_id");
  await purgeByUserId("donor_fcm_tokens", "donor_user_id");
  await purgeByUserId("donation_history", "donor_user_id");
  await purgeByUserId("donor_verification_events", "donor_user_id");
  await purgeByUserId("super_admin_audit_logs", "actor_user_id");
  await purgeByUserId("user_email_event_logs", "actor_user_id");
  await purgeByUserId("user_email_event_logs", "target_user_id");
  await purgeByUserId("emergency_notification_logs", "donor_user_id");
  await purgeByUserId("admin_permissions", "user_id");
  await purgeByUserId("hospital_permissions", "user_id");
  await purgeByUserId("hospital_users", "user_id");
  await purgeByUserId("admin_users", "user_id");
  await purgeByUserId("profiles", "user_id");

  const { error: delUserErr } = await adminClient.auth.admin.deleteUser(donorUserId);
  if (delUserErr) return json({ error: `Failed to delete user: ${delUserErr.message}` }, 500);

  await logSuperAdminAction(adminClient, {
    actor_user_id: callerUserId,
    action_type: "donor_deleted",
    target_kind: "donor",
    target_id: donorUserId,
    metadata: { snapshot: donorSnap ?? null },
  });

  return json({ ok: true });
}

