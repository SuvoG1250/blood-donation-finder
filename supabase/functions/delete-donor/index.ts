import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

type DeleteDonorBody = {
  donor_user_id: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers":
          "authorization, x-client-info, apikey, content-type",
        "access-control-allow-methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(
      { error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      500,
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return jsonResponse({ error: "Missing Authorization bearer token" }, 401);

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: callerUser, error: callerErr } = await adminClient.auth.getUser(jwt);
  if (callerErr || !callerUser?.user) return jsonResponse({ error: "Unauthorized caller" }, 401);
  const { data: roleRow, error: roleErr } = await adminClient
    .from("admin_users")
    .select("admin_role")
    .eq("user_id", callerUser.user.id)
    .maybeSingle();
  if (roleErr) {
    return jsonResponse({ error: "Super admin check failed" }, 500);
  }
  if ((roleRow as { admin_role?: string } | null)?.admin_role !== "super_admin") {
    return jsonResponse({ error: "Forbidden: super admin only" }, 403);
  }

  const body = (await req.json().catch(() => ({}))) as DeleteDonorBody;
  const donorUserId = body?.donor_user_id;
  if (!donorUserId) return jsonResponse({ error: "Missing donor_user_id" }, 400);

  // Best-effort cleanup of storage objects (they're also removed if auth user is deleted,
  // but RLS/bucket policies vary so we explicitly delete to keep the bucket clean).
  const cleanupBucket = async (bucket: string) => {
    const { data: objects } = await adminClient.storage.from(bucket).list(donorUserId);
    const names = (objects ?? []).map((o) => o.name);
    const paths = names.map((name) => `${donorUserId}/${name}`);
    if (paths.length === 0) return;
    const { error } = await adminClient.storage.from(bucket).remove(paths);
    if (error) {
      // Don't hard-fail deletion if storage cleanup fails; the user deletion is the primary action.
      console.warn(`Failed to remove objects from bucket ${bucket}:`, error.message);
    }
  };

  await cleanupBucket("donor-ids");
  await cleanupBucket("donor-photos");

  // Deleting the auth user cascades to profiles (FK on delete cascade) which cascades to donors.
  const { error: delUserErr } = await adminClient.auth.admin.deleteUser(donorUserId);
  if (delUserErr) {
    return jsonResponse({ error: `Failed to delete user: ${delUserErr.message}` }, 500);
  }

  return jsonResponse({ ok: true });
});

