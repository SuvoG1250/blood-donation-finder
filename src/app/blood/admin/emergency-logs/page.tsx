"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

type NotificationLogRow = {
  id: number;
  request_id: string;
  donor_user_id: string | null;
  donor_email: string | null;
  status:
    | "matched"
    | "sent"
    | "failed"
    | "skipped_no_email"
    | "provider_not_configured";
  error_message: string | null;
  created_at: string;
};

function toneByStatus(status: NotificationLogRow["status"]) {
  switch (status) {
    case "sent":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-200";
    case "failed":
      return "bg-rose-500/10 text-rose-700 border-rose-200";
    case "matched":
      return "bg-sky-500/10 text-sky-700 border-sky-200";
    case "provider_not_configured":
      return "bg-amber-500/10 text-amber-800 border-amber-200";
    default:
      return "bg-zinc-500/10 text-zinc-700 border-zinc-200";
  }
}

function labelByStatus(status: NotificationLogRow["status"]) {
  if (status === "provider_not_configured") return "Provider missing";
  if (status === "skipped_no_email") return "No email";
  if (status === "matched") return "Matched";
  if (status === "sent") return "Sent";
  return "Failed";
}

export default function EmergencyNotificationLogsPage() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<NotificationLogRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<
    "all" | NotificationLogRow["status"]
  >("all");
  const [query, setQuery] = useState("");

  async function load() {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setIsAdmin(false);
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const { data: adminOk, error: adminErr } = await supabase.rpc("is_admin");
    if (adminErr) {
      setError(adminErr.message);
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    if (!adminOk) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }
    setIsAdmin(true);
    setError(null);

    const { data, error: listErr } = await supabase
      .from("emergency_notification_logs")
      .select(
        "id,request_id,donor_user_id,donor_email,status,error_message,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(300);

    if (listErr) {
      setError(listErr.message);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data as NotificationLogRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, []);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.request_id.toLowerCase().includes(q) ||
        (r.donor_email ?? "").toLowerCase().includes(q) ||
        (r.error_message ?? "").toLowerCase().includes(q)
      );
    });
  }, [query, rows, statusFilter]);

  const grouped = useMemo(() => {
    const map = new Map<
      string,
      {
        requestId: string;
        latestAt: string;
        matched: number;
        sent: number;
        failed: number;
        skippedNoEmail: number;
        providerMissing: number;
      }
    >();
    for (const r of filteredRows) {
      const prev = map.get(r.request_id) ?? {
        requestId: r.request_id,
        latestAt: r.created_at,
        matched: 0,
        sent: 0,
        failed: 0,
        skippedNoEmail: 0,
        providerMissing: 0,
      };
      if (new Date(r.created_at).getTime() > new Date(prev.latestAt).getTime()) {
        prev.latestAt = r.created_at;
      }
      if (r.status === "matched") prev.matched += 1;
      if (r.status === "sent") prev.sent += 1;
      if (r.status === "failed") prev.failed += 1;
      if (r.status === "skipped_no_email") prev.skippedNoEmail += 1;
      if (r.status === "provider_not_configured") prev.providerMissing += 1;
      map.set(r.request_id, prev);
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime(),
    );
  }, [filteredRows]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          Loading notification logs...
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 className="text-lg font-semibold">Admin access required</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Sign in with an admin account to view notification logs.
          </p>
          <div className="mt-4">
            <Link
              href="/admin/sign-in"
              className="text-sm font-semibold underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
            >
              Admin sign in
            </Link>
          </div>
          {error ? (
            <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Emergency Notification Logs</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Track matched donors and email send results per emergency request.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Back to dashboard
            </Link>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <input
            className="rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none ring-rose-200 placeholder:text-zinc-400 focus:ring"
            placeholder="Search request id / email / error"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none ring-rose-200 focus:ring"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as "all" | NotificationLogRow["status"],
              )
            }
          >
            <option value="all">All statuses</option>
            <option value="matched">Matched</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="skipped_no_email">No email</option>
            <option value="provider_not_configured">Provider missing</option>
          </select>
          <div className="rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm text-zinc-600">
            Showing <b>{filteredRows.length}</b> of <b>{rows.length}</b> logs
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-5 overflow-x-auto rounded-2xl border">
          <div className="border-b bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700">
            Request summary
          </div>
          <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-700">
              <tr>
                <th className="px-3 py-2 font-semibold">Request</th>
                <th className="px-3 py-2 font-semibold">Last update</th>
                <th className="px-3 py-2 font-semibold">Matched</th>
                <th className="px-3 py-2 font-semibold">Sent</th>
                <th className="px-3 py-2 font-semibold">Failed</th>
                <th className="px-3 py-2 font-semibold">No email</th>
                <th className="px-3 py-2 font-semibold">Provider missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {grouped.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-zinc-500" colSpan={7}>
                    No grouped data available.
                  </td>
                </tr>
              ) : (
                grouped.map((g) => (
                  <tr key={g.requestId}>
                    <td className="px-3 py-2 font-mono text-xs">{g.requestId}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(g.latestAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{g.matched}</td>
                    <td className="px-3 py-2 text-emerald-700">{g.sent}</td>
                    <td className="px-3 py-2 text-rose-700">{g.failed}</td>
                    <td className="px-3 py-2">{g.skippedNoEmail}</td>
                    <td className="px-3 py-2">{g.providerMissing}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-5 overflow-x-auto rounded-2xl border">
          <div className="border-b bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700">
            Detailed rows
          </div>
          <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-700">
              <tr>
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">Request</th>
                <th className="px-3 py-2 font-semibold">Donor email</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-5 text-zinc-500" colSpan={5}>
                    No notification logs found.
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.request_id}</td>
                    <td className="px-3 py-2">{r.donor_email ?? "-"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${toneByStatus(
                          r.status,
                        )}`}
                      >
                        {labelByStatus(r.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-rose-700">
                      {r.error_message ? (
                        <span className="line-clamp-2">{r.error_message}</span>
                      ) : (
                        "-"
                      )}
                    </td>
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

