import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { getMailjetConfig, sendMailjetMessage } from "@/lib/mailjet";
import { logSuperAdminAction } from "@/lib/superAdminAudit";

type WebPushSubscription = {
  endpoint: string;
  keys: { auth: string; p256dh: string };
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function getCallerUserIdOrThrow(opts: {
  supabaseUrl: string;
  anonKey: string;
  jwt: string;
}): Promise<{ user_id: string }> {
  const resp = await fetch(`${opts.supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: opts.anonKey,
      Authorization: `Bearer ${opts.jwt}`,
    },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(text || `Auth user fetch failed (${resp.status})`);
  const data = JSON.parse(text) as { id?: string };
  if (!data?.id) throw new Error("Auth user id missing");
  return { user_id: data.id };
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

type Body =
  | {
      action: "preview";
      blood_group: string;
      district: string;
      block?: string | null;
      panchayat?: string | null;
    }
  | {
      action: "send";
      blood_group: string;
      district: string;
      block?: string | null;
      panchayat?: string | null;
      message: string;
      channels: { email?: boolean; push?: boolean; telegram?: boolean };
    };

const BROADCAST_COOLDOWN_MS = 10 * 60 * 1000;
const BROADCAST_MAX_PER_WINDOW = 2;

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Missing Authorization bearer token" }, 401);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(
      { error: "Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" },
      500,
    );
  }

  let callerUserId: string;
  try {
    callerUserId = (await getCallerUserIdOrThrow({ supabaseUrl, anonKey, jwt })).user_id;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unauthorized caller";
    return json({ error: `Unauthorized caller: ${msg}` }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: roleRow, error: roleErr } = await adminClient
    .from("admin_users")
    .select("admin_role")
    .eq("user_id", callerUserId)
    .maybeSingle();
  if (roleErr) return json({ error: `Admin check failed: ${roleErr.message}` }, 500);
  const isSuper = (roleRow as { admin_role?: string } | null)?.admin_role === "super_admin";
  if (!isSuper) {
    const { data: permRow } = await adminClient
      .from("admin_permissions")
      .select("can_broadcast")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!Boolean((permRow as { can_broadcast?: boolean } | null)?.can_broadcast)) {
      return json({ error: "Forbidden: broadcast permission required" }, 403);
    }
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!("action" in body)) return json({ error: "Invalid payload" }, 400);

  const bloodGroup = (body as { blood_group?: string }).blood_group?.trim() ?? "";
  const district = (body as { district?: string }).district?.trim() ?? "";
  const block = ((body as { block?: string | null }).block ?? "").trim();
  const panchayat = ((body as { panchayat?: string | null }).panchayat ?? "").trim();
  if (!bloodGroup || !district) return json({ error: "Missing blood_group / district" }, 400);

  const { data: matchedRows, error: matchErr } = await adminClient.rpc(
    "get_broadcast_recipients",
    {
      p_blood_group: bloodGroup,
      p_district: district,
      p_block: block || null,
      p_panchayat: panchayat || null,
    },
  );
  if (matchErr) return json({ error: matchErr.message }, 500);
  const recipients =
    (matchedRows ?? []) as Array<{
      donor_user_id: string;
      email: string | null;
      name: string | null;
      blood_group: string;
      district: string;
      block: string;
      panchayat: string;
    }>;

  if (body.action === "preview") {
    return json({
      ok: true,
      recipients: recipients.length,
      sample: recipients.slice(0, 5).map((r) => ({
        donor_user_id: r.donor_user_id,
        email_masked: r.email ? r.email.replace(/(^.).*(@.*$)/, "$1***$2") : null,
        name: r.name ?? null,
      })),
    });
  }

  const sendBody = body as Extract<Body, { action: "send" }>;
  const message = (sendBody.message ?? "").trim();
  if (!message) return json({ error: "Message is required" }, 400);

  const sinceIso = new Date(Date.now() - BROADCAST_COOLDOWN_MS).toISOString();
  const { data: recent, error: rateErr } = await adminClient
    .from("super_admin_audit_logs")
    .select("id")
    .eq("actor_user_id", callerUserId)
    .eq("action_type", "broadcast_send")
    .gte("created_at", sinceIso)
    .limit(10);
  if (rateErr) return json({ error: `Rate check failed: ${rateErr.message}` }, 500);
  if ((recent?.length ?? 0) >= BROADCAST_MAX_PER_WINDOW) {
    return json({ error: "Rate limited: too many broadcasts. Try again later." }, 429);
  }

  const channels = sendBody.channels ?? {};
  const doEmail = channels.email === true;
  const doTelegram = channels.telegram === true;
  const doPush = channels.push === true;

  let emailSent = 0;
  let emailFailed = 0;
  let telegramSent = 0;
  let telegramFailed = 0;
  let pushSent = 0;
  let pushFailed = 0;

  if (doEmail) {
    const mj = getMailjetConfig();
    if (mj.ok) {
      const subject = `Blood request broadcast: ${bloodGroup} (${district}${block ? ` / ${block}` : ""})`;
      const html = `<div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color: #111;">
        <h2 style="margin:0 0 12px 0; font-size: 18px;">Blood request broadcast</h2>
        <p style="margin:0 0 12px 0;"><b>Blood group:</b> ${bloodGroup}</p>
        <p style="margin:0 0 12px 0;"><b>Location:</b> ${district}${block ? ` / ${block}` : ""}${panchayat ? ` / ${panchayat}` : ""}</p>
        <pre style="white-space:pre-wrap;background:#fafafa;border:1px solid #eee;padding:10px;border-radius:10px;">${message
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")}</pre>
        <p style="margin:12px 0 0 0; color:#525252; font-size:12px;">Automated broadcast from Raktodaan admin.</p>
      </div>`;
      const text = [
        "Blood request broadcast",
        `Blood group: ${bloodGroup}`,
        `Location: ${district}${block ? ` / ${block}` : ""}${panchayat ? ` / ${panchayat}` : ""}`,
        "",
        message,
        "",
        "Automated broadcast from Raktodaan admin.",
      ].join("\n");

      for (const r of recipients) {
        const toEmail = (r.email ?? "").trim();
        if (!toEmail) continue;
        try {
          await sendMailjetMessage(mj.config, {
            toEmail,
            toName: r.name ?? undefined,
            subject,
            html,
            text,
            preheader: `Need ${bloodGroup} in ${district}${block ? ` / ${block}` : ""}`,
            customId: `broadcast:${callerUserId}:${Date.now()}`,
          });
          emailSent += 1;
        } catch {
          emailFailed += 1;
        }
      }
    } else {
      emailFailed = recipients.filter((r) => (r.email ?? "").trim()).length;
    }
  }

  if (doTelegram) {
    const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
    if (telegramBotToken) {
      const { data: subs } = await adminClient
        .from("donor_telegram_subscriptions")
        .select("donor_user_id,telegram_chat_id,enabled")
        .in(
          "donor_user_id",
          recipients.map((r) => r.donor_user_id),
        );
      const subMap = new Map<string, string>();
      for (const row of (subs ?? []) as Array<{
        donor_user_id: string;
        telegram_chat_id: string | null;
        enabled: boolean | null;
      }>) {
        if (row.enabled === true && row.telegram_chat_id) {
          subMap.set(row.donor_user_id, row.telegram_chat_id);
        }
      }
      for (const r of recipients) {
        const chatId = subMap.get(r.donor_user_id) ?? "";
        if (!chatId) continue;
        try {
          const ok = await sendTelegramAlert({
            botToken: telegramBotToken,
            chatId,
            message,
          });
          if (ok) telegramSent += 1;
          else telegramFailed += 1;
        } catch {
          telegramFailed += 1;
        }
      }
    }
  }

  if (doPush) {
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY ?? "";
    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
    const vapidSubjectEmail = process.env.VAPID_SUBJECT_EMAIL ?? "admin@example.com";
    if (vapidPrivateKey && vapidPublicKey) {
      webpush.setVapidDetails(vapidSubjectEmail, vapidPublicKey, vapidPrivateKey);
      const { data: subs } = await adminClient
        .from("donor_webpush_subscriptions")
        .select("donor_user_id,subscription")
        .in(
          "donor_user_id",
          recipients.map((r) => r.donor_user_id),
        )
        .limit(2000);
      const subsByUser = new Map<string, WebPushSubscription[]>();
      for (const row of (subs ?? []) as Array<{
        donor_user_id: string;
        subscription: WebPushSubscription;
      }>) {
        const list = subsByUser.get(row.donor_user_id) ?? [];
        list.push(row.subscription);
        subsByUser.set(row.donor_user_id, list);
      }
      const payload = JSON.stringify({
        title: `Broadcast: ${bloodGroup} needed`,
        body: message.slice(0, 140),
        url: "/blood/emergency",
      });

      for (const r of recipients) {
        const list = subsByUser.get(r.donor_user_id) ?? [];
        for (const sub of list) {
          try {
            await webpush.sendNotification(sub, payload);
            pushSent += 1;
          } catch {
            pushFailed += 1;
          }
        }
      }
    }
  }

  await logSuperAdminAction(adminClient, {
    actor_user_id: callerUserId,
    action_type: "broadcast_send",
    target_kind: "donor_group",
    target_id: `${bloodGroup}:${district}:${block || "-"}:${panchayat || "-"}`,
    metadata: {
      blood_group: bloodGroup,
      district,
      block: block || null,
      panchayat: panchayat || null,
      recipients: recipients.length,
      channels: { email: doEmail, telegram: doTelegram, push: doPush },
      results: { emailSent, emailFailed, telegramSent, telegramFailed, pushSent, pushFailed },
    },
  });

  return json({
    ok: true,
    recipients: recipients.length,
    emailSent,
    emailFailed,
    telegramSent,
    telegramFailed,
    pushSent,
    pushFailed,
  });
}

