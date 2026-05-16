/**
 * Server-side Mailjet (transactional). Env must be set on the Next.js host
 * (e.g. Vercel project env) — not only in .env.local on your laptop.
 */

function trimEnv(v: string | undefined): string {
  return (v ?? "").trim().replace(/^\uFEFF/, "");
}

export type MailjetConfig = {
  apiKey: string;
  apiSecret: string;
  fromEmail: string;
  fromName: string;
  replyToEmail: string | null;
};

export function getMailjetConfig(): { ok: true; config: MailjetConfig } | { ok: false; reason: string } {
  const apiKey = trimEnv(process.env.MAILJET_API_KEY);
  const apiSecret = trimEnv(process.env.MAILJET_API_SECRET);
  const fromEmail = trimEnv(process.env.MAILJET_FROM_EMAIL);
  const fromName = trimEnv(process.env.MAILJET_FROM_NAME) || "Raktodaan";
  const replyToEmail = trimEnv(process.env.MAILJET_REPLY_TO_EMAIL) || null;

  if (!apiKey || !apiSecret || !fromEmail) {
    return {
      ok: false,
      reason:
        "Mailjet is not configured. Set MAILJET_API_KEY, MAILJET_API_SECRET, and MAILJET_FROM_EMAIL on the server (e.g. Vercel → Environment Variables), then redeploy. Local dev: use blood-donation-finder/.env.local and restart `npm run dev`.",
    };
  }

  return {
    ok: true,
    config: { apiKey, apiSecret, fromEmail, fromName, replyToEmail },
  };
}

export type SendMailjetOpts = {
  toEmail: string;
  toName?: string | null;
  subject: string;
  html: string;
  text: string;
  /** Short inbox preview line (hidden in HTML). */
  preheader?: string;
  /** Mailjet dashboard / webhook correlation */
  customId?: string;
};

export function escapeHtmlText(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapHtmlWithPreheader(html: string, preheader?: string) {
  const pre = (preheader ?? "").trim();
  const hidden =
    pre.length > 0
      ? `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtmlText(pre)}</div>`
      : "";
  return `${hidden}${html}`;
}

/**
 * Sends via Mailjet v3.1 with TextPart + HTMLPart, optional Reply-To, CustomID.
 */
export async function sendMailjetMessage(
  config: MailjetConfig,
  opts: SendMailjetOpts,
): Promise<void> {
  const token = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64");

  const headers: Record<string, string> = {};
  if (config.replyToEmail) {
    headers["Reply-To"] = config.replyToEmail;
  }

  const htmlPart = wrapHtmlWithPreheader(opts.html, opts.preheader);

  const message: Record<string, unknown> = {
    From: { Email: config.fromEmail, Name: config.fromName },
    To: [{ Email: opts.toEmail, Name: opts.toName || undefined }],
    Subject: opts.subject,
    HTMLPart: htmlPart,
    TextPart: opts.text,
  };

  if (Object.keys(headers).length > 0) {
    message.Headers = headers;
  }
  if (opts.customId) {
    message.CustomID = opts.customId.slice(0, 255);
  }

  const resp = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ Messages: [message] }),
  });

  const bodyText = await resp.text();
  if (!resp.ok) {
    throw new Error(bodyText || `Mailjet send failed (${resp.status})`);
  }
}
