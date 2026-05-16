import { createClient } from "@supabase/supabase-js";

export type PublicDonorProfile = {
  user_id: string;
  name: string;
  email: string;
  blood_group: string;
  pincode: string;
  district: string;
  block: string;
  panchayat: string;
  village: string;
  contact_number: string;
  preferred_days: string[] | null;
  preferred_time_slots: string[] | null;
  id_card_verified: boolean;
  last_donation_date: string;
  is_eligible: boolean;
  photo_url: string | null;
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const { userId } = await context.params;
  if (!userId?.trim()) {
    return json({ error: "Missing donor id." }, 400);
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server not configured." }, 503);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  type RpcRow = PublicDonorProfile & { photo_object_path?: string | null };

  let row: RpcRow | null = null;

  const rpcRes = await admin.rpc("get_public_donor_profile", { p_user_id: userId });
  if (!rpcRes.error && rpcRes.data) {
    row = ((rpcRes.data as RpcRow[]) ?? [])[0] ?? null;
  }

  if (!row) {
    const { data: direct, error: directErr } = await admin
      .from("donors")
      .select(
        "user_id,name,blood_group,district,block,panchayat,village,contact_number,photo_object_path,preferred_days,preferred_time_slots,id_card_verified,last_donation_date,pause_until",
      )
      .eq("user_id", userId)
      .eq("id_card_verified", true)
      .maybeSingle();

    if (directErr) {
      return json({ error: rpcRes.error?.message ?? directErr.message }, 500);
    }
    if (!direct) {
      return json({ error: "Donor not found or not currently eligible." }, 404);
    }

    const d = direct as RpcRow & { pause_until?: string | null };
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const eligible = new Date(d.last_donation_date) <= cutoff;
    const paused = Boolean(
      d.pause_until && new Date(d.pause_until).getTime() > Date.now(),
    );
    if (!eligible || paused) {
      return json({ error: "Donor not found or not currently eligible." }, 404);
    }

    row = {
      ...d,
      email: "",
      pincode: "",
      is_eligible: true,
    };
  }
  if (!row) {
    return json({ error: "Donor not found or not currently eligible." }, 404);
  }

  let photoUrl: string | null = null;
  const photoPath = (row as { photo_object_path?: string | null }).photo_object_path;
  if (photoPath) {
    const { data: signed } = await admin.storage
      .from("donor-photos")
      .createSignedUrl(photoPath, 60 * 60);
    photoUrl = signed?.signedUrl ?? null;
  }

  const profile: PublicDonorProfile = {
    user_id: row.user_id,
    name: row.name,
    email: row.email ?? "",
    blood_group: row.blood_group,
    pincode: row.pincode ?? "",
    district: row.district,
    block: row.block,
    panchayat: row.panchayat,
    village: row.village ?? "",
    contact_number: row.contact_number,
    preferred_days: row.preferred_days ?? null,
    preferred_time_slots: row.preferred_time_slots ?? null,
    id_card_verified: row.id_card_verified,
    last_donation_date: row.last_donation_date,
    is_eligible: Boolean(row.is_eligible),
    photo_url: photoUrl,
  };

  return json({ profile });
}
