import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

type RejectDonorBody = {
  donor_user_id: string;
  rejection_reason?: string;
};

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

  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(
      { error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      500,
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return jsonResponse({ error: "Missing Authorization bearer token" }, 401);

  const mailjetKey = Deno.env.get("MAILJET_API_KEY") ?? "";
  const mailjetSecret = Deno.env.get("MAILJET_API_SECRET") ?? "";
  const mailjetFromEmail = Deno.env.get("MAILJET_FROM_EMAIL") ?? "";
  const mailjetFromName = Deno.env.get("MAILJET_FROM_NAME") ?? "Raktodaan";
  const canSendEmail = Boolean(mailjetKey && mailjetSecret && mailjetFromEmail);

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: callerUser, error: callerErr } = await adminClient.auth.getUser(jwt);
  if (callerErr || !callerUser?.user) return jsonResponse({ error: "Unauthorized caller" }, 401);
  const { data: adminRow, error: adminCheckErr } = await adminClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", callerUser.user.id)
    .maybeSingle();
  if (adminCheckErr) return jsonResponse({ error: "Admin check failed" }, 500);
  if (!adminRow) return jsonResponse({ error: "Forbidden: admin only" }, 403);

  const body = (await req.json().catch(() => ({}))) as RejectDonorBody;
  const donorUserId = body?.donor_user_id;
  if (!donorUserId) return jsonResponse({ error: "Missing donor_user_id" }, 400);

  const rejectionReason = (body.rejection_reason ?? "").trim() || null;
  const reviewedAt = new Date().toISOString();

  // Fetch email + donor name for rejection email.
  const { data: authUserRes } = await adminClient.auth.admin.getUserById(donorUserId);
  const donorEmail = authUserRes?.user?.email ?? null;
  const { data: donorRow } = await adminClient
    .from("donors")
    .select("name")
    .eq("user_id", donorUserId)
    .maybeSingle();

  // Mark donor as rejected + keep them locked.
  const { error: donorUpdateErr } = await adminClient
    .from("donors")
    .update({
      id_card_verified: false,
      reviewed_at: reviewedAt,
      reviewed_by: callerUser.user.id,
      rejection_reason: rejectionReason,
    })
    .eq("user_id", donorUserId);

  if (donorUpdateErr) {
    return jsonResponse({ error: `Failed to update donors row: ${donorUpdateErr.message}` }, 500);
  }

  // Record rejection event for dashboard audit trail.
  await adminClient.from("donor_verification_events").insert({
    donor_user_id: donorUserId,
    admin_user_id: callerUser.user.id,
    verified_at: reviewedAt,
    note: rejectionReason ? `Rejected: ${rejectionReason}` : "Rejected",
  });

  // Ensure they cannot log in.
  const { error: banErr } = await adminClient.auth.admin.updateUserById(donorUserId, {
    ban_duration: "876000h",
  });
  if (banErr) {
    return jsonResponse({ error: `Failed to lock user: ${banErr.message}` }, 500);
  }

  // Clear forced-change/password state (temp password is no longer valid).
  const { error: profileUpdateErr } = await adminClient
    .from("profiles")
    .update({
      must_change_password: false,
      temp_password_set_at: null,
      temp_password_expires_at: null,
    })
    .eq("user_id", donorUserId);

  if (profileUpdateErr) {
    return jsonResponse({ error: `Failed to update profiles row: ${profileUpdateErr.message}` }, 500);
  }

  // Send rejection email (best-effort).
  if (canSendEmail && donorEmail) {
    const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/+$/, "");
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2 style="margin:0 0 10px 0;">Donor registration update</h2>
        <p style="margin:0 0 10px 0;">Hi${donorRow?.name ? ` ${donorRow.name}` : ""},</p>
        <p style="margin:0 0 10px 0;">Your donor registration was <b>rejected</b> by admin.</p>
        <p style="margin:0 0 10px 0;"><b>Reason:</b> ${rejectionReason ?? "Not provided"}</p>
        ${
          appUrl
            ? `<p style="margin:0 0 10px 0;">You can submit again here: <a href="${appUrl}/donor/onboarding">Donor Registration</a></p>`
            : ""
        }
      </div>
    `;
    try {
      await sendMailjetEmail({
        apiKey: mailjetKey,
        apiSecret: mailjetSecret,
        fromEmail: mailjetFromEmail,
        fromName: mailjetFromName,
        toEmail: donorEmail,
        toName: donorRow?.name ?? null,
        subject: "Donor registration rejected (Raktodaan)",
        html,
      });
    } catch {
      // ignore email errors
    }
  }

  return jsonResponse({ ok: true });
});

