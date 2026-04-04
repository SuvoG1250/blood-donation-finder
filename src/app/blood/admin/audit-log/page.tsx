"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

type AuditRow = {
  id: number;
  actor_user_id: string;
  action_type: string;
  target_kind: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export default function SuperAdminAuditPage() {
  const [loading, setLoading] = useState(true);
  const [isSuper, setIsSuper] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");

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

    const { data: ok, error: adminErr } = await supabase.rpc("admin_can", {
      action: "view_audit_log",
    });
    if (adminErr) {
      setError(adminErr.message);
      setLoading(false);
      return;
    }
    if (!ok) {
      setLoading(false);
      return;
    }
    setIsSuper(true);

    const { data, error: qErr } = await supabase
      .from("super_admin_audit_logs")
      .select(
        "id,actor_user_id,action_type,target_kind,target_id,metadata,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(400);

    if (qErr) {
      setError(
        qErr.message +
          (qErr.message.includes("relation") || qErr.message.includes("does not exist")
            ? " — Run supabase/23_super_admin_features.sql on your project."
            : ""),
      );
      setRows([]);
    } else {
      setRows((data as AuditRow[]) ?? []);
      setError(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, []);

  const actionTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.action_type) set.add(r.action_type);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter !== "all" && r.action_type !== actionFilter) return false;
      if (!q) return true;
      const meta = JSON.stringify(r.metadata ?? {});
      return (
        r.action_type.toLowerCase().includes(q) ||
        (r.target_id ?? "").toLowerCase().includes(q) ||
        (r.target_kind ?? "").toLowerCase().includes(q) ||
        r.actor_user_id.toLowerCase().includes(q) ||
        meta.toLowerCase().includes(q)
      );
    });
  }, [actionFilter, rows, searchQuery]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          Loading audit log…
        </div>
      </div>
    );
  }

  if (!isSuper) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 className="text-lg font-semibold">Permission required</h1>
          <p className="mt-2 text-sm text-zinc-600">
            You need the “view audit log” permission to see destructive-action entries.
          </p>
          <Link href="/admin" className="mt-4 inline-block text-sm font-semibold text-rose-700 underline">
            Back to dashboard
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
            <h1 className="text-xl font-semibold">Audit log</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Deletes, role changes, broadcasts, hospital verification, retention purges, emergency re-notify.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/admin"
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Dashboard
            </Link>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                void load();
              }}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search action, target id, actor, metadata…"
            className="w-full min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20 sm:max-w-md"
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm sm:w-auto sm:min-w-[200px]"
          >
            <option value="all">All actions</option>
            {actionTypes.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border">
          <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-700">
              <tr>
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">Action</th>
                <th className="px-3 py-2 font-semibold">Target</th>
                <th className="px-3 py-2 font-semibold">Actor</th>
                <th className="px-3 py-2 font-semibold">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white">
              {filteredRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-zinc-500" colSpan={5}>
                    {rows.length === 0 ? "No audit rows yet." : "No rows match this filter."}
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-3 py-2 align-top text-xs">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-xs">{r.action_type}</td>
                    <td className="px-3 py-2 align-top">
                      <div className="font-mono text-xs text-zinc-800">{r.target_id ?? "—"}</div>
                      <div className="text-[11px] text-zinc-500">{r.target_kind ?? ""}</div>
                    </td>
                    <td className="max-w-[120px] break-all px-3 py-2 align-top font-mono text-[11px] text-zinc-600">
                      {r.actor_user_id.slice(0, 8)}…
                    </td>
                    <td className="max-w-md px-3 py-2 align-top font-mono text-[11px] text-zinc-600 break-all">
                      {JSON.stringify(r.metadata ?? {})}
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
