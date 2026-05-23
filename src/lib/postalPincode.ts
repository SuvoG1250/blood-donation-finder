/** West Bengal pincode data — local india-pincode DB with optional remote fallback. */

import { getIndiaPincode, type PostOffice as IndiaPostOffice } from "india-pincode";
import { resolveWbBlock } from "@/lib/resolveWbBlock";

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

export function normalizeBlock(po: PostalPostOffice): string {
  const district = (po.District ?? "").trim();
  const locality = (po.Name ?? "").trim();
  const resolved = resolveWbBlock(district, locality, {
    postalBlock: po.Block,
    division: po.Division,
    taluk: po.Description ?? undefined,
  });
  if (resolved) return resolved;

  const block = (po.Block ?? "").trim();
  const districtKey = district.toLowerCase().replace(/\s+/g, "");
  if (
    block &&
    block.toUpperCase() !== "NA" &&
    block.toLowerCase().replace(/\s+/g, "") !== districtKey
  ) {
    return block;
  }

  return "";
}

export function postOfficeToAddress(
  po: PostalPostOffice,
  pincodeFallback = "",
): WbNormalizedAddress {
  return {
    pincode: (po.Pincode ?? pincodeFallback).trim(),
    district: (po.District ?? "").trim(),
    block: normalizeBlock(po),
    panchayat: (po.Name ?? "").trim(),
  };
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
  const district = titleCaseWords(po.district);
  const locality = (po.area ?? "").trim();
  return {
    Name: locality,
    District: district,
    State: titleCaseWords(po.state),
    Block: resolveWbBlock(district, locality, { division }),
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
        const district = titleCaseWords(row.district ?? "");
        const locality = (row.office ?? "").replace(/\s+B\.?O\.?$/i, "").trim();
        return {
        Name: locality,
        District: district,
        State: titleCaseWords(row.state ?? ""),
        Block: resolveWbBlock(district, locality),
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
  if (local.length > 0) return local;

  try {
    const remote = await fetchPincodeOfficesRemote(digits);
    if (remote.length > 0) return remote;
  } catch {
    // try legacy API next
  }

  try {
    return await fetchPincodeOfficesLegacy(digits);
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
