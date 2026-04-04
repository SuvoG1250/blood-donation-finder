import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

type ListResponseRow = {
  user_id: string;
  email: string | null;
  admin_role: string;
  created_at: string | null;
};

type Body =
  | { action: "list" }
  | { action: "set_role"; user_id: string; admin_role: "staff" | "super_admin" }
  | {
      action: "create_admin";
      email: string;
      password: string;
      admin_role?: "staff" | "super_admin";
    }
  | {
      action: "create_hospital";
      email: string;
      password: string;
      hospital_name?: string;
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

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = new Array(Math.max(1, limit)).fill(null).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
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
  if (roleErr) return jsonResponse({ error: "Super admin check failed" }, 500);
  if ((roleRow as { admin_role?: string } | null)?.admin_role !== "super_admin") {
    return jsonResponse({ error: "Forbidden: super admin only" }, 403);
  }

  const rawBody = (await req.json().catch(() => ({}))) as unknown;
  const body = rawBody as Body;
  if (!rawBody || typeof rawBody !== "object" || !("action" in rawBody)) {
    return jsonResponse({ error: "Missing action" }, 400);
  }
  const action = (rawBody as { action?: unknown }).action;
  if (typeof action !== "string") {
    return jsonResponse({ error: "Missing action" }, 400);
  }

  if (body.action === "list") {
    const { data: rows, error } = await adminClient
      .from("admin_users")
      .select("user_id,admin_role,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return jsonResponse({ error: error.message }, 500);

    const base = (rows ?? []) as Array<{
      user_id: string;
      admin_role?: string | null;
      created_at?: string | null;
    }>;

    const enriched = await mapLimit(base, 10, async (r): Promise<ListResponseRow> => {
      const { data: userRes } = await adminClient.auth.admin.getUserById(r.user_id);
      return {
        user_id: r.user_id,
        email: userRes?.user?.email ?? null,
        admin_role: (r.admin_role ?? "staff") as string,
        created_at: r.created_at ?? null,
      };
    });

    return jsonResponse({ ok: true, admins: enriched });
  }

  if (body.action === "set_role") {
    const userId = body.user_id;
    const role = body.admin_role;
    if (!userId) return jsonResponse({ error: "Missing user_id" }, 400);
    if (role !== "staff" && role !== "super_admin") {
      return jsonResponse({ error: "Invalid admin_role" }, 400);
    }

    // Prevent removing the last super admin.
    if (role !== "super_admin") {
      const { data: supers, error: superErr } = await adminClient
        .from("admin_users")
        .select("user_id", { count: "exact" })
        .eq("admin_role", "super_admin");
      if (superErr) return jsonResponse({ error: superErr.message }, 500);
      const superCount = (supers ?? []).length;
      if (superCount <= 1 && userId === callerUser.user.id) {
        return jsonResponse({ error: "Cannot demote the last super admin." }, 400);
      }
    }

    const { error: updErr } = await adminClient
      .from("admin_users")
      .update({ admin_role: role })
      .eq("user_id", userId);
    if (updErr) return jsonResponse({ error: updErr.message }, 500);

    return jsonResponse({ ok: true });
  }

  if (body.action === "create_admin") {
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const role = body.admin_role === "super_admin" ? "super_admin" : "staff";

    if (!email || !email.includes("@")) return jsonResponse({ error: "Invalid email" }, 400);
    if (password.length < 6) return jsonResponse({ error: "Password too short" }, 400);

    // Create (or fetch) auth user.
    let userId: string | null = null;
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr) {
      // If already exists, locate by email.
      const msg = createErr.message.toLowerCase();
      if (msg.includes("already") || msg.includes("exists")) {
        const { data: listRes, error: listErr } = await adminClient.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        if (listErr) return jsonResponse({ error: listErr.message }, 500);
        const match = (listRes?.users ?? []).find(
          (u) => (u.email ?? "").toLowerCase() === email,
        );
        userId = match?.id ?? null;
      } else {
        return jsonResponse({ error: createErr.message }, 500);
      }
    } else {
      userId = created?.user?.id ?? null;
    }

    if (!userId) return jsonResponse({ error: "Unable to create or find user." }, 500);

    // Ensure profiles row exists; then force password change on first login.
    const nowIso = new Date().toISOString();
    const expiryHours = Number(Deno.env.get("TEMP_PASSWORD_EXPIRY_HOURS") ?? "72");
    const exp = new Date();
    exp.setHours(exp.getHours() + Math.max(1, Math.min(168, expiryHours)));
    const expIso = exp.toISOString();

    await adminClient
      .from("profiles")
      .upsert({ user_id: userId, role: "seeker" }, { onConflict: "user_id" });

    await adminClient
      .from("profiles")
      .update({
        must_change_password: true,
        temp_password_set_at: nowIso,
        temp_password_expires_at: expIso,
      })
      .eq("user_id", userId);

    // Grant admin access (idempotent).
    const { error: insErr } = await adminClient
      .from("admin_users")
      .upsert({ user_id: userId, admin_role: role }, { onConflict: "user_id" });
    if (insErr) return jsonResponse({ error: insErr.message }, 500);

    return jsonResponse({ ok: true, user_id: userId });
  }

  if (body.action === "create_hospital") {
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    const hospitalName = (body.hospital_name ?? "").trim() || null;

    if (!email || !email.includes("@")) return jsonResponse({ error: "Invalid email" }, 400);
    if (password.length < 6) return jsonResponse({ error: "Password too short" }, 400);

    let userId: string | null = null;
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr) {
      const msg = createErr.message.toLowerCase();
      if (msg.includes("already") || msg.includes("exists")) {
        const { data: listRes, error: listErr } = await adminClient.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        if (listErr) return jsonResponse({ error: listErr.message }, 500);
        const match = (listRes?.users ?? []).find(
          (u) => (u.email ?? "").toLowerCase() === email,
        );
        userId = match?.id ?? null;
      } else {
        return jsonResponse({ error: createErr.message }, 500);
      }
    } else {
      userId = created?.user?.id ?? null;
    }

    if (!userId) return jsonResponse({ error: "Unable to create or find user." }, 500);

    const nowIso = new Date().toISOString();
    const expiryHours = Number(Deno.env.get("TEMP_PASSWORD_EXPIRY_HOURS") ?? "72");
    const exp = new Date();
    exp.setHours(exp.getHours() + Math.max(1, Math.min(168, expiryHours)));
    const expIso = exp.toISOString();

    await adminClient
      .from("profiles")
      .upsert({ user_id: userId, role: "hospital" }, { onConflict: "user_id" });

    await adminClient
      .from("profiles")
      .update({
        role: "hospital",
        must_change_password: true,
        temp_password_set_at: nowIso,
        temp_password_expires_at: expIso,
      })
      .eq("user_id", userId);

    const { error: hospitalErr } = await adminClient
      .from("hospital_users")
      .upsert({ user_id: userId, name: hospitalName }, { onConflict: "user_id" });
    if (hospitalErr) return jsonResponse({ error: hospitalErr.message }, 500);

    return jsonResponse({ ok: true, user_id: userId });
  }

  return jsonResponse({ error: "Unknown action" }, 400);
});

