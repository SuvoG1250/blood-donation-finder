/** West Bengal pincode data — local india-pincode DB with optional remote fallback. */

import { getIndiaPincode, type PostOffice as IndiaPostOffice } from "india-pincode";
import { normalizeLocationKey } from "@/lib/locationKeys";
import { normalizeOfficialWbDistrict } from "@/lib/officialWbDistricts";
import { resolveWbLocation } from "@/lib/resolveWbBlock";
import { WB_PINCODE_INDEX, type WbPincodeOfficeEntry } from "@/lib/wbLocations";

export const WB_STATE_LABEL = "West Bengal";

export type PostalPostOffice = {
  Name: string;
  Description?: string | null;
  BranchType?: string;
  DeliveryStatus?: string;
  Circle?: string;
  District: string;
  Division?: string;
  Region?: string;
  Block?: string;
  State: string;
  Country?: string;
  Pincode?: string;
};

export type PostalApiEnvelope = {
  Message: string;
  Status: string;
  PostOffice: PostalPostOffice[] | null;
};

export type WbNormalizedAddress = {
  pincode: string;
  district: string;
  block: string;
  panchayat: string;
  village?: string;
};

const LEGACY_API_BASE = "https://api.postalpincode.in";
const REMOTE_PIN_API = "https://postal-pincode-api.vercel.app/api/v1";

let localLookup: ReturnType<typeof getIndiaPincode> | null = null;

function getLocalLookup() {
  if (!localLookup) localLookup = getIndiaPincode();
  return localLookup;
}

export function isWestBengalState(state: string | null | undefined): boolean {
  const s = (state ?? "").trim().toLowerCase();
  return s === "west bengal" || s === "wb";
}

function resolveFromPostOffice(po: PostalPostOffice): WbNormalizedAddress {
  const district =
    normalizeOfficialWbDistrict(po.District) || (po.District ?? "").trim();
  const locality = (po.Name ?? "").trim();
  const resolved = resolveWbLocation(district, locality, {
    postalBlock: po.Block,
    division: po.Division,
    taluk: po.Description ?? undefined,
    pincode: po.Pincode,
  });

  let block = resolved.block;
  if (!block) {
    const postalBlock = (po.Block ?? "").trim();
    const districtKey = district.toLowerCase().replace(/\s+/g, "");
    if (
      postalBlock &&
      postalBlock.toUpperCase() !== "NA" &&
      postalBlock.toLowerCase().replace(/\s+/g, "") !== districtKey
    ) {
      block = postalBlock;
    }
  }

  return {
    pincode: (po.Pincode ?? "").trim(),
    district,
    block,
    panchayat: resolved.panchayat || locality,
    village: resolved.village,
  };
}

export function normalizeBlock(po: PostalPostOffice): string {
  return resolveFromPostOffice(po).block;
}

export function postOfficeToAddress(
  po: PostalPostOffice,
  pincodeFallback = "",
): WbNormalizedAddress {
  const addr = resolveFromPostOffice(po);
  if (!addr.pincode && pincodeFallback) {
    addr.pincode = pincodeFallback.trim();
  }
  return addr;
}

export function filterWestBengalOffices(offices: PostalPostOffice[]): PostalPostOffice[] {
  return offices.filter((po) => isWestBengalState(po.State));
}

export function parsePostalApiPayload(raw: unknown): PostalPostOffice[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first = raw[0] as PostalApiEnvelope;
  if (first?.Status?.toLowerCase() !== "success" || !first.PostOffice) return [];
  return first.PostOffice;
}

function titleCaseWords(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function indiaRecordToPostal(po: IndiaPostOffice): PostalPostOffice {
  const division = (po.division ?? "").trim();
  const district =
    normalizeOfficialWbDistrict(po.district) || titleCaseWords(po.district);
  const locality = (po.area ?? "").trim();
  return {
    Name: locality,
    District: district,
    State: titleCaseWords(po.state),
    Block: resolveWbLocation(district, locality, { division, pincode: po.pincode }).block,
    Division: division,
    Region: (po.region ?? "").trim(),
    Circle: (po.circle ?? "").trim(),
    Pincode: po.pincode,
    BranchType: po.officeType,
    DeliveryStatus: po.delivery ? "Delivery" : "Non-Delivery",
    Country: po.country ?? "India",
  };
}

function dedupeOffices(offices: PostalPostOffice[]): PostalPostOffice[] {
  const seen = new Set<string>();
  const out: PostalPostOffice[] = [];
  for (const po of offices) {
    const key = `${po.Pincode ?? ""}|${po.Name}|${po.District}|${po.Block ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(po);
  }
  return out;
}

function indexEntryToPostal(entry: WbPincodeOfficeEntry, pincode: string): PostalPostOffice {
  const label = (entry.village || entry.panchayat).trim();
  return {
    Name: label,
    District: entry.district,
    State: WB_STATE_LABEL,
    Block: entry.block,
    Pincode: pincode,
    BranchType: "Village",
    DeliveryStatus: "",
    Country: "India",
  };
}

/** Add verified villages/localities from wb-locations when India Post has no BO for them. */
function mergeWbPincodeExtras(
  pincode: string,
  offices: PostalPostOffice[],
): PostalPostOffice[] {
  const extras = WB_PINCODE_INDEX[pincode] ?? [];
  if (extras.length === 0) return offices;

  const seen = new Set(
    offices.map((o) => normalizeLocationKey(o.Name ?? "")),
  );
  const merged = [...offices];

  for (const entry of extras) {
    if (!entry.block) continue;
    const label = (entry.village || entry.panchayat).trim();
    const key = normalizeLocationKey(label);
    if (!key || seen.has(key)) continue;
    merged.push(indexEntryToPostal(entry, pincode));
    seen.add(key);
  }

  return dedupeOffices(merged);
}

function fetchPincodeOfficesLocal(pincode: string): PostalPostOffice[] {
  try {
    const result = getLocalLookup().getByPincode(pincode);
    if (!result.success || !result.data?.data?.length) return [];
    return dedupeOffices(
      filterWestBengalOffices(result.data.data.map(indiaRecordToPostal)),
    );
  } catch {
    return [];
  }
}

function fetchPostOfficeByNameLocal(query: string): PostalPostOffice[] {
  try {
    const lookup = getLocalLookup();
    const q = query.trim();
    const attempts = [
      () => lookup.search(q, { limit: 40 }),
      () => lookup.getByArea(q, { limit: 40 }),
    ];

    const collected: PostalPostOffice[] = [];
    for (const run of attempts) {
      const result = run();
      if (!result.success || !result.data?.data?.length) continue;
      collected.push(...result.data.data.map(indiaRecordToPostal));
      if (collected.length >= 12) break;
    }

    return dedupeOffices(filterWestBengalOffices(collected)).slice(0, 12);
  } catch {
    return [];
  }
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs = 12_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Raktodaan/1.0 (+https://raktodaan.com)",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPincodeOfficesLegacy(pincode: string): Promise<PostalPostOffice[]> {
  const resp = await fetchWithTimeout(`${LEGACY_API_BASE}/pincode/${pincode}`, {
    next: { revalidate: 86400 },
  });
  if (!resp.ok) throw new Error("PIN code lookup failed. Try again.");
  const raw = (await resp.json()) as unknown;
  return filterWestBengalOffices(parsePostalApiPayload(raw));
}

type RemotePinRow = {
  pincode?: string;
  office?: string;
  district?: string;
  state?: string;
  officeType?: string;
  delivery?: boolean;
};

async function fetchPincodeOfficesRemote(pincode: string): Promise<PostalPostOffice[]> {
  const resp = await fetchWithTimeout(`${REMOTE_PIN_API}/pincode/${pincode}`, {
    cache: "no-store",
  });
  if (!resp.ok) throw new Error("PIN code lookup failed. Try again.");
  const payload = (await resp.json()) as { data?: RemotePinRow[] };
  const rows = payload.data ?? [];
  return dedupeOffices(
    filterWestBengalOffices(
      rows.map((row) => {
        const district =
          normalizeOfficialWbDistrict(row.district ?? "") ||
          titleCaseWords(row.district ?? "");
        const locality = (row.office ?? "").replace(/\s+B\.?O\.?$/i, "").trim();
        return {
        Name: locality,
        District: district,
        State: titleCaseWords(row.state ?? ""),
        Block: resolveWbLocation(district, locality, { pincode: row.pincode ?? pincode }).block,
        Pincode: (row.pincode ?? pincode).trim(),
        BranchType: row.officeType ?? "",
        DeliveryStatus: row.delivery ? "Delivery" : "Non-Delivery",
      };
      }),
    ),
  );
}

export async function fetchPincodeOffices(pincode: string): Promise<PostalPostOffice[]> {
  const digits = pincode.replace(/\D/g, "");
  if (digits.length !== 6) return [];

  const local = fetchPincodeOfficesLocal(digits);
  if (local.length > 0) return mergeWbPincodeExtras(digits, local);

  try {
    const remote = await fetchPincodeOfficesRemote(digits);
    if (remote.length > 0) return mergeWbPincodeExtras(digits, remote);
  } catch {
    // try legacy API next
  }

  try {
    const legacy = await fetchPincodeOfficesLegacy(digits);
    return mergeWbPincodeExtras(digits, legacy);
  } catch {
    throw new Error("PIN code lookup failed. Try again.");
  }
}

export async function fetchPostOfficeByName(query: string): Promise<PostalPostOffice[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const local = fetchPostOfficeByNameLocal(q);
  if (local.length > 0) return local;

  const resp = await fetchWithTimeout(
    `${LEGACY_API_BASE}/postoffice/${encodeURIComponent(q)}`,
    { next: { revalidate: 86400 } },
  );
  if (!resp.ok) throw new Error("Post office search failed. Try again.");
  const raw = (await resp.json()) as unknown;
  return filterWestBengalOffices(parsePostalApiPayload(raw));
}
