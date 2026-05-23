import type { DonorSearchScope } from "@/lib/donorSearchScope";
import { getPincodeSearchAreas } from "@/lib/donorSearchScope";
import type { WbAddressValue } from "@/lib/wbAddress";
import { normalizeWbAddress } from "@/lib/wbAddress";

export type DonorSearchRow = {
  user_id: string;
  name: string;
  photo_object_path: string | null;
  blood_group: string;
  district: string;
  block: string;
  panchayat: string;
  village?: string | null;
  pincode?: string | null;
  last_donation_date: string;
  contact_number: string;
  preferred_days?: string[] | null;
  preferred_time_slots?: string[] | null;
  trusted_donor?: boolean | null;
};

export type FilterDonorSearchParams = {
  bloodGroup: string;
  address: WbAddressValue;
  searchScope?: DonorSearchScope;
  preferredDay?: string;
  preferredTimeSlot?: string;
};

function normalizeAreaText(value: string) {
  const romanToNumber: Record<string, string> = {
    i: "1",
    ii: "2",
    iii: "3",
    iv: "4",
    v: "5",
    vi: "6",
    vii: "7",
    viii: "8",
    ix: "9",
    x: "10",
  };
  const alias: Record<string, string> = {
    hooghly: "hugli",
    darjiling: "darjeeling",
  };
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((token) => alias[token] ?? token)
    .map((token) => romanToNumber[token] ?? token)
    .join("");
}

function areaMatches(actual: string, selected: string) {
  const a = normalizeAreaText(actual);
  const s = normalizeAreaText(selected);
  if (!s) return true;
  if (!a) return false;
  return a === s || a.includes(s) || s.includes(a);
}

function donorMatchesPincodeArea(
  donor: DonorSearchRow,
  district: string,
  pincode: string,
): boolean {
  if (!areaMatches(donor.district, district)) return false;

  const donorPin = (donor.pincode ?? "").replace(/\D/g, "");
  const searchPin = pincode.replace(/\D/g, "");
  if (donorPin.length === 6 && donorPin === searchPin) return true;

  const areas = getPincodeSearchAreas(searchPin);
  if (areas.length === 0) return false;

  return areas.some((area) => {
    if (!areaMatches(area.district, district)) return false;
    if (area.block && areaMatches(donor.block, area.block)) return true;
    if (area.panchayat && areaMatches(donor.panchayat, area.panchayat)) return true;
    if (area.village && areaMatches(donor.village ?? "", area.village)) return true;
    return false;
  });
}

function donorMatchesScope(
  donor: DonorSearchRow,
  address: WbAddressValue,
  scope: DonorSearchScope,
): boolean {
  const district = address.district.trim();
  const block = address.block.trim();
  const panchayat = address.panchayat.trim();
  const village = address.village.trim();
  const pincode = address.pincode.trim();

  if (scope === "pincode") {
    return donorMatchesPincodeArea(donor, district, pincode);
  }

  if (!areaMatches(donor.district, district)) return false;
  if (!areaMatches(donor.block, block)) return false;

  if (scope === "block") {
    if (panchayat && !areaMatches(donor.panchayat, panchayat)) return false;
    return true;
  }

  if (scope === "village") {
    if (!village) return false;
    const donorVillage = (donor.village ?? "").trim();
    if (donorVillage && areaMatches(donorVillage, village)) return true;
    if (areaMatches(donor.panchayat, village)) return true;
  }

  return false;
}

/** Client/server shared filter by search scope (PIN / village / block). */
export function filterDonorSearchRows(
  rows: DonorSearchRow[],
  params: FilterDonorSearchParams,
): DonorSearchRow[] {
  const bloodGroup = params.bloodGroup.trim();
  const address = normalizeWbAddress(params.address);
  const scope = params.searchScope ?? "block";
  const villageQuery = address.village.trim().toLowerCase();

  const scopeFiltered = rows.filter((r) => {
    const bgMatch = normalizeAreaText(r.blood_group) === normalizeAreaText(bloodGroup);
    return bgMatch && donorMatchesScope(r, address, scope);
  });

  const villageFiltered =
    scope === "village" && villageQuery
      ? scopeFiltered.filter((r) => {
          const dv = (r.village ?? "").toLowerCase();
          const dp = r.panchayat.toLowerCase();
          return dv.includes(villageQuery) || dp.includes(villageQuery);
        })
      : scopeFiltered;

  const preferredDay = params.preferredDay?.trim() ?? "";
  const preferredTimeSlot = params.preferredTimeSlot?.trim() ?? "";

  const withMatchScore = villageFiltered.map((r) => {
    const days = (r.preferred_days ?? []) as string[];
    const slots = (r.preferred_time_slots ?? []) as string[];

    const dayMatches = !preferredDay || days.length === 0 || days.includes(preferredDay);
    const timeMatches =
      !preferredTimeSlot || slots.length === 0 || slots.includes(preferredTimeSlot);

    const explicitDayMatch = Boolean(preferredDay && days.includes(preferredDay));
    const explicitTimeMatch = Boolean(
      preferredTimeSlot && slots.includes(preferredTimeSlot),
    );

    const score = (explicitDayMatch ? 1 : 0) + (explicitTimeMatch ? 1 : 0);
    const passes = dayMatches && timeMatches;
    return { row: r, score, passes };
  });

  const passing = withMatchScore.filter((x) => x.passes);
  passing.sort((a, b) => b.score - a.score);
  return passing.map((x) => x.row);
}
