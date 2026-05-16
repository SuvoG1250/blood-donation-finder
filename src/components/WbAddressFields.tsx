"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WB_STATE_LABEL, type WbNormalizedAddress } from "@/lib/postalPincode";
import {
  emptyWbAddress,
  normalizeWbAddress,
  type WbAddressValue,
} from "@/lib/wbAddress";

export type { WbAddressValue };
export { emptyWbAddress, normalizeWbAddress };

type OfficeOption = WbNormalizedAddress & {
  branchType?: string;
  deliveryStatus?: string;
};

type PincodeApiResp = {
  ok?: boolean;
  error?: string;
  message?: string;
  offices?: OfficeOption[];
};

type PostOfficeApiResp = {
  ok?: boolean;
  error?: string;
  message?: string;
  offices?: OfficeOption[];
};

export type WbAddressFieldsProps = {
  value: WbAddressValue;
  onChange: (next: WbAddressValue) => void;
  /** Fired when PIN/post office lookup fills district + block (ready to search donors). */
  onLocationResolved?: (address: WbAddressValue) => void;
  panchayatMode?: "required" | "optional" | "hidden";
  showVillage?: boolean;
  onError?: (message: string | null) => void;
  className?: string;
};

const inputClass =
  "mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20 disabled:opacity-70";

export default function WbAddressFields({
  value,
  onChange,
  onLocationResolved,
  panchayatMode = "required",
  showVillage = false,
  onError,
  className = "",
}: WbAddressFieldsProps) {
  const addr = normalizeWbAddress(value);
  const [pinBusy, setPinBusy] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [postOfficeQuery, setPostOfficeQuery] = useState("");
  const [pickerOffices, setPickerOffices] = useState<OfficeOption[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const gridClass = `grid gap-4 sm:grid-cols-2 sm:col-span-2${className ? ` ${className}` : ""}`;

  const patchAddress = useCallback(
    (patch: Partial<WbAddressValue>) => {
      onChange(normalizeWbAddress({ ...addr, ...patch }));
    },
    [addr, onChange],
  );

  const setError = useCallback(
    (msg: string | null) => {
      setLocalError(msg);
      onError?.(msg);
    },
    [onError],
  );

  const applyOffice = useCallback(
    (office: OfficeOption) => {
      const next = normalizeWbAddress({
        ...addr,
        pincode: office.pincode || addr.pincode,
        district: office.district,
        block: office.block,
        panchayat: office.panchayat,
      });
      onChange(next);
      setPickerOffices([]);
      setPostOfficeQuery(office.panchayat);
      setError(null);
      onLocationResolved?.(next);
    },
    [addr, onChange, onLocationResolved, setError],
  );

  async function lookupPincode(rawPin: string) {
    const digits = rawPin.replace(/\D/g, "").slice(0, 6);
    patchAddress({ pincode: digits });
    if (digits.length !== 6) {
      setPickerOffices([]);
      return;
    }

    setPinBusy(true);
    setError(null);
    try {
      const resp = await fetch(`/api/address/pincode/${digits}`);
      const data = (await resp.json()) as PincodeApiResp;
      if (!resp.ok) {
        setError(data.error ?? "PIN code lookup failed.");
        setPickerOffices([]);
        return;
      }
      const offices = data.offices ?? [];
      if (offices.length === 0) {
        setError(data.message ?? `No ${WB_STATE_LABEL} locations found for this PIN.`);
        setPickerOffices([]);
        return;
      }
      if (offices.length === 1) {
        applyOffice(offices[0]!);
        return;
      }
      setPickerOffices(offices);
      setError("Multiple post offices found — select one below.");
    } catch {
      setError("Could not reach address service. Check your connection.");
      setPickerOffices([]);
    } finally {
      setPinBusy(false);
    }
  }

  async function searchPostOffices(query: string) {
    const q = query.trim();
    if (q.length < 2) {
      setPickerOffices([]);
      return;
    }

    setSearchBusy(true);
    setError(null);
    try {
      const resp = await fetch(`/api/address/postoffice?q=${encodeURIComponent(q)}`);
      const data = (await resp.json()) as PostOfficeApiResp;
      if (!resp.ok) {
        setError(data.error ?? "Post office search failed.");
        setPickerOffices([]);
        return;
      }
      const offices = data.offices ?? [];
      if (offices.length === 0) {
        setError(data.message ?? `No ${WB_STATE_LABEL} post offices matched.`);
        setPickerOffices([]);
        return;
      }
      setPickerOffices(offices.slice(0, 12));
    } catch {
      setError("Could not reach address service. Check your connection.");
      setPickerOffices([]);
    } finally {
      setSearchBusy(false);
    }
  }

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  return (
    <div className={gridClass} suppressHydrationWarning>
      <label className="block sm:col-span-1">
        <span className="text-sm font-medium">PIN code</span>
        <input
          className={inputClass}
          value={addr.pincode}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, "").slice(0, 6);
            patchAddress({ pincode: next });
            if (next.length === 6) void lookupPincode(next);
            else setPickerOffices([]);
          }}
          onBlur={() => {
            if (addr.pincode.length === 6) void lookupPincode(addr.pincode);
          }}
          placeholder="6-digit PIN (West Bengal)"
          inputMode="numeric"
          maxLength={6}
          required
        />
        {pinBusy ? (
          <p className="mt-1 text-xs text-zinc-500">Looking up PIN…</p>
        ) : null}
      </label>

      <label className="block sm:col-span-1">
        <span className="text-sm font-medium">Search post office</span>
        <input
          className={inputClass}
          value={postOfficeQuery}
          onChange={(e) => {
            const next = e.target.value;
            setPostOfficeQuery(next);
            if (searchTimer.current) clearTimeout(searchTimer.current);
            searchTimer.current = setTimeout(() => {
              void searchPostOffices(next);
            }, 400);
          }}
          placeholder="e.g. Siliguri, Krishnanagar"
        />
        {searchBusy ? (
          <p className="mt-1 text-xs text-zinc-500">Searching…</p>
        ) : null}
      </label>

      {pickerOffices.length > 0 ? (
        <div className="sm:col-span-2 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3">
          <p className="text-xs font-semibold text-zinc-600">
            Select location ({WB_STATE_LABEL})
          </p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
            {pickerOffices.map((o) => (
              <li key={`${o.pincode}-${o.panchayat}-${o.block}`}>
                <button
                  type="button"
                  className="w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-white"
                  onClick={() => applyOffice(o)}
                >
                  <span className="font-medium">{o.panchayat}</span>
                  <span className="text-zinc-600">
                    {" "}
                    — {o.district}, {o.block}
                    {o.pincode ? ` (${o.pincode})` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <label className="block sm:col-span-1">
        <span className="text-sm font-medium">District</span>
        <input
          className={inputClass}
          value={addr.district}
          onChange={(e) => patchAddress({ district: e.target.value })}
          placeholder="Auto-filled from PIN"
          required
        />
      </label>

      <label className="block sm:col-span-1">
        <span className="text-sm font-medium">Block</span>
        <input
          className={inputClass}
          value={addr.block}
          onChange={(e) => patchAddress({ block: e.target.value })}
          placeholder="Auto-filled from PIN"
          required
        />
      </label>

      {panchayatMode !== "hidden" ? (
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium">
            Panchayat / locality
            {panchayatMode === "optional" ? " (optional)" : ""}
          </span>
          <input
            className={inputClass}
            value={addr.panchayat}
            onChange={(e) => patchAddress({ panchayat: e.target.value })}
            placeholder="Post office / locality name"
            required={panchayatMode === "required"}
          />
        </label>
      ) : null}

      {showVillage ? (
        <label className="block sm:col-span-2">
          <span className="text-sm font-medium">Village (optional)</span>
          <input
            className={inputClass}
            value={addr.village}
            onChange={(e) => patchAddress({ village: e.target.value })}
            placeholder="Village or neighbourhood"
          />
        </label>
      ) : null}

      {localError ? (
        <div className="sm:col-span-2 rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-sm text-rose-700">
          {localError}
        </div>
      ) : null}
    </div>
  );
}
