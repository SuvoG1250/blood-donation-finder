"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { getSupabaseOrNull } from "@/lib/supabaseClient";
import DonorPushEnable from "@/components/DonorPushEnable";

type DonorRow = {
  user_id: string;
  name: string;
  blood_group: string;
  district: string;
  block: string;
  panchayat: string;
  village?: string | null;
  last_donation_date: string;
  contact_number: string;
  id_card_verified: boolean;
  photo_object_path?: string | null;
  preferred_days?: string[] | null;
  preferred_time_slots?: string[] | null;
  pause_until?: string | null;
};

type DonationHistoryRow = {
  donation_id: string;
  donation_date: string;
  hospital_name: string | null;
  location: string | null;
  units: string | null;
  notes: string | null;
  created_at: string;
};

type RatingSummaryRow = {
  donor_user_id: string;
  rating_count: number;
  rating_avg: number;
};

type MyAlertRow = {
  id: number;
  request_id: string;
  status: string;
  error_message: string | null;
  created_at: string;
};

function digitsOnly(s: string) {
  return s.replace(/[^0-9]/g, "");
}

/** Safe for text/HTML attribute insertion in print templates */
function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function daysSince(dateIso: string) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function eligible90Days(dateIso: string) {
  const days = daysSince(dateIso);
  if (days === null) return false;
  return days >= 90;
}

function eligibleAtDate(lastDonationDate: string) {
  // lastDonationDate is stored as DATE (YYYY-MM-DD). JS parses it as UTC midnight.
  const d = new Date(lastDonationDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 90);
  return d;
}

function formatRemaining(ms: number) {
  if (ms <= 0) return "Eligible now";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / (24 * 3600));
  const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days} days ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function buildPublicDonorVerifyUrl(origin: string, donorUserId: string) {
  return `${origin.replace(/\/+$/, "")}/blood/donor/u/${donorUserId}`;
}

function icsEscapeText(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function icsDateValueOnly(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function icsUtcStampNow() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function downloadEligibilityIcs(opts: {
  donorUserId: string;
  bloodGroup: string;
  eligibleAt: Date;
}) {
  const start = icsDateValueOnly(opts.eligibleAt);
  const endExclusive = new Date(opts.eligibleAt.getTime());
  endExclusive.setDate(endExclusive.getDate() + 1);
  const end = icsDateValueOnly(endExclusive);
  const uid = `${opts.donorUserId}-elig-${start}@raktodaan`;
  const summary = icsEscapeText(`Raktodaan: eligible to donate (${opts.bloodGroup})`);
  const desc = icsEscapeText(
    "You become eligible to donate again on this date (90-day rule). Open Raktodaan after you donate to record your donation.",
  );
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Raktodaan//Donor Eligibility//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsUtcStampNow()}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `raktodaan-eligibility-${start}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const WEEK_DAYS: Array<{ value: string; label: string }> = [
  { value: "Mon", label: "Mon" },
  { value: "Tue", label: "Tue" },
  { value: "Wed", label: "Wed" },
  { value: "Thu", label: "Thu" },
  { value: "Fri", label: "Fri" },
  { value: "Sat", label: "Sat" },
  { value: "Sun", label: "Sun" },
];

const TIME_SLOTS: Array<{ value: string; label: string }> = [
  { value: "Morning", label: "Morning" },
  { value: "Afternoon", label: "Afternoon" },
  { value: "Evening", label: "Evening" },
];

export default function DonorDashboardPage() {
  type DashboardTab = "overview" | "profile" | "alerts" | "history";
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [donor, setDonor] = useState<DonorRow | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const [contactNumber, setContactNumber] = useState("");
  const [lastDonationDate, setLastDonationDate] = useState("");
  const [pauseUntil, setPauseUntil] = useState<string | null>(null);
  const [preferredDays, setPreferredDays] = useState<string[]>([]);
  const [preferredTimeSlots, setPreferredTimeSlots] = useState<string[]>([]);
  const [history, setHistory] = useState<DonationHistoryRow[]>([]);
  const [ratingSummary, setRatingSummary] = useState<RatingSummaryRow | null>(null);
  const [myAlerts, setMyAlerts] = useState<MyAlertRow[]>([]);

  const [eligibilityRemindersEnabled, setEligibilityRemindersEnabled] = useState(true);
  const [savingReminderPref, setSavingReminderPref] = useState(false);
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [telegramUsername, setTelegramUsername] = useState<string | null>(null);
  const [telegramChatId, setTelegramChatId] = useState<string | null>(null);
  const [telegramLinkCode, setTelegramLinkCode] = useState<string | null>(null);
  const [telegramCodeExpiry, setTelegramCodeExpiry] = useState<string | null>(null);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [downloadingCard, setDownloadingCard] = useState<null | "png" | "pdf">(null);
  const [addingHistory, setAddingHistory] = useState(false);
  const [historyDate, setHistoryDate] = useState("");
  const [historyHospital, setHistoryHospital] = useState("");
  const [historyLocation, setHistoryLocation] = useState("");
  const [historyUnits, setHistoryUnits] = useState("");
  const [historyNotes, setHistoryNotes] = useState("");
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");

  const eligible = useMemo(() => {
    if (!lastDonationDate) return false;
    return eligible90Days(lastDonationDate);
  }, [lastDonationDate]);

  const nextEligibilityDate = useMemo(() => {
    if (!lastDonationDate) return null;
    return eligibleAtDate(lastDonationDate);
  }, [lastDonationDate]);

  const canDownloadEligibilityIcs = Boolean(
    donor?.id_card_verified && lastDonationDate && !eligible && nextEligibilityDate,
  );

  const [eligibilityCountdown, setEligibilityCountdown] = useState<string>("—");

  async function load() {
    setLoading(true);
    setError(null);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
      );
      setLoading(false);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user ?? null;
    if (!user) {
      router.replace("/sign-in");
      return;
    }

    setEmail(user.email ?? null);

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();

    if (profileErr || !profile) {
      setError(profileErr?.message ?? "Unable to load profile.");
      setLoading(false);
      return;
    }

    if (profile.role !== "donor") {
      router.replace("/donor/onboarding");
      return;
    }

    const { data: donorRow, error: donorErr } = await supabase
      .from("donors")
      .select(
        "user_id,name,blood_group,district,block,panchayat,village,last_donation_date,contact_number,id_card_verified,photo_object_path,preferred_days,preferred_time_slots,pause_until",
      )
      .eq("user_id", user.id)
      .single();

    if (donorErr || !donorRow) {
      setError(donorErr?.message ?? "Unable to load donor record.");
      setLoading(false);
      return;
    }

    setDonor(donorRow as DonorRow);
    setPhotoUrl(null);
    setContactNumber((donorRow as DonorRow).contact_number ?? "");
    setLastDonationDate((donorRow as DonorRow).last_donation_date ?? "");
    setPauseUntil((donorRow as DonorRow).pause_until ?? null);
    setPreferredDays(((donorRow as DonorRow).preferred_days ?? []) as string[]);
    setPreferredTimeSlots(
      ((donorRow as DonorRow).preferred_time_slots ?? []) as string[],
    );

    const { data: historyRows, error: historyErr } = await supabase
      .from("donation_history")
      .select("donation_id,donation_date,hospital_name,location,units,notes,created_at")
      .eq("donor_user_id", user.id)
      .order("donation_date", { ascending: false });
    if (!historyErr) {
      setHistory((historyRows as DonationHistoryRow[]) ?? []);
    }

    const { data: prefsRow } = await supabase
      .from("donor_notification_prefs")
      .select("eligibility_reminders_enabled")
      .eq("donor_user_id", user.id)
      .maybeSingle();
    setEligibilityRemindersEnabled(
      Boolean(
        (prefsRow as { eligibility_reminders_enabled?: boolean } | null)
          ?.eligibility_reminders_enabled ?? true,
      ),
    );

    const { data: myAlertRows } = await supabase
      .from("emergency_notification_logs")
      .select("id,request_id,status,error_message,created_at")
      .eq("donor_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setMyAlerts((myAlertRows as MyAlertRow[]) ?? []);

    const { data: summaryRow } = await supabase.rpc("get_donor_rating_summary", {
      p_donor_user_id: user.id,
    });
    const first = (summaryRow as RatingSummaryRow[] | null)?.[0] ?? null;
    setRatingSummary(first);

    const { data: tgRow } = await supabase
      .from("donor_telegram_subscriptions")
      .select("telegram_chat_id,telegram_username,enabled")
      .eq("donor_user_id", user.id)
      .maybeSingle();
    if (tgRow) {
      const row = tgRow as {
        telegram_chat_id?: string;
        telegram_username?: string | null;
        enabled?: boolean;
      };
      setTelegramConnected(Boolean(row.telegram_chat_id));
      setTelegramChatId(row.telegram_chat_id ?? null);
      setTelegramUsername(row.telegram_username ?? null);
      setTelegramEnabled(Boolean(row.enabled ?? true));
    } else {
      setTelegramConnected(false);
      setTelegramChatId(null);
      setTelegramUsername(null);
      setTelegramEnabled(true);
    }

    setLoading(false);
  }

  useEffect(() => {
    queueMicrotask(() => void load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!donor?.id_card_verified) return;
    if (!lastDonationDate) return;

    const update = () => {
      const eligibleAt = eligibleAtDate(lastDonationDate);
      if (!eligibleAt) {
        setEligibilityCountdown("—");
        return;
      }
      const ms = eligibleAt.getTime() - Date.now();
      setEligibilityCountdown(formatRemaining(ms));
    };

    queueMicrotask(update);
    const t = window.setInterval(update, 10_000);
    return () => window.clearInterval(t);
  }, [donor?.id_card_verified, lastDonationDate]);

  useEffect(() => {
    let mounted = true;
    async function loadPhoto() {
      if (!donor?.photo_object_path) return;
      if (photoUrl) return;
      const supabase = getSupabaseOrNull();
      if (!supabase) return;
      const { data, error } = await supabase.storage
        .from("donor-photos")
        .createSignedUrl(donor.photo_object_path, 60 * 60);
      if (!mounted || error || !data?.signedUrl) return;
      setPhotoUrl(data.signedUrl);
    }
    void loadPhoto();
    return () => {
      mounted = false;
    };
  }, [donor?.photo_object_path, photoUrl]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setSaving(false);
      setError("Supabase is not configured.");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user ?? null;
    if (!user) {
      setSaving(false);
      router.replace("/sign-in");
      return;
    }

    const clean = digitsOnly(contactNumber);
    if (clean.length < 10) {
      setSaving(false);
      setError("Please enter a valid WhatsApp number (10+ digits).");
      return;
    }

    const { error: updErr } = await supabase
      .from("donors")
      .update({
        contact_number: clean,
        last_donation_date: lastDonationDate,
        preferred_days: preferredDays,
        preferred_time_slots: preferredTimeSlots,
        pause_until: pauseUntil,
      })
      .eq("user_id", user.id);

    setSaving(false);
    if (updErr) {
      setError(updErr.message);
      return;
    }

    await load();
  }

  function isPausedNow() {
    if (!pauseUntil) return false;
    const dt = new Date(pauseUntil);
    if (Number.isNaN(dt.getTime())) return false;
    return dt.getTime() > Date.now();
  }

  async function onPauseForDays(days: number) {
    const dt = new Date();
    dt.setDate(dt.getDate() + days);
    const iso = dt.toISOString();
    setPauseUntil(iso);
    const supabase = getSupabaseOrNull();
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user ?? null;
    if (!user) return;
    await supabase.from("donors").update({ pause_until: iso }).eq("user_id", user.id);
  }

  async function onResumeAvailability() {
    setPauseUntil(null);
    const supabase = getSupabaseOrNull();
    if (!supabase) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user ?? null;
    if (!user) return;
    await supabase.from("donors").update({ pause_until: null }).eq("user_id", user.id);
  }

  function onPrintCertificate(item: DonationHistoryRow) {
    if (!donor) return;
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    const name = escapeHtml(donor.name);
    const bg = escapeHtml(donor.blood_group);
    const date = escapeHtml(item.donation_date);
    const hospital = escapeHtml(item.hospital_name ?? "—");
    const loc = escapeHtml(item.location ?? "—");
    const units = escapeHtml(item.units ?? "—");
    const notes = escapeHtml(item.notes ?? "—");
    const printed = escapeHtml(new Date().toLocaleString());
    const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>Donation Certificate</title>
<style>
  *{box-sizing:border-box}
  @page{margin:12mm}
  body{
    margin:0;
    min-height:100vh;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:linear-gradient(165deg,#fff1f2 0%,#ffffff 38%,#f1f5f9 100%);
    color:#0f172a;
    padding:28px 16px 40px;
  }
  .stage{max-width:720px;margin:0 auto}
  .frame{
    position:relative;
    padding:4px;
    border-radius:20px;
    background:linear-gradient(135deg,#dc2626 0%,#f43f5e 35%,#fb7185 65%,#be123c 100%);
    box-shadow:0 28px 60px -18px rgba(220,38,38,.35),0 0 0 1px rgba(15,23,42,.06);
  }
  .frame::before{
    content:"";
    position:absolute;inset:4px;border-radius:16px;
    border:1px solid rgba(255,255,255,.45);
    pointer-events:none;
  }
  .inner{
    position:relative;
    background:linear-gradient(180deg,#fffefb 0%,#fff 45%,#fafaf9 100%);
    border-radius:16px;
    padding:44px 40px 36px;
    overflow:hidden;
  }
  .inner::after{
    content:"";
    position:absolute;right:-40px;bottom:-40px;width:200px;height:200px;border-radius:50%;
    background:radial-gradient(circle,rgba(254,202,202,.45) 0%,transparent 70%);
    pointer-events:none;
  }
  .inner::before{
    content:"";
    position:absolute;left:-30px;top:-30px;width:180px;height:180px;border-radius:50%;
    background:radial-gradient(circle,rgba(254,215,170,.35) 0%,transparent 70%);
    pointer-events:none;
  }
  .content{position:relative;z-index:1}
  .eyebrow{
    display:inline-block;
    font-size:10px;font-weight:800;letter-spacing:.28em;text-transform:uppercase;
    color:#b91c1c;background:rgba(254,226,226,.85);
    padding:7px 16px;border-radius:999px;border:1px solid rgba(252,165,165,.6);
    margin-bottom:18px;
  }
  h1{
    font-family:Georgia,"Times New Roman",serif;
    font-size:30px;font-weight:700;color:#7f1d1d;margin:0 0 10px;
    letter-spacing:-.03em;line-height:1.15;
  }
  .lead{
    margin:0 0 26px;font-size:14px;line-height:1.65;color:#64748b;max-width:52ch;
  }
  .band{
    height:2px;border-radius:2px;margin:0 0 26px;
    background:linear-gradient(90deg,transparent,rgba(220,38,38,.55),rgba(244,63,94,.45),transparent);
  }
  .rows{display:grid;gap:14px}
  .row{
    display:grid;grid-template-columns:minmax(0,150px) 1fr;gap:12px 20px;
    align-items:baseline;padding:12px 14px;border-radius:12px;
    background:linear-gradient(90deg,rgba(248,250,252,.9),rgba(255,255,255,.5));
    border:1px solid rgba(226,232,240,.95);
  }
  .k{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8}
  .v{font-size:15px;font-weight:600;color:#0f172a;word-break:break-word}
  .v strong{font-weight:800;color:#991b1b}
  .sig{
    margin-top:32px;display:flex;align-items:center;justify-content:center;gap:18px;flex-wrap:wrap;
  }
  .seal{
    width:76px;height:76px;border-radius:50%;
    background:linear-gradient(145deg,#fff,#fef2f2);
    border:3px solid #dc2626;
    display:flex;align-items:center;justify-content:center;font-size:30px;
    box-shadow:0 8px 22px rgba(220,38,38,.22);
  }
  .brand{text-align:left}
  .brand .t{font-weight:900;font-size:17px;letter-spacing:.02em;color:#7f1d1d}
  .brand .s{font-size:12px;color:#64748b;margin-top:2px}
  .foot{
    margin-top:28px;padding-top:18px;border-top:1px dashed #e2e8f0;
    font-size:11px;color:#94a3b8;text-align:center;line-height:1.5;
  }
  @media print{
    body{background:#fff;padding:0}
    .frame{box-shadow:none}
  }
</style></head>
<body>
  <div class="stage">
    <div class="frame">
      <div class="inner">
        <div class="content">
          <div class="eyebrow">Certificate of appreciation</div>
          <h1>Blood donation certificate</h1>
          <p class="lead">This recognises a voluntary blood donation made in support of community health through the Raktodaan network.</p>
          <div class="band"></div>
          <div class="rows">
            <div class="row"><div class="k">Donor name</div><div class="v"><strong>${name}</strong></div></div>
            <div class="row"><div class="k">Blood group</div><div class="v"><strong>${bg}</strong></div></div>
            <div class="row"><div class="k">Donation date</div><div class="v">${date}</div></div>
            <div class="row"><div class="k">Hospital / camp</div><div class="v">${hospital}</div></div>
            <div class="row"><div class="k">Location</div><div class="v">${loc}</div></div>
            <div class="row"><div class="k">Units</div><div class="v">${units}</div></div>
            <div class="row"><div class="k">Notes</div><div class="v">${notes}</div></div>
          </div>
          <div class="sig">
            <div class="seal" aria-hidden="true">🩸</div>
            <div class="brand">
              <div class="t">Raktodaan</div>
              <div class="s">Blood donation network</div>
            </div>
          </div>
          <div class="foot">Issued from your donor dashboard · Printed ${printed}</div>
        </div>
      </div>
    </div>
  </div>
  <script>window.print()</script>
</body></html>`;
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function ensurePhotoSignedUrl(): Promise<string | null> {
    if (photoUrl) return photoUrl;
    const path = donor?.photo_object_path ?? null;
    if (!path) return null;
    const supabase = getSupabaseOrNull();
    if (!supabase) return null;
    const { data, error } = await supabase.storage
      .from("donor-photos")
      .createSignedUrl(path, 60 * 60);
    if (error) return null;
    setPhotoUrl(data.signedUrl);
    return data.signedUrl;
  }

  async function onPrintIcard() {
    if (!donor) return;
    if (!donor.id_card_verified) {
      setError("Your account must be verified before generating ID card.");
      return;
    }

    const photo = await ensurePhotoSignedUrl();
    const verifyUrl = buildPublicDonorVerifyUrl(window.location.origin, donor.user_id);
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 200,
      color: { dark: "#7f1d1d", light: "#ffffff" },
    }).catch(() => "");
    const w = window.open("", "_blank", "width=900,height=900");
    if (!w) return;

    const safeName = escapeHtml(donor.name);
    const safeEmail = escapeHtml(email ?? "-");
    const safeBg = escapeHtml(donor.blood_group);
    const safeWa = escapeHtml(donor.contact_number);
    const safeLoc = escapeHtml(
      `${donor.district} / ${donor.block} / ${donor.panchayat}${donor.village ? ` / ${donor.village}` : ""}`,
    );

    const html = `<!doctype html>
<html><head><title>Donor ID Card</title>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root{
    --red:#dc2626;
    --pink:#f43f5e;
    --dark:#0f172a;
    --soft:#f8fafc;
    --ink:#111827;
    --muted:#64748b;
  }
  *{box-sizing:border-box}
  body{
    margin:0;
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:radial-gradient(ellipse 120% 80% at 50% -20%,#fecdd3 0%,transparent 50%),
      linear-gradient(165deg,#fff1f2 0%,#ffffff 45%,#f1f5f9 100%);
    padding:28px 16px 32px;
    color:var(--ink);
  }
  .wrap{max-width:920px;margin:0 auto}
  .card{
    width:540px;
    border-radius:26px;
    overflow:hidden;
    position:relative;
    border:2px solid transparent;
    background:
      linear-gradient(145deg,#ffffff 0%,#fffafb 100%) padding-box,
      linear-gradient(135deg,#fda4af,#f43f5e,#b91c1c) border-box;
    box-shadow:0 28px 55px -15px rgba(190,18,60,.22);
  }
  .glow{
    position:absolute;right:-100px;top:-80px;width:260px;height:260px;border-radius:999px;
    background:radial-gradient(circle,rgba(251,113,133,.45) 0%,rgba(251,113,133,0) 68%);
    pointer-events:none;
  }
  .glow2{
    position:absolute;left:-60px;bottom:-40px;width:200px;height:200px;border-radius:999px;
    background:radial-gradient(circle,rgba(254,215,170,.35) 0%,transparent 70%);
    pointer-events:none;
  }
  .top{
    background:linear-gradient(125deg,#b91c1c 0%,#dc2626 45%,#f43f5e 100%);
    color:#fff;
    padding:18px 20px 16px;
    display:flex;
    align-items:flex-start;
    justify-content:space-between;
    position:relative;
    overflow:hidden;
  }
  .top::after{
    content:"";
    position:absolute;right:0;bottom:0;left:0;height:40%;
    background:linear-gradient(180deg,transparent,rgba(0,0,0,.08));
    pointer-events:none;
  }
  .brandWrap{position:relative;z-index:1}
  .brand{
    font-weight:900;
    letter-spacing:.12em;
    font-size:16px;
    text-transform:uppercase;
    text-shadow:0 1px 2px rgba(0,0,0,.12);
  }
  .sub{font-size:11px;opacity:.95;margin-top:5px;font-weight:600;letter-spacing:.02em}
  .verified{
    position:relative;z-index:1;
    background:rgba(255,255,255,.22);
    border:1px solid rgba(255,255,255,.45);
    padding:7px 14px;
    border-radius:999px;
    font-size:10px;
    font-weight:900;
    letter-spacing:.14em;
    text-transform:uppercase;
    backdrop-filter:blur(6px);
  }
  .body{
    display:flex;
    gap:18px;
    padding:20px 20px 16px;
    position:relative;
  }
  .photoBox{
    width:132px;height:158px;
    border-radius:20px;
    border:3px solid #fff;
    overflow:hidden;
    background:var(--soft);
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 12px 28px rgba(15,23,42,.12),0 0 0 1px rgba(226,232,240,.9);
    flex-shrink:0;
  }
  .photoBox img{width:100%;height:100%;object-fit:cover}
  .phFallback{font-size:11px;color:var(--muted);padding:8px;text-align:center;line-height:1.35}
  .info{flex:1;min-width:0}
  .name{margin:0;font-size:23px;line-height:1.2;font-weight:900;color:var(--dark);letter-spacing:-.02em}
  .uid{
    margin-top:8px;
    display:inline-block;
    font-size:11px;
    color:var(--muted);
    background:linear-gradient(180deg,#f8fafc,#f1f5f9);
    border:1px dashed #cbd5e1;
    border-radius:999px;
    padding:4px 12px;
    max-width:100%;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  }
  .meta{
    margin-top:12px;
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:10px;
  }
  .tile{
    border:1px solid #e2e8f0;
    border-radius:14px;
    padding:10px 11px;
    background:linear-gradient(180deg,#ffffff,#fafafa);
    box-shadow:0 1px 2px rgba(15,23,42,.04);
  }
  .tile.full{grid-column:1 / span 2}
  .k{
    font-size:9px;
    text-transform:uppercase;
    letter-spacing:.12em;
    color:var(--muted);
    font-weight:900;
  }
  .v{
    margin-top:5px;
    font-size:13px;
    font-weight:800;
    color:var(--ink);
    word-break:break-word;
  }
  .blood{
    display:inline-flex;
    align-items:center;
    gap:8px;
    border:1px solid #fecdd3;
    background:linear-gradient(180deg,#fff1f2,#ffe4e6);
    color:#9f1239;
    border-radius:999px;
    padding:5px 12px;
    font-weight:900;
    font-size:13px;
  }
  .bloodDot{
    width:9px;height:9px;border-radius:999px;background:linear-gradient(180deg,#fb7185,#e11d48);
    box-shadow:0 0 0 3px rgba(225,29,72,.18);
  }
  .foot{
    border-top:1px solid #e2e8f0;
    background:linear-gradient(180deg,#fafafa,#f4f4f5);
    padding:14px 20px 16px;
    position:relative;
  }
  .footStrip{
    position:absolute;top:0;left:20px;right:20px;height:3px;border-radius:0 0 4px 4px;
    background:linear-gradient(90deg,#dc2626,#f97316,#dc2626);
    opacity:.85;
  }
  .qrWrap{margin-top:12px;display:flex;gap:14px;align-items:center;justify-content:space-between}
  .qrBox{
    border:1px solid #e2e8f0;border-radius:16px;background:#fff;padding:9px;
    display:flex;align-items:center;justify-content:center;
    box-shadow:0 4px 12px rgba(15,23,42,.06);
  }
  .qrBox img{width:96px;height:96px}
  .note{font-size:11px;color:#475569;line-height:1.5;max-width:280px}
  .note b{color:#0f172a}
  .tip{margin-top:14px;font-size:12px;color:#64748b;text-align:center}
  @media print{
    body{padding:0;background:#fff}
    .wrap{max-width:none}
    .tip{display:none}
  }
</style></head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="glow"></div>
      <div class="glow2"></div>
      <div class="top">
        <div class="brandWrap">
          <div class="brand">Raktodaan</div>
          <div class="sub">Verified donor · Digital ID</div>
        </div>
        <div class="verified">Verified</div>
      </div>
      <div class="body">
        <div class="photoBox">${photo ? `<img src="${photo}" alt=""/>` : `<div class="phFallback">No photo on file</div>`}</div>
        <div class="info">
          <p class="name">${safeName}</p>
          <div class="uid">${safeEmail}</div>
          <div class="meta">
            <div class="tile">
              <div class="k">Blood group</div>
              <div class="v"><span class="blood"><span class="bloodDot"></span>${safeBg}</span></div>
            </div>
            <div class="tile">
              <div class="k">WhatsApp</div>
              <div class="v">${safeWa}</div>
            </div>
            <div class="tile full">
              <div class="k">Location</div>
              <div class="v">${safeLoc}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="foot">
        <div class="footStrip"></div>
        <div class="note"><b>Verification:</b> Scan the QR code to confirm this profile on Raktodaan. This card is issued from the donor dashboard for volunteer identification.</div>
        <div class="qrWrap">
          ${
            qrDataUrl
              ? `<div class="qrBox"><img src="${qrDataUrl}" alt=""/></div>`
              : ""
          }
        </div>
      </div>
    </div>
    <div class="tip">Tip: Print → Save as PDF to keep a copy.</div>
    <script>window.print()</script>
  </div>
</body></html>`;

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function renderIcardCanvas(): Promise<HTMLCanvasElement | null> {
    if (!donor) return null;
    if (!donor.id_card_verified) {
      setError("Your account must be verified before generating ID card.");
      return null;
    }

    const photo = await ensurePhotoSignedUrl();
    const verifyUrl = buildPublicDonorVerifyUrl(window.location.origin, donor.user_id);
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 200,
      color: { dark: "#7f1d1d", light: "#ffffff" },
    }).catch(() => "");

    const safeName = escapeHtml(donor.name);
    const safeEmail = escapeHtml(email ?? "-");
    const safeBg = escapeHtml(donor.blood_group);
    const safeWa = escapeHtml(donor.contact_number);
    const safeLoc = escapeHtml(
      `${donor.district} / ${donor.block} / ${donor.panchayat}${donor.village ? ` / ${donor.village}` : ""}`,
    );

    const mount = document.createElement("div");
    mount.style.position = "fixed";
    mount.style.left = "-10000px";
    mount.style.top = "0";
    mount.style.width = "760px";
    mount.style.zIndex = "-1";
    mount.innerHTML = `
      <style>
        .ic-wrap{width:760px;padding:20px;background:#f8fafc;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}
        .ic-card{
          width:540px;border-radius:26px;overflow:hidden;position:relative;
          border:2px solid transparent;
          background:linear-gradient(145deg,#ffffff 0%,#fffafb 100%) padding-box,linear-gradient(135deg,#fda4af,#f43f5e,#b91c1c) border-box;
          box-shadow:0 28px 55px -15px rgba(190,18,60,.22);
          color:#111827;
        }
        .ic-glow{position:absolute;right:-80px;top:-60px;width:220px;height:220px;border-radius:999px;background:radial-gradient(circle,rgba(251,113,133,.35) 0%,transparent 70%);pointer-events:none}
        .ic-top{
          background:linear-gradient(125deg,#b91c1c 0%,#dc2626 45%,#f43f5e 100%);
          color:#fff;padding:18px 20px 16px;display:flex;align-items:flex-start;justify-content:space-between;position:relative
        }
        .ic-brand{font-weight:900;letter-spacing:.12em;font-size:16px;text-transform:uppercase}
        .ic-sub{font-size:11px;margin-top:5px;font-weight:600;opacity:.95}
        .ic-verified{background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.45);padding:7px 14px;border-radius:999px;font-size:10px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
        .ic-body{display:flex;gap:18px;padding:20px 20px 16px;position:relative}
        .ic-photo{
          width:132px;height:158px;border-radius:20px;border:3px solid #fff;overflow:hidden;background:#f8fafc;
          display:flex;align-items:center;justify-content:center;flex-shrink:0;
          box-shadow:0 12px 28px rgba(15,23,42,.12),0 0 0 1px rgba(226,232,240,.9)
        }
        .ic-photo img{width:100%;height:100%;object-fit:cover}
        .ic-info{flex:1;min-width:0}
        .ic-name{margin:0;font-size:23px;font-weight:900;color:#0f172a;line-height:1.2}
        .ic-uid{margin-top:8px;display:inline-block;font-size:11px;color:#64748b;background:linear-gradient(180deg,#f8fafc,#f1f5f9);border:1px dashed #cbd5e1;border-radius:999px;padding:4px 12px;max-width:100%}
        .ic-meta{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .ic-tile{border:1px solid #e2e8f0;border-radius:14px;padding:10px 11px;background:linear-gradient(180deg,#ffffff,#fafafa)}
        .ic-full{grid-column:1 / span 2}
        .ic-k{font-size:9px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;font-weight:900}
        .ic-v{margin-top:5px;font-size:13px;font-weight:800;word-break:break-word}
        .ic-blood{display:inline-flex;align-items:center;gap:8px;border:1px solid #fecdd3;background:linear-gradient(180deg,#fff1f2,#ffe4e6);color:#9f1239;border-radius:999px;padding:5px 12px;font-weight:900;font-size:13px}
        .ic-foot{border-top:1px solid #e2e8f0;background:linear-gradient(180deg,#fafafa,#f4f4f5);padding:14px 20px 16px;position:relative;font-size:11px;color:#475569;line-height:1.5}
        .ic-strip{position:absolute;top:0;left:20px;right:20px;height:3px;border-radius:0 0 4px 4px;background:linear-gradient(90deg,#dc2626,#f97316,#dc2626);opacity:.85}
        .ic-qr{margin-top:12px;display:flex;align-items:center;justify-content:flex-end;gap:12px}
        .ic-qrbox{border:1px solid #e2e8f0;border-radius:16px;background:#fff;padding:9px;box-shadow:0 4px 12px rgba(15,23,42,.06)}
        .ic-qrbox img{width:96px;height:96px}
      </style>
      <div class="ic-wrap">
        <div class="ic-card">
          <div class="ic-glow"></div>
          <div class="ic-top">
            <div>
              <div class="ic-brand">Raktodaan</div>
              <div class="ic-sub">Verified donor · Digital ID</div>
            </div>
            <div class="ic-verified">Verified</div>
          </div>
          <div class="ic-body">
            <div class="ic-photo">${photo ? `<img src="${photo}" alt=""/>` : `<div style="font-size:11px;color:#64748b;text-align:center;padding:8px">No photo</div>`}</div>
            <div class="ic-info">
              <p class="ic-name">${safeName}</p>
              <div class="ic-uid">${safeEmail}</div>
              <div class="ic-meta">
                <div class="ic-tile">
                  <div class="ic-k">Blood group</div>
                  <div class="ic-v"><span class="ic-blood">${safeBg}</span></div>
                </div>
                <div class="ic-tile">
                  <div class="ic-k">WhatsApp</div>
                  <div class="ic-v">${safeWa}</div>
                </div>
                <div class="ic-tile ic-full">
                  <div class="ic-k">Location</div>
                  <div class="ic-v">${safeLoc}</div>
                </div>
              </div>
            </div>
          </div>
          <div class="ic-foot">
            <div class="ic-strip"></div>
            <b style="color:#0f172a">Verification:</b> Scan the QR to confirm this profile on Raktodaan.
            <div class="ic-qr">
              ${qrDataUrl ? `<div class="ic-qrbox"><img src="${qrDataUrl}" alt=""/></div>` : ""}
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(mount);

    try {
      const html2canvasMod = await import("html2canvas");
      const html2canvas = html2canvasMod.default;
      const cardEl = mount.querySelector(".ic-card") as HTMLElement | null;
      if (!cardEl) return null;
      const canvas = await html2canvas(cardEl, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
      });
      return canvas;
    } finally {
      document.body.removeChild(mount);
    }
  }

  async function onDownloadIcardImage() {
    setDownloadingCard("png");
    setError(null);
    try {
      const canvas = await renderIcardCanvas();
      if (!canvas || !donor) return;
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `${donor.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_donor_id_card.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to download ID card image.");
    } finally {
      setDownloadingCard(null);
    }
  }

  async function onDownloadIcardPdf() {
    setDownloadingCard("pdf");
    setError(null);
    try {
      const canvas = await renderIcardCanvas();
      if (!canvas || !donor) return;
      const imgData = canvas.toDataURL("image/png");
      const jspdfMod = await import("jspdf");
      const { jsPDF } = jspdfMod;
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? "landscape" : "portrait",
        unit: "pt",
        format: [canvas.width, canvas.height],
      });
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
      pdf.save(`${donor.name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_donor_id_card.pdf`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to download ID card PDF.");
    } finally {
      setDownloadingCard(null);
    }
  }

  async function onAddHistory(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAddingHistory(true);
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setAddingHistory(false);
      setError("Supabase is not configured.");
      return;
    }
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user ?? null;
    if (!user) {
      setAddingHistory(false);
      router.replace("/sign-in");
      return;
    }
    const { error: insErr } = await supabase.from("donation_history").insert({
      donor_user_id: user.id,
      donation_date: historyDate,
      hospital_name: historyHospital || null,
      location: historyLocation || null,
      units: historyUnits || null,
      notes: historyNotes || null,
    });
    setAddingHistory(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setHistoryDate("");
    setHistoryHospital("");
    setHistoryLocation("");
    setHistoryUnits("");
    setHistoryNotes("");
    await load();
  }

  async function onToggleEligibilityReminders(next: boolean) {
    setError(null);
    setSavingReminderPref(true);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setSavingReminderPref(false);
      setError("Supabase is not configured.");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user ?? null;
    if (!user) {
      setSavingReminderPref(false);
      router.replace("/sign-in");
      return;
    }

    const { error: upErr } = await supabase.from("donor_notification_prefs").upsert(
      {
        donor_user_id: user.id,
        eligibility_reminders_enabled: next,
      },
      { onConflict: "donor_user_id" },
    );

    setSavingReminderPref(false);
    if (upErr) {
      setError(upErr.message);
      return;
    }
    setEligibilityRemindersEnabled(next);
  }

  async function callDonorTelegramApi(route: string, body: Record<string, unknown>) {
    const supabase = getSupabaseOrNull();
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error("Missing access token.");
    const resp = await fetch(`/api/donor/telegram/${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = {};
    }
    if (!resp.ok) throw new Error(String(parsed.error ?? text.slice(0, 200) ?? "Request failed"));
    return parsed;
  }

  async function onGenerateTelegramCode() {
    setTelegramBusy(true);
    setError(null);
    try {
      const res = await callDonorTelegramApi("link-code", {});
      setTelegramLinkCode(String(res.code ?? ""));
      setTelegramCodeExpiry(String(res.expires_at ?? ""));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate Telegram code.");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function onVerifyTelegramCode() {
    setTelegramBusy(true);
    setError(null);
    try {
      const res = await callDonorTelegramApi("verify", {});
      setTelegramConnected(true);
      setTelegramChatId(String(res.chat_id ?? ""));
      setTelegramUsername((res.username as string | null | undefined) ?? null);
      setTelegramEnabled(true);
      setTelegramLinkCode(null);
      setTelegramCodeExpiry(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Telegram verification failed.");
    } finally {
      setTelegramBusy(false);
    }
  }

  async function onToggleTelegram(next: boolean) {
    setTelegramBusy(true);
    setError(null);
    try {
      await callDonorTelegramApi("toggle", { enabled: next });
      setTelegramEnabled(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update Telegram preference.");
    } finally {
      setTelegramBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          Loading...
        </div>
      </div>
    );
  }

  if (!donor) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 className="text-lg font-semibold">Donor dashboard</h1>
          <p className="mt-2 text-sm text-zinc-600">{error ?? "No donor record found."}</p>
          <div className="mt-4">
            <Link
              href="/donor/onboarding"
              className="text-sm font-semibold underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
            >
              Go to donor registration
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="rounded-3xl border border-rose-100 bg-gradient-to-b from-rose-50/70 via-white to-white p-6 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Donor Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Manage your donor profile and availability.
            </p>
            {email ? (
              <div className="mt-2 text-xs text-zinc-500">User ID: {email}</div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/change-password"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
            >
              Change password
            </Link>
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-rose-100 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-100">
                {photoUrl ? (
                  <img src={photoUrl} alt={donor.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-lg font-bold text-zinc-600">
                    {(donor.name || "D").slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div>
                <div className="text-lg font-semibold text-zinc-900">{donor.name}</div>
                <div className="mt-1 inline-flex items-center rounded-full bg-rose-100 px-2.5 py-1 text-xs font-semibold text-rose-800">
                  {donor.blood_group} Donor
                </div>
                <div className="mt-1 text-xs text-zinc-600">
                  {donor.district} / {donor.block} / {donor.panchayat}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center text-xs sm:min-w-56">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                <div className="font-semibold text-zinc-900">{ratingSummary ? ratingSummary.rating_avg.toFixed(1) : "—"}</div>
                <div className="text-zinc-500">Rating</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                <div className="font-semibold text-zinc-900">{myAlerts.length}</div>
                <div className="text-zinc-500">My alerts</div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([
            { key: "overview", label: "Overview" },
            { key: "profile", label: "Profile" },
            { key: "alerts", label: "Alerts" },
            { key: "history", label: "History" },
          ] as Array<{ key: DashboardTab; label: string }>).map((t) => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                  isActive
                    ? "border-rose-300 bg-rose-50 text-rose-800"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="mt-5 rounded-xl border border-rose-100 bg-gradient-to-br from-rose-50/80 to-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-zinc-900">Quick links</div>
          <p className="mt-1 text-xs text-zinc-600">
            Jump to live emergencies or search for eligible donors (e.g. helping a patient).
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/blood/emergency"
              className="inline-flex flex-1 items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105"
            >
              Emergency feed
            </Link>
            <Link
              href="/blood/search"
              className="inline-flex flex-1 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
            >
              Find donors
            </Link>
          </div>
        </div>

        {activeTab === "overview" ? (
          <>
        {!donor.id_card_verified ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
            Your account is waiting for admin approval. You will be able to appear in searches after
            verification.
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900">
            Verified donor. Eligibility:{" "}
            <span className="font-semibold">{eligible ? "Eligible" : "Not eligible (within 90 days)"}</span>
            <div className="mt-2 text-xs text-emerald-800">
              Countdown: <span className="font-semibold">{eligibilityCountdown}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-emerald-900">
              <span className="font-semibold">Eligibility reminders:</span>
              <button
                type="button"
                disabled={savingReminderPref}
                onClick={() => void onToggleEligibilityReminders(!eligibilityRemindersEnabled)}
                className="rounded-full border border-emerald-300 bg-white px-3 py-1 font-semibold hover:bg-emerald-50 disabled:opacity-60"
              >
                {eligibilityRemindersEnabled ? "Enabled" : "Disabled"}
              </button>
              <span className="text-emerald-800">
                (Optional email/push reminder when you become eligible again)
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void onPrintIcard()}
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-105"
              >
                Print ID card
              </button>
              <button
                type="button"
                disabled={downloadingCard !== null}
                onClick={() => void onDownloadIcardImage()}
                className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-60"
              >
                {downloadingCard === "png" ? "Downloading..." : "Download PNG"}
              </button>
              <button
                type="button"
                disabled={downloadingCard !== null}
                onClick={() => void onDownloadIcardPdf()}
                className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-60"
              >
                {downloadingCard === "pdf" ? "Downloading..." : "Download PDF"}
              </button>
              {canDownloadEligibilityIcs && donor && nextEligibilityDate ? (
                <button
                  type="button"
                  onClick={() =>
                    downloadEligibilityIcs({
                      donorUserId: donor.user_id,
                      bloodGroup: donor.blood_group,
                      eligibleAt: nextEligibilityDate,
                    })
                  }
                  className="inline-flex items-center justify-center rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-900 shadow-sm hover:bg-sky-100"
                >
                  Add eligibility to calendar (.ics)
                </button>
              ) : null}
            </div>
          </div>
        )}

        <DonorPushEnable />

        <div className="mt-4 rounded-xl border border-zinc-200 bg-white/80 p-4">
          <div className="text-sm font-semibold text-zinc-900">Availability</div>
          <div className="mt-2 text-xs text-zinc-600">
            Pause your availability if you can’t donate for some time. You will be hidden from search and emergency matching until you resume.
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isPausedNow() ? (
              <>
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-900">
                  Paused
                </span>
                <span className="text-xs text-zinc-600">
                  Until: <b>{pauseUntil ?? "-"}</b>
                </span>
                <button
                  type="button"
                  onClick={() => void onResumeAvailability()}
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
                >
                  Resume now
                </button>
              </>
            ) : (
              <>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                  Active
                </span>
                <button
                  type="button"
                  onClick={() => void onPauseForDays(7)}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-zinc-50"
                >
                  Pause 7 days
                </button>
                <button
                  type="button"
                  onClick={() => void onPauseForDays(30)}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-zinc-50"
                >
                  Pause 30 days
                </button>
                <button
                  type="button"
                  onClick={() => void onPauseForDays(90)}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-zinc-50"
                >
                  Pause 90 days
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-white/80 p-4">
          <div className="text-sm font-semibold text-zinc-900">Telegram alerts</div>
          {!telegramConnected ? (
            <div className="mt-2 text-xs text-zinc-600">
              Connect your Telegram so emergency messages can reach you directly.
            </div>
          ) : (
            <div className="mt-2 text-xs text-zinc-600">
              Connected {telegramUsername ? `as @${telegramUsername}` : ""} ({telegramChatId ?? "-"})
            </div>
          )}

          <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700">
            <div className="font-semibold text-zinc-900">How to connect Telegram</div>
            <div className="mt-2">1) Click <b>Generate link code</b>.</div>
            <div className="mt-1">
              2) Open bot:{" "}
              <a
                href="https://t.me/Raktodaan_Community_bot"
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
              >
                t.me/Raktodaan_Community_bot
              </a>
            </div>
            <div className="mt-1">3) Send: <b>/start YOUR_CODE</b></div>
            <div className="mt-1">4) Come back and click <b>Verify now</b>.</div>
            <div className="mt-1">5) Keep Telegram alerts enabled.</div>
          </div>

          {!telegramConnected ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onGenerateTelegramCode()}
                disabled={telegramBusy}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-60"
              >
                {telegramBusy ? "Generating..." : "Generate link code"}
              </button>
              <button
                type="button"
                onClick={() => void onVerifyTelegramCode()}
                disabled={telegramBusy || !telegramLinkCode}
                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
              >
                {telegramBusy ? "Verifying..." : "Verify now"}
              </button>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onToggleTelegram(!telegramEnabled)}
                disabled={telegramBusy}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-60"
              >
                {telegramEnabled ? "Disable Telegram alerts" : "Enable Telegram alerts"}
              </button>
            </div>
          )}

          {telegramLinkCode ? (
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
              1) Open your Telegram bot and send: <b>/start {telegramLinkCode}</b>
              <br />
              2) Then click <b>Verify now</b>.
              {telegramCodeExpiry ? <div className="mt-1">Code expires: {telegramCodeExpiry}</div> : null}
            </div>
          ) : null}
        </div>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-white/80 p-4">
          <div className="text-sm font-semibold text-zinc-900">My alerts</div>
          <div className="mt-1 text-xs text-zinc-600">
            Your recent emergency notifications (email matching log). If an emergency is not verified,
            it won’t be sent.
          </div>
          <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50">
                <tr className="text-xs text-zinc-600">
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold">Request</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {myAlerts.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-sm text-zinc-600" colSpan={3}>
                      No alerts yet.
                    </td>
                  </tr>
                ) : (
                  myAlerts.map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2 text-xs text-zinc-700">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono text-zinc-700">
                        {r.request_id.slice(0, 8)}…
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-700">
                        <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-semibold">
                          {r.status}
                        </span>
                        {r.error_message ? (
                          <div className="mt-1 text-xs text-rose-700 line-clamp-2">
                            {r.error_message}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-200 bg-white/80 p-4">
          <div className="text-xs font-semibold text-zinc-500">Donor rating</div>
          <div className="mt-1 flex flex-wrap items-end gap-2">
            <div className="text-lg font-semibold">
              {ratingSummary ? ratingSummary.rating_avg.toFixed(1) : "—"}
              <span className="ml-1 text-sm font-medium text-zinc-600">/ 5</span>
            </div>
            <div className="text-xs text-zinc-600">
              {ratingSummary ? `${ratingSummary.rating_count} ratings` : "No ratings yet"}
            </div>
          </div>
          <div className="mt-2 text-xs text-zinc-500">
            Ratings are provided by admins after verification or donation confirmation.
          </div>
        </div>
          </>
        ) : null}

        {activeTab === "alerts" ? (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-white/80 p-4">
            <div className="text-sm font-semibold text-zinc-900">My alerts</div>
            <div className="mt-1 text-xs text-zinc-600">
              Your recent emergency notifications (email matching log). If an emergency is not verified,
              it won’t be sent.
            </div>
            <div className="mt-3 overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50">
                  <tr className="text-xs text-zinc-600">
                    <th className="px-3 py-2 font-semibold">When</th>
                    <th className="px-3 py-2 font-semibold">Request</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {myAlerts.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-sm text-zinc-600" colSpan={3}>
                        No alerts yet.
                      </td>
                    </tr>
                  ) : (
                    myAlerts.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2 text-xs text-zinc-700">
                          {new Date(r.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-xs font-mono text-zinc-700">
                          {r.request_id.slice(0, 8)}…
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-700">
                          <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-semibold">
                            {r.status}
                          </span>
                          {r.error_message ? (
                            <div className="mt-1 text-xs text-rose-700 line-clamp-2">
                              {r.error_message}
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "profile" ? (
          <>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 bg-white/80 p-4">
            <div className="text-xs font-semibold text-zinc-500">Name</div>
            <div className="mt-1 font-semibold">{donor.name}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white/80 p-4">
            <div className="text-xs font-semibold text-zinc-500">Blood group</div>
            <div className="mt-1 font-semibold">{donor.blood_group}</div>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white/80 p-4 sm:col-span-2">
            <div className="text-xs font-semibold text-zinc-500">Location</div>
            <div className="mt-1 text-sm text-zinc-700">
              {donor.district} / {donor.block} / {donor.panchayat}
              {donor.village ? <span className="text-zinc-500"> / {donor.village}</span> : null}
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={onSave}>
          <label className="sm:col-span-2 block">
            <span className="text-sm font-medium">WhatsApp number</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
              placeholder="10-digit mobile number"
              required
              inputMode="tel"
            />
            <div className="mt-1 text-xs text-zinc-500">
              Saved as digits only. Used for WhatsApp contact links.
            </div>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Last donation date</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              value={lastDonationDate}
              onChange={(e) => setLastDonationDate(e.target.value)}
              type="date"
              required
            />
          </label>

          <div className="sm:col-span-2 rounded-xl border border-zinc-200 bg-white/60 p-4">
            <div className="text-sm font-semibold text-zinc-900">
              Availability preference (optional)
            </div>
            <div className="mt-3 text-xs font-medium text-zinc-600">
              Choose days and time slots you prefer for blood donation.
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-zinc-500">Days</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {WEEK_DAYS.map((d) => {
                    const checked = preferredDays.includes(d.value);
                    return (
                      <label
                        key={d.value}
                        className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? Array.from(new Set([...preferredDays, d.value]))
                              : preferredDays.filter((x) => x !== d.value);
                            setPreferredDays(next);
                          }}
                        />
                        {d.label}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-zinc-500">Time</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {TIME_SLOTS.map((t) => {
                    const checked = preferredTimeSlots.includes(t.value);
                    return (
                      <label
                        key={t.value}
                        className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? Array.from(
                                  new Set([...preferredTimeSlots, t.value]),
                                )
                              : preferredTimeSlots.filter((x) => x !== t.value);
                            setPreferredTimeSlots(next);
                          }}
                        />
                        {t.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-3 text-xs text-zinc-600">
              If you leave this blank, seekers will still be able to find you.
            </div>
          </div>

          <div className="flex items-end">
            <button
              disabled={saving}
              type="submit"
              className="w-full rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>

          <div className="sm:col-span-2 text-xs text-zinc-600">
            WhatsApp preview:{" "}
            <a
              className="font-semibold underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
              href={`https://wa.me/${digitsOnly(contactNumber)}`}
              target="_blank"
              rel="noreferrer"
            >
              wa.me/{digitsOnly(contactNumber)}
            </a>
          </div>
        </form>
          </>
        ) : null}

        {activeTab === "history" ? (
        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white/80 p-5">
          <h2 className="text-lg font-semibold">Donation History</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Add your past blood donations and print a simple certificate.
          </p>

          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={onAddHistory}>
            <label className="block">
              <span className="text-sm font-medium">Donation date</span>
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                type="date"
                value={historyDate}
                onChange={(e) => setHistoryDate(e.target.value)}
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Hospital (optional)</span>
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                value={historyHospital}
                onChange={(e) => setHistoryHospital(e.target.value)}
                placeholder="Hospital name"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Location (optional)</span>
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                value={historyLocation}
                onChange={(e) => setHistoryLocation(e.target.value)}
                placeholder="City / district"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Units (optional)</span>
              <input
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                value={historyUnits}
                onChange={(e) => setHistoryUnits(e.target.value)}
                placeholder="e.g. 1 unit"
              />
            </label>
            <label className="sm:col-span-2 block">
              <span className="text-sm font-medium">Notes (optional)</span>
              <textarea
                className="mt-1 min-h-20 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                value={historyNotes}
                onChange={(e) => setHistoryNotes(e.target.value)}
                placeholder="Any extra details"
              />
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={addingHistory}
                className="rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {addingHistory ? "Adding..." : "Add donation record"}
              </button>
            </div>
          </form>

          <div className="mt-5 space-y-2">
            {history.length === 0 ? (
              <div className="text-sm text-zinc-600">No donation records yet.</div>
            ) : (
              history.map((item) => (
                <div
                  key={item.donation_id}
                  className="rounded-xl border border-zinc-200 bg-white p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{item.donation_date}</div>
                    <button
                      type="button"
                      onClick={() => onPrintCertificate(item)}
                      className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-zinc-50"
                    >
                      Print certificate
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-zinc-600">
                    {item.hospital_name ?? "-"} | {item.location ?? "-"} | {item.units ?? "-"}
                  </div>
                  {item.notes ? <div className="mt-1 text-xs text-zinc-500">{item.notes}</div> : null}
                </div>
              ))
            )}
          </div>
        </div>
        ) : null}
      </div>
    </div>
  );
}

