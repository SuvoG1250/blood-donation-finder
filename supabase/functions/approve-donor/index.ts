import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

type ApproveDonorBody = {
  donor_user_id: string;
};

function generateTempPassword(length: number) {
  // Avoid ambiguous characters for readability.
  const charset =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";

  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += charset[bytes[i] % charset.length];
  }
  return out;
}

function getExpiryAtIsoFromHours(hours: number | null) {
  if (!hours || hours <= 0) return null;
  const ms = hours * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
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
        },
      ],
    }),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(text || `Mailjet send failed (${resp.status})`);
  return text;
}

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

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(
      {
        error:
          "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars for this Edge Function.",
      },
      500,
    );
  }

  const mailjetKey = Deno.env.get("MAILJET_API_KEY") ?? "";
  const mailjetSecret = Deno.env.get("MAILJET_API_SECRET") ?? "";
  const mailjetFromEmail = Deno.env.get("MAILJET_FROM_EMAIL") ?? "";
  const mailjetFromName = Deno.env.get("MAILJET_FROM_NAME") ?? "Raktodaan";
  const canSendEmail = Boolean(mailjetKey && mailjetSecret && mailjetFromEmail);

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return jsonResponse({ error: "Missing Authorization: Bearer <jwt>" }, 401);
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: callerUser, error: callerUserErr } = await adminClient.auth.getUser(jwt);
  if (callerUserErr || !callerUser?.user) {
    return jsonResponse({ error: "Unauthorized caller" }, 401);
  }

  const { data: adminRow, error: adminCheckErr } = await adminClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", callerUser.user.id)
    .maybeSingle();
  if (adminCheckErr) {
    return jsonResponse({ error: "Admin check failed" }, 500);
  }
  if (!adminRow) {
    return jsonResponse({ error: "Forbidden: admin only" }, 403);
  }

  const body = (await req.json()) as ApproveDonorBody;
  const donorUserId = body?.donor_user_id;
  if (!donorUserId) {
    return jsonResponse({ error: "Missing donor_user_id" }, 400);
  }

  const expiryHoursEnv = Deno.env.get("TEMP_PASSWORD_EXPIRY_HOURS");
  const expiryHours = expiryHoursEnv
    ? Number(expiryHoursEnv)
    : null;
  const tempPasswordExpiryAtIso = getExpiryAtIsoFromHours(expiryHours);

  // Fresh temp password every approval (rotate-each-approve).
  const tempPassword = generateTempPassword(20);

  // Fetch donor row for a couple of fields (name) + to ensure the donor exists.
  const { data: donor, error: donorErr } = await adminClient
    .from("donors")
    .select("user_id, name, id_card_verified")
    .eq("user_id", donorUserId)
    .maybeSingle();

  if (donorErr || !donor) {
    return jsonResponse(
      { error: "Donor not found" },
      404,
    );
  }

  if (donor.id_card_verified) {
    return jsonResponse(
      { error: "Donor is already approved" },
      409,
    );
  }

  // Fetch auth user (email) so the email can include "User ID (Email)".
  const { data: authUserRes, error: authUserErr } = await adminClient.auth.admin.getUserById(
    donorUserId,
  );
  const donorEmail = authUserRes?.user?.email;
  if (authUserErr || !donorEmail) {
    return jsonResponse(
      { error: "Donor auth user not found or missing email" },
      400,
    );
  }

  // Update auth user password and lift any ban. (If you already ban
  // unapproved donors during registration, this unbans them.)
  const { error: passwordErr } = await adminClient.auth.admin.updateUserById(
    donorUserId,
    {
      password: tempPassword,
      ban_duration: "none",
      // You can also set email_confirmed: true here if needed, but only do it
      // if your registration flow expects unconfirmed emails.
    },
  );

  if (passwordErr) {
    return jsonResponse(
      { error: `Failed to set temporary password: ${passwordErr.message}` },
      500,
    );
  }

  const reviewedAt = new Date().toISOString();

  // Mark donor as verified in your domain tables.
  const { error: donorUpdateErr } = await adminClient
    .from("donors")
    .update({
      id_card_verified: true,
      reviewed_at: reviewedAt,
      reviewed_by: callerUser.user.id,
    })
    .eq("user_id", donorUserId);

  if (donorUpdateErr) {
    return jsonResponse(
      { error: `Failed to update donors row: ${donorUpdateErr.message}` },
      500,
    );
  }

  // Record verification event (optional audit trail).
  await adminClient.from("donor_verification_events").insert({
    donor_user_id: donorUserId,
    admin_user_id: callerUser.user.id,
    verified_at: reviewedAt,
    note: "Approved",
  });

  // Force first-login password change.
  const { error: profileUpdateErr } = await adminClient
    .from("profiles")
    .update({
      must_change_password: true,
      temp_password_set_at: reviewedAt,
      temp_password_expires_at: tempPasswordExpiryAtIso,
    })
    .eq("user_id", donorUserId);

  if (profileUpdateErr) {
    return jsonResponse(
      { error: `Failed to update profiles row: ${profileUpdateErr.message}` },
      500,
    );
  }

  const expiryText = tempPasswordExpiryAtIso
    ? `Temporary password expiry: ${new Date(tempPasswordExpiryAtIso).toLocaleString()}`
    : "Temporary password expiry: (not set)";

  // Send email to donor with the temp password (Mailjet).
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
  const signInUrl = appUrl ? `${appUrl}/sign-in` : "";
  const donorDashUrl = appUrl ? `${appUrl}/donor/dashboard` : "";

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2 style="margin:0 0 10px 0;">Welcome${donor?.name ? `, ${donor.name}` : ""}!</h2>
      <p style="margin:0 0 10px 0;">Your donor registration has been <b>approved</b>. Thank you for joining Raktodaan.</p>
      <div style="border:1px solid #eee; border-radius:12px; padding:12px; background:#fafafa;">
        <div><b>User ID (Email):</b> ${donorEmail}</div>
        <div><b>Temporary Password:</b> ${tempPassword}</div>
        <div style="margin-top:6px; color:#555;">${expiryText}</div>
      </div>
      <p style="margin:12px 0 0 0;"><b>Important:</b> Please sign in and change your password immediately.</p>
      ${
        signInUrl
          ? `<p style="margin:12px 0 0 0;"><a href="${signInUrl}">Sign in</a> → then go to <a href="${appUrl}/change-password">Change Password</a>.</p>`
          : ""
      }
      ${
        donorDashUrl
          ? `<p style="margin:10px 0 0 0;">After login, open your Donor Dashboard to manage availability and download your donor ID card.</p>
             <p style="margin:6px 0 0 0;"><a href="${donorDashUrl}">Open Donor Dashboard</a></p>`
          : ""
      }
      <p style="margin:16px 0 0 0; color:#666; font-size:12px;">If you didn’t request this, ignore this email.</p>
    </div>
  `;

  let emailResult: { sent: boolean; error?: string } | null = null;
  if (canSendEmail) {
    try {
      await sendMailjetEmail({
        apiKey: mailjetKey,
        apiSecret: mailjetSecret,
        fromEmail: mailjetFromEmail,
        fromName: mailjetFromName,
        toEmail: donorEmail,
        toName: donor?.name ?? null,
        subject: "Your donor account is approved (Raktodaan)",
        html: emailHtml,
      });
      emailResult = { sent: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Mailjet send failed";
      emailResult = { sent: false, error: msg };
    }
  } else {
    emailResult = { sent: false, error: "MAILJET_* env vars not configured" };
  }

  return jsonResponse({ ok: true, emailResult });
});

