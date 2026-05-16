import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

type Body = {
  days_old?: number;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return jsonResponse(
      { error: "Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" },
      500,
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return jsonResponse({ error: "Missing Authorization bearer token" }, 401);

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: callerUser, error: callerErr } = await userClient.auth.getUser();
  if (callerErr || !callerUser?.user) {
    return jsonResponse({ error: "Unauthorized caller" }, 401);
  }

  const canCheck = await userClient.rpc("admin_can", {
    action: "bulk_expire_open_emergencies",
  });
  if (canCheck.error) return jsonResponse({ error: "Permission check failed" }, 500);
  if (!canCheck.data) return jsonResponse({ error: "Forbidden: permission required" }, 403);

  const body = (await req.json().catch(() => ({}))) as Body;
  const daysOld = Math.max(1, Math.min(30, Number(body.days_old ?? 2)));
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysOld);
  const cutoffIso = cutoff.toISOString();

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

  const { data: beforeRows, error: beforeErr } = await adminClient
    .from("emergency_requests")
    .select("request_id")
    .eq("status", "open")
    .lt("created_at", cutoffIso);
  if (beforeErr) return jsonResponse({ error: beforeErr.message }, 500);

  const candidateCount = (beforeRows ?? []).length;
  if (candidateCount === 0) {
    return jsonResponse({ ok: true, updated: 0 });
  }

  const { error: updErr } = await adminClient
    .from("emergency_requests")
    .update({ status: "expired" })
    .eq("status", "open")
    .lt("created_at", cutoffIso);
  if (updErr) return jsonResponse({ error: updErr.message }, 500);

  return jsonResponse({ ok: true, updated: candidateCount });
});

