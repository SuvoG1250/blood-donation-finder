"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

type DonorHit = {
  user_id: string;
  name: string;
  blood_group: string;
  district: string;
  block: string;
  panchayat: string;
  contact_number: string | null;
  id_card_verified: boolean | null;
  rejection_reason: string | null;
  last_donation_date: string | null;
  auth_email: string | null;
};

async function callAdminApi<T>(
  routeName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const supabase = getSupabaseOrNull();
  if (!supabase) throw new Error("Supabase is not configured.");

  const apiPath = `/api/admin/${routeName}`;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Missing access token.");

  const resp = await fetch(apiPath, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await resp.text();
  let json: { error?: string; donors?: DonorHit[] } = {};
  try {
    json = (text ? JSON.parse(text) : {}) as { error?: string; donors?: DonorHit[] };
  } catch {
    json = {};
  }
  if (!resp.ok) {
    throw new Error(json.error ?? text.slice(0, 200) ?? `HTTP ${resp.status}`);
  }
  return json as unknown as T;
}

export default function DonorLookupPage() {
  const [loading, setLoading] = useState(true);
  const [isSuper, setIsSuper] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DonorHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = getSupabaseOrNull();
      if (!supabase) {
        setLoading(false);
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session?.user) {
        setLoading(false);
        return;
      }
      const { data: ok } = await supabase.rpc("admin_can", {
        action: "view_donor_lookup",
      });
      setIsSuper(Boolean(ok));
      setLoading(false);
    })();
  }, []);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await callAdminApi<{ donors: DonorHit[] }>("donor-lookup", { q: q.trim() });
      setResults(res.donors ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Search failed.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

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
            <h1 className="text-xl font-semibold">Donor lookup</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Search by donor <b>user id</b> (UUID), exact <b>email</b>, or partial{" "}
              <b>phone</b>.
            </p>
          </div>
          <Link
            href="/admin"
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            Dashboard
          </Link>
        </div>

        <form onSubmit={(e) => void onSearch(e)} className="mt-6 flex flex-col gap-2 sm:flex-row">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="UUID, email, or phone fragment"
            className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={searching}
            className="rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>

        {error ? (
          <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          {results.map((d) => (
            <div
              key={d.user_id}
              className="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm"
            >
              <div className="font-semibold">
                {d.name} <span className="text-zinc-500">({d.blood_group})</span>
              </div>
              <div className="mt-1 text-sm text-zinc-600">
                {d.district} / {d.block} / {d.panchayat}
              </div>
              <div className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-zinc-500">Auth email:</span>{" "}
                  <span className="font-mono text-xs">{d.auth_email ?? "—"}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Phone:</span> {d.contact_number ?? "—"}
                </div>
                <div>
                  <span className="text-zinc-500">User id:</span>{" "}
                  <span className="font-mono text-[11px]">{d.user_id}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Verified:</span>{" "}
                  {d.id_card_verified ? "yes" : "no"}
                  {d.rejection_reason ? (
                    <span className="text-rose-700"> — {d.rejection_reason}</span>
                  ) : null}
                </div>
                <div>
                  <span className="text-zinc-500">Last donation:</span>{" "}
                  {d.last_donation_date ?? "—"}
                </div>
              </div>
            </div>
          ))}
          {results.length === 0 && !error && !searching ? (
            <p className="text-sm text-zinc-500">Enter a query and search.</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
