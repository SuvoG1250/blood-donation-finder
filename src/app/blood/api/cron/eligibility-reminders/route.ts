import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { getMailjetConfig, sendMailjetMessage } from "@/lib/mailjet";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

type WebPushSubscription = {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
};

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

function isValidUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function eligibleAtIsoFromLastDonationDate(lastDonationDate: string): string | null {
  const d = new Date(lastDonationDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 90);
  return d.toISOString();
}

export async function POST(req: Request) {
  // Free hosting friendly: protect with a static secret header.
  const expected = process.env.CRON_SECRET ?? "";
  const got = (req.headers.get("x-cron-secret") ?? "").trim();
  if (!expected || got !== expected) return json({ error: "Forbidden" }, 403);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Pick donors whose "eligible at" date is today (UTC).
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // We can't easily compute "last_donation_date + 90" with client filters,
  // so we fetch a bounded batch and compute in code.
  const { data: donors, error: donorsErr } = await adminClient
    .from("donors")
    .select("user_id,name,last_donation_date,id_card_verified")
    .eq("id_card_verified", true)
    .limit(2000);

  if (donorsErr) return json({ error: donorsErr.message }, 500);

  const candidates = (donors ?? [])
    .map((d) => {
      const user_id = (d as { user_id?: unknown }).user_id;
      const last_donation_date = (d as { last_donation_date?: unknown }).last_donation_date;
      return {
        user_id: typeof user_id === "string" ? user_id : "",
        last_donation_date: typeof last_donation_date === "string" ? last_donation_date : "",
        name: typeof (d as { name?: unknown }).name === "string" ? ((d as { name?: string }).name ?? "") : "",
      };
    })
    .filter((d) => isValidUuid(d.user_id) && Boolean(d.last_donation_date))
    .map((d) => {
      const eligibleAtIso = eligibleAtIsoFromLastDonationDate(d.last_donation_date);
      return { ...d, eligibleAtIso };
    })
    .filter((d): d is { user_id: string; last_donation_date: string; name: string; eligibleAtIso: string } => {
      return typeof d.eligibleAtIso === "string" && d.eligibleAtIso.length > 0;
    })
    .filter((d) => d.eligibleAtIso >= startIso && d.eligibleAtIso < endIso);

  if (candidates.length === 0) {
    return json({ ok: true, emailed: 0, pushed: 0, skipped: 0, note: "No eligible-today donors found." });
  }

  // Load prefs; default enabled if missing.
  const { data: prefsRows, error: prefsErr } = await adminClient
    .from("donor_notification_prefs")
    .select("donor_user_id,eligibility_reminders_enabled,last_eligibility_reminder_sent_at")
    .in("donor_user_id", candidates.map((c) => c.user_id));
  if (prefsErr) return json({ error: prefsErr.message }, 500);

  const prefsByUser = new Map<
    string,
    { enabled: boolean; lastSentAt: string | null }
  >();
  for (const r of prefsRows ?? []) {
    const row = r as {
      donor_user_id?: unknown;
      eligibility_reminders_enabled?: unknown;
      last_eligibility_reminder_sent_at?: unknown;
    };
    const uid = typeof row.donor_user_id === "string" ? row.donor_user_id : "";
    if (!isValidUuid(uid)) continue;
    prefsByUser.set(uid, {
      enabled: Boolean(row.eligibility_reminders_enabled ?? true),
      lastSentAt: typeof row.last_eligibility_reminder_sent_at === "string" ? row.last_eligibility_reminder_sent_at : null,
    });
  }

  const mj = getMailjetConfig();
  const canEmail = mj.ok;
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  let telegramEnabled = false;
  let telegramReminderTemplate =
    "🩸 Hello {{name}}, you are now eligible to donate again. Thank you for supporting Raktodaan.";
  if (telegramBotToken) {
    const { data: tgRows } = await adminClient
      .from("public_site_settings")
      .select("setting_key,setting_value")
      .in("setting_key", ["telegram_enabled", "telegram_reminder_template"]);
    const map = new Map<string, string>();
    for (const row of (tgRows ?? []) as Array<{ setting_key: string; setting_value: string }>) {
      map.set(row.setting_key, row.setting_value);
    }
    telegramEnabled = (map.get("telegram_enabled") ?? "false").toLowerCase() === "true";
    telegramReminderTemplate = map.get("telegram_reminder_template") ?? telegramReminderTemplate;
  }

  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const vapidSubjectEmail = process.env.VAPID_SUBJECT_EMAIL ?? "admin@example.com";
  const canPush = Boolean(vapidPrivateKey && vapidPublicKey);
  if (canPush) webpush.setVapidDetails(vapidSubjectEmail, vapidPublicKey, vapidPrivateKey);

  // Load push subs for candidates (optional).
  const { data: subRows } = canPush
    ? await adminClient
        .from("donor_webpush_subscriptions")
        .select("donor_user_id,subscription")
        .in("donor_user_id", candidates.map((c) => c.user_id))
    : { data: [] as unknown[] };

  const subsByUser = new Map<string, WebPushSubscription[]>();
  for (const row of (subRows ?? []) as Array<{ donor_user_id: string; subscription: unknown }>) {
    const uid = row.donor_user_id;
    const s = row.subscription as unknown;
    if (!uid || !s || typeof s !== "object") continue;
    const ss = s as { endpoint?: unknown; keys?: unknown };
    const endpoint = typeof ss.endpoint === "string" ? ss.endpoint : null;
    const keys = ss.keys as { auth?: unknown; p256dh?: unknown } | undefined;
    const auth = keys && typeof keys.auth === "string" ? keys.auth : null;
    const p256dh = keys && typeof keys.p256dh === "string" ? keys.p256dh : null;
    if (!endpoint || !auth || !p256dh) continue;
    const sub: WebPushSubscription = { endpoint, keys: { auth, p256dh } };
    subsByUser.set(uid, [...(subsByUser.get(uid) ?? []), sub]);
  }

  let emailed = 0;
  let pushed = 0;
  let telegramSent = 0;
  let skipped = 0;

  for (const c of candidates) {
    const pref = prefsByUser.get(c.user_id) ?? { enabled: true, lastSentAt: null };
    if (!pref.enabled) {
      skipped += 1;
      continue;
    }
    // De-dupe: only one reminder per day.
    if (pref.lastSentAt) {
      const last = new Date(pref.lastSentAt);
      if (!Number.isNaN(last.getTime()) && last >= start && last < end) {
        skipped += 1;
        continue;
      }
    }

    // Email
    if (canEmail) {
      const userRes = await adminClient.auth.admin.getUserById(c.user_id);
      const toEmail = userRes.data.user?.email ?? "";
      if (toEmail) {
        const html = `
          <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color:#111;">
            <h2 style="margin:0 0 10px 0; font-size:18px;">You are eligible to donate again</h2>
            <p style="margin:0 0 10px 0;">
              Your 90-day eligibility period is complete. Thank you for being a donor.
            </p>
            <p style="margin:0; color:#555; font-size:12px;">Raktodaan reminder.</p>
          </div>
        `;
        const text = [
          "You are eligible to donate again",
          "Your 90-day eligibility period is complete. Thank you for being a donor.",
          "Raktodaan reminder.",
        ].join("\n");
        try {
          await sendMailjetMessage(mj.config, {
            toEmail,
            subject: "Raktodaan: You are eligible to donate again",
            html,
            text,
            preheader: "Your 90-day eligibility period is complete.",
            customId: `eligibility_reminder:${c.user_id}`,
          });
          emailed += 1;
        } catch {
          // non-blocking
        }
      }
    }

    // Push
    if (canPush) {
      const subs = subsByUser.get(c.user_id) ?? [];
      if (subs.length > 0) {
        const payload = JSON.stringify({
          title: "You are eligible to donate again",
          body: "Your 90-day eligibility period is complete. Thank you for being a donor.",
          route: "/donor/dashboard",
          kind: "eligibility_reminder",
        });
        for (const sub of subs) {
          try {
            await webpush.sendNotification(sub, payload);
            pushed += 1;
          } catch (e: unknown) {
            // Clean up invalid subscriptions.
            const msg = e instanceof Error ? e.message : "";
            if (msg.includes("410") || msg.toLowerCase().includes("gone") || msg.includes("404")) {
              await adminClient
                .from("donor_webpush_subscriptions")
                .delete()
                .eq("donor_user_id", c.user_id);
            }
          }
        }
      }
    }

    // Mark sent (even if provider missing; prevents spamming from repeated runs).
    if (telegramEnabled && telegramBotToken) {
      const { data: tgSub } = await adminClient
        .from("donor_telegram_subscriptions")
        .select("telegram_chat_id,enabled")
        .eq("donor_user_id", c.user_id)
        .maybeSingle();
      const tgChatId =
        (tgSub as { telegram_chat_id?: string; enabled?: boolean } | null)?.enabled === true
          ? (tgSub as { telegram_chat_id?: string }).telegram_chat_id ?? ""
          : "";
      if (tgChatId) {
      const message = applyTemplate(telegramReminderTemplate, {
        name: c.name || "Donor",
      });
      if (message) {
        try {
          const resp = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: "POST",
            headers: { "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({
              chat_id: tgChatId,
              text: message,
              disable_web_page_preview: true,
            }),
          });
          if (resp.ok) telegramSent += 1;
        } catch {
          // non-blocking
        }
      }
      }
    }

    // Mark sent (even if provider missing; prevents spamming from repeated runs).
    await adminClient.from("donor_notification_prefs").upsert(
      {
        donor_user_id: c.user_id,
        eligibility_reminders_enabled: pref.enabled,
        last_eligibility_reminder_sent_at: new Date().toISOString(),
      },
      { onConflict: "donor_user_id" },
    );
  }

  return json({
    ok: true,
    emailed,
    pushed,
    telegram_sent: telegramSent,
    skipped,
    candidates: candidates.length,
    canEmail,
    canPush,
    telegramEnabled,
  });
}

