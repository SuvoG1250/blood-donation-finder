"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getSupabaseOrNull } from "@/lib/supabaseClient";
import { WB_DISTRICTS } from "@/lib/wbLocations";

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

type DonorRow = {
  user_id: string;
  name: string;
  photo_object_path: string | null;
  blood_group: string;
  district: string;
  block: string;
  panchayat: string;
  village?: string | null;
  last_donation_date: string;
  contact_number: string;
  preferred_days?: string[] | null;
  preferred_time_slots?: string[] | null;
  trusted_donor?: boolean | null;
};

type RatingSummaryRow = {
  donor_user_id: string;
  rating_count: number;
  rating_avg: number;
};

function normalizeAreaText(value: string) {
  const romanToNumber: Record<string, string> = {
    i: "1",
    ii: "2",
    iii: "3",
    iv: "4",
    v: "5",
    vi: "6",
    vii: "7",
    viii: "8",
    ix: "9",
    x: "10",
  };

  const alias: Record<string, string> = {
    hooghly: "hugli",
  };

  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((token) => alias[token] ?? token)
    .map((token) => romanToNumber[token] ?? token)
    .join("");
}

function areaMatches(actual: string, selected: string) {
  const a = normalizeAreaText(actual);
  const s = normalizeAreaText(selected);
  if (!s) return true;
  if (!a) return false;
  return a === s || a.includes(s) || s.includes(a);
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

type SavedSearchPreset = {
  id: string;
  label: string;
  bg: string;
  districtId: string;
  blockId: string;
  panchayatId: string;
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

  const [bloodGroup, setBloodGroup] = useState("");
  const [bloodGroups, setBloodGroups] = useState<BloodGroupRow[]>([]);

  const [districts, setDistricts] = useState<DistrictRow[]>([]);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [panchayats, setPanchayats] = useState<PanchayatRow[]>([]);

  const [districtId, setDistrictId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [panchayatId, setPanchayatId] = useState("");

  const [districtsLoading, setDistrictsLoading] = useState(true);
  const [blocksLoading, setBlocksLoading] = useState(false);
  const [panchayatsLoading, setPanchayatsLoading] = useState(false);

  const [dropdownLoadError, setDropdownLoadError] = useState<string | null>(
    null,
  );

  const [village, setVillage] = useState("");
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

  // No sign-in required for searching donors.
  useEffect(() => {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      queueMicrotask(() =>
        setConfigError(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
        ),
      );
    }
  }, []);

  useEffect(() => {
    const supabase = getSupabaseOrNull();
    if (!supabase) return;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data.session?.user?.email ?? "";
      if (email) setRequesterLabel(email);
    })();
  }, []);

  useEffect(() => {
    const supabase = getSupabaseOrNull();
    if (!supabase) return;
    void (async () => {
      const { data } = await supabase
        .from("public_site_settings")
        .select("setting_key,setting_value")
        .in("setting_key", [
          "whatsapp_emergency_template",
          "whatsapp_query_template",
          "whatsapp_availability_template",
        ]);
      const map = new Map<string, string>();
      for (const row of (data ?? []) as Array<{ setting_key: string; setting_value: string }>) {
        map.set(row.setting_key, row.setting_value);
      }
      setWaTemplates((prev) => ({
        emergency: map.get("whatsapp_emergency_template") ?? prev.emergency,
        query: map.get("whatsapp_query_template") ?? prev.query,
        availability: map.get("whatsapp_availability_template") ?? prev.availability,
      }));
    })();
  }, []);

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
    const params = new URLSearchParams(window.location.search);
    const bg = params.get("bg") ?? "";
    const d = params.get("d") ?? "";
    const b = params.get("b") ?? "";
    const p = params.get("p") ?? "";
    const v = params.get("v") ?? "";
    const day = params.get("day") ?? "";
    const time = params.get("time") ?? "";
    queueMicrotask(() => {
      if (bg) setBloodGroup(bg);
      if (v) setVillage(v);
      if (day) setPreferredDay(day);
      if (time) setPreferredTimeSlot(time);

      if (!d) return;

      setDistrictId(d);
      const district = WB_DISTRICTS.find((x) => x.district === d);
      const staticBlocks: BlockRow[] =
        district?.blocks.map((x) => ({
          block_id: x.block,
          block_name: x.block,
        })) ?? [];
      setBlocks(staticBlocks);
      if (!b) return;

      setBlockId(b);
      const block = district?.blocks.find((x) => x.block === b);
      const staticPanchayats: PanchayatRow[] =
        block?.areas.map((name) => ({
          panchayat_id: name,
          panchayat_name: name,
        })) ?? [];
      setPanchayats(staticPanchayats);
      if (p) setPanchayatId(p);
    });
  }, []);

  function buildSearchUrl() {
    const params = new URLSearchParams();
    if (bloodGroup) params.set("bg", bloodGroup);
    if (districtId) params.set("d", districtId);
    if (blockId) params.set("b", blockId);
    if (panchayatId) params.set("p", panchayatId);
    if (village.trim()) params.set("v", village.trim());
    if (preferredDay) params.set("day", preferredDay);
    if (preferredTimeSlot) params.set("time", preferredTimeSlot);
    return `${window.location.origin}/search${params.toString() ? `?${params.toString()}` : ""}`;
  }

  function syncQueryInAddressBar() {
    const params = new URLSearchParams();
    if (bloodGroup) params.set("bg", bloodGroup);
    if (districtId) params.set("d", districtId);
    if (blockId) params.set("b", blockId);
    if (panchayatId) params.set("p", panchayatId);
    if (village.trim()) params.set("v", village.trim());
    if (preferredDay) params.set("day", preferredDay);
    if (preferredTimeSlot) params.set("time", preferredTimeSlot);
    const path = `/search${params.toString() ? `?${params.toString()}` : ""}`;
    window.history.replaceState(null, "", path);
  }

  const selectedDistrict = districts.find((d) => d.district_id === districtId);
  const selectedBlock = blocks.find((b) => b.block_id === blockId);
  const selectedPanchayat = panchayats.find(
    (p) => p.panchayat_id === panchayatId,
  );

  useEffect(() => {
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
  }, []);

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

    setBlocks(staticBlocks);
    setBlocksLoading(false);
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

    setPanchayats(staticPanchayats);
    setPanchayatsLoading(false);
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResults([]);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setLoading(false);
      setError(
        "Supabase is not configured. Please set .env.local and restart the app."
      );
      return;
    }

    if (!bloodGroup) {
      setLoading(false);
      setError("Please select a Blood Group.");
      return;
    }
    if (!selectedDistrict?.district_name) {
      setLoading(false);
      setError("Please select a District.");
      return;
    }
    if (!selectedBlock?.block_name) {
      setLoading(false);
      setError("Please select a Block.");
      return;
    }
    syncQueryInAddressBar();
    let data: DonorRow[] | null = null;
    let rpcErr: { message: string } | null = null;
    const eligibilityCutoff = new Date();
    eligibilityCutoff.setDate(eligibilityCutoff.getDate() - 90);
    const eligibilityCutoffIso = eligibilityCutoff.toISOString().slice(0, 10);

    if (selectedPanchayat?.panchayat_name) {
      const rpcRes = await supabase.rpc("search_donors", {
        p_blood_group: bloodGroup,
        p_district: selectedDistrict?.district_name ?? "",
        p_block: selectedBlock?.block_name ?? "",
        p_panchayat: selectedPanchayat.panchayat_name,
      });
      data = (rpcRes.data as DonorRow[]) ?? null;
      rpcErr = rpcRes.error ? { message: rpcRes.error.message } : null;
    } else {
      const queryRes = await supabase
        .from("donors")
        .select(
          "user_id,name,photo_object_path,blood_group,district,block,panchayat,village,last_donation_date,contact_number,preferred_days,preferred_time_slots",
        )
        .eq("id_card_verified", true)
        .lte("last_donation_date", eligibilityCutoffIso)
        .ilike("blood_group", bloodGroup)
        .order("reviewed_at", { ascending: false })
        .limit(1000);
      data = (queryRes.data as DonorRow[]) ?? null;
      rpcErr = queryRes.error ? { message: queryRes.error.message } : null;
    }

    setLoading(false);
    if (rpcErr) {
      setError(rpcErr.message);
      return;
    }

    const rows = (data as DonorRow[]) ?? [];
    const isAllPanchayats = !selectedPanchayat?.panchayat_name;

    const qVillage = village.trim().toLowerCase();
    const strictFiltered = rows.filter((r) => {
      const bgMatch =
        normalizeAreaText(r.blood_group) === normalizeAreaText(bloodGroup);
      const districtMatch = areaMatches(
        r.district,
        selectedDistrict?.district_name ?? "",
      );
      const blockMatch = areaMatches(r.block, selectedBlock?.block_name ?? "");
      const panchayatMatch =
        !selectedPanchayat?.panchayat_name ||
        areaMatches(r.panchayat, selectedPanchayat.panchayat_name);

      // Explicit requirement:
      // "All panchayats" => show all donors from selected block
      // (for selected blood group; panchayat filter must be ignored).
      if (isAllPanchayats) {
        return bgMatch && blockMatch;
      }

      return bgMatch && districtMatch && blockMatch && panchayatMatch;
    });

    const filtered = qVillage
      ? strictFiltered.filter((r) =>
          (r.village ?? "").toLowerCase().includes(qVillage),
        )
      : strictFiltered;

    // Optional availability filtering (client-side).
    // If a donor has no preferences, we treat them as "no preference" and include them.
    const withMatchScore = filtered.map((r) => {
      const days = (r.preferred_days ?? []) as string[];
      const slots = (r.preferred_time_slots ?? []) as string[];

      const dayMatches =
        !preferredDay || days.length === 0 || days.includes(preferredDay);
      const timeMatches =
        !preferredTimeSlot ||
        slots.length === 0 ||
        slots.includes(preferredTimeSlot);

      const explicitDayMatch = preferredDay && days.includes(preferredDay);
      const explicitTimeMatch =
        preferredTimeSlot && slots.includes(preferredTimeSlot);

      const score =
        (explicitDayMatch ? 1 : 0) +
        (explicitTimeMatch ? 1 : 0);

      const passes = dayMatches && timeMatches;
      return { row: r, score, passes, days, slots };
    });

    const passing = withMatchScore.filter((x) => x.passes);
    passing.sort((a, b) => b.score - a.score);

    setResults(passing.map((x) => x.row));
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
        districtId,
        blockId,
        panchayatId,
        village,
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
    setDistrictId(p.districtId);
    setBlockId(p.blockId);
    setPanchayatId(p.panchayatId);
    setVillage(p.village);
    setPreferredDay(p.preferredDay);
    setPreferredTimeSlot(p.preferredTimeSlot);

    const district = WB_DISTRICTS.find((x) => x.district === p.districtId);
    const staticBlocks: BlockRow[] =
      district?.blocks.map((x) => ({ block_id: x.block, block_name: x.block })) ??
      [];
    setBlocks(staticBlocks);
    const block = district?.blocks.find((x) => x.block === p.blockId);
    const staticPanchayats: PanchayatRow[] =
      block?.areas.map((name) => ({ panchayat_id: name, panchayat_name: name })) ??
      [];
    setPanchayats(staticPanchayats);
  }

  function onDeletePreset(id: string) {
    const next = savedPresets.filter((x) => x.id !== id);
    setSavedPresets(next);
    window.localStorage.setItem("saved-search-presets-v1", JSON.stringify(next));
  }

  if (configError) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-rose-900">
            Configuration required
          </h1>
          <p className="mt-2 text-sm text-rose-800">{configError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <h1 className="text-xl font-semibold">Find Eligible Donors</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Filters: Blood Group + District + Block + Panchayat. Admin verified and
          eligible under the 90-day rule.
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
              <span className="text-sm font-medium">Panchayat (optional)</span>
              <select
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20 disabled:opacity-70"
                value={panchayatId}
                onChange={(e) => setPanchayatId(e.target.value)}
                disabled={Boolean(!blockId || panchayatsLoading)}
                suppressHydrationWarning
              >
                <option value="">
                  {panchayatsLoading
                    ? "Loading panchayats..."
                    : "All panchayats (optional)"}
                </option>
                {panchayats.map((p) => (
                  <option key={p.panchayat_id} value={p.panchayat_id}>
                    {p.panchayat_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-sm font-medium">Village (optional)</span>
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
                value={village}
                onChange={(e) => setVillage(e.target.value)}
                placeholder="Filter by village name"
              />
            </label>

            <label className="block sm:col-span-1">
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

        {dropdownLoadError ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-700">
            {dropdownLoadError}
          </div>
        ) : null}

        {!dropdownLoadError && !districtsLoading && districts.length === 0 ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900">
            Location dropdowns are empty. Import West Bengal District/Block/
            Panchayat data into Supabase (`districts`, `blocks`, `panchayats`)
            before using search filters.
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-5 space-y-2.5">
          {results.length === 0 && !loading ? (
            <div className="text-sm text-zinc-600">No eligible donors found.</div>
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
                        district: selectedDistrict?.district_name ?? d.district ?? "",
                        block: selectedBlock?.block_name ?? d.block ?? "",
                        panchayat_line: selectedPanchayat?.panchayat_name
                          ? `, ${selectedPanchayat.panchayat_name}`
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

