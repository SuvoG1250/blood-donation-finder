"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

type Stat = {
  label: string;
  value: number | null;
  hint?: string;
};

type RecentReviewRow = {
  user_id: string;
  name: string;
  blood_group: string;
  district: string;
  block: string;
  panchayat: string;
  id_card_verified: boolean;
  reviewed_at: string | null;
  rejection_reason: string | null;
};

type ActiveDonorRow = {
  user_id: string;
  name: string;
  blood_group: string;
  district: string;
  block: string;
  panchayat: string;
  village?: string | null;
  last_donation_date: string;
  contact_number: string;
  reviewed_at: string | null;
  is_trusted?: boolean;
};

type EmergencyAdminRow = {
  request_id: string;
  blood_group: string;
  district: string;
  block: string;
  panchayat: string;
  patient_name: string | null;
  request_details: string;
  contact_number: string;
  status: string;
  verified_status?: "pending" | "verified" | "suspected_spam" | string;
  verified_note?: string | null;
  verified_at?: string | null;
  hospital_user_id?: string | null;
  created_at: string;
  escalated_at?: string | null;
};

type AdminUiPrefs = {
  eligibilityDays: number;
  activeRowsLimit: number;
  emergencyRowsLimit: number;
};

function formatCompact(n: number) {
  return Intl.NumberFormat(undefined, { notation: "compact" }).format(n);
}

function toWhatsAppLink(contact: string) {
  const digits = contact.replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}`;
}

function daysSince(dateIso: string) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function isEligibleDays(lastDonationIso: string, minDays: number) {
  const days = daysSince(lastDonationIso);
  if (days === null) return false;
  return days >= minDays;
}

function badge(label: string, tone: "green" | "amber" | "rose") {
  const cls =
    tone === "green"
      ? "bg-emerald-500/10 text-emerald-800 border-emerald-200"
      : tone === "amber"
        ? "bg-amber-500/10 text-amber-900 border-amber-200"
        : "bg-rose-500/10 text-rose-800 border-rose-200";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
  const [canUpdateEmergencyStatus, setCanUpdateEmergencyStatus] = useState(false);
  const [canDeleteEmergency, setCanDeleteEmergency] = useState(false);
  const [canResendEmergencyNotify, setCanResendEmergencyNotify] = useState(false);
  const [canBulkExpireOpenEmergencies, setCanBulkExpireOpenEmergencies] = useState(false);
  const [canSendMailjetTestEmail, setCanSendMailjetTestEmail] = useState(false);
  const [canPreviewEmergencyNotifications, setCanPreviewEmergencyNotifications] = useState(false);
  const [canViewSystemHealth, setCanViewSystemHealth] = useState(false);
  const [canManageAdmins, setCanManageAdmins] = useState(false);
  const [canEditSiteSettings, setCanEditSiteSettings] = useState(false);
  const [canViewDonorLookup, setCanViewDonorLookup] = useState(false);
  const [canViewDuplicateContacts, setCanViewDuplicateContacts] = useState(false);
  const [canViewAuditLog, setCanViewAuditLog] = useState(false);
  const [canEditEmailTemplates, setCanEditEmailTemplates] = useState(false);
  const [canBroadcast, setCanBroadcast] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stats, setStats] = useState<{
    donorsTotal: number | null;
    donorsPending: number | null;
    donorsVerified: number | null;
    donorsRejected: number | null;
    emergenciesTotal: number | null;
    emergenciesOpen: number | null;
    emergenciesInProgress: number | null;
    emergenciesFulfilled: number | null;
    emergenciesExpired: number | null;
    emergenciesCancelled: number | null;
    emergenciesLast7Days: number | null;
  }>({
    donorsTotal: null,
    donorsPending: null,
    donorsVerified: null,
    donorsRejected: null,
    emergenciesTotal: null,
    emergenciesOpen: null,
    emergenciesInProgress: null,
    emergenciesFulfilled: null,
    emergenciesExpired: null,
    emergenciesCancelled: null,
    emergenciesLast7Days: null,
  });

  const [recent, setRecent] = useState<RecentReviewRow[]>([]);
  const [activeDonors, setActiveDonors] = useState<ActiveDonorRow[]>([]);
  const [emergencies, setEmergencies] = useState<EmergencyAdminRow[]>([]);
  const [activeQuery, setActiveQuery] = useState("");
  const [eligibilityFilter, setEligibilityFilter] = useState<
    "all" | "eligible" | "recent90"
  >("all");
  const [emergencyQuery, setEmergencyQuery] = useState("");
  const [emergencyStatusFilter, setEmergencyStatusFilter] = useState<
    "all" | "open" | "in_progress" | "fulfilled" | "expired" | "cancelled"
  >("all");
  const [emergencyEscalationFilter, setEmergencyEscalationFilter] = useState<
    "all" | "escalated"
  >("all");
  const [updatingEmergencyId, setUpdatingEmergencyId] = useState<string | null>(
    null,
  );
  const [activeDistrictFilter, setActiveDistrictFilter] = useState("all");
  const [emergencyDistrictFilter, setEmergencyDistrictFilter] = useState("all");
  const [prefs, setPrefs] = useState<AdminUiPrefs>({
    eligibilityDays: 90,
    activeRowsLimit: 60,
    emergencyRowsLimit: 80,
  });
  const [superHealth, setSuperHealth] = useState<{
    mailjetConfigured: boolean;
    userEmailFailures24h: number;
    openEmergencies: number;
    emergencyNotifySendFailures24h: number;
    escalatedOpenEmergencies: number;
    oldestOpenAgeMinutes: number | null;
  } | null>(null);
  const [resendingEmergencyId, setResendingEmergencyId] = useState<string | null>(
    null,
  );
  const [updatingTrustedDonorId, setUpdatingTrustedDonorId] = useState<string | null>(
    null,
  );

  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailBusy, setTestEmailBusy] = useState(false);
  const [testEmailMsg, setTestEmailMsg] = useState<string | null>(null);

  const [previewRequestId, setPreviewRequestId] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<{
    eligibleDonors: number;
    matchedWithEmail: number;
    withoutEmail: number;
    uniqueRecipientsCount: number;
    sampleRecipients: Array<{ donor_user_id: string; donor_email_masked: string }>;
  } | null>(null);
  const emergencyControlRef = useRef<HTMLDivElement | null>(null);

  const cards: Stat[] = useMemo(
    () => [
      {
        label: "Total donors",
        value: stats.donorsTotal,
        hint: "All donor profiles (verified + pending + rejected).",
      },
      {
        label: "Pending approvals",
        value: stats.donorsPending,
        hint: "Submitted but not verified yet.",
      },
      {
        label: "Verified donors",
        value: stats.donorsVerified,
        hint: "Visible in search (subject to 90-day rule).",
      },
      {
        label: "Rejected",
        value: stats.donorsRejected,
        hint: "Rejected with reason.",
      },
      {
        label: "Emergency requests",
        value: stats.emergenciesTotal,
        hint: "Total requests posted.",
      },
    ],
    [stats],
  );

  /** Defaults match cron env EMERGENCY_ESCALATE_* (see /api/cron/emergency-sla). */
  const OPEN_SLA_MIN = 30;
  const VERIFY_SLA_MIN = 20;

  const emergencySlaMetrics = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    let openBreaches = 0;
    let verifyBreaches = 0;
    let escalatedInSample = 0;
    const verifyDeltasMs: number[] = [];

    for (const e of emergencies) {
      const created = new Date(e.created_at).getTime();
      if (Number.isNaN(created)) continue;
      const ageMin = (now - created) / (60 * 1000);
      const vs = (e.verified_status ?? "pending").toLowerCase();
      if (e.status === "open" && ageMin > OPEN_SLA_MIN) openBreaches += 1;
      if (vs !== "verified" && ageMin > VERIFY_SLA_MIN) verifyBreaches += 1;
      if (e.escalated_at) escalatedInSample += 1;

      const vat = e.verified_at;
      if (vat && created >= sevenDaysAgo) {
        const v = new Date(vat).getTime();
        if (!Number.isNaN(v) && v >= created) verifyDeltasMs.push(v - created);
      }
    }

    let medianVerifyMs: number | null = null;
    if (verifyDeltasMs.length > 0) {
      verifyDeltasMs.sort((a, b) => a - b);
      const mid = Math.floor(verifyDeltasMs.length / 2);
      medianVerifyMs =
        verifyDeltasMs.length % 2 === 0
          ? (verifyDeltasMs[mid - 1]! + verifyDeltasMs[mid]!) / 2
          : verifyDeltasMs[mid]!;
    }

    function fmtDur(ms: number) {
      if (ms < 60 * 1000) return `${Math.round(ms / 1000)}s`;
      if (ms < 60 * 60 * 1000) return `${Math.round(ms / (60 * 1000))}m`;
      return `${(ms / (60 * 60 * 1000)).toFixed(1)}h`;
    }

    return {
      openBreaches,
      verifyBreaches,
      escalatedInSample,
      medianVerifyLabel: medianVerifyMs === null ? null : fmtDur(medianVerifyMs),
      verifySampleCount: verifyDeltasMs.length,
    };
  }, [emergencies]);

  async function load() {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
      );
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const { data: isAdminData, error: adminErr } = await supabase.rpc("is_admin");
    if (adminErr) {
      setError(adminErr.message);
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const ok = Boolean(isAdminData);
    setIsAdmin(ok);
    if (!ok) {
      setLoading(false);
      return;
    }
    const { data: superAdminData } = await supabase.rpc("is_super_admin");
    setIsSuperAdmin(Boolean(superAdminData));

    const [
      updateEmergencyStatusP,
      deleteEmergencyP,
      resendEmergencyNotifyP,
      bulkExpireOpenEmergenciesP,
      sendMailjetTestEmailP,
      previewEmergencyNotificationsP,
      viewSystemHealthP,
      manageAdminsP,
      editSiteSettingsP,
      viewDonorLookupP,
      viewDuplicateContactsP,
      viewAuditLogP,
      editEmailTemplatesP,
      broadcastP,
    ] = await Promise.all([
      supabase.rpc("admin_can", { action: "update_emergency_status" }),
      supabase.rpc("admin_can", { action: "delete_emergency" }),
      supabase.rpc("admin_can", { action: "resend_emergency_notify" }),
      supabase.rpc("admin_can", { action: "bulk_expire_open_emergencies" }),
      supabase.rpc("admin_can", { action: "send_mailjet_test_email" }),
      supabase.rpc("admin_can", { action: "preview_emergency_notifications" }),
      supabase.rpc("admin_can", { action: "view_system_health" }),
      supabase.rpc("admin_can", { action: "manage_admins" }),
      supabase.rpc("admin_can", { action: "edit_site_settings" }),
      supabase.rpc("admin_can", { action: "view_donor_lookup" }),
      supabase.rpc("admin_can", { action: "view_duplicate_contacts" }),
      supabase.rpc("admin_can", { action: "view_audit_log" }),
      supabase.rpc("admin_can", { action: "edit_email_templates" }),
      supabase.rpc("admin_can", { action: "broadcast" }),
    ]);

    setCanUpdateEmergencyStatus(Boolean(updateEmergencyStatusP.data));
    setCanDeleteEmergency(Boolean(deleteEmergencyP.data));
    setCanResendEmergencyNotify(Boolean(resendEmergencyNotifyP.data));
    setCanBulkExpireOpenEmergencies(Boolean(bulkExpireOpenEmergenciesP.data));
    setCanSendMailjetTestEmail(Boolean(sendMailjetTestEmailP.data));
    setCanPreviewEmergencyNotifications(Boolean(previewEmergencyNotificationsP.data));
    setCanViewSystemHealth(Boolean(viewSystemHealthP.data));
    setCanManageAdmins(Boolean(manageAdminsP.data));
    setCanEditSiteSettings(Boolean(editSiteSettingsP.data));
    setCanViewDonorLookup(Boolean(viewDonorLookupP.data));
    setCanViewDuplicateContacts(Boolean(viewDuplicateContactsP.data));
    setCanViewAuditLog(Boolean(viewAuditLogP.data));
    setCanEditEmailTemplates(Boolean(editEmailTemplatesP.data));
    setCanBroadcast(Boolean(broadcastP.data));

    setError(null);

    const donorsTotalP = supabase
      .from("donors")
      .select("user_id", { count: "exact", head: true });

    const donorsPendingP = supabase
      .from("donors")
      .select("user_id", { count: "exact", head: true })
      .eq("id_card_verified", false)
      .is("rejection_reason", null);

    const donorsVerifiedP = supabase
      .from("donors")
      .select("user_id", { count: "exact", head: true })
      .eq("id_card_verified", true);

    const donorsRejectedP = supabase
      .from("donors")
      .select("user_id", { count: "exact", head: true })
      .not("rejection_reason", "is", null);

    const emergenciesTotalP = supabase
      .from("emergency_requests")
      .select("request_id", { count: "exact", head: true });
    const emergenciesOpenP = supabase
      .from("emergency_requests")
      .select("request_id", { count: "exact", head: true })
      .eq("status", "open");
    const emergenciesInProgressP = supabase
      .from("emergency_requests")
      .select("request_id", { count: "exact", head: true })
      .eq("status", "in_progress");
    const emergenciesFulfilledP = supabase
      .from("emergency_requests")
      .select("request_id", { count: "exact", head: true })
      .eq("status", "fulfilled");
    const emergenciesExpiredP = supabase
      .from("emergency_requests")
      .select("request_id", { count: "exact", head: true })
      .eq("status", "expired");
    const emergenciesCancelledP = supabase
      .from("emergency_requests")
      .select("request_id", { count: "exact", head: true })
      .eq("status", "cancelled");
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const last7Iso = sevenDaysAgo.toISOString();
    const emergenciesLast7DaysP = supabase
      .from("emergency_requests")
      .select("request_id", { count: "exact", head: true })
      .gte("created_at", last7Iso);

    const recentP = supabase
      .from("donors")
      .select(
        "user_id,name,blood_group,district,block,panchayat,id_card_verified,reviewed_at,rejection_reason",
      )
      .not("reviewed_at", "is", null)
      .order("reviewed_at", { ascending: false })
      .limit(8);

    // Active donors = verified donors (admin view).
    const activeDonorsP = supabase
      .from("donors")
      .select(
        "user_id,name,blood_group,district,block,panchayat,village,last_donation_date,contact_number,reviewed_at,is_trusted",
      )
      .eq("id_card_verified", true)
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .limit(200);

    const emergenciesListP = supabase
      .from("emergency_requests")
      .select(
        "request_id,blood_group,district,block,panchayat,patient_name,request_details,contact_number,status,created_at,verified_status,verified_note,verified_at,hospital_user_id,escalated_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);

    const [
      donorsTotalR,
      donorsPendingR,
      donorsVerifiedR,
      donorsRejectedR,
      emergenciesTotalR,
      emergenciesOpenR,
      emergenciesInProgressR,
      emergenciesFulfilledR,
      emergenciesExpiredR,
      emergenciesCancelledR,
      emergenciesLast7DaysR,
      recentR,
      activeDonorsR,
      emergenciesListR,
    ] = await Promise.all([
      donorsTotalP,
      donorsPendingP,
      donorsVerifiedP,
      donorsRejectedP,
      emergenciesTotalP,
      emergenciesOpenP,
      emergenciesInProgressP,
      emergenciesFulfilledP,
      emergenciesExpiredP,
      emergenciesCancelledP,
      emergenciesLast7DaysP,
      recentP,
      activeDonorsP,
      emergenciesListP,
    ]);

    const firstErr =
      donorsTotalR.error ??
      donorsPendingR.error ??
      donorsVerifiedR.error ??
      donorsRejectedR.error ??
      emergenciesTotalR.error ??
      emergenciesOpenR.error ??
      emergenciesInProgressR.error ??
      emergenciesFulfilledR.error ??
      emergenciesExpiredR.error ??
      emergenciesCancelledR.error ??
      emergenciesLast7DaysR.error ??
      recentR.error ??
      activeDonorsR.error ??
      emergenciesListR.error;

    if (firstErr) {
      setError(firstErr.message);
      setLoading(false);
      return;
    }

    setStats({
      donorsTotal: donorsTotalR.count ?? 0,
      donorsPending: donorsPendingR.count ?? 0,
      donorsVerified: donorsVerifiedR.count ?? 0,
      donorsRejected: donorsRejectedR.count ?? 0,
      emergenciesTotal: emergenciesTotalR.count ?? 0,
      emergenciesOpen: emergenciesOpenR.count ?? 0,
      emergenciesInProgress: emergenciesInProgressR.count ?? 0,
      emergenciesFulfilled: emergenciesFulfilledR.count ?? 0,
      emergenciesExpired: emergenciesExpiredR.count ?? 0,
      emergenciesCancelled: emergenciesCancelledR.count ?? 0,
      emergenciesLast7Days: emergenciesLast7DaysR.count ?? 0,
    });

    setRecent(((recentR.data as RecentReviewRow[]) ?? []).slice(0, 8));
    setActiveDonors((activeDonorsR.data as ActiveDonorRow[]) ?? []);
    setEmergencies((emergenciesListR.data as EmergencyAdminRow[]) ?? []);
    setLoading(false);
  }

  function emergencyBadge(status: EmergencyAdminRow["status"]) {
    const s = (status ?? "open").toLowerCase();
    if (s === "open") return badge("Open", "rose");
    if (s === "in_progress") return badge("In progress", "amber");
    if (s === "fulfilled") return badge("Fulfilled", "green");
    if (s === "expired") {
      return (
        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">
          Expired
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700">
        Cancelled
      </span>
    );
  }

  function verificationBadge(vs?: string | null) {
    const s = (vs ?? "pending").toLowerCase();
    if (s === "verified") return badge("Verified", "green");
    if (s === "suspected_spam") return badge("Suspected spam", "rose");
    return badge("Pending verify", "amber");
  }

  async function onUpdateEmergencyStatus(
    requestId: string,
    nextStatus: EmergencyAdminRow["status"],
  ) {
    if (!canUpdateEmergencyStatus) {
      setError("You do not have permission to update emergency status.");
      return;
    }
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    setUpdatingEmergencyId(requestId);
    setError(null);
    const { error: updErr } = await supabase
      .from("emergency_requests")
      .update({ status: nextStatus })
      .eq("request_id", requestId);
    setUpdatingEmergencyId(null);

    if (updErr) {
      setError(updErr.message);
      return;
    }
    await load();
  }

  async function onSetEmergencyVerification(
    requestId: string,
    next: "verified" | "suspected_spam",
  ) {
    if (!canUpdateEmergencyStatus) {
      setError("You do not have permission to verify emergencies.");
      return;
    }
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user ?? null;
    if (!user) {
      setError("Please sign in again.");
      return;
    }

    const note = window.prompt(
      next === "verified"
        ? "Verification note (optional):"
        : "Why suspected spam? (optional):",
      next === "verified" ? "Verified by admin." : "Duplicate / suspicious content.",
    );
    if (note === null) return;

    setUpdatingEmergencyId(requestId);
    setError(null);
    const { error: updErr } = await supabase
      .from("emergency_requests")
      .update({
        verified_status: next,
        verified_by: user.id,
        verified_at: new Date().toISOString(),
        verified_note: note.trim() ? note.trim() : null,
      })
      .eq("request_id", requestId);
    setUpdatingEmergencyId(null);

    if (updErr) {
      setError(updErr.message);
      return;
    }
    await load();
  }

  async function onDeleteEmergency(requestId: string) {
    if (!canDeleteEmergency) {
      setError("You do not have permission to delete emergency requests.");
      return;
    }
    const ok = window.confirm("Delete this emergency request permanently?");
    if (!ok) return;
    try {
      setError(null);
      await callAdminApi("delete-emergency", { request_id: requestId });
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete emergency.";
      setError(msg);
    }
  }

  async function onResendEmergencyNotify(requestId: string) {
    if (!canResendEmergencyNotify) {
      setError("You do not have permission to re-notify donors.");
      return;
    }
    const ok = window.confirm(
      "Re-run donor email notifications for this emergency? (Rate-limited: once per hour per request.)",
    );
    if (!ok) return;
    try {
      setError(null);
      setResendingEmergencyId(requestId);
      await callAdminApi("resend-emergency-notify", { request_id: requestId });
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Re-notify failed.";
      setError(msg);
    } finally {
      setResendingEmergencyId(null);
    }
  }

  async function onSetDonorTrusted(donorUserId: string, nextTrusted: boolean) {
    if (!isSuperAdmin) {
      setError("Only super admin can update donor trust bridge.");
      return;
    }
    setError(null);
    setUpdatingTrustedDonorId(donorUserId);
    try {
      await callAdminApi<{ ok?: boolean }>("trust-donor", {
        donor_user_id: donorUserId,
        is_trusted: nextTrusted,
      });
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update donor trust bridge.";
      setError(msg);
    } finally {
      setUpdatingTrustedDonorId(null);
    }
  }

  async function onSendMailjetTestEmail() {
    if (!canSendMailjetTestEmail) {
      setError("You do not have permission to run Mailjet tests.");
      return;
    }
    const toEmail = testEmailTo.trim();
    if (!toEmail) {
      setTestEmailMsg("Please enter an email address.");
      return;
    }

    setTestEmailBusy(true);
    setTestEmailMsg(null);
    setError(null);
    try {
      await callAdminApi("send-mailjet-test-email", { to_email: toEmail });
      setTestEmailMsg("Test email sent (check inbox).");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Test email failed.";
      setTestEmailMsg(msg);
    } finally {
      setTestEmailBusy(false);
    }
  }

  async function onPreviewEmergencyNotification() {
    if (!canPreviewEmergencyNotifications) {
      setError("You do not have permission to preview emergency notifications.");
      return;
    }
    const rid = previewRequestId.trim();
    if (!rid) {
      setPreviewError("Please enter a request_id (UUID).");
      return;
    }

    setPreviewBusy(true);
    setPreviewError(null);
    setPreviewData(null);
    try {
      const res = await callAdminApi<{
        eligibleDonors: number;
        matchedWithEmail: number;
        withoutEmail: number;
        uniqueRecipientsCount: number;
        sampleRecipients: Array<{ donor_user_id: string; donor_email_masked: string }>;
      }>("emergency-notification-preview", { request_id: rid });

      setPreviewData({
        eligibleDonors: res.eligibleDonors ?? 0,
        matchedWithEmail: res.matchedWithEmail ?? 0,
        withoutEmail: res.withoutEmail ?? 0,
        uniqueRecipientsCount: res.uniqueRecipientsCount ?? 0,
        sampleRecipients: (res.sampleRecipients ?? []).map((x) => ({
          donor_user_id: x.donor_user_id,
          donor_email_masked: x.donor_email_masked,
        })),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Preview failed.";
      setPreviewError(msg);
    } finally {
      setPreviewBusy(false);
    }
  }

  /** Next.js API routes under /api/admin/* (service role on server). */
  async function callAdminApi<T>(
    routeName: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const supabase = getSupabaseOrNull();
    if (!supabase) throw new Error("Supabase is not configured.");

    const apiPath = `/api/admin/${routeName}`;
    const invoke = async (token: string) =>
      fetch(apiPath, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

    const getTokenOrThrow = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Missing access token. Please sign in again.");
      return token;
    };

    let accessToken = await getTokenOrThrow();
    let resp = await invoke(accessToken);

    const text = await resp.text();
    let json: { error?: string; ok?: boolean } = {};
    try {
      json = (text ? JSON.parse(text) : {}) as { error?: string; ok?: boolean };
    } catch {
      json = {};
    }

    if (!resp.ok) {
      let details =
        json?.error ??
        (text && text.length < 500 ? text : "") ??
        `HTTP ${resp.status}`;

      const msg = details || `Admin API ${routeName} failed.`;
      if (resp.status === 401 && msg.toLowerCase().includes("invalid jwt")) {
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
        const nextToken = refreshed.session?.access_token;
        if (!refreshErr && nextToken) {
          accessToken = nextToken;
          resp = await invoke(accessToken);
          const retryText = await resp.text();
          let retryJson: { error?: string; ok?: boolean } = {};
          try {
            retryJson = (retryText ? JSON.parse(retryText) : {}) as {
              error?: string;
              ok?: boolean;
            };
          } catch {
            retryJson = {};
          }

          if (resp.ok) {
            return (retryJson as unknown as T) ?? ({} as T);
          }

          details =
            retryJson?.error ??
            (retryText && retryText.length < 500 ? retryText : "") ??
            `HTTP ${resp.status}`;
          throw new Error(details || "Session expired / Invalid JWT. Please sign in again.");
        }

        throw new Error("Session expired / Invalid JWT. Please sign in again.");
      }
      throw new Error(msg);
    }

    return (json as unknown as T) ?? ({} as T);
  }

  /** Supabase Edge Functions (e.g. bulk-expire) — not deployed for all admin actions. */
  async function callSupabaseEdgeFunction<T>(
    functionName: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const supabase = getSupabaseOrNull();
    if (!supabase) throw new Error("Supabase is not configured.");

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL.");

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (!accessToken) throw new Error("Missing access token. Please sign in again.");

    const resp = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    type EdgeFnJson = { error?: string; ok?: boolean; updated?: number };
    const json = (await resp.json().catch(() => ({}))) as EdgeFnJson;
    if (!resp.ok) {
      throw new Error(json?.error ?? `Edge function ${functionName} failed.`);
    }
    return json as unknown as T;
  }

  async function onAutoExpireOldOpen(daysOld: number) {
    if (!canBulkExpireOpenEmergencies) {
      setError("You do not have permission to run bulk-expire.");
      return;
    }
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setError("Supabase is not configured.");
      return;
    }
    const ok = window.confirm(
      `Mark all OPEN emergency requests older than ${daysOld} days as EXPIRED?`,
    );
    if (!ok) return;

    setError(null);
    try {
      const res = await callSupabaseEdgeFunction<{ ok?: boolean; updated?: number }>(
        "bulk-expire-open-emergencies",
        { days_old: daysOld },
      );
      await load();
      if ((res.updated ?? 0) === 0) {
        setError("No open emergency requests were old enough to expire.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bulk action failed.";
      setError(msg);
    }
  }

  function buildFilteredEmergenciesList(): EmergencyAdminRow[] {
    const q = emergencyQuery.trim().toLowerCase();
    return emergencies
      .filter((e) =>
        emergencyStatusFilter === "all" ? true : (e.status ?? "open") === emergencyStatusFilter,
      )
      .filter((e) =>
        emergencyEscalationFilter === "escalated" ? Boolean(e.escalated_at) : true,
      )
      .filter((e) =>
        emergencyDistrictFilter === "all" ? true : e.district === emergencyDistrictFilter,
      )
      .filter((e) => {
        if (!q) return true;
        const hay =
          `${e.blood_group} ${e.district} ${e.block} ${e.panchayat} ${e.patient_name ?? ""} ${e.request_details}`.toLowerCase();
        return hay.includes(q);
      });
  }

  function onExportEmergenciesCsv() {
    const filtered = buildFilteredEmergenciesList().slice(0, 2000);
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
      "request_details",
    ];
    const csvLines = [header.join(",")];
    for (const e of filtered) {
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
        e.request_details,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      csvLines.push(vals.join(","));
    }
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `emergency-requests-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function focusEscalatedOpenEmergencies() {
    setEmergencyDistrictFilter("all");
    setEmergencyStatusFilter("open");
    setEmergencyEscalationFilter("escalated");
    setEmergencyQuery("");
    emergencyControlRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearEmergencyTriageFilters() {
    setEmergencyDistrictFilter("all");
    setEmergencyStatusFilter("all");
    setEmergencyEscalationFilter("all");
    setEmergencyQuery("");
  }

  function onExportActiveDonorsCsv() {
    const rows = activeDonors;
    const header = [
      "name",
      "blood_group",
      "district",
      "block",
      "panchayat",
      "village",
      "last_donation_date",
      "contact_number",
    ];
    const csvLines = [header.join(",")];
    for (const d of rows) {
      const vals = [
        d.name,
        d.blood_group,
        d.district,
        d.block,
        d.panchayat,
        d.village ?? "",
        d.last_donation_date,
        d.contact_number,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
      csvLines.push(vals.join(","));
    }
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `active-donors-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    queueMicrotask(() => {
      setLoading(true);
      void load();
    });
  }, []);

  useEffect(() => {
    if (!isAdmin || !canViewSystemHealth) {
      setSuperHealth(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = getSupabaseOrNull();
      if (!supabase) return;
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;
      const resp = await fetch("/api/admin/health", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        mailjetConfigured?: boolean;
        userEmailFailures24h?: number;
        openEmergencies?: number;
        emergencyNotifySendFailures24h?: number;
        escalatedOpenEmergencies?: number;
        oldestOpenAgeMinutes?: number | null;
      };
      if (cancelled || !resp.ok) return;
      if (json.ok) {
        setSuperHealth({
          mailjetConfigured: Boolean(json.mailjetConfigured),
          userEmailFailures24h: json.userEmailFailures24h ?? 0,
          openEmergencies: json.openEmergencies ?? 0,
          emergencyNotifySendFailures24h: json.emergencyNotifySendFailures24h ?? 0,
          escalatedOpenEmergencies: json.escalatedOpenEmergencies ?? 0,
          oldestOpenAgeMinutes:
            typeof json.oldestOpenAgeMinutes === "number" ? json.oldestOpenAgeMinutes : null,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, canViewSystemHealth, loading, stats.emergenciesOpen]);

  useEffect(() => {
    (async () => {
      // 1) Try Supabase persisted prefs (per admin user).
      try {
        const supabase = getSupabaseOrNull();
        const session = await supabase?.auth.getSession();
        const uid = session?.data.session?.user?.id;
        if (supabase && uid) {
          const { data } = await supabase
            .from("admin_ui_prefs")
            .select(
              "user_id,eligibility_days,active_rows_limit,emergency_rows_limit",
            )
            .eq("user_id", uid)
            .maybeSingle();
          if (data) {
            const row = data as {
              eligibility_days: number;
              active_rows_limit: number;
              emergency_rows_limit: number;
            };
            queueMicrotask(() => {
              setPrefs({
                eligibilityDays: Math.max(30, Math.min(180, row.eligibility_days ?? 90)),
                activeRowsLimit: Math.max(20, Math.min(200, row.active_rows_limit ?? 60)),
                emergencyRowsLimit: Math.max(
                  20,
                  Math.min(200, row.emergency_rows_limit ?? 80),
                ),
              });
            });
            return;
          }
        }
      } catch {
        // ignore DB errors; fallback to localStorage below
      }

      // 2) Fallback to localStorage.
      try {
        const raw = window.localStorage.getItem("admin-ui-prefs-v1");
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<AdminUiPrefs>;
        queueMicrotask(() => {
          setPrefs((prev) => ({
            eligibilityDays:
              typeof parsed.eligibilityDays === "number"
                ? Math.max(30, Math.min(180, parsed.eligibilityDays))
                : prev.eligibilityDays,
            activeRowsLimit:
              typeof parsed.activeRowsLimit === "number"
                ? Math.max(20, Math.min(200, parsed.activeRowsLimit))
                : prev.activeRowsLimit,
            emergencyRowsLimit:
              typeof parsed.emergencyRowsLimit === "number"
                ? Math.max(20, Math.min(200, parsed.emergencyRowsLimit))
                : prev.emergencyRowsLimit,
          }));
        });
      } catch {
        // ignore malformed local storage
      }
    })();
  }, []);

  function savePrefs(next: AdminUiPrefs) {
    setPrefs(next);
    window.localStorage.setItem("admin-ui-prefs-v1", JSON.stringify(next));

    // Best-effort persist to Supabase. Non-blocking for the UI.
    void (async () => {
      try {
        const supabase = getSupabaseOrNull();
        if (!supabase) return;
        const session = await supabase.auth.getSession();
        const uid = session.data.session?.user?.id;
        if (!uid) return;

        await supabase.from("admin_ui_prefs").upsert(
          {
            user_id: uid,
            eligibility_days: next.eligibilityDays,
            active_rows_limit: next.activeRowsLimit,
            emergency_rows_limit: next.emergencyRowsLimit,
          },
          { onConflict: "user_id" },
        );
      } catch {
        // ignore
      }
    })();
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          Loading...
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
            Sign in with an admin account to view dashboard and stats.
          </p>
          <div className="mt-4">
            <Link
              className="text-sm font-semibold underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
              href="/admin/sign-in"
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
            <h1 className="text-xl font-semibold">Admin Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-600">
              Quick stats, approvals, and recent activity.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <>
              {isSuperAdmin || canManageAdmins ? (
                <Link
                  href="/admin/admins"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
                >
                  Manage admins
                </Link>
              ) : null}
                {isSuperAdmin || canBroadcast ? (
                  <Link
                    href="/admin/broadcast"
                    className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
                  >
                    Broadcast
                  </Link>
                ) : null}
              {canEditSiteSettings ? (
                <Link
                  href="/admin/settings"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
                >
                  Site settings
                </Link>
              ) : null}
              {canViewDonorLookup ? (
                <Link
                  href="/admin/donor-lookup"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
                >
                  Donor lookup
                </Link>
              ) : null}
              {canViewDuplicateContacts ? (
                <Link
                  href="/admin/duplicates"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
                >
                  Duplicates
                </Link>
              ) : null}
              {canViewAuditLog ? (
                <Link
                  href="/admin/audit-log"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
                >
                  Audit log
                </Link>
              ) : null}
              {canEditEmailTemplates ? (
                <Link
                  href="/admin/email-templates"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
                >
                  Email templates
                </Link>
              ) : null}
            </>
            <Link
              href="/admin/donors"
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105"
            >
              Verify donors
            </Link>
            <Link
              href="/change-password"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
            >
              Change password
            </Link>
            <Link
              href="/emergency"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
            >
              Emergency feed
            </Link>
            <Link
              href="/admin/emergency-logs"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
            >
              Notification logs
            </Link>
            <Link
              href="/admin/email-logs"
              className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
            >
              Email audit
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
            {isSuperAdmin ? (
              <>
                <button
                  type="button"
                  onClick={onExportActiveDonorsCsv}
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
                >
                  Export active donors CSV
                </button>
                <button
                  type="button"
                  onClick={onExportEmergenciesCsv}
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
                >
                  Export emergencies CSV
                </button>
              </>
            ) : (
              <span className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold text-zinc-500">
                Export CSV (super admin only)
              </span>
            )}
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {canViewSystemHealth && superHealth ? (
          <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-zinc-800">System health</div>
              {superHealth.escalatedOpenEmergencies > 0 ? (
                <button
                  type="button"
                  onClick={focusEscalatedOpenEmergencies}
                  className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-900 hover:bg-violet-100"
                >
                  View escalated open now
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-zinc-700">
              <span>
                Mailjet:{" "}
                <b className={superHealth.mailjetConfigured ? "text-emerald-800" : "text-amber-800"}>
                  {superHealth.mailjetConfigured ? "configured" : "not configured"}
                </b>
              </span>
              <span>
                Open emergencies: <b>{superHealth.openEmergencies}</b>
              </span>
              <span>
                Escalated open:{" "}
                <b
                  className={
                    superHealth.escalatedOpenEmergencies > 0 ? "text-violet-800" : "text-zinc-800"
                  }
                >
                  {superHealth.escalatedOpenEmergencies}
                </b>
              </span>
              <span>
                Oldest open age:{" "}
                <b
                  className={
                    (superHealth.oldestOpenAgeMinutes ?? 0) >= 120
                      ? "text-rose-800"
                      : (superHealth.oldestOpenAgeMinutes ?? 0) >= 60
                        ? "text-amber-800"
                        : "text-zinc-800"
                  }
                >
                  {superHealth.oldestOpenAgeMinutes === null
                    ? "—"
                    : `${superHealth.oldestOpenAgeMinutes}m`}
                </b>
              </span>
              <span>
                User email failures (24h):{" "}
                <b
                  className={
                    superHealth.userEmailFailures24h > 0 ? "text-rose-800" : "text-zinc-800"
                  }
                >
                  {superHealth.userEmailFailures24h}
                </b>
              </span>
              <span>
                Emergency notify failures (24h):{" "}
                <b
                  className={
                    superHealth.emergencyNotifySendFailures24h > 0
                      ? "text-rose-800"
                      : "text-zinc-800"
                  }
                >
                  {superHealth.emergencyNotifySendFailures24h}
                </b>
              </span>
            </div>
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {cards.map((c) => (
            <div
              key={c.label}
              className="rounded-2xl border border-zinc-200 bg-white/80 p-4 shadow-sm"
            >
              <div className="text-sm font-semibold text-zinc-900">{c.label}</div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="text-2xl font-bold tracking-tight">
                  {c.value === null ? "—" : formatCompact(c.value)}
                </div>
                <div className="h-8 w-14 rounded-lg bg-gradient-to-br from-rose-500/15 to-orange-500/10" />
              </div>
              {c.hint ? (
                <div className="mt-2 text-xs text-zinc-600">{c.hint}</div>
              ) : null}
            </div>
          ))}
        </div>

        <div
          ref={emergencyControlRef}
          className="mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-5 shadow-sm"
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Emergency analytics</h2>
              <p className="mt-1 text-xs text-zinc-600">
                Status breakdown and recent 7-day volume.
              </p>
            </div>
            <div className="text-xs text-zinc-600">
              Last 7 days:{" "}
              <span className="font-semibold">
                {stats.emergenciesLast7Days ?? 0}
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-red-200 bg-red-50/60 p-3">
              <div className="text-xs font-semibold text-red-700">Open</div>
              <div className="mt-1 text-xl font-bold text-red-800">
                {stats.emergenciesOpen ?? 0}
              </div>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3">
              <div className="text-xs font-semibold text-sky-700">In progress</div>
              <div className="mt-1 text-xl font-bold text-sky-800">
                {stats.emergenciesInProgress ?? 0}
              </div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
              <div className="text-xs font-semibold text-emerald-700">Fulfilled</div>
              <div className="mt-1 text-xl font-bold text-emerald-800">
                {stats.emergenciesFulfilled ?? 0}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3">
              <div className="text-xs font-semibold text-zinc-700">Expired</div>
              <div className="mt-1 text-xl font-bold text-zinc-800">
                {stats.emergenciesExpired ?? 0}
              </div>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3">
              <div className="text-xs font-semibold text-rose-700">Cancelled</div>
              <div className="mt-1 text-xl font-bold text-rose-800">
                {stats.emergenciesCancelled ?? 0}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-200/80 bg-amber-50/40 p-5 shadow-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-amber-950">Emergency SLA</h2>
              <p className="mt-1 text-xs text-zinc-700">
                Thresholds (defaults align with cron): open &gt; {OPEN_SLA_MIN}m · pending
                verification &gt; {VERIFY_SLA_MIN}m. Counts below use the most recent{" "}
                {emergencies.length} loaded requests (not full-table totals).
              </p>
            </div>
            <div className="text-xs text-zinc-600 sm:text-right">
              Auto-escalation:{" "}
              <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-[11px]">
                POST /blood/api/cron/emergency-sla
              </code>
              {" "}
              with header{" "}
              <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-[11px]">
                x-cron-secret
              </code>
              . Env:{" "}
              <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-[11px]">
                EMERGENCY_ESCALATE_OPEN_MINUTES
              </code>
              ,{" "}
              <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-[11px]">
                EMERGENCY_ESCALATE_VERIFY_PENDING_MINUTES
              </code>
              . When Mailjet is configured, super admins receive an alert email; optional{" "}
              <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-[11px]">
                EMERGENCY_SLA_EXTRA_NOTIFY_EMAILS
              </code>{" "}
              (comma-separated) or{" "}
              <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-[11px]">
                EMERGENCY_SLA_DISABLE_EMAIL_ALERTS=true
              </code>{" "}
              to turn off.
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-rose-200 bg-white/90 p-3">
              <div className="text-xs font-semibold text-rose-800">Open &gt; {OPEN_SLA_MIN}m</div>
              <div className="mt-1 text-xl font-bold text-rose-900">
                {emergencySlaMetrics.openBreaches}
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-white/90 p-3">
              <div className="text-xs font-semibold text-amber-900">
                Pending verify &gt; {VERIFY_SLA_MIN}m
              </div>
              <div className="mt-1 text-xl font-bold text-amber-950">
                {emergencySlaMetrics.verifyBreaches}
              </div>
            </div>
            <div className="rounded-xl border border-violet-200 bg-white/90 p-3">
              <div className="text-xs font-semibold text-violet-800">Escalated (sample)</div>
              <div className="mt-1 text-xl font-bold text-violet-950">
                {emergencySlaMetrics.escalatedInSample}
              </div>
            </div>
            <div className="rounded-xl border border-sky-200 bg-white/90 p-3">
              <div className="text-xs font-semibold text-sky-800">
                Median verify time (7d, sample)
              </div>
              <div className="mt-1 text-xl font-bold text-sky-950">
                {emergencySlaMetrics.medianVerifyLabel ?? "—"}
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">
                n={emergencySlaMetrics.verifySampleCount} verified in window
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white/80 p-5 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Recent reviews</h2>
                <p className="mt-1 text-xs text-zinc-600">
                  Latest approve/reject actions from admin dashboard.
                </p>
              </div>
              <Link
                href="/admin/donors"
                className="text-xs font-semibold underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
              >
                Open donors list
              </Link>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50">
                  <tr className="text-xs text-zinc-600">
                    <th className="px-3 py-2 font-semibold">Donor</th>
                    <th className="px-3 py-2 font-semibold">Location</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {recent.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-sm text-zinc-600" colSpan={3}>
                        No reviews yet.
                      </td>
                    </tr>
                  ) : (
                    recent.map((r) => (
                      <tr key={r.user_id} className="bg-white">
                        <td className="px-3 py-2">
                          <div className="font-semibold">{r.name}</div>
                          <div className="text-xs text-zinc-600">{r.blood_group}</div>
                        </td>
                        <td className="px-3 py-2 text-xs text-zinc-700">
                          {r.district} / {r.block} / {r.panchayat}
                        </td>
                        <td className="px-3 py-2">
                          {r.id_card_verified
                            ? badge("Approved", "green")
                            : r.rejection_reason
                              ? badge("Rejected", "rose")
                              : badge("Pending", "amber")}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white/80 p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Approval funnel</h2>
            <p className="mt-1 text-xs text-zinc-600">
              Snapshot of donor verification pipeline.
            </p>

            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">Pending</span>
                  <span className="text-zinc-700">
                    {stats.donorsPending === null ? "—" : stats.donorsPending}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-zinc-100">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-amber-500 to-rose-500"
                    style={{
                      width:
                        stats.donorsTotal && stats.donorsPending !== null
                          ? `${Math.min(
                              100,
                              Math.round((stats.donorsPending / Math.max(1, stats.donorsTotal)) * 100),
                            )}%`
                          : "0%",
                    }}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">Verified</span>
                  <span className="text-zinc-700">
                    {stats.donorsVerified === null ? "—" : stats.donorsVerified}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-zinc-100">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600"
                    style={{
                      width:
                        stats.donorsTotal && stats.donorsVerified !== null
                          ? `${Math.min(
                              100,
                              Math.round((stats.donorsVerified / Math.max(1, stats.donorsTotal)) * 100),
                            )}%`
                          : "0%",
                    }}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">Rejected</span>
                  <span className="text-zinc-700">
                    {stats.donorsRejected === null ? "—" : stats.donorsRejected}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-zinc-100">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-rose-500 to-red-600"
                    style={{
                      width:
                        stats.donorsTotal && stats.donorsRejected !== null
                          ? `${Math.min(
                              100,
                              Math.round((stats.donorsRejected / Math.max(1, stats.donorsTotal)) * 100),
                            )}%`
                          : "0%",
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
              Tip: approvals and rejections are recorded on the donor row via
              `reviewed_at` / `rejection_reason`.
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-5 shadow-sm">
          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="text-xs font-semibold text-zinc-700">Admin customization</div>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-zinc-600">
                Eligibility days
                <input
                  type="number"
                  min={30}
                  max={180}
                  value={prefs.eligibilityDays}
                  onChange={(e) =>
                    savePrefs({
                      ...prefs,
                      eligibilityDays: Math.max(
                        30,
                        Math.min(180, Number(e.target.value || 90)),
                      ),
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800"
                />
              </label>
              <label className="text-xs text-zinc-600">
                Active donor rows
                <input
                  type="number"
                  min={20}
                  max={200}
                  value={prefs.activeRowsLimit}
                  onChange={(e) =>
                    savePrefs({
                      ...prefs,
                      activeRowsLimit: Math.max(
                        20,
                        Math.min(200, Number(e.target.value || 60)),
                      ),
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800"
                />
              </label>
              <label className="text-xs text-zinc-600">
                Emergency rows
                <input
                  type="number"
                  min={20}
                  max={200}
                  value={prefs.emergencyRowsLimit}
                  onChange={(e) =>
                    savePrefs({
                      ...prefs,
                      emergencyRowsLimit: Math.max(
                        20,
                        Math.min(200, Number(e.target.value || 80)),
                      ),
                    })
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-800"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Emergency control center</h2>
              <p className="mt-1 text-xs text-zinc-600">
                Search emergency requests and update their lifecycle status.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <select
                value={emergencyDistrictFilter}
                onChange={(e) => setEmergencyDistrictFilter(e.target.value)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                <option value="all">All districts</option>
                {Array.from(new Set(emergencies.map((x) => x.district)))
                  .sort((a, b) => a.localeCompare(b))
                  .map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
              </select>
              <select
                value={emergencyStatusFilter}
                onChange={(e) =>
                  setEmergencyStatusFilter(
                    e.target.value as
                      | "all"
                      | "open"
                      | "in_progress"
                      | "fulfilled"
                      | "expired"
                      | "cancelled",
                  )
                }
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="fulfilled">Fulfilled</option>
                <option value="expired">Expired</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                value={emergencyEscalationFilter}
                onChange={(e) =>
                  setEmergencyEscalationFilter(
                    e.target.value as "all" | "escalated",
                  )
                }
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                <option value="all">All escalation states</option>
                <option value="escalated">Escalated only</option>
              </select>
              <input
                value={emergencyQuery}
                onChange={(e) => setEmergencyQuery(e.target.value)}
                placeholder="Search patient, place, blood group"
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm sm:w-[320px]"
              />
              <button
                type="button"
                onClick={clearEmergencyTriageFilters}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
              >
                Clear triage filters
              </button>
              {canBulkExpireOpenEmergencies ? (
                <button
                  type="button"
                  onClick={() => void onAutoExpireOldOpen(2)}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
                >
                  Auto-expire open &gt;2 days
                </button>
              ) : (
                <span className="inline-flex items-center rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-500">
                  Bulk actions: permission required
                </span>
              )}
            </div>
          </div>

          {canSendMailjetTestEmail || canPreviewEmergencyNotifications ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="text-sm font-semibold text-zinc-700">
                  Mailjet test email
                </div>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={testEmailTo}
                    onChange={(e) => setTestEmailTo(e.target.value)}
                    placeholder="your email (e.g. admin@domain.com)"
                    className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={testEmailBusy || !testEmailTo.trim() || !canSendMailjetTestEmail}
                    onClick={() => void onSendMailjetTestEmail()}
                    className="rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {testEmailBusy ? "Sending..." : "Send test email"}
                  </button>
                </div>
                {testEmailMsg ? (
                  <div className="mt-2 text-xs text-zinc-600">{testEmailMsg}</div>
                ) : null}
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <div className="text-sm font-semibold text-zinc-700">
                  Emergency notification preview
                </div>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={previewRequestId}
                    onChange={(e) => setPreviewRequestId(e.target.value)}
                    placeholder="request_id (UUID)"
                    className="flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-mono"
                  />
                  <button
                    type="button"
                    disabled={previewBusy || !previewRequestId.trim() || !canPreviewEmergencyNotifications}
                    onClick={() => void onPreviewEmergencyNotification()}
                    className="rounded-xl border border-zinc-200 bg-white px-5 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    {previewBusy ? "Previewing..." : "Preview recipients"}
                  </button>
                </div>

                {previewError ? (
                  <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                    {previewError}
                  </div>
                ) : null}

                {previewData ? (
                  <div className="mt-3 space-y-2">
                    <div className="text-xs text-zinc-600">
                      Eligible donors: <b>{previewData.eligibleDonors}</b>
                      {"  "}·{"  "}
                      Matched with email: <b>{previewData.matchedWithEmail}</b>
                      {"  "}·{"  "}
                      Without email: <b>{previewData.withoutEmail}</b>
                      {"  "}·{"  "}
                      Unique recipients (dedup): <b>{previewData.uniqueRecipientsCount}</b>
                    </div>
                    {previewData.sampleRecipients.length > 0 ? (
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2">
                        <div className="text-xs font-semibold text-zinc-700">
                          Sample recipients
                        </div>
                        <div className="mt-1 grid gap-1">
                          {previewData.sampleRecipients.map((r) => (
                            <div
                              key={r.donor_user_id}
                              className="text-xs font-mono text-zinc-700"
                            >
                              {r.donor_email_masked} ({r.donor_user_id.slice(0, 8)}…)
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {(() => {
            const filtered = buildFilteredEmergenciesList().slice(0, prefs.emergencyRowsLimit);

            return (
              <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50">
                    <tr className="text-xs text-zinc-600">
                      <th className="px-3 py-2 font-semibold">Request</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Contact</th>
                      <th className="px-3 py-2 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y bg-white">
                    {filtered.length === 0 ? (
                      <tr>
                        <td className="px-3 py-3 text-sm text-zinc-600" colSpan={4}>
                          No emergency requests match this filter.
                        </td>
                      </tr>
                    ) : (
                      filtered.map((e) => (
                        <tr key={e.request_id}>
                          <td className="px-3 py-2">
                            <div className="font-semibold">
                              {e.blood_group} in {e.district}
                            </div>
                            <div className="text-xs text-zinc-600">
                              {e.block} / {e.panchayat}
                              {e.patient_name ? ` • Patient: ${e.patient_name}` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col gap-1">
                              <div className="flex flex-wrap items-center gap-2">
                                {emergencyBadge(e.status)}
                                {verificationBadge(e.verified_status)}
                                {e.escalated_at ? (
                                  <span className="inline-flex items-center rounded-full border border-violet-500/40 bg-violet-500/10 px-2 py-0.5 text-xs font-semibold text-violet-900">
                                    Escalated
                                  </span>
                                ) : null}
                              </div>
                              {e.verified_note ? (
                                <div className="text-xs text-zinc-600 line-clamp-2">
                                  Note: {e.verified_note}
                                </div>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <a
                              className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-red-600 to-rose-500 px-2.5 py-1.5 text-xs font-semibold text-white"
                              href={toWhatsAppLink(e.contact_number)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              WhatsApp
                            </a>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-2">
                              {canUpdateEmergencyStatus || canResendEmergencyNotify || canDeleteEmergency ? (
                                <>
                                  {canUpdateEmergencyStatus ? (
                                    <>
                                      {String(e.verified_status ?? "pending").toLowerCase() !== "verified" ? (
                                        <>
                                          <button
                                            type="button"
                                            disabled={updatingEmergencyId === e.request_id}
                                            onClick={() =>
                                              void onSetEmergencyVerification(e.request_id, "verified")
                                            }
                                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                                          >
                                            Verify (send allowed)
                                          </button>
                                          <button
                                            type="button"
                                            disabled={updatingEmergencyId === e.request_id}
                                            onClick={() =>
                                              void onSetEmergencyVerification(
                                                e.request_id,
                                                "suspected_spam",
                                              )
                                            }
                                            className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-900 hover:bg-rose-100 disabled:opacity-50"
                                          >
                                            Mark spam
                                          </button>
                                        </>
                                      ) : null}
                                      {(
                                        [
                                          "open",
                                          "in_progress",
                                          "fulfilled",
                                          "expired",
                                          "cancelled",
                                        ] as const
                                      ).map((s) => (
                                        <button
                                          key={s}
                                          type="button"
                                          disabled={
                                            updatingEmergencyId === e.request_id ||
                                            (e.status ?? "open") === s
                                          }
                                          onClick={() =>
                                            void onUpdateEmergencyStatus(e.request_id, s)
                                          }
                                          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                                        >
                                          {s}
                                        </button>
                                      ))}
                                    </>
                                  ) : null}
                                  {canResendEmergencyNotify ? (
                                    <button
                                      type="button"
                                      disabled={resendingEmergencyId === e.request_id}
                                      onClick={() => void onResendEmergencyNotify(e.request_id)}
                                      className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50"
                                    >
                                      {resendingEmergencyId === e.request_id
                                        ? "Re-notify…"
                                        : "Re-notify donors"}
                                    </button>
                                  ) : null}
                                  {canDeleteEmergency ? (
                                    <button
                                      type="button"
                                      onClick={() => void onDeleteEmergency(e.request_id)}
                                      className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-100"
                                    >
                                      Delete
                                    </button>
                                  ) : null}
                                </>
                              ) : (
                                <span className="inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-500">
                                  View only
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>

        <div className="mt-6 rounded-2xl border border-zinc-200 bg-white/80 p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Active donors (verified)</h2>
              <p className="mt-1 text-xs text-zinc-600">
                Search & filter donors. Eligibility is based on the 90-day rule.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEligibilityFilter("all")}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                    eligibilityFilter === "all"
                      ? "border-rose-200 bg-rose-50 text-rose-800"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setEligibilityFilter("eligible")}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                    eligibilityFilter === "eligible"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  Eligible (≥90 days)
                </button>
                <button
                  type="button"
                  onClick={() => setEligibilityFilter("recent90")}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                    eligibilityFilter === "recent90"
                      ? "border-amber-200 bg-amber-50 text-amber-900"
                      : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                  }`}
                >
                  Donated within 90 days
                </button>
              </div>

              <select
                value={activeDistrictFilter}
                onChange={(e) => setActiveDistrictFilter(e.target.value)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                <option value="all">All districts</option>
                {Array.from(new Set(activeDonors.map((x) => x.district)))
                  .sort((a, b) => a.localeCompare(b))
                  .map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
              </select>

              <input
                value={activeQuery}
                onChange={(e) => setActiveQuery(e.target.value)}
                placeholder="Search name / district / block / panchayat / village"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20 sm:w-[360px]"
              />
            </div>
          </div>

          {(() => {
            const q = activeQuery.trim().toLowerCase();
            const filtered = activeDonors
              .filter((d) => {
                const eligible = isEligibleDays(
                  d.last_donation_date,
                  prefs.eligibilityDays,
                );
                if (eligibilityFilter === "eligible" && !eligible) return false;
                if (eligibilityFilter === "recent90" && eligible) return false;
                return true;
              })
              .filter((d) =>
                activeDistrictFilter === "all" ? true : d.district === activeDistrictFilter,
              )
              .filter((d) => {
                if (!q) return true;
                const hay =
                  `${d.name} ${d.blood_group} ${d.district} ${d.block} ${d.panchayat} ${d.village ?? ""}`.toLowerCase();
                return hay.includes(q);
              })
              .slice(0, prefs.activeRowsLimit);

            const eligibleCount = activeDonors.filter((d) =>
              isEligibleDays(d.last_donation_date, prefs.eligibilityDays),
            ).length;
            const recent90Count = activeDonors.length - eligibleCount;
            const topDistricts = Object.entries(
              activeDonors.reduce<Record<string, number>>((acc, d) => {
                acc[d.district] = (acc[d.district] ?? 0) + 1;
                return acc;
              }, {}),
            )
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5);

            return (
              <>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
                  <div>
                    Showing <span className="font-semibold text-zinc-900">{filtered.length}</span>{" "}
                    of{" "}
                    <span className="font-semibold text-zinc-900">{activeDonors.length}</span>{" "}
                    verified donors.
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">
                      Eligible: {eligibleCount}
                    </span>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900">
                      Within 90 days: {recent90Count}
                    </span>
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-zinc-50">
                      <tr className="text-xs text-zinc-600">
                        <th className="px-3 py-2 font-semibold">Donor</th>
                        <th className="px-3 py-2 font-semibold">Location</th>
                        <th className="px-3 py-2 font-semibold">Last donation</th>
                        <th className="px-3 py-2 font-semibold">Eligibility</th>
                        <th className="px-3 py-2 font-semibold">Trust bridge</th>
                        <th className="px-3 py-2 font-semibold">Contact</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y bg-white">
                      {filtered.length === 0 ? (
                        <tr>
                          <td className="px-3 py-3 text-sm text-zinc-600" colSpan={6}>
                            No donors match this filter.
                          </td>
                        </tr>
                      ) : (
                        filtered.map((d) => {
                          const eligible = isEligibleDays(
                            d.last_donation_date,
                            prefs.eligibilityDays,
                          );
                          const days = daysSince(d.last_donation_date);
                          return (
                            <tr key={d.user_id}>
                              <td className="px-3 py-2">
                                <div className="font-semibold">{d.name}</div>
                                <div className="text-xs text-zinc-600">{d.blood_group}</div>
                              </td>
                              <td className="px-3 py-2 text-xs text-zinc-700">
                                {d.district} / {d.block} / {d.panchayat}
                                {d.village ? (
                                  <div className="text-[11px] text-zinc-500">
                                    Village: {d.village}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-xs text-zinc-700">
                                {d.last_donation_date}
                                {typeof days === "number" ? (
                                  <div className="text-[11px] text-zinc-500">{days} days ago</div>
                                ) : null}
                              </td>
                              <td className="px-3 py-2">
                                {eligible
                                  ? badge("Eligible", "green")
                                  : badge(`Not eligible (<${prefs.eligibilityDays}d)`, "amber")}
                              </td>
                              <td className="px-3 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  {Boolean(d.is_trusted)
                                    ? badge("Trusted", "green")
                                    : badge("Normal", "amber")}
                                  {isSuperAdmin ? (
                                    <button
                                      type="button"
                                      disabled={updatingTrustedDonorId === d.user_id}
                                      onClick={() =>
                                        void onSetDonorTrusted(d.user_id, !Boolean(d.is_trusted))
                                      }
                                      className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                                    >
                                      {updatingTrustedDonorId === d.user_id
                                        ? "Saving..."
                                        : Boolean(d.is_trusted)
                                          ? "Remove trust"
                                          : "Mark trusted"}
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-3 py-2">
                                <a
                                  className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-105"
                                  href={toWhatsAppLink(d.contact_number)}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  WhatsApp
                                </a>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-3">
                  <div className="text-xs font-semibold text-zinc-700">
                    Top districts (verified donors)
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {topDistricts.length === 0 ? (
                      <span className="text-xs text-zinc-500">No data</span>
                    ) : (
                      topDistricts.map(([district, count]) => (
                        <span
                          key={district}
                          className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-semibold text-zinc-700"
                        >
                          {district}: {count}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

