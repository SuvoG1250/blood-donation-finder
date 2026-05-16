import { createClient } from "@supabase/supabase-js";

type Body = {
  donor_user_id?: string;
  is_trusted?: boolean;
};

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
  const parsed = JSON.parse(text) as { id?: string };
  if (!parsed?.id) throw new Error("Auth user id missing");
  return { user_id: parsed.id };
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

  const { data: adminRow, error: adminErr } = await adminClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", callerUserId)
    .maybeSingle();
  if (adminErr) return json({ error: `Admin check failed: ${adminErr.message}` }, 500);
  if (!adminRow) return json({ error: "Forbidden: admin only" }, 403);

  const { data: isSuperAdminData, error: superErr } = await adminClient.rpc("is_super_admin", {});
  if (superErr) return json({ error: `Super admin check failed: ${superErr.message}` }, 500);
  if (!isSuperAdminData) return json({ error: "Forbidden: super admin only" }, 403);

  const body = (await req.json().catch(() => ({}))) as Body;
  const donorUserId = String(body.donor_user_id ?? "").trim();
  if (!donorUserId) return json({ error: "Missing donor_user_id" }, 400);
  const nextTrusted = Boolean(body.is_trusted);

  const { data: donorRow, error: donorErr } = await adminClient
    .from("donors")
    .select("user_id,is_trusted")
    .eq("user_id", donorUserId)
    .maybeSingle();
  if (donorErr || !donorRow) return json({ error: "Donor not found" }, 404);

  const prevTrusted = Boolean((donorRow as { is_trusted?: boolean | null }).is_trusted ?? false);
  if (prevTrusted === nextTrusted) {
    return json({ ok: true, changed: false, is_trusted: nextTrusted });
  }

  const { error: updErr } = await adminClient
    .from("donors")
    .update({
      is_trusted: nextTrusted,
      reviewed_at: new Date().toISOString(),
      reviewed_by: callerUserId,
    })
    .eq("user_id", donorUserId);
  if (updErr) return json({ error: `Failed to update donor trust: ${updErr.message}` }, 500);

  await adminClient.from("admin_audit_logs").insert({
    actor_user_id: callerUserId,
    action_type: "donor_trust_bridge_updated",
    target_type: "donor",
    target_id: donorUserId,
    metadata: { previous: prevTrusted, next: nextTrusted },
  });

  return json({ ok: true, changed: true, is_trusted: nextTrusted });
}
