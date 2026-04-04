"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";
import { WB_DISTRICTS } from "@/lib/wbLocations";

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
  status?: string;
  hospital_user_id?: string | null;
  expires_at?: string | null;
  hospital_is_verified?: boolean | null;
  escalated_at?: string | null;
};

function isSchemaCacheMissingTableError(message: string) {
  const m = message.toLowerCase();
  return m.includes("schema cache") && m.includes("could not find the table");
}

function toWhatsAppLink(contact: string, message?: string) {
  const digits = contact.replace(/[^0-9]/g, "");
  if (!message?.trim()) return `https://wa.me/${digits}`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function applyTemplate(template: string, vars: Record<string, string>) {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function digitsOnly(s: string) {
  return s.replace(/[^0-9]/g, "");
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

type DistrictRow = {
  district_id: string;
  district_name: string;
};

type BlockRow = {
  block_id: string;
  block_name: string;
};

type PanchayatRow = {
  panchayat_id: string;
  panchayat_name: string;
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

export default function EmergencyPage() {
  const [loading, setLoading] = useState(false);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [items, setItems] = useState<EmergencyRow[]>([]);
  const [waTemplate, setWaTemplate] = useState<string>(
    "Hello, I saw your emergency request for {{blood_group}} blood in {{district}}, {{block}}{{panchayat_line}}. I want to help. Please share more details.",
  );

  const [bloodGroup, setBloodGroup] = useState("");
  const [bloodGroups, setBloodGroups] = useState<BloodGroupRow[]>([]);

  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [panchayats, setPanchayats] = useState<PanchayatRow[]>([]);

  const [districtId, setDistrictId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [panchayatId, setPanchayatId] = useState("");

  useEffect(() => {
    const supabase = getSupabaseOrNull();
    if (!supabase) return;
    void (async () => {
      const { data } = await supabase
        .from("public_site_settings")
        .select("setting_key,setting_value")
        .eq("setting_key", "whatsapp_emergency_template")
        .maybeSingle();
      const row = data as { setting_key?: string; setting_value?: string } | null;
      const v = row?.setting_value ?? "";
      if (v.trim()) setWaTemplate(v);
    })();
  }, []);

  const [districtsLoading, setDistrictsLoading] = useState(true);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [panchayatsLoading, setPanchayatsLoading] = useState(false);

  const [dropdownLoadError, setDropdownLoadError] = useState<string | null>(null);

  const [patientName, setPatientName] = useState("");
  const [requestDetails, setRequestDetails] = useState("");
  const [contactNumber, setContactNumber] = useState("");

  const [notifyInfo, setNotifyInfo] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);

  const selectedDistrict = useMemo(
    () => districts.find((d) => d.district_id === districtId),
    [districts, districtId],
  );
  const selectedBlock = useMemo(
    () => blocks.find((b) => b.block_id === blockId),
    [blocks, blockId],
  );
  const selectedPanchayat = useMemo(
    () => panchayats.find((p) => p.panchayat_id === panchayatId),
    [panchayats, panchayatId],
  );

  async function loadBlocksForDistrict(nextDistrictId: string) {
    if (!nextDistrictId) return;

    setBlocksLoading(true);
    setDropdownLoadError(null);
    setBlocks([]);
    setBlockId("");
    setPanchayats([]);
    setPanchayatId("");

    const district = WB_DISTRICTS.find((d) => d.district === nextDistrictId);
    const staticBlocks: BlockRow[] =
      district?.blocks.map((b) => ({
        block_id: b.block,
        block_name: b.block,
      })) ?? [];

    queueMicrotask(() => {
      setBlocks(staticBlocks);
      setBlocksLoading(false);
    });
  }

  async function loadPanchayatsForBlock(nextBlockId: string) {
    if (!nextBlockId) return;

    setPanchayatsLoading(true);
    setDropdownLoadError(null);
    setPanchayats([]);
    setPanchayatId("");

    const district = WB_DISTRICTS.find((d) => d.district === districtId);
    const block = district?.blocks.find((b) => b.block === nextBlockId);
    const staticPanchayats: PanchayatRow[] =
      block?.areas.map((name) => ({
        panchayat_id: name,
        panchayat_name: name,
      })) ?? [];

    queueMicrotask(() => {
      setPanchayats(staticPanchayats);
      setPanchayatsLoading(false);
    });
  }

  async function loadFeed() {
    setFeedLoading(true);
    setFeedError(null);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setConfigError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
      );
      setFeedLoading(false);
      return;
    }
    const rpc = await supabase.rpc("get_emergency_feed", { limit_rows: 30 });
    const data = rpc.data;
    const error = rpc.error;

    setFeedLoading(false);
    if (error) {
      // When the table exists in SQL but not in the schema cache (or the table
      // hasn't been created in the connected project yet), show a friendly empty state.
      if (isSchemaCacheMissingTableError(error.message)) {
        setItems([]);
        setFeedError(null);
        return;
      }

      setFeedError(error.message);
      return;
    }

    setItems((data as EmergencyRow[]) ?? []);
  }

  useEffect(() => {
    // Dropdowns + blood groups
    const staticDistricts: DistrictRow[] = WB_DISTRICTS.map((d) => ({
      district_id: d.district,
      district_name: d.district,
    }));

    queueMicrotask(() => {
      setDistricts(staticDistricts);
      setDistrictsLoading(false);
    });

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      queueMicrotask(() => setBloodGroups([]));
      return;
    }

    void (async () => {
      const { data: bgData } = await supabase
        .from("blood_groups")
        .select("blood_group, display_name")
        .order("sort_order");

      if (bgData && bgData.length > 0) {
        setBloodGroups(bgData as BloodGroupRow[]);
      }
    })();

    void (async () => {
      await loadFeed();
    })();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setNotifyInfo(null);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setLoading(false);
      alert(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
      );
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id ?? null;

    let isHospital = false;
    let hospitalUserId: string | null = null;
    if (userId) {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", userId)
        .single();
      isHospital = profileRow?.role === "hospital";
      hospitalUserId = isHospital ? userId : null;
    }

    const districtName = selectedDistrict?.district_name ?? "";
    const blockName = selectedBlock?.block_name ?? "";
    const panchayatName = selectedPanchayat?.panchayat_name ?? "";
    const contactDigits = digitsOnly(contactNumber);

    if (!bloodGroup) {
      setLoading(false);
      alert("Please select a Blood Group.");
      return;
    }
    if (!districtName) {
      setLoading(false);
      alert("Please select a District.");
      return;
    }
    if (!blockName) {
      setLoading(false);
      alert("Please select a Block.");
      return;
    }
    if (!panchayatName) {
      setLoading(false);
      alert("Please select a Panchayat.");
      return;
    }

    if (contactDigits.length < 10) {
      setLoading(false);
      alert("Please enter a valid WhatsApp number (10+ digits).");
      return;
    }

    let requestId: string | null = null;
    if (isHospital) {
      const { data, error } = await supabase
        .from("emergency_requests")
        .insert({
          blood_group: bloodGroup,
          district: districtName,
          block: blockName,
          panchayat: panchayatName,
          patient_name: patientName || null,
          request_details: requestDetails,
          contact_number: contactDigits,
          created_by: userId,
          status: "open",
          hospital_user_id: hospitalUserId,
          verified_status: "verified",
          verified_by: userId,
          verified_at: new Date().toISOString(),
        })
        .select("request_id")
        .single();

      if (error) {
        setLoading(false);
        alert(error.message);
        return;
      }

      requestId = data?.request_id ?? null;
    } else {
      const resp = await fetch("/api/emergency/post", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          blood_group: bloodGroup,
          district: districtName,
          block: blockName,
          panchayat: panchayatName,
          patient_name: patientName || null,
          request_details: requestDetails,
          contact_number: contactDigits,
        }),
      });

      type PostEmergencyJson = {
        ok?: boolean;
        request_id?: string;
        error?: string;
      };
      const json = (await resp.json().catch(() => ({}))) as PostEmergencyJson;
      if (!resp.ok || !json.request_id) {
        setLoading(false);
        alert(json.error ?? "Failed to post emergency.");
        return;
      }

      requestId = json.request_id;
    }

    if (!requestId) {
      setLoading(false);
      alert("Emergency posted but request id missing.");
      return;
    }

    // Fire-and-forget: notify matching donors via Edge Function.
    try {
      const resp = await fetch("/api/emergency/notify", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ request_id: requestId }),
      });

      type EdgeFnJson = {
        ok?: boolean;
        notified?: number;
        warning?: string;
        error?: string;
        push_warning?: string;
      };
      const json = (await resp.json().catch(() => ({}))) as EdgeFnJson;
      if (!resp.ok || json.error) {
        setNotifyInfo(
          json.error ??
            "Emergency created, but donor notification failed. Check Edge Function logs.",
        );
      } else if (typeof json.notified === "number") {
        setNotifyInfo(
          json.notified > 0
            ? `Emergency posted. Email notifications sent to ${json.notified} donors.`
            : json.warning ??
                "Emergency posted. No matching donors were notified (no matches or email not configured).",
        );
      } else if (
        typeof json.push_warning === "string" &&
        json.push_warning.toLowerCase().includes("not verified")
      ) {
        setNotifyInfo(
          "Emergency posted and pending verification. Notifications will be sent after an admin/hospital verifies it.",
        );
      }
    } catch {
      setNotifyInfo(
        "Emergency posted, but we could not trigger donor notifications (network error).",
      );
    }

    setLoading(false);
    setBloodGroup("");
    setDistrictId("");
    setBlockId("");
    setPanchayatId("");
    setPatientName("");
    setRequestDetails("");
    setContactNumber("");

    await loadFeed();
  }

  async function callAi(route: "rewrite" | "translate" | "spam-check", body: unknown) {
    const resp = await fetch(`/api/ai/${route}`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = {};
    }
    if (!resp.ok) throw new Error(String(json.error ?? text.slice(0, 200) ?? "AI request failed"));
    return json;
  }

  async function onAiRewrite() {
    setAiBusy(true);
    setAiMsg(null);
    try {
      const res = await callAi("rewrite", { text: requestDetails });
      const t = String(res.text ?? "").trim();
      if (t) setRequestDetails(t);
      setAiMsg("Rewritten.");
    } catch (e: unknown) {
      setAiMsg(e instanceof Error ? e.message : "AI rewrite failed.");
    } finally {
      setAiBusy(false);
    }
  }

  async function onAiTranslate(target: "bn" | "en") {
    setAiBusy(true);
    setAiMsg(null);
    try {
      const res = await callAi("translate", { text: requestDetails, target });
      const t = String(res.text ?? "").trim();
      if (t) setRequestDetails(t);
      setAiMsg(target === "bn" ? "Translated to Bengali." : "Translated to English.");
    } catch (e: unknown) {
      setAiMsg(e instanceof Error ? e.message : "AI translate failed.");
    } finally {
      setAiBusy(false);
    }
  }

  async function onAiSpamCheck() {
    setAiBusy(true);
    setAiMsg(null);
    try {
      const res = await callAi("spam-check", { text: requestDetails });
      const isSpam = Boolean(res.is_spam);
      const score = typeof res.score === "number" ? res.score : Number(res.score ?? 0);
      setAiMsg(isSpam ? `Warning: looks like spam (score ${score.toFixed(2)}).` : "Looks OK (not spam).");
    } catch (e: unknown) {
      setAiMsg(e instanceof Error ? e.message : "AI spam check failed.");
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      {configError ? (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50/70 p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-rose-900">
            Configuration required
          </h1>
          <p className="mt-2 text-sm text-rose-800">{configError}</p>
        </div>
      ) : null}
      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <div className="inline-flex items-center gap-2 rounded-full border border-red-500/15 bg-red-500/5 px-3 py-1.5 text-xs font-semibold text-red-700">
            Emergency
          </div>
          <h1 className="mt-3 text-xl font-semibold">Urgent Blood Request</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Public feed: anyone can post. Donors can view and contact via WhatsApp.
          </p>

          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium">Blood Group</span>
                <select
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20 disabled:opacity-70"
                  value={bloodGroup}
                  onChange={(e) => setBloodGroup(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select blood group
                  </option>
                  {(bloodGroups.length > 0 ? bloodGroups : fallbackBloodGroups).map(
                    (bg) => (
                      <option key={bg.blood_group} value={bg.blood_group}>
                        {bg.display_name}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium">District</span>
                <select
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20 disabled:opacity-70"
                  value={districtId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setDistrictId(next);
                    void loadBlocksForDistrict(next);
                  }}
                  required
                  disabled={Boolean(districtsLoading)}
                  suppressHydrationWarning
                >
                  <option value="" disabled>
                    {districtsLoading ? "Loading districts..." : "Select district"}
                  </option>
                  {districts.map((d) => (
                    <option key={d.district_id} value={d.district_id}>
                      {d.district_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium">Block</span>
                <select
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20 disabled:opacity-70"
                  value={blockId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setBlockId(next);
                    void loadPanchayatsForBlock(next);
                  }}
                  required
                  disabled={Boolean(!districtId || blocksLoading)}
                  suppressHydrationWarning
                >
                  <option value="" disabled>
                    {blocksLoading ? "Loading blocks..." : "Select block"}
                  </option>
                  {blocks.map((b) => (
                    <option key={b.block_id} value={b.block_id}>
                      {b.block_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-medium">Panchayat</span>
                <select
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20 disabled:opacity-70"
                  value={panchayatId}
                  onChange={(e) => setPanchayatId(e.target.value)}
                  required
                  disabled={Boolean(!blockId || panchayatsLoading)}
                  suppressHydrationWarning
                >
                  <option value="" disabled>
                    {panchayatsLoading ? "Loading panchayats..." : "Select panchayat"}
                  </option>
                  {panchayats.map((p) => (
                    <option key={p.panchayat_id} value={p.panchayat_id}>
                      {p.panchayat_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {dropdownLoadError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-sm text-rose-800">
                {dropdownLoadError}
              </div>
            ) : null}

            <label className="block">
              <span className="text-sm font-medium">Patient Name (optional)</span>
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="e.g. Rajesh"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Request Details</span>
              <textarea
                className="mt-1 min-h-28 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
                value={requestDetails}
                onChange={(e) => setRequestDetails(e.target.value)}
                required
              />
            </label>

            <div className="rounded-xl border border-zinc-200 bg-white/60 p-3 text-xs text-zinc-700">
              <div className="font-semibold text-zinc-900">AI help (free on your PC)</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={aiBusy || !requestDetails.trim()}
                  onClick={() => void onAiRewrite()}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 font-semibold hover:bg-zinc-50 disabled:opacity-60"
                >
                  {aiBusy ? "Working..." : "Rewrite clearer"}
                </button>
                <button
                  type="button"
                  disabled={aiBusy || !requestDetails.trim()}
                  onClick={() => void onAiTranslate("bn")}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 font-semibold hover:bg-zinc-50 disabled:opacity-60"
                >
                  Translate to Bengali
                </button>
                <button
                  type="button"
                  disabled={aiBusy || !requestDetails.trim()}
                  onClick={() => void onAiTranslate("en")}
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-2 font-semibold hover:bg-zinc-50 disabled:opacity-60"
                >
                  Translate to English
                </button>
                <button
                  type="button"
                  disabled={aiBusy || !requestDetails.trim()}
                  onClick={() => void onAiSpamCheck()}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                >
                  Check spam
                </button>
              </div>
              {aiMsg ? <div className="mt-2">{aiMsg}</div> : null}
              <div className="mt-2 text-[11px] text-zinc-500">
                Requires `AI_SERVICE_URL` configured on server (for production use VPS or PC server).
              </div>
            </div>

            <label className="block">
              <span className="text-sm font-medium">
                Contact Number (for WhatsApp)
              </span>
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
                value={contactNumber}
                onChange={(e) => setContactNumber(e.target.value)}
                placeholder="10-digit mobile number"
                required
              />
            </label>

            <button
              disabled={Boolean(loading)}
              suppressHydrationWarning
              className="w-full rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
              type="submit"
            >
              {loading ? "Posting..." : "Post Emergency Request"}
            </button>
          </form>
          {notifyInfo ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-900">
              {notifyInfo}
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span
                className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-rose-500 text-white shadow-sm shadow-rose-500/25 ring-1 ring-white/20 animate-pulse"
                aria-hidden="true"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </span>
              <h2 className="text-lg font-semibold">Emergency Feed</h2>
            </div>
            <button
              type="button"
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
              onClick={loadFeed}
              disabled={Boolean(feedLoading)}
              suppressHydrationWarning
            >
              Refresh
            </button>
          </div>

          {feedError ? (
            <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">
              {feedError}
            </div>
          ) : null}

          {feedLoading ? <div className="mt-4 text-sm">Loading...</div> : null}

          <div className="mt-4 space-y-2.5">
            {items.map((it) => (
              <div
                key={it.request_id}
                className="rounded-2xl border border-zinc-200 bg-white/80 p-4 shadow-sm"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-semibold">
                      {it.blood_group} blood in {it.district}
                    </div>
                    <div className="mt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeTone(it.status)}`}
                        >
                          {formatStatusLabel(it.status)}
                        </span>
                        {it.hospital_user_id ? (
                          it.hospital_is_verified ? (
                            <span className="rounded-full border border-emerald-200 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                              Verified hospital
                            </span>
                          ) : (
                            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                              Hospital
                            </span>
                          )
                        ) : (
                          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                            Public
                          </span>
                        )}
                        {it.escalated_at ? (
                          <span
                            className="rounded-full border border-violet-300 bg-violet-500/10 px-2 py-0.5 text-xs font-semibold text-violet-900"
                            title="This request exceeded admin SLA; coordinators were notified."
                          >
                            SLA escalated
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-sm text-zinc-700">
                      {it.block} / {it.panchayat}
                    </div>
                    <div className="text-sm text-zinc-600">
                      {it.patient_name ? `Patient: ${it.patient_name}` : null}
                    </div>
                    <div className="mt-2 text-sm">{it.request_details}</div>
                  </div>
                  <a
                    className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 sm:w-auto"
                    href={toWhatsAppLink(
                      it.contact_number,
                      applyTemplate(waTemplate, {
                        donor_name: "Donor",
                        requester: "A donor",
                        blood_group: it.blood_group ?? "",
                        district: it.district ?? "",
                        block: it.block ?? "",
                        panchayat_line: it.panchayat ? `, ${it.panchayat}` : "",
                        village_line: "",
                      }),
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    WhatsApp
                  </a>
                </div>
              </div>
            ))}

            {!feedLoading && items.length === 0 ? (
              <div className="text-sm text-zinc-600">No emergency requests yet.</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

