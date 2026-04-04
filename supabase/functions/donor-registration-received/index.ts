import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

type Body = {
  donor_user_id: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
      "access-control-allow-methods": "POST, OPTIONS",
    },
  });
}

async function sendMailjetEmail(opts: {
  apiKey: string;
  apiSecret: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName?: string | null;
  subject: string;
  html: string;
  text: string;
}) {
  const token = btoa(`${opts.apiKey}:${opts.apiSecret}`);
  const resp = await fetch("https://api.mailjet.com/v3.1/send", {
    method: "POST",
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: opts.fromEmail, Name: opts.fromName },
          To: [{ Email: opts.toEmail, Name: opts.toName ?? undefined }],
          Subject: opts.subject,
          HTMLPart: opts.html,
          TextPart: opts.text,
        },
      ],
    }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(text || `Mailjet send failed (${resp.status})`);
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers":
          "authorization, x-client-info, apikey, content-type",
        "access-control-allow-methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(
      { error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      500,
    );
  }

  const mailjetKey = Deno.env.get("MAILJET_API_KEY") ?? "";
  const mailjetSecret = Deno.env.get("MAILJET_API_SECRET") ?? "";
  const mailjetFromEmail = Deno.env.get("MAILJET_FROM_EMAIL") ?? "";
  const mailjetFromName = Deno.env.get("MAILJET_FROM_NAME") ?? "Raktodaan";
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
  const canSendEmail = Boolean(mailjetKey && mailjetSecret && mailjetFromEmail);

  if (!canSendEmail) {
    return jsonResponse({ ok: true, notified: false, warning: "MAILJET_* env vars missing" });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return jsonResponse({ error: "Missing Authorization bearer token" }, 401);

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: caller, error: callerErr } = await adminClient.auth.getUser(jwt);
  if (callerErr || !caller?.user) return jsonResponse({ error: "Unauthorized caller" }, 401);

  const body = (await req.json().catch(() => ({}))) as Body;
  const donorUserId = body?.donor_user_id;
  if (!donorUserId) return jsonResponse({ error: "Missing donor_user_id" }, 400);

  // Only allow sending for the same user (donor).
  if (caller.user.id !== donorUserId) {
    return jsonResponse({ error: "Forbidden" }, 403);
  }

  const { data: donor } = await adminClient
    .from("donors")
    .select("name,district,block,panchayat,blood_group")
    .eq("user_id", donorUserId)
    .maybeSingle();

  const { data: authUser } = await adminClient.auth.admin.getUserById(donorUserId);
  const email = authUser?.user?.email ?? null;
  if (!email) return jsonResponse({ error: "Donor email not found" }, 400);

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2 style="margin:0 0 10px 0;">Registration received</h2>
      <p style="margin:0 0 10px 0;">Hi${donor?.name ? ` ${donor.name}` : ""},</p>
      <p style="margin:0 0 10px 0;">We received your donor registration on Raktodaan.</p>
      <p style="margin:0 0 10px 0;">Your account is now <b>pending admin verification</b>. You will get another email after approval.</p>
      ${
        donor
          ? `<div style="border:1px solid #eee; border-radius:12px; padding:12px; background:#fafafa;">
              <div><b>Blood group:</b> ${donor.blood_group ?? "-"}</div>
              <div><b>Location:</b> ${donor.district ?? "-"} / ${donor.block ?? "-"} / ${donor.panchayat ?? "-"}</div>
            </div>`
          : ""
      }
      ${
        appUrl
          ? `<p style="margin:12px 0 0 0;">You can check status here: <a href="${appUrl}/donor/dashboard">${appUrl}/donor/dashboard</a></p>`
          : ""
      }
    </div>
  `;
  const text = [
    "Registration received",
    `Hi${donor?.name ? ` ${donor.name}` : ""},`,
    "We received your donor registration on Raktodaan.",
    "Your account is pending admin verification. You will get another email after approval.",
    donor ? `Blood group: ${donor.blood_group ?? "-"}` : "",
    donor
      ? `Location: ${donor.district ?? "-"} / ${donor.block ?? "-"} / ${donor.panchayat ?? "-"}`
      : "",
    appUrl ? `Check status: ${appUrl}/donor/dashboard` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    await sendMailjetEmail({
      apiKey: mailjetKey,
      apiSecret: mailjetSecret,
      fromEmail: mailjetFromEmail,
      fromName: mailjetFromName,
      toEmail: email,
      toName: donor?.name ?? null,
      subject: "Registration received (Raktodaan)",
      html,
      text,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Mailjet send failed";
    return jsonResponse({ error: "Failed to send email", providerError: msg }, 500);
  }

  return jsonResponse({ ok: true, notified: true });
});

