import type { DonorSearchScope } from "@/lib/donorSearchScope";

/** West Bengal address shape (PIN lookup + district / block / locality). */

export type WbAddressValue = {
  pincode: string;
  district: string;
  block: string;
  panchayat: string;
  village: string;
};

export function emptyWbAddress(): WbAddressValue {
  return {
    pincode: "",
    district: "",
    block: "",
    panchayat: "",
    village: "",
  };
}

/** Ensures every field is a string so inputs stay controlled (never undefined). */
export function normalizeWbAddress(value?: Partial<WbAddressValue> | null): WbAddressValue {
  return {
    pincode: value?.pincode ?? "",
    district: value?.district ?? "",
    block: value?.block ?? "",
    panchayat: value?.panchayat ?? "",
    village: value?.village ?? "",
  };
}

export type WbAddressValidation = {
  ok: boolean;
  error?: string;
};

export function validateWbAddressForSearch(
  address: WbAddressValue,
  opts?: { requirePanchayat?: boolean; searchScope?: DonorSearchScope },
): WbAddressValidation {
  const a = normalizeWbAddress(address);
  const scope = opts?.searchScope ?? "block";

  if (!a.district.trim()) {
    return { ok: false, error: "Please enter a PIN or select a post office to fill District." };
  }

  if (scope === "pincode") {
    if (a.pincode.replace(/\D/g, "").length !== 6) {
      return { ok: false, error: "Enter a 6-digit PIN for PIN-level search." };
    }
    return { ok: true };
  }

  if (!a.block.trim()) {
    return { ok: false, error: "Please fill Block (use PIN lookup or post office search)." };
  }

  if (scope === "village" && !a.village.trim()) {
    return {
      ok: false,
      error: "Enter or select a village for village-level search (use PIN lookup).",
    };
  }

  if (opts?.requirePanchayat && !a.panchayat.trim()) {
    return {
      ok: false,
      error: "Please fill Panchayat / locality (use PIN lookup or post office search).",
    };
  }
  return { ok: true };
}

export function formatWbAddressLabel(address: WbAddressValue): string {
  const a = normalizeWbAddress(address);
  const parts = [a.district, a.block, a.panchayat, a.village].map((s) => s.trim()).filter(Boolean);
  return parts.join(" / ") || "—";
}
