import { createClient } from "@supabase/supabase-js";

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Body = { q?: string };

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
      .select("can_view_donor_lookup")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!Boolean((permRow as { can_view_donor_lookup?: boolean } | null)?.can_view_donor_lookup)) {
      return json({ error: "Forbidden: donor lookup permission required" }, 403);
    }
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const rawQ = (body.q ?? "").trim();
  if (!rawQ) return json({ error: "Missing search query (q)" }, 400);
  if (rawQ.length < 2) return json({ error: "Query too short" }, 400);

  type DonorRow = {
    user_id: string;
    name: string;
    blood_group: string;
    district: string;
    block: string;
    panchayat: string;
    contact_number: string | null;
    id_card_verified: boolean | null;
    rejection_reason: string | null;
    last_donation_date: string | null;
  };

  const donorSelect =
    "user_id,name,blood_group,district,block,panchayat,contact_number,id_card_verified,rejection_reason,last_donation_date";

  let donors: DonorRow[] = [];

  if (UUID_RE.test(rawQ)) {
    const { data, error } = await adminClient
      .from("donors")
      .select(donorSelect)
      .eq("user_id", rawQ)
      .limit(5);
    if (error) return json({ error: error.message }, 500);
    donors = (data as DonorRow[]) ?? [];
  } else if (rawQ.includes("@")) {
    try {
      const target = rawQ.trim().toLowerCase();
      let uid: string | null = null;
      for (let page = 1; page <= 15; page++) {
        const { data, error: listErr } = await adminClient.auth.admin.listUsers({
          page,
          perPage: 200,
        });
        if (listErr) throw listErr;
        const users = data?.users ?? [];
        const u = users.find((x) => (x.email ?? "").toLowerCase() === target);
        if (u) {
          uid = u.id;
          break;
        }
        if (users.length < 200) break;
      }
      if (!uid) {
        return json({ ok: true, donors: [] });
      }
      const { data, error } = await adminClient
        .from("donors")
        .select(donorSelect)
        .eq("user_id", uid)
        .limit(5);
      if (error) return json({ error: error.message }, 500);
      donors = (data as DonorRow[]) ?? [];
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Email search failed";
      return json({ error: msg }, 500);
    }
  } else {
    const term = `%${rawQ.replace(/%/g, "\\%")}%`;
    const { data, error } = await adminClient
      .from("donors")
      .select(donorSelect)
      .ilike("contact_number", term)
      .limit(40);
    if (error) return json({ error: error.message }, 500);
    donors = (data as DonorRow[]) ?? [];
  }

  const withEmail = await Promise.all(
    donors.map(async (d) => {
      const { data: authData } = await adminClient.auth.admin.getUserById(d.user_id);
      return {
        ...d,
        auth_email: authData.user?.email ?? null,
      };
    }),
  );

  return json({ ok: true, donors: withEmail });
}
