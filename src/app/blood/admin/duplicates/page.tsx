"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

type DupRow = { contact_number: string; donor_count: number };

export default function DonorDuplicatesPage() {
  const [loading, setLoading] = useState(true);
  const [isSuper, setIsSuper] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<DupRow[]>([]);

  async function load() {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session?.user) {
      setLoading(false);
      return;
    }

    const { data: ok, error: admErr } = await supabase.rpc("admin_can", {
      action: "view_duplicate_contacts",
    });
    if (admErr) {
      setError(admErr.message);
      setLoading(false);
      return;
    }
    if (!ok) {
      setLoading(false);
      return;
    }
    setIsSuper(true);

    const { data, error: rpcErr } = await supabase.rpc("admin_list_duplicate_donor_contacts");

    if (rpcErr) {
      setError(
        rpcErr.message +
          (rpcErr.message.includes("function") || rpcErr.message.includes("does not exist")
            ? " — Run supabase/23_super_admin_features.sql."
            : ""),
      );
      setRows([]);
    } else {
      setRows((data as DupRow[]) ?? []);
      setError(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, []);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          Loading…
        </div>
      </div>
    );
  }

  if (!isSuper) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 className="text-lg font-semibold">Permission required</h1>
          <Link href="/admin" className="mt-4 inline-block text-sm font-semibold text-rose-700 underline">
            Back
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Duplicate donor contacts</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Phone numbers shared by more than one donor row (review before merging accounts).
            </p>
          </div>
          <Link
            href="/admin"
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            Dashboard
          </Link>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 overflow-x-auto rounded-xl border">
          <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50">
              <tr>
                <th className="px-3 py-2 font-semibold">Contact</th>
                <th className="px-3 py-2 font-semibold"># Profiles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-zinc-500" colSpan={2}>
                    No duplicates found (same phone on multiple donors).
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.contact_number}>
                    <td className="px-3 py-2 font-medium">{r.contact_number}</td>
                    <td className="px-3 py-2 text-rose-800">{r.donor_count}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
