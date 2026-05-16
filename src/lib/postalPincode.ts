/** India Post data via https://api.postalpincode.in — West Bengal only in this app. */

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

const API_BASE = "https://api.postalpincode.in";

export function isWestBengalState(state: string | null | undefined): boolean {
  const s = (state ?? "").trim().toLowerCase();
  return s === "west bengal" || s === "wb";
}

export function normalizeBlock(po: PostalPostOffice): string {
  const block = (po.Block ?? "").trim();
  if (block && block.toUpperCase() !== "NA") return block;
  const division = (po.Division ?? "").trim();
  if (division) return division;
  return (po.Region ?? "").trim();
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

export async function fetchPincodeOffices(pincode: string): Promise<PostalPostOffice[]> {
  const digits = pincode.replace(/\D/g, "");
  if (digits.length !== 6) return [];

  const resp = await fetch(`${API_BASE}/pincode/${digits}`, {
    next: { revalidate: 86400 },
  });
  if (!resp.ok) throw new Error("PIN code lookup failed. Try again.");
  const raw = (await resp.json()) as unknown;
  return filterWestBengalOffices(parsePostalApiPayload(raw));
}

export async function fetchPostOfficeByName(query: string): Promise<PostalPostOffice[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const resp = await fetch(
    `${API_BASE}/postoffice/${encodeURIComponent(q)}`,
    { next: { revalidate: 86400 } },
  );
  if (!resp.ok) throw new Error("Post office search failed. Try again.");
  const raw = (await resp.json()) as unknown;
  return filterWestBengalOffices(parsePostalApiPayload(raw));
}
