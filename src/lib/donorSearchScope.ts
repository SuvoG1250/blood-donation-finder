import { WB_PINCODE_INDEX, type WbPincodeOfficeEntry } from "@/lib/wbLocations";

export type DonorSearchScope = "block" | "village" | "pincode";

export const DONOR_SEARCH_SCOPES: {
  id: DonorSearchScope;
  label: string;
  description: string;
}[] = [
  {
    id: "pincode",
    label: "PIN code area",
    description: "All eligible donors under this PIN (every block & village listed for the PIN).",
  },
  {
    id: "village",
    label: "Village",
    description: "Donors in the same district, block, and village.",
  },
  {
    id: "block",
    label: "Block",
    description: "All donors in the district and block (widest within one block).",
  },
];

export function parseDonorSearchScope(raw: string | null | undefined): DonorSearchScope {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "pin" || v === "pincode") return "pincode";
  if (v === "village" || v === "v") return "village";
  return "block";
}

export function getPincodeSearchAreas(pincode: string): WbPincodeOfficeEntry[] {
  const digits = pincode.replace(/\D/g, "");
  if (digits.length !== 6) return [];
  return WB_PINCODE_INDEX[digits] ?? [];
}

export function describeSearchScope(
  scope: DonorSearchScope,
  address: { district: string; block: string; village: string; pincode: string },
): string {
  const district = address.district.trim();
  const block = address.block.trim();
  const village = address.village.trim();
  const pin = address.pincode.trim();

  if (scope === "pincode" && pin) {
    return `PIN ${pin}${district ? ` (${district})` : ""}`;
  }
  if (scope === "village" && village) {
    return `${village}, ${block}, ${district}`;
  }
  if (block && district) {
    return `${block}, ${district}`;
  }
  return district || "selected area";
}
