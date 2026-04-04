import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

type NotifyBody = {
  request_id: string;
};

type LogStatus =
  | "matched"
  | "sent"
  | "failed"
  | "skipped_no_email"
  | "provider_not_configured";

async function sendMailjetEmail(opts: {
  apiKey: string;
  apiSecret: string;
  fromEmail: string;
  fromName: string;
  toEmails: string[];
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
          To: opts.toEmails.map((Email) => ({ Email })),
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
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function dayAbbrevFromIso(iso: string | null | undefined): string {
  const dt = iso ? new Date(iso) : new Date();
  if (Number.isNaN(dt.getTime())) return "Mon";
  const day = dt.getUTCDay(); // 0=Sun..6=Sat
  const map: Record<number, string> = {
    0: "Sun",
    1: "Mon",
    2: "Tue",
    3: "Wed",
    4: "Thu",
    5: "Fri",
    6: "Sat",
  };
  return map[day] ?? "Mon";
}

function timeSlotFromIso(iso: string | null | undefined): string {
  const dt = iso ? new Date(iso) : new Date();
  if (Number.isNaN(dt.getTime())) return "Morning";
  const hour = dt.getUTCHours();
  if (hour >= 5 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  return "Evening";
}

function toWhatsAppLink(contact: string): string {
  const digits = contact.replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}`;
}

async function writeLog(
  adminClient: ReturnType<typeof createClient>,
  row: {
    request_id: string;
    donor_user_id: string | null;
    donor_email: string | null;
    status: LogStatus;
    error_message?: string | null;
  },
) {
  await adminClient.from("emergency_notification_logs").insert(row);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const mailjetKey = Deno.env.get("MAILJET_API_KEY") ?? "";
  const mailjetSecret = Deno.env.get("MAILJET_API_SECRET") ?? "";
  const mailjetFromEmail = Deno.env.get("MAILJET_FROM_EMAIL") ?? "";
  const mailjetFromName = Deno.env.get("MAILJET_FROM_NAME") ?? "Raktodaan";

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return jsonResponse(
      {
        error:
          "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars for this Edge Function.",
      },
      500,
    );
  }

  const canSendEmail = Boolean(mailjetKey && mailjetSecret && mailjetFromEmail);

  const body = (await req.json().catch(() => null)) as NotifyBody | null;
  const requestId = body?.request_id;
  if (!requestId) {
    return jsonResponse({ error: "Missing request_id" }, 400);
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

  const { data: emergency, error: emErr } = await adminClient
    .from("emergency_requests")
    .select(
      "request_id,blood_group,district,block,panchayat,patient_name,request_details,contact_number,created_at",
    )
    .eq("request_id", requestId)
    .maybeSingle();

  if (emErr || !emergency) {
    return jsonResponse(
      { error: "Emergency request not found" },
      404,
    );
  }

  // Match eligible donors using the existing RPC that already supports:
  // - donor eligibility (90-day rule)
  // - preferred_days / preferred_time_slots (empty array => no restriction)
  const p_day = dayAbbrevFromIso(emergency.created_at);
  const p_time_slot = timeSlotFromIso(emergency.created_at);

  const { data: matchedRows, error: matchErr } = await adminClient.rpc(
    "get_donors_for_emergency",
    {
      p_blood_group: emergency.blood_group,
      p_district: emergency.district,
      p_block: emergency.block,
      p_panchayat: emergency.panchayat,
      p_day,
      p_time_slot,
    },
  );

  if (matchErr) {
    return jsonResponse({ error: `Donor match failed: ${matchErr.message}` }, 500);
  }

  const matched = (matchedRows ?? []) as Array<{
    donor_user_id: string;
    email: string | null;
    name: string | null;
  }>;

  const recipientRows: Array<{ donor_user_id: string; donor_email: string }> = [];
  for (const row of matched) {
    if (row.email) {
      recipientRows.push({ donor_user_id: row.donor_user_id, donor_email: row.email });
      await writeLog(adminClient, {
        request_id: requestId,
        donor_user_id: row.donor_user_id,
        donor_email: row.email,
        status: "matched",
      });
    } else {
      await writeLog(adminClient, {
        request_id: requestId,
        donor_user_id: row.donor_user_id,
        donor_email: null,
        status: "skipped_no_email",
      });
    }
  }

  const dedup = new Map<string, string>();
  for (const row of recipientRows) {
    if (!dedup.has(row.donor_email)) dedup.set(row.donor_email, row.donor_user_id);
  }
  const uniqueRecipients = Array.from(dedup.entries()).map(([donor_email, donor_user_id]) => ({
    donor_email,
    donor_user_id,
  }));

  if (matched.length === 0) {
    return jsonResponse({
      ok: true,
      notified: 0,
      warning: "No matching donors found for this emergency.",
    });
  }

  let warning: string | null = null;
  let sentCount = 0; // email sent count

  if (!canSendEmail) {
    for (const row of uniqueRecipients) {
      await writeLog(adminClient, {
        request_id: requestId,
        donor_user_id: row.donor_user_id,
        donor_email: row.donor_email,
        status: "provider_not_configured",
      });
    }
    warning = "Email provider not configured (MAILJET_* env vars missing).";
  } else if (uniqueRecipients.length === 0) {
    warning = "No donor emails found for this emergency.";
  } else {
    const waLink = toWhatsAppLink(emergency.contact_number ?? "");
    const subject = "Emergency blood request near you";

    const detailsLines = [
      emergency.patient_name ? `Patient: ${emergency.patient_name}` : null,
      `Blood group: ${emergency.blood_group}`,
      `Location: ${emergency.district} / ${emergency.block} / ${emergency.panchayat}`,
      `Contact: ${emergency.contact_number}`,
    ].filter(Boolean);

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Urgent blood request</h2>
        <p>An emergency request has been posted in your area.</p>
        <p>${detailsLines.join("<br />")}</p>
        <p style="margin-top: 12px;"><b>Details:</b></p>
        <p>${(emergency.request_details ?? "").replace(/\n/g, "<br />")}</p>
        <p style="margin-top: 16px;">
          You can contact directly on WhatsApp:
          <a href="${waLink}">${waLink}</a>
        </p>
      </div>
    `;

    for (const row of uniqueRecipients) {
      try {
        await sendMailjetEmail({
          apiKey: mailjetKey,
          apiSecret: mailjetSecret,
          fromEmail: mailjetFromEmail,
          fromName: mailjetFromName,
          toEmails: [row.donor_email],
          subject,
          html: emailHtml,
        });
        sentCount += 1;
        await writeLog(adminClient, {
          request_id: requestId,
          donor_user_id: row.donor_user_id,
          donor_email: row.donor_email,
          status: "sent",
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Mailjet send failed";
        await writeLog(adminClient, {
          request_id: requestId,
          donor_user_id: row.donor_user_id,
          donor_email: row.donor_email,
          status: "failed",
          error_message: msg,
        });
      }
    }
  }

  return jsonResponse({
    ok: true,
    notified: sentCount,
    warning: warning ?? undefined,
  });
});

