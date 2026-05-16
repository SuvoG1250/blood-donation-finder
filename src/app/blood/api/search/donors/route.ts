import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  filterDonorSearchRows,
  type DonorSearchRow,
  type FilterDonorSearchParams,
} from "@/lib/filterDonorSearch";
import { normalizeWbAddress, validateWbAddressForSearch } from "@/lib/wbAddress";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

/** Columns that exist on all deployed schemas (no trusted_donor / is_trusted). */
const DONOR_SELECT_SAFE =
  "user_id,name,photo_object_path,blood_group,district,block,panchayat,village,last_donation_date,contact_number,preferred_days,preferred_time_slots";

type DonorDbRow = DonorSearchRow & {
  pause_until?: string | null;
};

function mapDbRow(row: DonorDbRow): DonorSearchRow {
  return {
    user_id: row.user_id,
    name: row.name,
    photo_object_path: row.photo_object_path,
    blood_group: row.blood_group,
    district: row.district,
    block: row.block,
    panchayat: row.panchayat,
    village: row.village,
    last_donation_date: row.last_donation_date,
    contact_number: row.contact_number,
    preferred_days: row.preferred_days,
    preferred_time_slots: row.preferred_time_slots,
    trusted_donor: false,
  };
}

function isPaused(pauseUntil: string | null | undefined) {
  if (!pauseUntil) return false;
  const dt = new Date(pauseUntil);
  return !Number.isNaN(dt.getTime()) && dt.getTime() > Date.now();
}

function isMissingColumnError(message: string) {
  const m = message.toLowerCase();
  return m.includes("does not exist") && m.includes("column");
}

async function fetchDonorRows(
  admin: SupabaseClient,
  bloodGroup: string,
  eligibilityCutoffIso: string,
): Promise<{ rows: DonorDbRow[]; error: string | null }> {
  const selects = [
    `${DONOR_SELECT_SAFE},pause_until`,
    DONOR_SELECT_SAFE,
  ];

  for (const selectCols of selects) {
    const { data, error } = await admin
      .from("donors")
      .select(selectCols)
      .eq("id_card_verified", true)
      .lte("last_donation_date", eligibilityCutoffIso)
      .ilike("blood_group", bloodGroup)
      .order("name", { ascending: true })
      .limit(2000);

    if (!error) {
      return { rows: (data as DonorDbRow[]) ?? [], error: null };
    }
    if (!isMissingColumnError(error.message ?? "")) {
      return { rows: [], error: error.message ?? "Search failed." };
    }
  }

  return { rows: [], error: "Unable to load donors from database." };
}

export async function POST(req: Request) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      {
        error:
          "Search is not configured on the server. Add SUPABASE_SERVICE_ROLE_KEY to .env.local and restart npm run dev.",
      },
      503,
    );
  }

  let body: FilterDonorSearchParams;
  try {
    body = (await req.json()) as FilterDonorSearchParams;
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  const bloodGroup = (body.bloodGroup ?? "").trim();
  if (!bloodGroup) {
    return json({ error: "Please select a Blood Group." }, 400);
  }

  const address = normalizeWbAddress(body.address);
  const validation = validateWbAddressForSearch(address);
  if (!validation.ok) {
    return json({ error: validation.error ?? "Invalid address." }, 400);
  }

  const eligibilityCutoff = new Date();
  eligibilityCutoff.setDate(eligibilityCutoff.getDate() - 90);
  const eligibilityCutoffIso = eligibilityCutoff.toISOString().slice(0, 10);

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { rows: rawRows, error: fetchError } = await fetchDonorRows(
    admin,
    bloodGroup,
    eligibilityCutoffIso,
  );
  if (fetchError) {
    return json({ error: fetchError }, 500);
  }

  const rows = rawRows.filter((r) => !isPaused(r.pause_until)).map(mapDbRow);

  const donors = filterDonorSearchRows(rows, {
    bloodGroup,
    address,
    preferredDay: body.preferredDay,
    preferredTimeSlot: body.preferredTimeSlot,
  });

  return json({ donors, error: null });
}
