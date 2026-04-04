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

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Missing Authorization bearer token" }, 401);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const chatId = process.env.TELEGRAM_CHAT_ID ?? "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }
  if (!botToken || !chatId) {
    return json({ error: "Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID" }, 500);
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
  if (roleErr) return json({ error: `Permission check failed: ${roleErr.message}` }, 500);
  if ((roleRow as { admin_role?: string } | null)?.admin_role !== "super_admin") {
    const { data: permRow, error: permErr } = await adminClient
      .from("admin_permissions")
      .select("can_edit_site_settings")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (permErr) return json({ error: `Permission check failed: ${permErr.message}` }, 500);
    const canEdit = Boolean(
      (permRow as { can_edit_site_settings?: boolean } | null)?.can_edit_site_settings,
    );
    if (!canEdit) return json({ error: "Forbidden: settings permission required" }, 403);
  }

  const message = `Raktodaan test: Telegram integration is active.\nActor: ${callerUserId}`;
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    }),
  });
  const text = await resp.text();
  if (!resp.ok) return json({ error: text.slice(0, 300) || "Telegram send failed" }, 502);
  return json({ ok: true });
}

