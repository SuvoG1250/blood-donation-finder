import official from "@/data/official-wb-districts.json";
import { normalizeLocationKey } from "@/lib/locationKeys";

/** Official West Bengal districts (igod.gov.in via Indian-state-district-json). */
export const OFFICIAL_WB_DISTRICTS: readonly string[] = official.districts;

const OFFICIAL_KEYS = new Map(
  OFFICIAL_WB_DISTRICTS.map((d) => [normalizeLocationKey(d), d]),
);

/** Postal / package aliases → official district name. */
const DISTRICT_ALIASES: Record<string, string> = {
  "24PARAGANASNORTH": "North 24 Parganas",
  "24PARAGANASSOUTH": "South 24 Parganas",
  NORTH24PARGANAS: "North 24 Parganas",
  SOUTH24PARGANAS: "South 24 Parganas",
  HOOGHLY: "Hooghly",
  MALDAH: "Malda",
  MEDINIPUREAST: "Purba Medinipur",
  MEDINIPURWEST: "Paschim Medinipur",
  PURBAMEDINIPUR: "Purba Medinipur",
  PASCHIMMEDINIPUR: "Paschim Medinipur",
  DINAJPURDAKSHIN: "Dakshin Dinajpur",
  DINAJPURUTTAR: "Uttar Dinajpur",
  DAKSHINDINAJPUR: "Dakshin Dinajpur",
  UTTARDINAJPUR: "Uttar Dinajpur",
  COOCHBEHAR: "Cooch Behar",
  BIRBHUM: "Birbhum",
  BANKURA: "Bankura",
  HOWRAH: "Howrah",
  JALPAIGURI: "Jalpaiguri",
  KALIMPONG: "Kalimpong",
  DARJEELING: "Darjeeling",
  PURULIA: "Purulia",
  NADIA: "Nadia",
  MURSHIDABAD: "Murshidabad",
  PURBABARDHAMAN: "Purba Bardhaman",
  PASCHIMBARDHAMAN: "Paschim Bardhaman",
  JHARGRAM: "Jhargram",
  ALIPURDUAR: "Alipurduar",
  KOLKATA: "Kolkata",
};

function fuzzyOfficialDistrict(key: string): string | null {
  if (OFFICIAL_KEYS.has(key)) return OFFICIAL_KEYS.get(key)!;
  if (DISTRICT_ALIASES[key]) return DISTRICT_ALIASES[key];

  for (const [aliasKey, name] of Object.entries(DISTRICT_ALIASES)) {
    if (key.includes(aliasKey) || aliasKey.includes(key)) return name;
  }

  for (const [officialKey, name] of OFFICIAL_KEYS) {
    if (key.includes(officialKey) || officialKey.includes(key)) return name;
  }

  return null;
}

/** Map any district label to the official West Bengal district name, or empty if unknown. */
export function normalizeOfficialWbDistrict(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";

  const key = normalizeLocationKey(trimmed);
  const official = fuzzyOfficialDistrict(key);
  if (official) return official;

  return "";
}

export function isOfficialWbDistrict(name: string): boolean {
  return normalizeOfficialWbDistrict(name).length > 0;
}
