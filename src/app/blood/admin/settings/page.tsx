"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

const KEYS = [
  "support_whatsapp",
  "home_tagline",
  "home_support_note",
  "emergency_retention_days",
  "emergency_sla_open_minutes",
  "emergency_sla_verify_pending_minutes",
  "telegram_enabled",
  "telegram_emergency_template",
  "telegram_reminder_template",
  "whatsapp_emergency_template",
  "whatsapp_query_template",
  "whatsapp_availability_template",
] as const;

const DEFAULT_VALUES = {
  support_whatsapp: "",
  home_tagline: "",
  home_support_note: "",
  emergency_retention_days: "365",
  emergency_sla_open_minutes: "30",
  emergency_sla_verify_pending_minutes: "20",
  telegram_enabled: "false",
  telegram_emergency_template:
    "🚨 Emergency Blood Request\nBlood group: {{blood_group}}\nLocation: {{district}} / {{block}} / {{panchayat}}\n{{patient_line}}\n{{contact_line}}\n{{details_line}}",
  telegram_reminder_template:
    "🩸 Hello {{name}}, you are now eligible to donate again. Thank you for supporting Raktodaan.",
  whatsapp_emergency_template:
    "Hello {{donor_name}}, I am {{requester}}. I need {{blood_group}} blood donor support in {{district}}, {{block}}{{panchayat_line}}{{village_line}}.",
  whatsapp_query_template:
    "Hello {{donor_name}}, I am {{requester}}. Are you available to donate {{blood_group}} blood? Location: {{district}}, {{block}}{{panchayat_line}}{{village_line}}.",
  whatsapp_availability_template:
    "Hello {{donor_name}}, I am {{requester}}. Please tell me when you can donate (day/time). Needed: {{blood_group}}. Location: {{district}}, {{block}}{{panchayat_line}}{{village_line}}.",
} as const;

async function callAdminApi(routeName: string, body: Record<string, unknown>) {
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
  let json: { error?: string; ok?: boolean; deleted?: number } = {};
  try {
    json = (text ? JSON.parse(text) : {}) as { error?: string; ok?: boolean; deleted?: number };
  } catch {
    json = {};
  }
  if (!resp.ok) throw new Error(json.error ?? text.slice(0, 200));
  return json;
}

export default function SuperAdminSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [isSuper, setIsSuper] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({ ...DEFAULT_VALUES });
  const [purging, setPurging] = useState(false);
  const [telegramTesting, setTelegramTesting] = useState(false);

  const load = useCallback(async () => {
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
      action: "edit_site_settings",
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

    const { data, error: qErr } = await supabase
      .from("public_site_settings")
      .select("setting_key,setting_value")
      .in("setting_key", [...KEYS]);

    if (qErr) {
      setError(
        qErr.message +
          (qErr.message.includes("relation") || qErr.message.includes("does not exist")
            ? " — Run supabase/23_super_admin_features.sql."
            : ""),
      );
    } else {
      const next: Record<string, string> = { ...DEFAULT_VALUES };
      for (const row of data ?? []) {
        const r = row as { setting_key: string; setting_value: string };
        if (KEYS.includes(r.setting_key as (typeof KEYS)[number])) {
          next[r.setting_key] = r.setting_value;
        }
      }
      setValues(next);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedMsg(null);
    const supabase = getSupabaseOrNull();
    if (!supabase) return;

    const rows = KEYS.map((k) => ({
      setting_key: k,
      setting_value: values[k] ?? "",
      updated_at: new Date().toISOString(),
    }));

    const { error: upErr } = await supabase.from("public_site_settings").upsert(rows, {
      onConflict: "setting_key",
    });

    if (upErr) {
      setError(upErr.message);
      return;
    }
    setSavedMsg("Saved.");
  }

  async function onPurge() {
    const days = parseInt(values.emergency_retention_days || "365", 10);
    const ok = window.confirm(
      `Delete fulfilled / expired / cancelled emergency requests older than ${Number.isFinite(days) ? days : 365} days? This cannot be undone.`,
    );
    if (!ok) return;
    setPurging(true);
    setError(null);
    try {
      const res = await callAdminApi("purge-old-emergencies", {});
      setSavedMsg(`Purge complete: removed ${res.deleted ?? 0} request(s).`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Purge failed.");
    } finally {
      setPurging(false);
    }
  }

  async function onTestTelegram() {
    setTelegramTesting(true);
    setError(null);
    setSavedMsg(null);
    try {
      await callAdminApi("send-telegram-test-message", {});
      setSavedMsg("Telegram test sent.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Telegram test failed.");
    } finally {
      setTelegramTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          Loading…
        </div>
      </div>
    );
  }

  if (!isSuper) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
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
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Site settings</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Public homepage copy and data retention. Keys are read without secrets via RLS.
            </p>
          </div>
          <Link
            href="/admin"
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
          >
            Dashboard
          </Link>
        </div>

        <form onSubmit={(e) => void onSave(e)} className="mt-8 space-y-5">
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Support WhatsApp (display + link)</span>
            <input
              value={values.support_whatsapp}
              onChange={(e) => setValues((v) => ({ ...v, support_whatsapp: e.target.value }))}
              className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              placeholder="+91..."
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Home tagline (main paragraph)</span>
            <textarea
              value={values.home_tagline}
              onChange={(e) => setValues((v) => ({ ...v, home_tagline: e.target.value }))}
              className="mt-1 min-h-[80px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              placeholder="Leave empty to use default text on homepage."
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Home support note (optional second line)</span>
            <textarea
              value={values.home_support_note}
              onChange={(e) => setValues((v) => ({ ...v, home_support_note: e.target.value }))}
              className="mt-1 min-h-[60px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">
              Emergency retention (days) — fulfilled / expired / cancelled only
            </span>
            <input
              type="number"
              min={30}
              max={3650}
              value={values.emergency_retention_days}
              onChange={(e) =>
                setValues((v) => ({ ...v, emergency_retention_days: e.target.value }))
              }
              className="mt-1 w-full max-w-xs rounded-xl border border-zinc-200 px-3 py-2 text-sm"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium text-zinc-700">
                SLA: open escalation threshold (minutes)
              </span>
              <input
                type="number"
                min={5}
                max={10080}
                value={values.emergency_sla_open_minutes}
                onChange={(e) =>
                  setValues((v) => ({ ...v, emergency_sla_open_minutes: e.target.value }))
                }
                className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-zinc-700">
                SLA: pending verify escalation threshold (minutes)
              </span>
              <input
                type="number"
                min={5}
                max={10080}
                value={values.emergency_sla_verify_pending_minutes}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    emergency_sla_verify_pending_minutes: e.target.value,
                  }))
                }
                className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Enable Telegram alerts</span>
            <select
              value={values.telegram_enabled}
              onChange={(e) => setValues((v) => ({ ...v, telegram_enabled: e.target.value }))}
              className="mt-1 w-full max-w-xs rounded-xl border border-zinc-200 px-3 py-2 text-sm"
            >
              <option value="false">Off</option>
              <option value="true">On</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Telegram emergency template</span>
            <textarea
              value={values.telegram_emergency_template}
              onChange={(e) =>
                setValues((v) => ({ ...v, telegram_emergency_template: e.target.value }))
              }
              className="mt-1 min-h-[120px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              placeholder={"Placeholders: {{blood_group}}, {{district}}, {{block}}, {{panchayat}}, {{patient_line}}, {{contact_line}}, {{details_line}}"}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700">Telegram reminder template</span>
            <textarea
              value={values.telegram_reminder_template}
              onChange={(e) =>
                setValues((v) => ({ ...v, telegram_reminder_template: e.target.value }))
              }
              className="mt-1 min-h-[90px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              placeholder={"Placeholder: {{name}}"}
            />
          </label>

          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <div className="text-sm font-semibold text-zinc-800">WhatsApp message templates</div>
            <div className="mt-1 text-xs text-zinc-600">
                Placeholders: {"{{donor_name}}"}, {"{{requester}}"}, {"{{blood_group}}"},{" "}
                {"{{district}}"}, {"{{block}}"}, {"{{panchayat_line}}"}, {"{{village_line}}"}
            </div>
            <div className="mt-3 space-y-4">
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">WhatsApp emergency template</span>
                <textarea
                  value={values.whatsapp_emergency_template}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, whatsapp_emergency_template: e.target.value }))
                  }
                  className="mt-1 min-h-[90px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">WhatsApp query template</span>
                <textarea
                  value={values.whatsapp_query_template}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, whatsapp_query_template: e.target.value }))
                  }
                  className="mt-1 min-h-[90px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-zinc-700">WhatsApp availability template</span>
                <textarea
                  value={values.whatsapp_availability_template}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, whatsapp_availability_template: e.target.value }))
                  }
                  className="mt-1 min-h-[90px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-5 py-2 text-sm font-semibold text-white"
            >
              Save settings
            </button>
            <button
              type="button"
              onClick={() => void onPurge()}
              disabled={purging}
              className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-2 text-sm font-semibold text-rose-900 disabled:opacity-60"
            >
              {purging ? "Purging…" : "Run retention purge now"}
            </button>
            <button
              type="button"
              onClick={() => void onTestTelegram()}
              disabled={telegramTesting}
              className="rounded-xl border border-sky-200 bg-sky-50 px-5 py-2 text-sm font-semibold text-sky-900 disabled:opacity-60"
            >
              {telegramTesting ? "Sending…" : "Send Telegram test"}
            </button>
          </div>
        </form>

        {error ? (
          <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {savedMsg ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {savedMsg}
          </div>
        ) : null}
      </div>
    </div>
  );
}
