"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

type PublicDonorRow = {
  user_id: string;
  name: string;
  blood_group: string;
  district: string;
  block: string;
  panchayat: string;
  village: string;
  id_card_verified: boolean;
  last_donation_date: string;
  pause_until: string | null;
};

export default function PublicDonorProfilePage(props: { params: { userId: string } }) {
  const userId = props.params.userId;
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState<PublicDonorRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const location = useMemo(() => {
    if (!row) return "-";
    const parts = [row.district, row.block, row.panchayat, row.village].filter((x) => Boolean(x?.trim()));
    return parts.join(" / ");
  }, [row]);

  useEffect(() => {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      queueMicrotask(() => {
        setError("Supabase is not configured.");
        setLoading(false);
      });
      return;
    }
    void (async () => {
      setLoading(true);
      setError(null);
      const { data, error: rpcErr } = await supabase.rpc("get_public_donor_profile", {
        p_user_id: userId,
      });
      if (rpcErr) {
        setError(rpcErr.message);
        setRow(null);
        setLoading(false);
        return;
      }
      const first = (data as PublicDonorRow[] | null)?.[0] ?? null;
      setRow(first);
      setLoading(false);
    })();
  }, [userId]);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Donor verification</h1>
            <p className="mt-1 text-sm text-zinc-600">Public view for QR verification.</p>
          </div>
          <Link
            href="/blood"
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            Home
          </Link>
        </div>

        {loading ? <div className="mt-6 text-sm text-zinc-600">Loading…</div> : null}

        {!loading && !row ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {error ?? "Donor profile not found / not eligible / paused."}
          </div>
        ) : null}

        {row ? (
          <div className="mt-6 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">{row.name}</span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                Verified
              </span>
              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-700">
                {row.blood_group}
              </span>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white/80 p-4">
              <div className="text-xs font-semibold text-zinc-500">Location</div>
              <div className="mt-1 text-sm font-semibold text-zinc-900">{location}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-white/80 p-4">
                <div className="text-xs font-semibold text-zinc-500">Last donation date</div>
                <div className="mt-1 text-sm font-semibold text-zinc-900">{row.last_donation_date}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white/80 p-4">
                <div className="text-xs font-semibold text-zinc-500">Donor User ID</div>
                <div className="mt-1 break-all text-xs font-semibold text-zinc-900">{row.user_id}</div>
              </div>
            </div>
            <div className="text-xs text-zinc-500">
              Phone number is hidden for privacy. Contact donors via the app search.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

