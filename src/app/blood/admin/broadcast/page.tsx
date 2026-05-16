"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";
import WbAddressFields, { emptyWbAddress, type WbAddressValue } from "@/components/WbAddressFields";
import { normalizeWbAddress } from "@/lib/wbAddress";

type PreviewResp = {
  ok?: boolean;
  recipients?: number;
  sample?: Array<{ donor_user_id: string; email_masked: string | null; name: string | null }>;
  error?: string;
};

type SendResp = {
  ok?: boolean;
  recipients?: number;
  emailSent?: number;
  emailFailed?: number;
  telegramSent?: number;
  telegramFailed?: number;
  pushSent?: number;
  pushFailed?: number;
  error?: string;
};

type BloodGroupRow = {
  blood_group: string;
  display_name: string;
};

const fallbackBloodGroups: BloodGroupRow[] = [
  { blood_group: "O+", display_name: "O+" },
  { blood_group: "O-", display_name: "O-" },
  { blood_group: "A+", display_name: "A+" },
  { blood_group: "A-", display_name: "A-" },
  { blood_group: "B+", display_name: "B+" },
  { blood_group: "B-", display_name: "B-" },
  { blood_group: "AB+", display_name: "AB+" },
  { blood_group: "AB-", display_name: "AB-" },
];

async function callAdminApi<T>(routeName: string, body: Record<string, unknown>): Promise<T> {
  const supabase = getSupabaseOrNull();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Missing access token.");

  const resp = await fetch(`/api/admin/${routeName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let json: { error?: string } = {};
  try {
    json = (text ? JSON.parse(text) : {}) as { error?: string };
  } catch {
    json = {};
  }
  if (!resp.ok) throw new Error(json.error ?? text.slice(0, 200));
  return json as unknown as T;
}

export default function AdminBroadcastPage() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [canBroadcast, setCanBroadcast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [bloodGroup, setBloodGroup] = useState("O+");
  const [bloodGroups, setBloodGroups] = useState<BloodGroupRow[]>([]);
  const [address, setAddress] = useState<WbAddressValue>(emptyWbAddress);
  const [addressError, setAddressError] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [channels, setChannels] = useState({ email: true, push: true, telegram: true });

  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [busyPreview, setBusyPreview] = useState(false);
  const [busySend, setBusySend] = useState(false);
  const [sendResult, setSendResult] = useState<SendResp | null>(null);

  const district = address.district.trim();
  const block = address.block.trim();
  const panchayat = address.panchayat.trim();

  const locationLabel = useMemo(() => {
    const parts = [district, block, panchayat].filter(Boolean);
    return parts.join(" / ") || "—";
  }, [block, district, panchayat]);

  useEffect(() => {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      queueMicrotask(() => {
        setIsAdmin(false);
        setError(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
        );
        setLoading(false);
      });
      return;
    }
    void (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session?.user) {
        queueMicrotask(() => {
          setIsAdmin(false);
          setLoading(false);
        });
        return;
      }
      const [{ data: adminOk }, { data: superOk }, { data: canB }, { data: bgData }] =
        await Promise.all([
          supabase.rpc("is_admin"),
          supabase.rpc("is_super_admin"),
          supabase.rpc("admin_can", { action: "broadcast" }),
          supabase.from("blood_groups").select("blood_group, display_name").order("sort_order"),
        ]);
      queueMicrotask(() => {
        setIsAdmin(Boolean(adminOk));
        setIsSuperAdmin(Boolean(superOk));
        setCanBroadcast(Boolean(canB));
        if (bgData && bgData.length > 0) {
          setBloodGroups(bgData as BloodGroupRow[]);
        } else {
          setBloodGroups(fallbackBloodGroups);
        }
        setLoading(false);
      });
    })();
  }, []);

  async function onPreview() {
    setBusyPreview(true);
    setError(null);
    setMsg(null);
    setSendResult(null);
    try {
      const res = await callAdminApi<PreviewResp>("broadcast", {
        action: "preview",
        blood_group: bloodGroup,
        district,
        block,
        panchayat,
      });
      setPreview(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setBusyPreview(false);
    }
  }

  async function onSend() {
    const ok = window.confirm(
      `Send broadcast to eligible donors?\nBlood group: ${bloodGroup}\nLocation: ${locationLabel}\n\nThis is rate-limited.`,
    );
    if (!ok) return;

    setBusySend(true);
    setError(null);
    setMsg(null);
    try {
      const res = await callAdminApi<SendResp>("broadcast", {
        action: "send",
        blood_group: bloodGroup,
        district,
        block,
        panchayat,
        message,
        channels,
      });
      setSendResult(res);
      setMsg("Broadcast sent.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusySend(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">Loading…</div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 className="text-lg font-semibold">Admin access required</h1>
          <p className="mt-2 text-sm text-zinc-600">Sign in as admin to use broadcast.</p>
          <div className="mt-4">
            <Link
              href="/admin/sign-in"
              className="text-sm font-semibold underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
            >
              Admin sign in
            </Link>
          </div>
          {error ? (
            <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">{error}</div>
          ) : null}
        </div>
      </div>
    );
  }

  if (!isSuperAdmin && !canBroadcast) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 className="text-lg font-semibold">Permission required</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Broadcast requires super admin access or the Broadcast permission.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/admin"
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Back to dashboard
            </Link>
            <Link
              href="/admin/admins"
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Manage admins
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">One-click broadcast</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Send an urgent message to eligible verified donors by district/block (West Bengal
              addresses via PIN lookup).
            </p>
          </div>
          <Link
            href="/admin"
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            Back
          </Link>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Blood group</span>
            <select
              value={bloodGroup}
              onChange={(e) => setBloodGroup(e.target.value)}
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
            >
              {(bloodGroups.length > 0 ? bloodGroups : fallbackBloodGroups).map((bg) => (
                <option key={bg.blood_group} value={bg.blood_group}>
                  {bg.display_name}
                </option>
              ))}
            </select>
          </label>

          <WbAddressFields
            value={address}
            onChange={(next) => setAddress(normalizeWbAddress(next))}
            onError={setAddressError}
            panchayatMode="optional"
            className="sm:col-span-2"
          />

          <label className="sm:col-span-2 block text-sm">
            <span className="font-medium text-zinc-700">Message</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 min-h-[120px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              placeholder="Urgent: blood needed…"
              required
            />
          </label>

          <div className="sm:col-span-2 flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={channels.email}
                onChange={(e) => setChannels((c) => ({ ...c, email: e.target.checked }))}
              />
              Email
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={channels.push}
                onChange={(e) => setChannels((c) => ({ ...c, push: e.target.checked }))}
              />
              Push
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={channels.telegram}
                onChange={(e) => setChannels((c) => ({ ...c, telegram: e.target.checked }))}
              />
              Telegram
            </label>
          </div>
        </div>

        <p className="mt-4 text-sm text-zinc-600">
          Target location: <b>{locationLabel}</b>
        </p>
        {addressError ? (
          <p className="mt-2 text-sm text-rose-700">{addressError}</p>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : null}
        {msg ? (
          <div className="mt-4 rounded-xl border bg-emerald-50 p-4 text-sm text-emerald-800">{msg}</div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onPreview()}
            disabled={busyPreview || !district}
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busyPreview ? "Previewing…" : "Preview recipients"}
          </button>
          <button
            type="button"
            onClick={() => void onSend()}
            disabled={busySend || !district || !message.trim()}
            className="rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busySend ? "Sending…" : "Send broadcast"}
          </button>
        </div>

        {preview ? (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-white/60 p-4 text-sm">
            <div>
              Recipients (estimate): <b>{preview.recipients ?? 0}</b>
            </div>
            {preview.sample && preview.sample.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-zinc-600">
                {preview.sample.map((s) => (
                  <li key={s.donor_user_id}>
                    {s.name ?? "Donor"} ({s.email_masked ?? "no email"})
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {sendResult ? (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-700">
            Sent to {sendResult.recipients ?? 0} donors. Email ok/fail: {sendResult.emailSent ?? 0}/
            {sendResult.emailFailed ?? 0}. Push ok/fail: {sendResult.pushSent ?? 0}/
            {sendResult.pushFailed ?? 0}. Telegram ok/fail: {sendResult.telegramSent ?? 0}/
            {sendResult.telegramFailed ?? 0}.
          </div>
        ) : null}
      </div>
    </div>
  );
}
