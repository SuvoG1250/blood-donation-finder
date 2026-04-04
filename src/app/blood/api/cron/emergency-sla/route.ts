import { createClient } from "@supabase/supabase-js";
import { escapeHtmlText, getMailjetConfig, sendMailjetMessage } from "@/lib/mailjet";
import { logSuperAdminAction } from "@/lib/superAdminAudit";

function getAppBaseUrl(): string {
  const explicit = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (explicit) return explicit;
  const vercel = (process.env.VERCEL_URL ?? "").trim().replace(/\/+$/, "");
  if (vercel) return vercel.startsWith("http") ? vercel : `https://${vercel}`;
  return "";
}

function parseExtraNotifyEmails(raw: string | undefined): string[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  const out = new Set<string>();
  for (const part of s.split(/[,;\s]+/)) {
    const e = part.trim().toLowerCase();
    if (e.includes("@")) out.add(e);
  }
  return [...out];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 10080) return fallback;
  return n;
}

async function readSlaThresholdMinutesFromSettings(adminClient: any) {
  const { data } = await adminClient
    .from("public_site_settings")
    .select("setting_key,setting_value")
    .in("setting_key", [
      "emergency_sla_open_minutes",
      "emergency_sla_verify_pending_minutes",
    ]);

  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ setting_key: string; setting_value: string }>) {
    map.set(row.setting_key, row.setting_value);
  }
  return {
    openFromDb: parsePositiveInt(map.get("emergency_sla_open_minutes"), 0),
    verifyFromDb: parsePositiveInt(map.get("emergency_sla_verify_pending_minutes"), 0),
  };
}

/**
 * Marks emergencies that breached SLA (stale open or stale pending verification).
 * Idempotent: rows with escalated_at already set are skipped.
 * Schedule with CRON_SECRET (same as eligibility-reminders).
 */
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET ?? "";
  const got = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!expected || got !== expected) return json({ error: "Forbidden" }, 403);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const dbThresholds = await readSlaThresholdMinutesFromSettings(adminClient);
  const openMinutes =
    dbThresholds.openFromDb > 0
      ? dbThresholds.openFromDb
      : parsePositiveInt(process.env.EMERGENCY_ESCALATE_OPEN_MINUTES, 30);
  const verifyPendingMinutes =
    dbThresholds.verifyFromDb > 0
      ? dbThresholds.verifyFromDb
      : parsePositiveInt(process.env.EMERGENCY_ESCALATE_VERIFY_PENDING_MINUTES, 20);

  const now = Date.now();
  const openCutoffMs = now - openMinutes * 60 * 1000;
  const verifyCutoffMs = now - verifyPendingMinutes * 60 * 1000;

  const { data: rows, error: selErr } = await adminClient
    .from("emergency_requests")
    .select("request_id,status,verified_status,created_at,escalated_at")
    .is("escalated_at", null)
    .in("status", ["open", "in_progress"]);

  if (selErr) return json({ error: selErr.message }, 500);

  const toEscalate: string[] = [];
  for (const r of rows ?? []) {
    const row = r as {
      request_id: string;
      status: string;
      verified_status?: string | null;
      created_at: string;
    };
    const created = new Date(row.created_at).getTime();
    if (Number.isNaN(created)) continue;
    const vs = (row.verified_status ?? "pending").toLowerCase();
    const isVerified = vs === "verified";
    const openBreached = row.status === "open" && created < openCutoffMs;
    const verifyBreached = !isVerified && created < verifyCutoffMs;
    if (openBreached || verifyBreached) {
      toEscalate.push(row.request_id);
    }
  }

  if (toEscalate.length === 0) {
    const mj = getMailjetConfig();
    return json({
      ok: true,
      escalated: 0,
      open_minutes: openMinutes,
      verify_pending_minutes: verifyPendingMinutes,
      candidates_scanned: (rows ?? []).length,
      emails_sent: 0,
      mailjet_configured: mj.ok,
      email_alerts_skipped: true,
    });
  }

  const escalatedAt = new Date().toISOString();
  const { error: updErr } = await adminClient
    .from("emergency_requests")
    .update({ escalated_at: escalatedAt })
    .in("request_id", toEscalate)
    .is("escalated_at", null);

  if (updErr) return json({ error: updErr.message }, 500);

  const systemActor = "00000000-0000-0000-0000-000000000000";
  await logSuperAdminAction(adminClient, {
    actor_user_id: systemActor,
    action_type: "emergency_sla_escalation",
    target_kind: "emergency_batch",
    target_id: null,
    metadata: {
      count: toEscalate.length,
      request_ids_sample: toEscalate.slice(0, 20),
      open_minutes: openMinutes,
      verify_pending_minutes: verifyPendingMinutes,
      escalated_at: escalatedAt,
    },
  });

  let emailsSent = 0;
  const disableEmail =
    (process.env.EMERGENCY_SLA_DISABLE_EMAIL_ALERTS ?? "").toLowerCase() === "true" ||
    (process.env.EMERGENCY_SLA_DISABLE_EMAIL_ALERTS ?? "").trim() === "1";
  const mj = getMailjetConfig();

  if (!disableEmail && mj.ok) {
    const { data: superRows } = await adminClient
      .from("admin_users")
      .select("user_id")
      .eq("admin_role", "super_admin");

    const recipients = new Set<string>();
    for (const extra of parseExtraNotifyEmails(process.env.EMERGENCY_SLA_EXTRA_NOTIFY_EMAILS)) {
      recipients.add(extra);
    }

    for (const row of superRows ?? []) {
      const uid = (row as { user_id?: string }).user_id;
      if (!uid) continue;
      const { data: userRes } = await adminClient.auth.admin.getUserById(uid);
      const email = (userRes.user?.email ?? "").trim().toLowerCase();
      if (email) recipients.add(email);
    }

    const appBase = getAppBaseUrl();
    const adminLink = appBase ? `${appBase}/blood/admin` : "";
    const sampleIds = toEscalate.slice(0, 15);
    const idsHtml = sampleIds.map((id) => `<li style="font-family:monospace;font-size:12px;">${escapeHtmlText(id)}</li>`).join("");
    const subject = `Raktodaan: ${toEscalate.length} emergency request(s) hit SLA — action needed`;
    const preheader = `${toEscalate.length} emergency(s) marked escalated (open or pending verification too long).`;
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color:#111;">
        <h2 style="margin:0 0 10px 0; font-size:18px;">Emergency SLA escalation</h2>
        <p style="margin:0 0 10px 0;">
          <b>${toEscalate.length}</b> open / in-progress request(s) breached the configured SLA
          (open &gt; ${openMinutes}m and/or verification pending &gt; ${verifyPendingMinutes}m).
          They are now marked <b>escalated</b> in the admin dashboard.
        </p>
        ${adminLink ? `<p style="margin:0 0 10px 0;"><a href="${escapeHtmlText(adminLink)}" style="color:#b91c1c;">Open admin dashboard</a></p>` : ""}
        <p style="margin:0 0 8px 0; font-size:13px; font-weight:bold;">Request IDs (sample)</p>
        <ul style="margin:0; padding-left:18px;">${idsHtml}</ul>
        <p style="margin:12px 0 0 0; color:#555; font-size:12px;">Automated message from the emergency SLA cron.</p>
      </div>
    `;
    const text = [
      `Emergency SLA escalation: ${toEscalate.length} request(s).`,
      `Thresholds: open ${openMinutes}m, verify pending ${verifyPendingMinutes}m.`,
      adminLink ? `Admin: ${adminLink}` : "",
      "Sample IDs:",
      ...sampleIds,
    ]
      .filter(Boolean)
      .join("\n");

    for (const toEmail of recipients) {
      try {
        await sendMailjetMessage(mj.config, {
          toEmail,
          subject,
          html,
          text,
          preheader,
          customId: `emergency_sla_escalation:${escalatedAt}`,
        });
        emailsSent += 1;
      } catch {
        // non-blocking; cron still succeeds
      }
    }
  }

  return json({
    ok: true,
    escalated: toEscalate.length,
    open_minutes: openMinutes,
    verify_pending_minutes: verifyPendingMinutes,
    candidates_scanned: (rows ?? []).length,
    emails_sent: emailsSent,
    mailjet_configured: mj.ok,
    email_alerts_skipped: disableEmail || !mj.ok,
  });
}
