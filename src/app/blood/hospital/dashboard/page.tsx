"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

type EmergencyRow = {
  request_id: string;
  blood_group: string;
  district: string;
  block: string;
  panchayat: string;
  patient_name: string | null;
  request_details: string;
  contact_number: string;
  created_at: string;
  status: string;
  expires_at?: string | null;
  escalated_at?: string | null;
};

function toWhatsAppLink(contact: string) {
  const digits = contact.replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}`;
}

function formatStatusLabel(status?: string | null) {
  switch ((status ?? "open").toLowerCase()) {
    case "open":
      return "Open";
    case "in_progress":
      return "In progress";
    case "fulfilled":
      return "Fulfilled";
    case "expired":
      return "Expired";
    case "cancelled":
      return "Cancelled";
    default:
      return status ?? "Open";
  }
}

function statusBadgeTone(status?: string | null) {
  switch ((status ?? "open").toLowerCase()) {
    case "open":
      return "bg-red-500/10 text-red-700";
    case "in_progress":
      return "bg-sky-500/10 text-sky-700";
    case "fulfilled":
      return "bg-emerald-500/10 text-emerald-700";
    case "expired":
      return "bg-zinc-500/10 text-zinc-700";
    case "cancelled":
      return "bg-rose-500/10 text-rose-700";
    default:
      return "bg-zinc-500/10 text-zinc-700";
  }
}

type HospitalRequestFilter =
  | "all"
  | "active"
  | "open"
  | "in_progress"
  | "fulfilled"
  | "expired"
  | "cancelled";

export default function HospitalDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [requests, setRequests] = useState<EmergencyRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<HospitalRequestFilter>("active");
  const [escalatedOnly, setEscalatedOnly] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user ?? null;
    if (!user) {
      router.replace("/hospital/sign-in");
      return;
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (profileErr || !profile || profile.role !== "hospital") {
      setLoading(false);
      router.replace("/hospital/sign-in");
      return;
    }

    setUserId(user.id);

    const { data, error: listErr } = await supabase
      .from("emergency_requests")
      .select(
        "request_id,blood_group,district,block,panchayat,patient_name,request_details,contact_number,created_at,status,expires_at,escalated_at",
      )
      .eq("hospital_user_id", user.id)
      .order("created_at", { ascending: false });

    if (listErr) {
      setError(listErr.message);
      setRequests([]);
      setLoading(false);
      return;
    }

    setRequests((data as EmergencyRow[]) ?? []);
    setLoading(false);
  }

  const requestStats = useMemo(() => {
    let open = 0;
    let inProgress = 0;
    let fulfilled = 0;
    let expired = 0;
    let cancelled = 0;
    let escalatedActive = 0;
    for (const r of requests) {
      const s = (r.status ?? "open").toLowerCase();
      if (s === "open") open += 1;
      else if (s === "in_progress") inProgress += 1;
      else if (s === "fulfilled") fulfilled += 1;
      else if (s === "expired") expired += 1;
      else if (s === "cancelled") cancelled += 1;
      if (r.escalated_at && (s === "open" || s === "in_progress")) escalatedActive += 1;
    }
    return {
      total: requests.length,
      open,
      inProgress,
      fulfilled,
      expired,
      cancelled,
      escalatedActive,
      active: open + inProgress,
    };
  }, [requests]);

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      const s = (r.status ?? "open").toLowerCase();
      if (escalatedOnly && !r.escalated_at) return false;
      if (statusFilter === "all") return true;
      if (statusFilter === "active") return s === "open" || s === "in_progress";
      return s === statusFilter;
    });
  }, [requests, statusFilter, escalatedOnly]);

  useEffect(() => {
    queueMicrotask(() => void load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyRequestId(requestId: string) {
    try {
      await navigator.clipboard.writeText(requestId);
    } catch {
      // ignore
    }
  }

  function exportFilteredRequestsCsv() {
    const rows = filteredRequests;
    const header = [
      "request_id",
      "blood_group",
      "district",
      "block",
      "panchayat",
      "patient_name",
      "status",
      "escalated_at",
      "contact_number",
      "created_at",
      "expires_at",
      "request_details",
    ];
    const csvLines = [header.join(",")];
    for (const e of rows) {
      const vals = [
        e.request_id,
        e.blood_group,
        e.district,
        e.block,
        e.panchayat,
        e.patient_name ?? "",
        e.status,
        e.escalated_at ?? "",
        e.contact_number,
        e.created_at,
        e.expires_at ?? "",
        e.request_details,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      csvLines.push(vals.join(","));
    }
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hospital-emergency-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function updateStatus(requestId: string, nextStatus: string) {
    if (!userId) return;
    setSaving(true);
    setError(null);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setSaving(false);
      setError("Supabase is not configured.");
      return;
    }

    const nowIso = new Date().toISOString();
    const payload: Record<string, unknown> =
      nextStatus === "expired"
        ? { status: nextStatus, expires_at: nowIso }
        : { status: nextStatus, expires_at: null };

    const { error: updErr } = await supabase
      .from("emergency_requests")
      .update(payload)
      .eq("request_id", requestId)
      .eq("hospital_user_id", userId);

    setSaving(false);
    if (updErr) {
      setError(updErr.message);
      return;
    }

    await load();
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Hospital Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Manage your emergency requests status.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/emergency"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
            >
              Post new emergency
            </Link>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
              disabled={saving}
            >
              Refresh
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        {requests.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-zinc-200 bg-white/90 p-3 shadow-sm">
              <div className="text-xs font-semibold text-zinc-500">Total posted</div>
              <div className="mt-1 text-2xl font-bold text-zinc-900">{requestStats.total}</div>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 shadow-sm">
              <div className="text-xs font-semibold text-rose-800">Open</div>
              <div className="mt-1 text-2xl font-bold text-rose-900">{requestStats.open}</div>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-3 shadow-sm">
              <div className="text-xs font-semibold text-sky-800">In progress</div>
              <div className="mt-1 text-2xl font-bold text-sky-900">{requestStats.inProgress}</div>
            </div>
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 shadow-sm">
              <div className="text-xs font-semibold text-violet-800">SLA escalated (active)</div>
              <div className="mt-1 text-2xl font-bold text-violet-900">
                {requestStats.escalatedActive}
              </div>
            </div>
          </div>
        ) : null}

        {requests.length > 0 ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <label className="flex flex-col gap-1 text-xs text-zinc-600 sm:min-w-[200px]">
              <span className="font-semibold text-zinc-700">Filter by status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as HospitalRequestFilter)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
              >
                <option value="active">Active (open + in progress)</option>
                <option value="all">All</option>
                <option value="open">Open only</option>
                <option value="in_progress">In progress only</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="expired">Expired</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800">
              <input
                type="checkbox"
                checked={escalatedOnly}
                onChange={(e) => setEscalatedOnly(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300"
              />
              Escalated only
            </label>
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <span className="text-xs text-zinc-500">
                Showing {filteredRequests.length} of {requests.length}
              </span>
              <button
                type="button"
                onClick={exportFilteredRequestsCsv}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
              >
                Export CSV (current filter)
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          {requests.length === 0 ? (
            <div className="text-sm text-zinc-600">No requests yet.</div>
          ) : null}

          {filteredRequests.length === 0 && requests.length > 0 ? (
            <div className="text-sm text-zinc-600">
              No requests match this filter. Try &quot;All&quot; or turn off escalated-only.
            </div>
          ) : null}

          {filteredRequests.map((it) => (
            <div
              key={it.request_id}
              className="rounded-2xl border border-zinc-200 bg-white/80 p-4 shadow-sm"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold">
                      {it.blood_group} blood in {it.district}
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeTone(
                        it.status,
                      )}`}
                    >
                      {formatStatusLabel(it.status)}
                    </span>
                    {it.escalated_at ? (
                      <span
                        className="rounded-full border border-violet-300 bg-violet-500/10 px-2 py-0.5 text-xs font-semibold text-violet-900"
                        title="Exceeded response-time SLA; coordinators were notified."
                      >
                        SLA escalated
                      </span>
                    ) : null}
                  </div>
                  <div className="text-sm text-zinc-700">
                    {it.block} / {it.panchayat}
                  </div>
                  {it.patient_name ? (
                    <div className="text-sm text-zinc-600">
                      Patient: {it.patient_name}
                    </div>
                  ) : null}
                  <div className="mt-1 text-sm">{it.request_details}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-zinc-500">
                      ID: {it.request_id.slice(0, 8)}…
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyRequestId(it.request_id)}
                      className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-100"
                    >
                      Copy full ID
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:items-end">
                  <a
                    className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105"
                    href={toWhatsAppLink(it.contact_number)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    WhatsApp
                  </a>

                  <div className="flex flex-wrap gap-2">
                    {it.status === "open" ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void updateStatus(it.request_id, "in_progress")}
                        className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-60"
                      >
                        Mark in progress
                      </button>
                    ) : null}

                    {it.status === "in_progress" ? (
                      <>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void updateStatus(it.request_id, "fulfilled")}
                          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                        >
                          Fulfilled
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void updateStatus(it.request_id, "expired")}
                          className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                        >
                          Expired
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void updateStatus(it.request_id, "cancelled")}
                          className="rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-900 hover:bg-rose-50 disabled:opacity-60"
                        >
                          Cancelled
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

