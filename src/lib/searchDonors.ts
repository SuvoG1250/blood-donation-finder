import type { SupabaseClient } from "@supabase/supabase-js";
import {
  filterDonorSearchRows,
  type DonorSearchRow,
  type FilterDonorSearchParams,
} from "@/lib/filterDonorSearch";
import type { DonorSearchScope } from "@/lib/donorSearchScope";
import { parseDonorSearchScope } from "@/lib/donorSearchScope";
import {
  normalizeWbAddress,
  validateWbAddressForSearch,
  type WbAddressValue,
} from "@/lib/wbAddress";

export type { DonorSearchRow };
export type { DonorSearchScope };

export type SearchDonorsParams = FilterDonorSearchParams;

export type SearchDonorsResult = {
  donors: DonorSearchRow[];
  error: string | null;
};

const SAFE_DONOR_SELECT =
  "user_id,name,photo_object_path,blood_group,district,block,panchayat,village,pincode,last_donation_date,contact_number,preferred_days,preferred_time_slots";

async function searchViaApi(params: SearchDonorsParams): Promise<SearchDonorsResult | null> {
  const paths = ["/blood/api/search/donors", "/api/search/donors"];
  for (const path of paths) {
    try {
      const resp = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
        cache: "no-store",
      });
      const payload = (await resp.json()) as {
        donors?: DonorSearchRow[];
        error?: string | null;
      };
      if (resp.status === 404) continue;
      if (!resp.ok) {
        return { donors: [], error: payload.error ?? "Search failed." };
      }
      return { donors: payload.donors ?? [], error: payload.error ?? null };
    } catch {
      // try next path
    }
  }
  return null;
}

/** Client fallback: RPC block search or safe column query (never trusted_donor). */
async function searchViaClient(
  supabase: SupabaseClient,
  params: SearchDonorsParams,
): Promise<SearchDonorsResult> {
  const bloodGroup = params.bloodGroup.trim();
  const address = normalizeWbAddress(params.address);
  const scope = params.searchScope ?? "block";
  const district = address.district.trim();
  const block = address.block.trim();

  if (
    scope === "block" &&
    district &&
    block &&
    !address.panchayat.trim() &&
    !address.village.trim()
  ) {
    const rpcRes = await supabase.rpc("search_donors_by_block", {
      p_blood_group: bloodGroup,
      p_district: district,
      p_block: block,
    });
    if (!rpcRes.error && rpcRes.data) {
      const rows = ((rpcRes.data as DonorSearchRow[]) ?? []).map((r) => ({
        ...r,
        trusted_donor: Boolean(r.trusted_donor ?? false),
      }));
      return {
        donors: filterDonorSearchRows(rows, {
          bloodGroup,
          address,
          searchScope: scope,
          preferredDay: params.preferredDay,
          preferredTimeSlot: params.preferredTimeSlot,
        }),
        error: null,
      };
    }
  }

  const eligibilityCutoff = new Date();
  eligibilityCutoff.setDate(eligibilityCutoff.getDate() - 90);
  const eligibilityCutoffIso = eligibilityCutoff.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("donors")
    .select(SAFE_DONOR_SELECT)
    .eq("id_card_verified", true)
    .lte("last_donation_date", eligibilityCutoffIso)
    .ilike("blood_group", bloodGroup)
    .limit(2000);

  if (error) {
    return { donors: [], error: error.message };
  }

  const rows = ((data as DonorSearchRow[]) ?? []).map((r) => ({
    ...r,
    trusted_donor: false,
  }));

  const donors = filterDonorSearchRows(rows, {
    bloodGroup,
    address,
    searchScope: scope,
    preferredDay: params.preferredDay,
    preferredTimeSlot: params.preferredTimeSlot,
  });

  return { donors, error: null };
}

/**
 * Search verified, eligible donors by blood group + West Bengal address.
 * Scope: pincode (all areas under PIN), village, or block.
 */
export async function searchDonorsByAddress(
  supabase: SupabaseClient,
  params: SearchDonorsParams,
): Promise<SearchDonorsResult> {
  const bloodGroup = params.bloodGroup.trim();
  if (!bloodGroup) {
    return { donors: [], error: "Please select a Blood Group." };
  }

  const address = normalizeWbAddress(params.address);
  const searchScope = params.searchScope ?? "block";
  const validation = validateWbAddressForSearch(address, { searchScope });
  if (!validation.ok) {
    return { donors: [], error: validation.error ?? "Invalid address." };
  }

  const apiResult = await searchViaApi({
    bloodGroup,
    address,
    searchScope,
    preferredDay: params.preferredDay,
    preferredTimeSlot: params.preferredTimeSlot,
  });

  if (apiResult) {
    if (apiResult.error?.toLowerCase().includes("trusted_donor")) {
      return searchViaClient(supabase, params);
    }
    return apiResult;
  }

  return searchViaClient(supabase, params);
}

/** Build /search query string from blood group + address filters. */
export function buildDonorSearchQueryParams(opts: {
  bloodGroup: string;
  address: WbAddressValue;
  searchScope?: DonorSearchScope;
  preferredDay?: string;
  preferredTimeSlot?: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  const bg = opts.bloodGroup.trim();
  const a = normalizeWbAddress(opts.address);
  const scope = opts.searchScope ?? "block";
  if (bg) params.set("bg", bg);
  if (scope !== "block") params.set("scope", scope);
  if (a.district.trim()) params.set("d", a.district.trim());
  if (a.block.trim()) params.set("b", a.block.trim());
  if (a.panchayat.trim()) params.set("p", a.panchayat.trim());
  if (a.village.trim()) params.set("v", a.village.trim());
  if (a.pincode.trim()) params.set("pin", a.pincode.trim());
  if (opts.preferredDay?.trim()) params.set("day", opts.preferredDay.trim());
  if (opts.preferredTimeSlot?.trim()) params.set("time", opts.preferredTimeSlot.trim());
  return params;
}

export function parseDonorSearchParams(search: string): {
  bloodGroup: string;
  address: WbAddressValue;
  searchScope: DonorSearchScope;
  preferredDay: string;
  preferredTimeSlot: string;
} {
  const params = new URLSearchParams(search);
  return {
    bloodGroup: params.get("bg") ?? "",
    searchScope: parseDonorSearchScope(params.get("scope")),
    address: normalizeWbAddress({
      pincode: params.get("pin") ?? "",
      district: params.get("d") ?? "",
      block: params.get("b") ?? "",
      panchayat: params.get("p") ?? "",
      village: params.get("v") ?? "",
    }),
    preferredDay: params.get("day") ?? "",
    preferredTimeSlot: params.get("time") ?? "",
  };
}
