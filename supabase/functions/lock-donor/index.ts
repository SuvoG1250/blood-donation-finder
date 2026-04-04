import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

type LockDonorBody = {
  donor_user_id?: string;
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

  // Identify caller (must be the donor themselves).
  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: callerUser, error: callerErr } = await adminClient.auth.getUser(jwt);
  if (callerErr || !callerUser?.user) return jsonResponse({ error: "Unauthorized" }, 401);

  const body = (await req.json().catch(() => ({}))) as LockDonorBody;
  const donorUserId = body.donor_user_id ?? callerUser.user.id;
  if (donorUserId !== callerUser.user.id) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  // Ensure they have a donors row and it's not verified yet.
  const { data: donor, error: donorErr } = await adminClient
    .from("donors")
    .select("user_id, id_card_verified")
    .eq("user_id", donorUserId)
    .maybeSingle();
  if (donorErr || !donor) return jsonResponse({ error: "Donor record not found" }, 404);
  if (donor.id_card_verified) return jsonResponse({ ok: true, already_verified: true });

  // Ban the user (prevents login until admin approves).
  // 876000h ~ 100 years, effectively "locked".
  const { error: banErr } = await adminClient.auth.admin.updateUserById(donorUserId, {
    ban_duration: "876000h",
  });
  if (banErr) {
    return jsonResponse({ error: `Failed to lock user: ${banErr.message}` }, 500);
  }

  return jsonResponse({ ok: true });
});

