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

type Body = { request_id?: string };

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
      .select("can_preview_emergency_notifications")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!Boolean((permRow as { can_preview_emergency_notifications?: boolean } | null)?.can_preview_emergency_notifications)) {
      return json({ error: "Forbidden: emergency preview permission required" }, 403);
    }
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const requestId = body.request_id;
  if (!requestId) return json({ error: "Missing request_id" }, 400);

  const { data: emergency, error: emErr } = await adminClient
    .from("emergency_requests")
    .select(
      "request_id,blood_group,district,block,panchayat,patient_name,request_details,contact_number,created_at",
    )
    .eq("request_id", requestId)
    .maybeSingle();

  if (emErr || !emergency) return json({ error: "Emergency request not found" }, 404);

  const dt = emergency.created_at ? new Date(emergency.created_at) : new Date();
  const day = Number.isNaN(dt.getTime()) ? 1 : dt.getUTCDay(); // 0=Sun..6=Sat
  const dayMap: Record<number, string> = {
    0: "Sun",
    1: "Mon",
    2: "Tue",
    3: "Wed",
    4: "Thu",
    5: "Fri",
    6: "Sat",
  };
  const p_day = dayMap[day] ?? "Mon";
  const hour = Number.isNaN(dt.getTime()) ? 9 : dt.getUTCHours();
  const p_time_slot =
    hour >= 5 && hour < 12
      ? "Morning"
      : hour >= 12 && hour < 17
        ? "Afternoon"
        : "Evening";

  // Use the same RPC as the email edge function (eligibility + preferences).
  const { data: matchedRows, error: matchErr } = await adminClient.rpc(
    "get_donors_for_emergency",
    {
      p_blood_group: emergency.blood_group,
      p_district: emergency.district,
      p_block: emergency.block,
      p_panchayat: emergency.panchayat,
      p_day,
      p_time_slot,
    },
  );

  if (matchErr) {
    return json({ error: `Failed to match donors: ${matchErr.message}` }, 500);
  }

  const recipientRows: Array<{ donor_user_id: string; donor_email: string | null }> = (
    (matchedRows ?? []) as Array<{ donor_user_id: string; email: string | null }>
  ).map((r) => ({ donor_user_id: r.donor_user_id, donor_email: r.email }));

  const matchedWithEmail = recipientRows.filter((r) => Boolean(r.donor_email)).length;
  const withoutEmail = recipientRows.filter((r) => !r.donor_email).length;

  // Same dedup-by-email logic as the Edge Function.
  const dedup = new Map<string, string>();
  for (const row of recipientRows) {
    if (!row.donor_email) continue;
    if (!dedup.has(row.donor_email)) dedup.set(row.donor_email, row.donor_user_id);
  }
  const uniqueRecipients = Array.from(dedup.entries()).map(([donor_email, donor_user_id]) => ({
    donor_email,
    donor_user_id,
  }));

  // Mask emails in preview UI (still clear enough for admin).
  const sample = uniqueRecipients.slice(0, 10).map((r) => {
    const [user, domain] = r.donor_email.split("@");
    const maskedUser = user.length <= 2 ? `${user[0] ?? "*"}*` : `${user.slice(0, 2)}***`;
    return {
      donor_user_id: r.donor_user_id,
      donor_email_masked: `${maskedUser}@${domain ?? ""}`,
    };
  });

  // Non-destructive preview; no logs written.
  return json({
    ok: true,
    request_id: requestId,
    emergency: {
      blood_group: emergency.blood_group,
      district: emergency.district,
      block: emergency.block,
      panchayat: emergency.panchayat,
      patient_name: emergency.patient_name ?? null,
      contact_number: emergency.contact_number ?? null,
      created_at: emergency.created_at,
    },
    eligibleDonors: recipientRows.length,
    matchedWithEmail,
    withoutEmail,
    uniqueRecipientsCount: uniqueRecipients.length,
    sampleRecipients: sample,
  });
}

