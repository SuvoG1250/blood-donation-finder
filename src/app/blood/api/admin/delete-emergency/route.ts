import { createClient } from "@supabase/supabase-js";
import { logSuperAdminAction } from "@/lib/superAdminAudit";

type Body = { request_id?: string };

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
      .select("can_delete_emergency")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!Boolean((permRow as { can_delete_emergency?: boolean } | null)?.can_delete_emergency)) {
      return json({ error: "Forbidden: delete emergency permission required" }, 403);
    }
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const requestId = body.request_id;
  if (!requestId) return json({ error: "Missing request_id" }, 400);

  const { data: emSnap } = await adminClient
    .from("emergency_requests")
    .select("blood_group,district,block,status")
    .eq("request_id", requestId)
    .maybeSingle();

  const { error: delErr } = await adminClient
    .from("emergency_requests")
    .delete()
    .eq("request_id", requestId);
  if (delErr) return json({ error: `Failed to delete emergency: ${delErr.message}` }, 500);

  await logSuperAdminAction(adminClient, {
    actor_user_id: callerUserId,
    action_type: "emergency_deleted",
    target_kind: "emergency_request",
    target_id: requestId,
    metadata: { snapshot: emSnap ?? null },
  });

  return json({ ok: true });
}

