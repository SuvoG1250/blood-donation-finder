"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ensureSupabase, getSupabaseOrNull } from "@/lib/supabaseClient";
import WbAddressFields, { emptyWbAddress, type WbAddressValue } from "@/components/WbAddressFields";
import { normalizeWbAddress } from "@/lib/wbAddress";
import {
  DONOR_SEARCH_SCOPES,
  describeSearchScope,
  type DonorSearchScope,
} from "@/lib/donorSearchScope";
import {
  buildDonorSearchQueryParams,
  parseDonorSearchParams,
  searchDonorsByAddress,
  type DonorSearchRow,
} from "@/lib/searchDonors";

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

type DonorRow = DonorSearchRow;

type RatingSummaryRow = {
  donor_user_id: string;
  rating_count: number;
  rating_avg: number;
};

type BloodGroupRow = {
  blood_group: string;
  display_name: string;
};

type SavedSearchPreset = {
  id: string;
  label: string;
  bg: string;
  searchScope?: DonorSearchScope;
  pincode: string;
  district: string;
  block: string;
  panchayat: string;
  village: string;
  preferredDay: string;
  preferredTimeSlot: string;
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

export default function SearchPage() {
  const [configError, setConfigError] = useState<string | null>(null);
  const [configChecking, setConfigChecking] = useState(true);
  const [supabaseReady, setSupabaseReady] = useState(false);
  const lastAutoSearchKey = useRef("");

  const [bloodGroup, setBloodGroup] = useState("");
  const [bloodGroups, setBloodGroups] = useState<BloodGroupRow[]>([]);

  const [address, setAddress] = useState<WbAddressValue>(emptyWbAddress);
  const [searchScope, setSearchScope] = useState<DonorSearchScope>("block");
  const [addressError, setAddressError] = useState<string | null>(null);

  const [preferredDay, setPreferredDay] = useState("");
  const [preferredTimeSlot, setPreferredTimeSlot] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DonorRow[]>([]);
  const [photoSignedUrls, setPhotoSignedUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [savedPresets, setSavedPresets] = useState<SavedSearchPreset[]>([]);
  const [ratingMap, setRatingMap] = useState<Record<string, RatingSummaryRow>>({});
  const [requesterLabel, setRequesterLabel] = useState<string>("A blood seeker");
  const [waMode, setWaMode] = useState<"emergency" | "query" | "availability">(
    "emergency",
  );
  const [waTemplates, setWaTemplates] = useState<{
    emergency: string;
    query: string;
    availability: string;
  }>({
    emergency:
      "Hello {{donor_name}}, I am {{requester}}. I need {{blood_group}} blood donor support in {{district}}, {{block}}{{panchayat_line}}{{village_line}}.",
    query:
      "Hello {{donor_name}}, I am {{requester}}. Are you available to donate {{blood_group}} blood? Location: {{district}}, {{block}}{{panchayat_line}}{{village_line}}.",
    availability:
      "Hello {{donor_name}}, I am {{requester}}. Please tell me when you can donate (day/time). Needed: {{blood_group}}. Location: {{district}}, {{block}}{{panchayat_line}}{{village_line}}.",
  });

  const runDonorSearch = useCallback(
    async (opts?: {
      addressOverride?: WbAddressValue;
      bloodGroupOverride?: string;
      searchScopeOverride?: DonorSearchScope;
    }) => {
      const bg = (opts?.bloodGroupOverride ?? bloodGroup).trim();
      const loc = normalizeWbAddress(opts?.addressOverride ?? address);
      const scope = opts?.searchScopeOverride ?? searchScope;

      if (!bg) {
        setError("Please select a blood group first.");
        return;
      }
      if (!loc.district.trim()) {
        return;
      }
      if (scope !== "pincode" && !loc.block.trim()) {
        return;
      }

      setError(null);
      setAddressError(null);
      setLoading(true);
      setResults([]);

      const supabase = (await ensureSupabase()) ?? getSupabaseOrNull();
      if (!supabase) {
        setLoading(false);
        setConfigError(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart npm run dev.",
        );
        return;
      }

      syncQueryInAddressBar(scope, loc, bg);

      const { donors, error: searchError } = await searchDonorsByAddress(supabase, {
        bloodGroup: bg,
        address: loc,
        searchScope: scope,
        preferredDay,
        preferredTimeSlot,
      });

      setLoading(false);
      if (searchError) {
        setError(searchError);
        return;
      }
      setResults(donors);
    },
    [address, bloodGroup, preferredDay, preferredTimeSlot, searchScope],
  );

  useEffect(() => {
    void (async () => {
      setConfigChecking(true);
      const supabase = await ensureSupabase();
      setConfigChecking(false);
      if (!supabase) {
        setConfigError(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, then restart npm run dev.",
        );
        setSupabaseReady(false);
        return;
      }
      setConfigError(null);
      setSupabaseReady(true);

      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData.session?.user?.email ?? "";
      if (email) setRequesterLabel(email);

      const { data: bgData } = await supabase
        .from("blood_groups")
        .select("blood_group, display_name")
        .order("sort_order");
      if (bgData && bgData.length > 0) {
        setBloodGroups(bgData as BloodGroupRow[]);
      }

      const { data: settingsData } = await supabase
        .from("public_site_settings")
        .select("setting_key,setting_value")
        .in("setting_key", [
          "whatsapp_emergency_template",
          "whatsapp_query_template",
          "whatsapp_availability_template",
        ]);
      const map = new Map<string, string>();
      for (const row of (settingsData ?? []) as Array<{
        setting_key: string;
        setting_value: string;
      }>) {
        map.set(row.setting_key, row.setting_value);
      }
      setWaTemplates((prev) => ({
        emergency: map.get("whatsapp_emergency_template") ?? prev.emergency,
        query: map.get("whatsapp_query_template") ?? prev.query,
        availability: map.get("whatsapp_availability_template") ?? prev.availability,
      }));
    })();
  }, []);

  const handleLocationResolved = useCallback(
    (loc: WbAddressValue) => {
      const normalized = normalizeWbAddress(loc);
      if (normalized.village.trim() && searchScope === "block") {
        setSearchScope("village");
      }
      setAddress(normalized);
      if (!bloodGroup.trim()) {
        setError("Location set. Select a blood group, then search.");
        return;
      }
      const scopeForSearch =
        normalized.village.trim() && searchScope === "block" ? "village" : searchScope;
      const key = `${bloodGroup}|${scopeForSearch}|${normalized.pincode}|${normalized.district}|${normalized.block}|${normalized.village}`;
      if (key === lastAutoSearchKey.current) return;
      lastAutoSearchKey.current = key;
      void runDonorSearch({
        addressOverride: normalized,
        bloodGroupOverride: bloodGroup,
        searchScopeOverride: scopeForSearch,
      });
    },
    [bloodGroup, runDonorSearch, searchScope],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("saved-search-presets-v1");
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedSearchPreset[];
      if (Array.isArray(parsed)) {
        queueMicrotask(() => setSavedPresets(parsed));
      }
    } catch {
      // ignore malformed local storage data
    }
  }, []);

  useEffect(() => {
    const parsed = parseDonorSearchParams(window.location.search);
    queueMicrotask(() => {
      if (parsed.bloodGroup) setBloodGroup(parsed.bloodGroup);
      setAddress(parsed.address);
      setSearchScope(parsed.searchScope);
      if (parsed.preferredDay) setPreferredDay(parsed.preferredDay);
      if (parsed.preferredTimeSlot) setPreferredTimeSlot(parsed.preferredTimeSlot);
    });
  }, []);

  function buildSearchUrl() {
    const params = buildDonorSearchQueryParams({
      bloodGroup,
      address,
      searchScope,
      preferredDay,
      preferredTimeSlot,
    });
    return `${window.location.origin}/search${params.toString() ? `?${params.toString()}` : ""}`;
  }

  function syncQueryInAddressBar(
    scope: DonorSearchScope,
    loc: WbAddressValue,
    bg: string,
  ) {
    const params = buildDonorSearchQueryParams({
      bloodGroup: bg,
      address: loc,
      searchScope: scope,
      preferredDay,
      preferredTimeSlot,
    });
    const path = `/search${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState(null, "", path);
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    lastAutoSearchKey.current = "";
    await runDonorSearch();
  }

  useEffect(() => {
    if (results.length === 0) return;
    const supabase = getSupabaseOrNull();
    if (!supabase) return;

    void (async () => {
      const missing = results.filter(
        (d) => d.photo_object_path && !photoSignedUrls[d.user_id],
      );
      if (missing.length === 0) return;

      const updates: Record<string, string> = {};
      for (const d of missing) {
        const path = d.photo_object_path;
        if (!path) continue;
        const { data, error: signedErr } = await supabase.storage
          .from("donor-photos")
          .createSignedUrl(path, 60 * 60);
        if (!signedErr && data?.signedUrl) {
          updates[d.user_id] = data.signedUrl;
        }
      }

      if (Object.keys(updates).length > 0) {
        setPhotoSignedUrls((prev) => ({ ...prev, ...updates }));
      }
    })();
  }, [results, photoSignedUrls]);

  useEffect(() => {
    if (results.length === 0) {
      queueMicrotask(() => setRatingMap({}));
      return;
    }
    const supabase = getSupabaseOrNull();
    if (!supabase) return;
    void (async () => {
      const ids = Array.from(new Set(results.map((r) => r.user_id)));
      const { data, error: rpcErr } = await supabase.rpc("get_donor_rating_summaries", {
        p_donor_user_ids: ids,
      });
      if (rpcErr) return;
      const map: Record<string, RatingSummaryRow> = {};
      for (const row of (data as RatingSummaryRow[]) ?? []) {
        map[row.donor_user_id] = row;
      }
      setRatingMap(map);
    })();
  }, [results]);

  async function onGiveReview(donor: DonorRow) {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user ?? null;
    if (!user) {
      setError("Please sign in first to submit rating.");
      return;
    }
    if (user.id === donor.user_id) {
      setError("You cannot rate yourself.");
      return;
    }

    const rawStars = window.prompt(`Rate ${donor.name} (1-5):`, "5");
    if (rawStars === null) return;
    const stars = Number(rawStars.trim());
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
      setError("Rating must be between 1 and 5.");
      return;
    }
    const comment = window.prompt("Optional review comment:", "") ?? "";

    const { error: upErr } = await supabase.from("donor_ratings").upsert(
      {
        donor_user_id: donor.user_id,
        rater_user_id: user.id,
        stars,
        comment: comment.trim() ? comment.trim() : null,
      },
      { onConflict: "donor_user_id,rater_user_id" },
    );
    if (upErr) {
      setError(upErr.message);
      return;
    }

    const { data: summaryRows } = await supabase.rpc("get_donor_rating_summaries", {
      p_donor_user_ids: [donor.user_id],
    });
    const summary = ((summaryRows as RatingSummaryRow[] | null) ?? [])[0];
    if (summary) {
      setRatingMap((prev) => ({ ...prev, [donor.user_id]: summary }));
    }
  }

  async function onCopyShareLink() {
    try {
      const url = buildSearchUrl();
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Unable to copy link. Please copy URL manually from browser.");
    }
  }

  function onSavePreset() {
    const label = presetName.trim();
    if (!label) return;
    const next: SavedSearchPreset[] = [
      {
        id: crypto.randomUUID(),
        label,
        bg: bloodGroup,
        searchScope,
        pincode: address.pincode,
        district: address.district,
        block: address.block,
        panchayat: address.panchayat,
        village: address.village,
        preferredDay,
        preferredTimeSlot,
      },
      ...savedPresets,
    ].slice(0, 10);
    setSavedPresets(next);
    setPresetName("");
    window.localStorage.setItem("saved-search-presets-v1", JSON.stringify(next));
  }

  function onLoadPreset(p: SavedSearchPreset) {
    setBloodGroup(p.bg);
    setSearchScope(p.searchScope ?? "block");
    setAddress({
      pincode: p.pincode ?? "",
      district: p.district,
      block: p.block,
      panchayat: p.panchayat,
      village: p.village,
    });
    setPreferredDay(p.preferredDay);
    setPreferredTimeSlot(p.preferredTimeSlot);
  }

  function onDeletePreset(id: string) {
    const next = savedPresets.filter((x) => x.id !== id);
    setSavedPresets(next);
    window.localStorage.setItem("saved-search-presets-v1", JSON.stringify(next));
  }

  if (configChecking) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm">
          <p className="text-sm text-zinc-600">Connecting to database…</p>
        </div>
      </div>
    );
  }

  if (configError && !supabaseReady) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-rose-900">
            Configuration required
          </h1>
          <p className="mt-2 text-sm text-rose-800">{configError}</p>
          <button
            type="button"
            className="mt-4 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
            onClick={() => {
              setConfigChecking(true);
              setConfigError(null);
              void (async () => {
                const s = await ensureSupabase();
                setConfigChecking(false);
                if (s) {
                  setSupabaseReady(true);
                  setConfigError(null);
                } else {
                  setConfigError(
                    "Still not configured. Check .env.local and restart: npm run dev",
                  );
                }
              })();
            }}
          >
            Retry connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <h1 className="text-xl font-semibold">Find Eligible Donors</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Enter a West Bengal PIN or village, choose how wide to search (PIN area, village,
          or whole block), then pick a blood group. Only admin-verified, 90-day eligible
          donors are shown.
        </p>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-white/60 p-4 text-sm text-zinc-700">
          Want to become a donor?{" "}
          <Link
            className="font-semibold underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
            href="/donor/onboarding"
          >
            Register here
          </Link>
          .
        </div>

        <form className="mt-6 space-y-4" onSubmit={onSearch}>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="block sm:col-span-2">
              <legend className="text-sm font-medium">Search area</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {DONOR_SEARCH_SCOPES.map((opt) => (
                  <label
                    key={opt.id}
                    className={`flex cursor-pointer flex-col rounded-xl border px-3 py-2.5 text-sm transition ${
                      searchScope === opt.id
                        ? "border-rose-400 bg-rose-50/80 ring-2 ring-rose-500/20"
                        : "border-zinc-200 bg-white/80 hover:border-zinc-300"
                    }`}
                  >
                    <span className="flex items-center gap-2 font-semibold text-zinc-900">
                      <input
                        type="radio"
                        name="searchScope"
                        value={opt.id}
                        checked={searchScope === opt.id}
                        onChange={() => {
                          setSearchScope(opt.id);
                          lastAutoSearchKey.current = "";
                        }}
                        className="accent-rose-600"
                      />
                      {opt.label}
                    </span>
                    <span className="mt-1 text-xs leading-snug text-zinc-600">
                      {opt.description}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block">
              <span className="text-sm font-medium">Blood Group</span>
              <select
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20 disabled:opacity-70"
                value={bloodGroup}
                onChange={(e) => {
                  const next = e.target.value;
                  setBloodGroup(next);
                  const loc = normalizeWbAddress(address);
                  const canSearch =
                    next.trim() &&
                    loc.district.trim() &&
                    (searchScope === "pincode" ||
                      loc.block.trim());
                  if (canSearch) {
                    lastAutoSearchKey.current = "";
                    void runDonorSearch({
                      bloodGroupOverride: next,
                      addressOverride: loc,
                    });
                  }
                }}
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
            <WbAddressFields
              value={address}
              onChange={(next) => setAddress(normalizeWbAddress(next))}
              onLocationResolved={handleLocationResolved}
              onError={setAddressError}
              panchayatMode="optional"
              showVillage={searchScope !== "pincode"}
            />

            <label className="block">
              <span className="text-sm font-medium">Preferred Day (optional)</span>
              <select
                value={preferredDay}
                onChange={(e) => setPreferredDay(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20 disabled:opacity-70"
              >
                <option value="">Any day</option>
                <option value="Mon">Mon</option>
                <option value="Tue">Tue</option>
                <option value="Wed">Wed</option>
                <option value="Thu">Thu</option>
                <option value="Fri">Fri</option>
                <option value="Sat">Sat</option>
                <option value="Sun">Sun</option>
              </select>
            </label>

            <label className="block sm:col-span-1">
              <span className="text-sm font-medium">Preferred Time (optional)</span>
              <select
                value={preferredTimeSlot}
                onChange={(e) => setPreferredTimeSlot(e.target.value)}
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20 disabled:opacity-70"
              >
                <option value="">Any time</option>
                <option value="Morning">Morning</option>
                <option value="Afternoon">Afternoon</option>
                <option value="Evening">Evening</option>
              </select>
            </label>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white/70 p-3">
            <div className="text-xs font-semibold text-zinc-600">WhatsApp message type</div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <select
                value={waMode}
                onChange={(e) =>
                  setWaMode(e.target.value as "emergency" | "query" | "availability")
                }
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm sm:max-w-xs"
              >
                <option value="emergency">Emergency</option>
                <option value="query">Query</option>
                <option value="availability">Ask availability</option>
              </select>
              <div className="text-xs text-zinc-500">
                Admin can edit templates in{" "}
                <Link href="/admin/settings" className="font-semibold underline">
                  Site settings
                </Link>
                .
              </div>
            </div>
          </div>

          <button
            disabled={loading}
            type="submit"
            className="w-full rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
          >
            {loading ? "Searching..." : "Search"}
          </button>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void onCopyShareLink()}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              {copied ? "Copied link" : "Copy Search Link"}
            </button>
            <div className="flex gap-2">
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Preset name"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={onSavePreset}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
              >
                Save
              </button>
            </div>
          </div>
        </form>

        {savedPresets.length > 0 ? (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-white/70 p-3">
            <div className="text-xs font-semibold text-zinc-600">Saved searches</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {savedPresets.map((p) => (
                <div
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1"
                >
                  <button
                    type="button"
                    onClick={() => onLoadPreset(p)}
                    className="text-xs font-semibold text-zinc-800"
                  >
                    {p.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeletePreset(p.id)}
                    className="rounded-full px-1 text-xs text-rose-700 hover:bg-rose-50"
                    aria-label={`Delete preset ${p.label}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {addressError ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-700">
            {addressError}
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-5 space-y-2.5">
          {results.length === 0 && !loading ? (
            <div className="text-sm text-zinc-600">
              {address.district.trim()
                ? `No eligible donors found for ${describeSearchScope(searchScope, address)} (${DONOR_SEARCH_SCOPES.find((s) => s.id === searchScope)?.label ?? "search"}).`
                : "No eligible donors found. Enter a PIN and select a blood group."}
            </div>
          ) : null}

          {results.map((d) => (
            <div
              key={d.user_id}
              className="rounded-2xl border border-zinc-200 bg-white/80 p-4 shadow-sm"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  {photoSignedUrls[d.user_id] ? (
                    <Image
                      src={photoSignedUrls[d.user_id]}
                      alt={`${d.name} profile`}
                      width={56}
                      height={56}
                      unoptimized
                      className="h-14 w-14 rounded-full border border-zinc-200 object-cover"
                    />
                  ) : (
                    <div className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-base font-semibold text-zinc-600">
                      {(d.name?.trim()?.[0] ?? "D").toUpperCase()}
                    </div>
                  )}
                  <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{d.name}</span>
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-semibold text-red-700">
                      {d.blood_group}
                    </span>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      Eligible
                    </span>
                    {d.trusted_donor ? (
                      <span className="rounded-full bg-emerald-600/10 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                        Trusted donor
                      </span>
                    ) : null}
                    {preferredDay || preferredTimeSlot ? (
                      <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-semibold text-sky-800">
                        {(() => {
                          const days = (d.preferred_days ?? []) as string[];
                          const slots = (d.preferred_time_slots ?? []) as string[];
                          const hasPrefs = days.length > 0 || slots.length > 0;
                          const explicitDay =
                            preferredDay && days.includes(preferredDay);
                          const explicitTime =
                            preferredTimeSlot &&
                            slots.includes(preferredTimeSlot);
                          if (!hasPrefs) return "No preference set";
                          if (explicitDay || explicitTime) return "Availability matches";
                          return "May not match your schedule";
                        })()}
                      </span>
                    ) : null}
                    {ratingMap[d.user_id] ? (
                      <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-semibold text-indigo-800">
                        Rating {ratingMap[d.user_id].rating_avg.toFixed(1)}/5 ({ratingMap[d.user_id].rating_count})
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-500/10 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                        No rating yet
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-zinc-700">
                    {d.district} / {d.block} / {d.panchayat}
                  </div>
                  {d.village ? (
                    <div className="text-xs text-zinc-500">Village: {d.village}</div>
                  ) : null}
                  <div className="text-xs text-zinc-500">
                    Last donation: {d.last_donation_date}
                  </div>
                  </div>
                </div>

                <a
                  className="w-full inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 sm:w-auto"
                  href={toWhatsAppLink(
                    d.contact_number,
                    applyTemplate(
                      waMode === "availability"
                        ? waTemplates.availability
                        : waMode === "query"
                          ? waTemplates.query
                          : waTemplates.emergency,
                      {
                        donor_name: d.name ?? "Donor",
                        requester: requesterLabel || "A blood seeker",
                        blood_group: d.blood_group ?? "",
                        district: address.district.trim() || d.district || "",
                        block: address.block.trim() || d.block || "",
                        panchayat_line: address.panchayat.trim()
                          ? `, ${address.panchayat.trim()}`
                          : d.panchayat
                            ? `, ${d.panchayat}`
                            : "",
                        village_line: d.village ? `, ${d.village}` : "",
                      },
                    ),
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  Contact via WhatsApp
                </a>
                <button
                  type="button"
                  onClick={() => void onGiveReview(d)}
                  className="w-full mt-2 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 sm:mt-0 sm:w-auto"
                >
                  Give review & rating
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

