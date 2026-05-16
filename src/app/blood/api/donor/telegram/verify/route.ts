import { createClient } from "@supabase/supabase-js";

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
}): Promise<string> {
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
  return data.id;
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Missing Authorization bearer token" }, 401);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !botToken) {
    return json({ error: "Missing env configuration for Telegram verify." }, 500);
  }

  let callerUserId: string;
  try {
    callerUserId = await getCallerUserIdOrThrow({ supabaseUrl, anonKey, jwt });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unauthorized caller";
    return json({ error: msg }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: codeRow, error: codeErr } = await adminClient
    .from("donor_telegram_link_codes")
    .select("code,expires_at")
    .eq("donor_user_id", callerUserId)
    .maybeSingle();
  if (codeErr) return json({ error: codeErr.message }, 500);
  if (!codeRow) return json({ error: "No link code found. Generate one first." }, 400);
  const expires = new Date((codeRow as { expires_at: string }).expires_at);
  if (Number.isNaN(expires.getTime()) || expires.getTime() < Date.now()) {
    return json({ error: "Link code expired. Generate a new code." }, 400);
  }
  const code = String((codeRow as { code: string }).code);

  const updatesResp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, {
    method: "GET",
  });
  const updatesText = await updatesResp.text();
  if (!updatesResp.ok) return json({ error: updatesText.slice(0, 300) || "getUpdates failed" }, 502);
  const updatesJson = JSON.parse(updatesText) as {
    ok?: boolean;
    result?: Array<{
      message?: {
        text?: string;
        chat?: { id?: number | string; username?: string; type?: string };
        from?: { username?: string };
      };
    }>;
  };
  const list = updatesJson.result ?? [];
  const needle = `/start ${code}`;

  for (const it of list) {
    const msg = it.message;
    if (!msg) continue;
    const text = (msg.text ?? "").trim();
    if (text !== needle) continue;
    const chatType = msg.chat?.type ?? "";
    if (chatType !== "private") continue;
    const chatId = String(msg.chat?.id ?? "");
    if (!chatId) continue;
    const username = msg.from?.username ?? msg.chat?.username ?? null;

    const { error: upErr } = await adminClient.from("donor_telegram_subscriptions").upsert(
      {
        donor_user_id: callerUserId,
        telegram_chat_id: chatId,
        telegram_username: username,
        enabled: true,
        verified_at: new Date().toISOString(),
      },
      { onConflict: "donor_user_id" },
    );
    if (upErr) return json({ error: upErr.message }, 500);

    await adminClient.from("donor_telegram_link_codes").delete().eq("donor_user_id", callerUserId);
    return json({ ok: true, chat_id: chatId, username });
  }

  return json({ error: "Verification command not found. Send /start CODE to bot and retry." }, 400);
}

