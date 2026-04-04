"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

type EmailLogRow = {
  id: number;
  event_type: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  target_email: string | null;
  status: "sent" | "failed" | "skipped";
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

function toneByStatus(status: EmailLogRow["status"]) {
  switch (status) {
    case "sent":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-200";
    case "failed":
      return "bg-rose-500/10 text-rose-700 border-rose-200";
    default:
      return "bg-zinc-500/10 text-zinc-700 border-zinc-200";
  }
}

function formatMetadata(meta: Record<string, unknown>) {
  try {
    const s = JSON.stringify(meta, null, 0);
    if (s.length <= 120) return s;
    return `${s.slice(0, 117)}…`;
  } catch {
    return "—";
  }
}

export default function EmailAuditLogsPage() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<EmailLogRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | EmailLogRow["status"]>(
    "all",
  );
  const [eventFilter, setEventFilter] = useState<string>("all");
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
      .from("user_email_event_logs")
      .select(
        "id,event_type,actor_user_id,target_user_id,target_email,status,error_message,metadata,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500);

    if (listErr) {
      setError(listErr.message);
      setRows([]);
      setLoading(false);
      return;
    }

    setRows((data as EmailLogRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, []);

  const eventTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.event_type);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (eventFilter !== "all" && r.event_type !== eventFilter) return false;
      if (!q) return true;
      const metaStr = (() => {
        try {
          return JSON.stringify(r.metadata ?? {}).toLowerCase();
        } catch {
          return "";
        }
      })();
      return (
        r.event_type.toLowerCase().includes(q) ||
        (r.target_email ?? "").toLowerCase().includes(q) ||
        (r.error_message ?? "").toLowerCase().includes(q) ||
        (r.actor_user_id ?? "").toLowerCase().includes(q) ||
        (r.target_user_id ?? "").toLowerCase().includes(q) ||
        metaStr.includes(q)
      );
    });
  }, [query, rows, statusFilter, eventFilter]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          Loading email audit…
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
            Sign in with an admin account to view email audit logs.
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
            <h1 className="text-xl font-semibold">Email audit</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Lifecycle emails (donor welcome, rejection, admin welcome) logged from
              server actions. Use this to debug deliverability without opening the
              database.
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
            <button
              type="button"
              onClick={() => {
                const header = [
                  "id",
                  "created_at",
                  "event_type",
                  "actor_user_id",
                  "target_user_id",
                  "target_email",
                  "status",
                  "error_message",
                  "metadata",
                ];
                const esc = (v: unknown) =>
                  `"${String(v ?? "")
                    .replace(/"/g, '""')
                    .replace(/\r?\n/g, " ")}"`;
                const csvLines = [header.join(",")];
                for (const r of filteredRows) {
                  csvLines.push(
                    [
                      r.id,
                      r.created_at,
                      r.event_type,
                      r.actor_user_id ?? "",
                      r.target_user_id ?? "",
                      r.target_email ?? "",
                      r.status,
                      r.error_message ?? "",
                      JSON.stringify(r.metadata ?? {}),
                    ].map(esc).join(","),
                  );
                }
                const blob = new Blob([csvLines.join("\n")], {
                  type: "text/csv;charset=utf-8",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `email-audit-${new Date()
                  .toISOString()
                  .slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
              }}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Download CSV
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none ring-rose-200 placeholder:text-zinc-400 focus:ring"
            placeholder="Search email, user id, event, error…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            className="rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none ring-rose-200 focus:ring"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as "all" | EmailLogRow["status"])
            }
          >
            <option value="all">All outcomes</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
          <select
            className="rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none ring-rose-200 focus:ring"
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value)}
          >
            <option value="all">All event types</option>
            {eventTypes.map((et) => (
              <option key={et} value={et}>
                {et}
              </option>
            ))}
          </select>
          <div className="rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm text-zinc-600">
            Showing <b>{filteredRows.length}</b> of <b>{rows.length}</b> rows
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-5 overflow-x-auto rounded-2xl border">
          <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-700">
              <tr>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">When</th>
                <th className="px-3 py-2 font-semibold">Event</th>
                <th className="px-3 py-2 font-semibold">To</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold min-w-[200px]">Error</th>
                <th className="px-3 py-2 font-semibold min-w-[180px]">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-5 text-zinc-500" colSpan={6}>
                    {rows.length === 0
                      ? "No email events logged yet (approvals/rejections/admin welcome will appear here)."
                      : "No rows match your filters."}
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2 whitespace-nowrap align-top">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-xs text-zinc-800">
                      {r.event_type}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="max-w-[220px] break-words text-zinc-800">
                        {r.target_email ?? "—"}
                      </div>
                      {r.target_user_id ? (
                        <div className="mt-1 font-mono text-[11px] text-zinc-500">
                          user {r.target_user_id.slice(0, 8)}…
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${toneByStatus(
                          r.status,
                        )}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top text-rose-800">
                      {r.error_message ? (
                        <span className="line-clamp-4 text-xs">{r.error_message}</span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-[11px] text-zinc-600 break-all">
                      {formatMetadata(r.metadata ?? {})}
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
