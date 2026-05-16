import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

type WebPushSubscription = {
  endpoint: string;
  keys: {
    auth: string;
    p256dh: string;
  };
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function sendTelegramAlert(opts: {
  botToken: string;
  chatId: string;
  message: string;
}): Promise<boolean> {
  const resp = await fetch(`https://api.telegram.org/bot${opts.botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      chat_id: opts.chatId,
      text: opts.message,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  return resp.ok;
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

export async function POST(req: Request) {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(
      { error: "Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" },
      500,
    );
  }

  const bodyText = await req.text();
  const upstream = await fetch(`${supabaseUrl}/functions/v1/notify-donors-on-emergency`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      apikey: anonKey,
    },
    body: bodyText,
  });

  const upstreamText = await upstream.text();
  if (!upstream.ok) {
    return new Response(upstreamText, {
      status: upstream.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  type EmailResp = { ok?: boolean; notified?: number; warning?: string; error?: string };
  let emailJson: EmailResp = {};
  try {
    emailJson = upstreamText ? (JSON.parse(upstreamText) as EmailResp) : {};
  } catch {
    emailJson = {};
  }

  // Extract request_id from body so we can match donors for Web Push.
  type ReqBody = { request_id?: string };
  let requestId: string | null = null;
  try {
    const parsed = (bodyText ? JSON.parse(bodyText) : {}) as ReqBody;
    requestId = parsed.request_id ?? null;
  } catch {
    requestId = null;
  }

  if (!requestId) {
    return json({
      ...(emailJson ?? {}),
      push_sent: 0,
      push_failed: 0,
      push_warning: "request_id missing; push skipped.",
    });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: emergency, error: emErr } = await adminClient
    .from("emergency_requests")
    .select("request_id,blood_group,district,block,panchayat,patient_name,request_details,contact_number,created_at,status,verified_status")
    .eq("request_id", requestId)
    .maybeSingle();

  if (emErr || !emergency) {
    return json({
      ...(emailJson ?? {}),
      telegram_sent: false,
      push_sent: 0,
      push_failed: 0,
      push_warning: "Emergency request not found; push skipped.",
    });
  }

  // Gate notifications: only verified emergencies should notify donors.
  if ((emergency as { verified_status?: string | null }).verified_status !== "verified") {
    return json({
      ...(emailJson ?? {}),
      telegram_sent: false,
      telegram_donor_sent: 0,
      telegram_donor_failed: 0,
      push_sent: 0,
      push_failed: 0,
      push_warning: "Emergency is not verified yet; notifications skipped.",
    });
  }

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const telegramChatId = process.env.TELEGRAM_CHAT_ID ?? "";
  let telegramSent = false;
  let telegram_donor_sent = 0;
  let telegram_donor_failed = 0;
  if (telegramBotToken && telegramChatId) {
    const { data: tgSettings } = await adminClient
      .from("public_site_settings")
      .select("setting_key,setting_value")
      .in("setting_key", ["telegram_enabled", "telegram_emergency_template"]);
    const settingsMap = new Map<string, string>();
    for (const row of (tgSettings ?? []) as Array<{ setting_key: string; setting_value: string }>) {
      settingsMap.set(row.setting_key, row.setting_value);
    }
    const enabled = (settingsMap.get("telegram_enabled") ?? "false").toLowerCase() === "true";
    const tpl =
      settingsMap.get("telegram_emergency_template") ??
      "🚨 Emergency Blood Request\nBlood group: {{blood_group}}\nLocation: {{district}} / {{block}} / {{panchayat}}\n{{patient_line}}\n{{contact_line}}\n{{details_line}}";
    const message = applyTemplate(tpl, {
      blood_group: String(emergency.blood_group ?? ""),
      district: String(emergency.district ?? ""),
      block: String(emergency.block ?? ""),
      panchayat: String(emergency.panchayat ?? ""),
      patient_line: emergency.patient_name ? `Patient: ${emergency.patient_name}` : "",
      contact_line: emergency.contact_number ? `Contact: ${emergency.contact_number}` : "",
      details_line: emergency.request_details ? `Details: ${String(emergency.request_details).slice(0, 700)}` : "",
    });
    try {
      if (enabled && message) {
        telegramSent = await sendTelegramAlert({
          botToken: telegramBotToken,
          chatId: telegramChatId,
          message,
        });
      }
    } catch {
      telegramSent = false;
    }
  }

  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const vapidSubjectEmail = process.env.VAPID_SUBJECT_EMAIL ?? "admin@example.com";

  if (!vapidPrivateKey || !vapidPublicKey) {
    return json({
      ...(emailJson ?? {}),
      telegram_sent: telegramSent,
      push_sent: 0,
      push_failed: 0,
      push_warning: "VAPID keys missing on server; push skipped.",
    });
  }

  webpush.setVapidDetails(vapidSubjectEmail, vapidPublicKey, vapidPrivateKey);

  const dt = emergency.created_at ? new Date(emergency.created_at) : new Date();
  const day = Number.isNaN(dt.getTime()) ? 1 : dt.getUTCDay(); // 0=Sun..6=Sat
  const dayMap: Record<number, string> = {
    0: "Sun",
    1: "Mon",
    2: "Tue",
    3: "Wed",
    4: "Thu",
    5: "Fri",
    6: "Sat",
  };
  const p_day = dayMap[day] ?? "Mon";
  const hour = Number.isNaN(dt.getTime()) ? 9 : dt.getUTCHours();
  const p_time_slot = hour >= 5 && hour < 12 ? "Morning" : hour >= 12 && hour < 17 ? "Afternoon" : "Evening";

  // Match donors using the same RPC as the email edge function.
  const { data: matchedRows, error: matchErr } = await adminClient.rpc("get_donors_for_emergency", {
    p_blood_group: emergency.blood_group,
    p_district: emergency.district,
    p_block: emergency.block,
    p_panchayat: emergency.panchayat,
    p_day,
    p_time_slot,
  });

  if (matchErr || !matchedRows) {
    return json({
      ...(emailJson ?? {}),
      telegram_sent: telegramSent,
      push_sent: 0,
      push_failed: 0,
      push_warning: "Failed to match donors; push skipped.",
    });
  }

  const matchedDonorUserIds = (matchedRows as Array<{ donor_user_id: string }>).map(
    (r) => r.donor_user_id,
  );

  if (matchedDonorUserIds.length === 0) {
    return json({
      ...(emailJson ?? {}),
      telegram_sent: telegramSent,
      telegram_donor_sent,
      telegram_donor_failed,
      push_sent: 0,
      push_failed: 0,
      push_warning: "No matched donors; push skipped.",
    });
  }

  // Per-donor Telegram alerts (opt-in subscriptions)
  if (telegramBotToken) {
    const { data: tgSettings } = await adminClient
      .from("public_site_settings")
      .select("setting_key,setting_value")
      .in("setting_key", ["telegram_enabled", "telegram_emergency_template"]);
    const settingsMap = new Map<string, string>();
    for (const row of (tgSettings ?? []) as Array<{ setting_key: string; setting_value: string }>) {
      settingsMap.set(row.setting_key, row.setting_value);
    }
    const enabled = (settingsMap.get("telegram_enabled") ?? "false").toLowerCase() === "true";
    const tpl =
      settingsMap.get("telegram_emergency_template") ??
      "🚨 Emergency Blood Request\nBlood group: {{blood_group}}\nLocation: {{district}} / {{block}} / {{panchayat}}\n{{patient_line}}\n{{contact_line}}\n{{details_line}}";
    if (enabled) {
      const { data: tgSubs } = await adminClient
        .from("donor_telegram_subscriptions")
        .select("donor_user_id,telegram_chat_id,enabled")
        .in("donor_user_id", matchedDonorUserIds)
        .eq("enabled", true);
      for (const row of (tgSubs ?? []) as Array<{ donor_user_id: string; telegram_chat_id: string; enabled: boolean }>) {
        if (!row.telegram_chat_id) continue;
        const donor = (matchedRows as Array<{ donor_user_id: string; name?: string | null }>).find(
          (m) => m.donor_user_id === row.donor_user_id,
        );
        const message = applyTemplate(tpl, {
          blood_group: String(emergency.blood_group ?? ""),
          district: String(emergency.district ?? ""),
          block: String(emergency.block ?? ""),
          panchayat: String(emergency.panchayat ?? ""),
          patient_line: emergency.patient_name ? `Patient: ${emergency.patient_name}` : "",
          contact_line: emergency.contact_number ? `Contact: ${emergency.contact_number}` : "",
          details_line: emergency.request_details ? `Details: ${String(emergency.request_details).slice(0, 700)}` : "",
          name: donor?.name ?? "Donor",
        });
        try {
          const ok = await sendTelegramAlert({
            botToken: telegramBotToken,
            chatId: row.telegram_chat_id,
            message,
          });
          if (ok) telegram_donor_sent += 1;
          else telegram_donor_failed += 1;
        } catch {
          telegram_donor_failed += 1;
        }
      }
    }
  }

  // Load stored Web Push subscriptions for matched donors.
  const { data: subRows, error: subErr } = await adminClient
    .from("donor_webpush_subscriptions")
    .select("donor_user_id,subscription")
    .in("donor_user_id", matchedDonorUserIds);

  if (subErr || !subRows) {
    return json({
      ...(emailJson ?? {}),
      telegram_sent: telegramSent,
      telegram_donor_sent,
      telegram_donor_failed,
      push_sent: 0,
      push_failed: 0,
      push_warning: "Failed to load subscriptions; push skipped.",
    });
  }

  const uniqueEndpoints = new Set<string>();
  const subsToSend = (subRows as Array<{ donor_user_id: string; subscription: unknown }>)
    .map((r) => r.subscription)
    .filter((s): s is WebPushSubscription => {
      if (!s || typeof s !== "object") return false;
      const ss = s as { endpoint?: unknown; keys?: unknown };
      const endpoint = typeof ss.endpoint === "string" ? ss.endpoint : null;
      if (!endpoint) return false;

      const keys = ss.keys as { auth?: unknown; p256dh?: unknown } | undefined;
      const auth = keys && typeof keys.auth === "string" ? keys.auth : null;
      const p256dh = keys && typeof keys.p256dh === "string" ? keys.p256dh : null;
      if (!auth || !p256dh) return false;

      if (uniqueEndpoints.has(endpoint)) return false;
      uniqueEndpoints.add(endpoint);
      return true;
    });

  const payload = JSON.stringify({
    title: "Emergency blood request near you",
    body: `Need ${emergency.blood_group} blood in ${emergency.district}.`,
    route: "/emergency",
    request_id: requestId,
  });

  let pushSent = 0;
  let pushFailed = 0;

  for (const subscription of subsToSend) {
    try {
      await webpush.sendNotification(subscription, payload);
      pushSent += 1;
    } catch {
      pushFailed += 1;
    }
  }

  return json({
    ...(emailJson ?? {}),
    telegram_sent: telegramSent,
    telegram_donor_sent,
    telegram_donor_failed,
    push_sent: pushSent,
    push_failed: pushFailed,
  });
}

