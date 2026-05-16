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
  last_donation_date: string;
  contact_number: string;
  preferred_days?: string[] | null;
  preferred_time_slots?: string[] | null;
  trusted_donor?: boolean | null;
};

export type FilterDonorSearchParams = {
  bloodGroup: string;
  address: WbAddressValue;
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

/** Client/server shared filter: block-wide when panchayat empty; fuzzy district/block match. */
export function filterDonorSearchRows(
  rows: DonorSearchRow[],
  params: FilterDonorSearchParams,
): DonorSearchRow[] {
  const bloodGroup = params.bloodGroup.trim();
  const address = normalizeWbAddress(params.address);
  const district = address.district.trim();
  const block = address.block.trim();
  const panchayat = address.panchayat.trim();
  const villageQuery = address.village.trim().toLowerCase();
  const isAllPanchayats = !panchayat;

  const strictFiltered = rows.filter((r) => {
    const bgMatch = normalizeAreaText(r.blood_group) === normalizeAreaText(bloodGroup);
    const districtMatch = areaMatches(r.district, district);
    const blockMatch = areaMatches(r.block, block);
    const panchayatMatch = !panchayat || areaMatches(r.panchayat, panchayat);

    if (isAllPanchayats) {
      return bgMatch && districtMatch && blockMatch;
    }
    return bgMatch && districtMatch && blockMatch && panchayatMatch;
  });

  const villageFiltered = villageQuery
    ? strictFiltered.filter((r) => (r.village ?? "").toLowerCase().includes(villageQuery))
    : strictFiltered;

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
