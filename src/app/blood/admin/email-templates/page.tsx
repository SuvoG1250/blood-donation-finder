"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

type TemplateState = {
  subject_template: string;
  preheader_template: string | null;
  html_template: string;
  text_template: string;
};

const KEYS = [
  "donor_approved_welcome",
  "donor_rejected_notice",
  "admin_account_created_welcome",
  "hospital_account_created_welcome",
] as const;

function labelForKey(key: (typeof KEYS)[number]) {
  switch (key) {
    case "donor_approved_welcome":
      return "Donor approved welcome";
    case "donor_rejected_notice":
      return "Donor rejection notice";
    case "admin_account_created_welcome":
      return "Admin account created";
    case "hospital_account_created_welcome":
      return "Hospital account created";
    default:
      return key;
  }
}

export default function EmailTemplatesPage() {
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [templates, setTemplates] = useState<
    Partial<Record<(typeof KEYS)[number], TemplateState>>
  >({});

  const apiHeaders = useMemo(() => {
    return async () => {
      const supabase = getSupabaseOrNull();
      const session = await supabase?.auth.getSession();
      const token = session?.data.session?.access_token;
      return token ? { Authorization: `Bearer ${token}` } : {};
    };
  }, []);

  async function load() {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setError("Supabase is not configured.");
      setLoading(false);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) {
      setLoading(false);
      return;
    }

    const { data: ok, error: okErr } = await supabase.rpc("admin_can", {
      action: "edit_email_templates",
    });
    if (okErr) {
      setError(okErr.message);
      setLoading(false);
      return;
    }
    if (!ok) {
      setLoading(false);
      return;
    }
    setIsSuperAdmin(true);

    const headers = await apiHeaders();
    const resp = await fetch("/api/admin/email-templates", {
      headers: headers as HeadersInit,
    });
    type ApiResp = {
      error?: string;
      ok?: boolean;
      templates?: Record<string, unknown>;
    };
    const json = (await resp.json().catch(() => ({}))) as ApiResp;

    if (!resp.ok) {
      setError(json.error ?? "Failed to load templates.");
      setLoading(false);
      return;
    }

    const t = (json.templates ?? {}) as Record<string, unknown>;
    const next: Partial<Record<(typeof KEYS)[number], TemplateState>> = {};
    for (const key of KEYS) {
      const row = t[key] as Partial<TemplateState> | undefined;
      if (!row) continue;

      const r = row as {
        subject_template?: unknown;
        preheader_template?: unknown;
        html_template?: unknown;
        text_template?: unknown;
      };
      next[key] = {
        subject_template: String(r.subject_template ?? ""),
        preheader_template:
          r.preheader_template === null || r.preheader_template === undefined
            ? null
            : String(r.preheader_template),
        html_template: String(r.html_template ?? ""),
        text_template: String(r.text_template ?? ""),
      };
    }

    setTemplates(next);
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSave() {
    if (!isSuperAdmin) return;
    setSaving(true);
    setSavedMsg(null);
    setError(null);
    try {
      const headers = await apiHeaders();
      const payload: {
        templates: Partial<Record<(typeof KEYS)[number], TemplateState>>;
      } = { templates: {} };
      for (const key of KEYS) {
        const t = templates[key];
        if (!t) continue;
        payload.templates[key] = t;
      }

      const resp = await fetch("/api/admin/email-templates", {
        method: "POST",
        headers: {
          ...(headers as Record<string, string>),
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(payload),
      });
      const json = (await resp.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
        saved?: number;
      };
      if (!resp.ok) throw new Error(json.error ?? "Save failed.");
      setSavedMsg(`Saved templates for ${json.saved ?? "selected"} email types.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          Loading email templates…
        </div>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 className="text-lg font-semibold">Permission required</h1>
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Email templates</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Edit the email subject + HTML/text templates. Placeholders are in the form <span className="font-mono">{`{placeholder}`}</span>.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Back
            </Link>
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save templates"}
            </button>
          </div>
        </div>

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

        <div className="mt-6 space-y-5">
          {KEYS.map((key) => {
            const t = templates[key];
            return (
              <section key={key} className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-800">{labelForKey(key)}</h2>
                    <p className="mt-1 text-xs text-zinc-500">Template key: <span className="font-mono">{key}</span></p>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {t ? "Ready" : "Missing"}{/* */}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-1">
                  <label className="block text-sm">
                    <span className="font-medium text-zinc-700">Subject template</span>
                    <input
                      value={t?.subject_template ?? ""}
                      onChange={(e) =>
                        setTemplates((prev) => ({
                          ...prev,
                          [key]: {
                            ...(prev[key] ?? {
                              subject_template: "",
                              preheader_template: null,
                              html_template: "",
                              text_template: "",
                            }),
                            subject_template: e.target.value,
                          },
                        }))
                      }
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium text-zinc-700">
                      Preheader template (optional)
                    </span>
                    <input
                      value={t?.preheader_template ?? ""}
                      onChange={(e) =>
                        setTemplates((prev) => ({
                          ...prev,
                          [key]: {
                            ...(prev[key] ?? {
                              subject_template: "",
                              preheader_template: null,
                              html_template: "",
                              text_template: "",
                            }),
                            preheader_template: e.target.value || null,
                          },
                        }))
                      }
                      className="mt-1 w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium text-zinc-700">HTML template</span>
                    <textarea
                      value={t?.html_template ?? ""}
                      onChange={(e) =>
                        setTemplates((prev) => ({
                          ...prev,
                          [key]: {
                            ...(prev[key] ?? {
                              subject_template: "",
                              preheader_template: null,
                              html_template: "",
                              text_template: "",
                            }),
                            html_template: e.target.value,
                          },
                        }))
                      }
                      className="mt-1 min-h-[160px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm font-mono"
                    />
                  </label>

                  <label className="block text-sm">
                    <span className="font-medium text-zinc-700">Text template</span>
                    <textarea
                      value={t?.text_template ?? ""}
                      onChange={(e) =>
                        setTemplates((prev) => ({
                          ...prev,
                          [key]: {
                            ...(prev[key] ?? {
                              subject_template: "",
                              preheader_template: null,
                              html_template: "",
                              text_template: "",
                            }),
                            text_template: e.target.value,
                          },
                        }))
                      }
                      className="mt-1 min-h-[120px] w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm font-mono"
                    />
                  </label>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

