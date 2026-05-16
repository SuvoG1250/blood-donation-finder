import { createClient } from "@supabase/supabase-js";
import type { EmailTemplateRow } from "@/lib/emailTemplateEngine";

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

const TEMPLATE_KEYS = [
  "donor_approved_welcome",
  "donor_rejected_notice",
  "admin_account_created_welcome",
  "hospital_account_created_welcome",
] as const;

function getDefaultTemplates(): Record<(typeof TEMPLATE_KEYS)[number], EmailTemplateRow> {
  return {
    donor_approved_welcome: {
      template_key: "donor_approved_welcome",
      subject_template: "Your Raktodaan donor profile is approved",
      preheader_template: "Your donor registration was approved — sign in to continue.",
      html_template: `
        <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color: #111;">
          <h2 style="margin:0 0 12px 0; font-size: 20px;">Welcome{displayName}!</h2>
          <p style="margin:0 0 12px 0;">Your donor registration has been <b>approved</b>.</p>
          <p style="margin:0 0 12px 0;">You can sign in using your existing password.</p>
          <p style="margin:0;">
            <a href="{signInUrl}" style="color:#b91c1c;">Sign in</a>
            &nbsp;·&nbsp;
            <a href="{dashboardUrl}" style="color:#b91c1c;">Donor dashboard</a>
          </p>
          <p style="margin:12px 0 0 0; color:#525252; font-size:12px;">Raktodaan donor system email.</p>
        </div>
      `.trim(),
      text_template: [
        "Welcome{displayName}!",
        "",
        "Your donor registration has been approved.",
        "You can sign in using your existing password.",
        "Sign in: {signInUrl}",
        "Donor dashboard: {dashboardUrl}",
        "",
        "Raktodaan donor system email.",
      ].join("\n"),
    },
    donor_rejected_notice: {
      template_key: "donor_rejected_notice",
      subject_template: "Update on your Raktodaan donor registration",
      preheader_template: "Your donor registration was reviewed — details inside.",
      html_template: `
        <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color: #111;">
          <h2 style="margin:0 0 12px 0; font-size: 18px;">Donor registration update{displayName}</h2>
          <p style="margin:0 0 12px 0;">Your donor registration could not be approved at this time.</p>
          <p style="margin:0 0 12px 0;"><b>Reason:</b> {reason}</p>
          <p style="margin:0;">
            <a href="{onboardingUrl}" style="color:#b91c1c;">Submit registration again</a>
          </p>
          <p style="margin:12px 0 0 0; color:#525252; font-size:12px;">Raktodaan donor system email.</p>
        </div>
      `.trim(),
      text_template: [
        "Donor registration update{displayName}",
        "",
        "Your donor registration could not be approved at this time.",
        "Reason: {reason}",
        "Submit registration again: {onboardingUrl}",
        "",
        "Raktodaan donor system email.",
      ].join("\n"),
    },
    admin_account_created_welcome: {
      template_key: "admin_account_created_welcome",
      subject_template: "Your Raktodaan admin account",
      preheader_template: "Admin sign-in details — Raktodaan.",
      html_template: `
        <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color:#111;">
          <h2 style="margin:0 0 12px 0; font-size:18px;">Welcome to Raktodaan Admin</h2>
          <p style="margin:0 0 12px 0;">Your admin account has been created with role: <b>{role}</b>.</p>
          <p style="margin:0 0 12px 0;">Sign in with your assigned password.</p>
          <p style="margin:0;">
            <a href="{adminSignInUrl}" style="color:#b91c1c;">Open admin sign in</a>
          </p>
          <p style="margin:12px 0 0 0; color:#525252; font-size:12px;">Transactional message from Raktodaan.</p>
        </div>
      `.trim(),
      text_template: [
        "Welcome to Raktodaan Admin",
        "Your admin account has been created with role: {role}.",
        "Sign in with your assigned password.",
        "Admin sign in: {adminSignInUrl}",
        "",
        "Transactional message from Raktodaan.",
      ].join("\n"),
    },
    hospital_account_created_welcome: {
      template_key: "hospital_account_created_welcome",
      subject_template: "Your Raktodaan hospital account",
      preheader_template: "Hospital portal access — Raktodaan.",
      html_template: `
        <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color:#111;">
          <h2 style="margin:0 0 12px 0; font-size:18px;">Welcome to Raktodaan Hospital</h2>
          <p style="margin:0 0 12px 0;">Your hospital account has been created{hospitalNamePart}.</p>
          <p style="margin:0 0 12px 0;">Sign in with your assigned password.</p>
          <p style="margin:0;">
            <a href="{hospitalSignInUrl}" style="color:#b91c1c;">Open hospital sign in</a>
          </p>
          <p style="margin:12px 0 0 0; color:#525252; font-size:12px;">Transactional message from Raktodaan.</p>
        </div>
      `.trim(),
      text_template: [
        "Welcome to Raktodaan Hospital",
        "Your hospital account has been created{hospitalNamePart}.",
        "Sign in with your assigned password.",
        "Hospital sign in: {hospitalSignInUrl}",
        "",
        "Transactional message from Raktodaan.",
      ].join("\n"),
    },
  };
}

export async function GET(req: Request) {
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
  if (roleErr) return json({ error: `Super admin check failed: ${roleErr.message}` }, 500);
  if ((roleRow as { admin_role?: string } | null)?.admin_role !== "super_admin") {
    const { data: permRow } = await adminClient
      .from("admin_permissions")
      .select("can_edit_email_templates")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!Boolean((permRow as { can_edit_email_templates?: boolean } | null)?.can_edit_email_templates)) {
      return json({ error: "Forbidden: edit email templates permission required" }, 403);
    }
  }

  const defaults = getDefaultTemplates();

  const { data } = await adminClient
    .from("email_templates")
    .select("template_key,subject_template,preheader_template,html_template,text_template,updated_at")
    .in("template_key", [...TEMPLATE_KEYS]);

  type EmailTplRow = {
    template_key: string;
    subject_template: string;
    preheader_template: string | null;
    html_template: string;
    text_template: string;
    updated_at: string;
  };
  const existing = new Map<string, EmailTplRow>();
  for (const row of (data ?? []) as EmailTplRow[]) {
    existing.set(row.template_key, row);
  }

  const templates: Record<string, EmailTemplateRow> = {};
  for (const key of TEMPLATE_KEYS) {
    const row = existing.get(key);
    templates[key] = row
      ? {
          template_key: row.template_key,
          subject_template: row.subject_template,
          preheader_template: row.preheader_template,
          html_template: row.html_template,
          text_template: row.text_template,
          updated_at: row.updated_at,
        }
      : defaults[key];
  }

  return json({ ok: true, templates });
}

type PostBody = {
  templates?: Partial<
    Record<
      (typeof TEMPLATE_KEYS)[number],
      {
        subject_template?: string;
        preheader_template?: string | null;
        html_template?: string;
        text_template?: string;
      }
    >
  >;
};

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
  if (roleErr) return json({ error: `Super admin check failed: ${roleErr.message}` }, 500);
  if ((roleRow as { admin_role?: string } | null)?.admin_role !== "super_admin") {
    const { data: permRow } = await adminClient
      .from("admin_permissions")
      .select("can_edit_email_templates")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (!Boolean((permRow as { can_edit_email_templates?: boolean } | null)?.can_edit_email_templates)) {
      return json({ error: "Forbidden: edit email templates permission required" }, 403);
    }
  }

  const body = (await req.json().catch(() => ({}))) as PostBody;
  if (!body.templates) return json({ error: "Missing templates payload" }, 400);

  const rows: Array<{
    template_key: string;
    subject_template: string;
    preheader_template: string | null;
    html_template: string;
    text_template: string;
  }> = [];

  for (const key of TEMPLATE_KEYS) {
    const t = body.templates[key];
    if (!t) continue;
    const subject = String(t.subject_template ?? "").trim();
    const html = String(t.html_template ?? "").trim();
    const text = String(t.text_template ?? "").trim();
    const preheader =
      t.preheader_template === undefined ? null : String(t.preheader_template ?? "").trim();

    if (!subject || !html || !text) {
      return json({ error: `Template ${key}: subject/html/text are required.` }, 400);
    }

    // Prevent accidental huge payload or odd whitespace issues.
    if (html.length > 50_000 || text.length > 20_000 || subject.length > 500) {
      return json({ error: `Template ${key}: content too large.` }, 400);
    }

    rows.push({
      template_key: key,
      subject_template: subject,
      preheader_template: preheader,
      html_template: html,
      text_template: text,
    });
  }

  if (rows.length === 0) return json({ error: "No templates provided." }, 400);

  const { error } = await adminClient.from("email_templates").upsert(rows, {
    onConflict: "template_key",
  });

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, saved: rows.length });
}

