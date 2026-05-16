import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import {
  escapeHtmlText,
  getMailjetConfig,
  sendMailjetMessage,
} from "@/lib/mailjet";
import { logSuperAdminAction } from "@/lib/superAdminAudit";
import { fillHtmlTemplate, fillTemplate } from "@/lib/emailTemplateEngine";

type AdminPermissionsPayload = {
  can_delete_donor: boolean;
  can_delete_emergency: boolean;
  can_update_emergency_status: boolean;
  can_bulk_expire_open_emergencies: boolean;
  can_resend_emergency_notify: boolean;
  can_manage_admins: boolean;
  can_view_audit_log: boolean;
  can_preview_emergency_notifications: boolean;
  can_send_mailjet_test_email: boolean;
  can_edit_email_templates: boolean;
  can_view_donor_lookup: boolean;
  can_view_duplicate_contacts: boolean;
  can_edit_site_settings: boolean;
  can_view_system_health: boolean;
  can_broadcast: boolean;
};

type Body =
  | { action: "list" }
  | { action: "set_role"; user_id: string; admin_role: "staff" | "super_admin" }
  | { action: "list_hospitals" }
  | { action: "set_hospital_verified"; user_id: string; is_verified: boolean }
  | { action: "resend_admin_credentials"; user_id: string }
  | { action: "resend_hospital_credentials"; user_id: string }
  | { action: "get_admin_permissions"; user_id: string }
  | { action: "update_admin_permissions"; user_id: string; permissions: AdminPermissionsPayload }
  | {
      action: "create_admin";
      email: string;
      password: string;
      admin_role?: "staff" | "super_admin";
      permissions?: Partial<{
        can_delete_donor: boolean;
        can_delete_emergency: boolean;
        can_update_emergency_status: boolean;
        can_bulk_expire_open_emergencies: boolean;
        can_resend_emergency_notify: boolean;
        can_manage_admins: boolean;
        can_view_audit_log: boolean;
        can_preview_emergency_notifications: boolean;
        can_send_mailjet_test_email: boolean;
        can_edit_email_templates: boolean;
        can_view_donor_lookup: boolean;
        can_view_duplicate_contacts: boolean;
        can_edit_site_settings: boolean;
        can_view_system_health: boolean;
        can_broadcast: boolean;
      }>;
    }
  | {
      action: "create_hospital";
      email: string;
      password: string;
      hospital_name?: string;
      hospital_permissions?: Partial<{
        can_post_emergency: boolean;
        can_update_own_emergency_status: boolean;
      }>;
    };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function generateTempPassword(length = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function logEmailEvent(
  adminClient: unknown,
  row: {
    event_type: string;
    actor_user_id?: string | null;
    target_user_id?: string | null;
    target_email?: string | null;
    status: "sent" | "failed" | "skipped";
    error_message?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  const client = adminClient as {
    from: (table: string) => { insert: (values: never) => Promise<unknown> };
  };
  try {
    await client.from("user_email_event_logs").insert({
      event_type: row.event_type,
      actor_user_id: row.actor_user_id ?? null,
      target_user_id: row.target_user_id ?? null,
      target_email: row.target_email ?? null,
      status: row.status,
      error_message: row.error_message ?? null,
      metadata: row.metadata ?? {},
    } as never);
  } catch {
    // non-blocking audit write
  }
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
  if (!resp.ok) {
    throw new Error(text || `Auth user fetch failed (${resp.status})`);
  }
  const json = JSON.parse(text) as { id?: string };
  if (!json?.id) throw new Error("Auth user id missing");
  return { user_id: json.id };
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const jwt = auth.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ error: "Missing Authorization bearer token" }, 401);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: "Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  let callerUserId: string;
  try {
    callerUserId = (await getCallerUserIdOrThrow({ supabaseUrl, anonKey, jwt })).user_id;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unauthorized caller";
    return json({ error: `Unauthorized caller: ${msg}` }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const mj = getMailjetConfig();
  const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const { data: roleRow, error: roleErr } = await adminClient
    .from("admin_users")
    .select("admin_role")
    .eq("user_id", callerUserId)
    .maybeSingle();
  if (roleErr) return json({ error: "Super admin check failed" }, 500);
  if ((roleRow as { admin_role?: string } | null)?.admin_role !== "super_admin") {
    const { data: permRow } = await adminClient
      .from("admin_permissions")
      .select("can_manage_admins")
      .eq("user_id", callerUserId)
      .maybeSingle();
    const canManage = Boolean((permRow as { can_manage_admins?: boolean } | null)?.can_manage_admins);
    if (!canManage) return json({ error: "Forbidden: manage permissions only" }, 403);
  }

  const rawBody = (await req.json().catch(() => ({}))) as Body;

  if (rawBody.action === "list") {
    const { data: rows, error } = await adminClient
      .from("admin_users")
      .select("user_id,admin_role,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return json({ error: error.message }, 500);

    const out = await Promise.all(
      (rows ?? []).map(async (r) => {
        const { data } = await adminClient.auth.admin.getUserById(r.user_id);
        return {
          user_id: r.user_id,
          email: data?.user?.email ?? null,
          admin_role: (r as { admin_role?: string }).admin_role ?? "staff",
          created_at: (r as { created_at?: string | null }).created_at ?? null,
        };
      }),
    );
    return json({ ok: true, admins: out });
  }

  if (rawBody.action === "list_hospitals") {
    const { data: rows, error } = await adminClient
      .from("hospital_users")
      .select("user_id,name,is_verified,created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return json({ error: error.message }, 500);

    const out = await Promise.all(
      (rows ?? []).map(async (r) => {
        const { data } = await adminClient.auth.admin.getUserById(r.user_id);
        return {
          user_id: r.user_id,
          email: data?.user?.email ?? null,
          name: (r as { name?: string | null }).name ?? null,
          is_verified: Boolean((r as { is_verified?: boolean | null }).is_verified ?? false),
          created_at: (r as { created_at?: string | null }).created_at ?? null,
        };
      }),
    );
    return json({ ok: true, hospitals: out });
  }

  if (rawBody.action === "set_hospital_verified") {
    const userId = rawBody.user_id;
    const isVerified = Boolean(rawBody.is_verified);
    if (!userId) return json({ error: "Invalid payload" }, 400);
    const { data: prev } = await adminClient
      .from("hospital_users")
      .select("is_verified")
      .eq("user_id", userId)
      .maybeSingle();
    const prevVal = Boolean((prev as { is_verified?: boolean | null } | null)?.is_verified ?? false);

    const { error } = await adminClient
      .from("hospital_users")
      .update({ is_verified: isVerified })
      .eq("user_id", userId);
    if (error) return json({ error: error.message }, 500);

    await logSuperAdminAction(adminClient, {
      actor_user_id: callerUserId,
      action_type: "hospital_verified_changed",
      target_kind: "hospital_user",
      target_id: userId,
      metadata: { from: prevVal, to: isVerified },
    });
    return json({ ok: true });
  }

  if (rawBody.action === "get_admin_permissions") {
    const userId = (rawBody as { user_id?: string }).user_id;
    if (!userId) return json({ error: "Invalid payload" }, 400);
    const { data: au, error: auErr } = await adminClient
      .from("admin_users")
      .select("admin_role")
      .eq("user_id", userId)
      .maybeSingle();
    if (auErr) return json({ error: auErr.message }, 500);
    if (!au) return json({ error: "Not an admin user" }, 404);
    const role = (au as { admin_role?: string }).admin_role ?? "staff";
    if (role === "super_admin") {
      return json({ error: "Super admin permissions are implicit (all enabled)" }, 400);
    }
    const { data: perm, error: pErr } = await adminClient
      .from("admin_permissions")
      .select(
        "can_delete_donor,can_delete_emergency,can_update_emergency_status,can_bulk_expire_open_emergencies,can_resend_emergency_notify,can_manage_admins,can_view_audit_log,can_preview_emergency_notifications,can_send_mailjet_test_email,can_edit_email_templates,can_view_donor_lookup,can_view_duplicate_contacts,can_edit_site_settings,can_view_system_health,can_broadcast",
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (pErr) return json({ error: pErr.message }, 500);
    const p = (perm ?? {}) as Partial<AdminPermissionsPayload>;
    const permissions: AdminPermissionsPayload = {
      can_delete_donor: Boolean(p.can_delete_donor),
      can_delete_emergency: Boolean(p.can_delete_emergency),
      can_update_emergency_status: Boolean(p.can_update_emergency_status),
      can_bulk_expire_open_emergencies: Boolean(p.can_bulk_expire_open_emergencies),
      can_resend_emergency_notify: Boolean(p.can_resend_emergency_notify),
      can_manage_admins: Boolean(p.can_manage_admins),
      can_view_audit_log: Boolean(p.can_view_audit_log),
      can_preview_emergency_notifications: Boolean(p.can_preview_emergency_notifications),
      can_send_mailjet_test_email: Boolean(p.can_send_mailjet_test_email),
      can_edit_email_templates: Boolean(p.can_edit_email_templates),
      can_view_donor_lookup: Boolean(p.can_view_donor_lookup),
      can_view_duplicate_contacts: Boolean(p.can_view_duplicate_contacts),
      can_edit_site_settings: Boolean(p.can_edit_site_settings),
      can_view_system_health: Boolean(p.can_view_system_health),
      can_broadcast: Boolean(p.can_broadcast),
    };
    return json({ ok: true, admin_role: role, permissions });
  }

  if (rawBody.action === "update_admin_permissions") {
    const userId = (rawBody as { user_id?: string }).user_id;
    const perms = (rawBody as { permissions?: AdminPermissionsPayload }).permissions;
    if (!userId || !perms) return json({ error: "Invalid payload" }, 400);
    const { data: au, error: auErr } = await adminClient
      .from("admin_users")
      .select("admin_role")
      .eq("user_id", userId)
      .maybeSingle();
    if (auErr) return json({ error: auErr.message }, 500);
    if (!au) return json({ error: "Not an admin user" }, 404);
    if ((au as { admin_role?: string }).admin_role === "super_admin") {
      return json({ error: "Cannot edit super admin permissions" }, 400);
    }
    const { error: upErr } = await adminClient.from("admin_permissions").upsert(
      {
        user_id: userId,
        can_delete_donor: Boolean(perms.can_delete_donor),
        can_delete_emergency: Boolean(perms.can_delete_emergency),
        can_update_emergency_status: Boolean(perms.can_update_emergency_status),
        can_bulk_expire_open_emergencies: Boolean(perms.can_bulk_expire_open_emergencies),
        can_resend_emergency_notify: Boolean(perms.can_resend_emergency_notify),
        can_manage_admins: Boolean(perms.can_manage_admins),
        can_view_audit_log: Boolean(perms.can_view_audit_log),
        can_preview_emergency_notifications: Boolean(perms.can_preview_emergency_notifications),
        can_send_mailjet_test_email: Boolean(perms.can_send_mailjet_test_email),
        can_edit_email_templates: Boolean(perms.can_edit_email_templates),
        can_view_donor_lookup: Boolean(perms.can_view_donor_lookup),
        can_view_duplicate_contacts: Boolean(perms.can_view_duplicate_contacts),
        can_edit_site_settings: Boolean(perms.can_edit_site_settings),
        can_view_system_health: Boolean(perms.can_view_system_health),
        can_broadcast: Boolean(perms.can_broadcast),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (upErr) return json({ error: upErr.message }, 500);
    await logSuperAdminAction(adminClient, {
      actor_user_id: callerUserId,
      action_type: "admin_permissions_updated",
      target_kind: "admin_user",
      target_id: userId,
      metadata: { permissions: perms },
    });
    return json({ ok: true });
  }

  if (rawBody.action === "set_role") {
    const userId = rawBody.user_id;
    const role = rawBody.admin_role;
    if (!userId || (role !== "staff" && role !== "super_admin")) {
      return json({ error: "Invalid payload" }, 400);
    }
    const { data: prevRow } = await adminClient
      .from("admin_users")
      .select("admin_role")
      .eq("user_id", userId)
      .maybeSingle();
    const prevRole = (prevRow as { admin_role?: string } | null)?.admin_role ?? null;

    // Safety: avoid accidental demotion of super admins.
    if (prevRole === "super_admin" && role === "staff") {
      if ((roleRow as { admin_role?: string } | null)?.admin_role !== "super_admin") {
        return json({ error: "Protected: cannot demote super admin to staff" }, 403);
      }
    }

    const { error } = await adminClient
      .from("admin_users")
      .update({ admin_role: role })
      .eq("user_id", userId);
    if (error) return json({ error: error.message }, 500);
    await logSuperAdminAction(adminClient, {
      actor_user_id: callerUserId,
      action_type: "admin_role_changed",
      target_kind: "admin_user",
      target_id: userId,
      metadata: { from_role: prevRole, to_role: role },
    });
    return json({ ok: true });
  }

  if (rawBody.action === "create_admin") {
    const email = rawBody.email.trim().toLowerCase();
    const password = rawBody.password;
    const role = rawBody.admin_role === "super_admin" ? "super_admin" : "staff";
    if (!email || password.length < 6) return json({ error: "Invalid payload" }, 400);

    let userId: string | null = null;
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) {
      const { data: listRes } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
      userId = (listRes?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
    } else {
      userId = created.user?.id ?? null;
    }
    if (!userId) return json({ error: "Unable to create or find user." }, 500);

    // Ensure the provided password works even if the auth user already existed.
    // (Without this, we might email/WhatsApp a password that the user never got set.)
    {
      const { error: pwErr } = await adminClient.auth.admin.updateUserById(userId, {
        password,
      });
      if (pwErr) return json({ error: `Failed to set password: ${pwErr.message}` }, 500);
    }

    await adminClient.from("profiles").upsert({ user_id: userId, role: "seeker" }, { onConflict: "user_id" });
    await adminClient.from("profiles").update({ must_change_password: false }).eq("user_id", userId);
    await adminClient.from("admin_users").upsert({ user_id: userId, admin_role: role }, { onConflict: "user_id" });

    const permissions = rawBody.permissions ?? {};
    const allTrue = role === "super_admin";
    await adminClient.from("admin_permissions").upsert(
      {
        user_id: userId,
        can_delete_donor: allTrue ? true : Boolean(permissions.can_delete_donor),
        can_delete_emergency: allTrue ? true : Boolean(permissions.can_delete_emergency),
        can_update_emergency_status: allTrue ? true : Boolean(permissions.can_update_emergency_status),
        can_bulk_expire_open_emergencies: allTrue ? true : Boolean(permissions.can_bulk_expire_open_emergencies),
        can_resend_emergency_notify: allTrue ? true : Boolean(permissions.can_resend_emergency_notify),
        can_manage_admins: allTrue ? true : Boolean(permissions.can_manage_admins),
        can_view_audit_log: allTrue ? true : Boolean(permissions.can_view_audit_log),
        can_preview_emergency_notifications: allTrue ? true : Boolean(permissions.can_preview_emergency_notifications),
        can_send_mailjet_test_email: allTrue ? true : Boolean(permissions.can_send_mailjet_test_email),
        can_edit_email_templates: allTrue ? true : Boolean(permissions.can_edit_email_templates),
        can_view_donor_lookup: allTrue ? true : Boolean(permissions.can_view_donor_lookup),
        can_view_duplicate_contacts: allTrue ? true : Boolean(permissions.can_view_duplicate_contacts),
        can_edit_site_settings: allTrue ? true : Boolean(permissions.can_edit_site_settings),
        can_view_system_health: allTrue ? true : Boolean(permissions.can_view_system_health),
        can_broadcast: allTrue ? true : Boolean(permissions.can_broadcast),
      },
      { onConflict: "user_id" },
    );

    let emailResult: { sent: boolean; error?: string } | null = null;
    if (mj.ok) {
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color: #111;">
          <h2 style="margin:0 0 12px 0; font-size: 18px;">Welcome to Raktodaan Admin</h2>
          <p style="margin:0 0 12px 0;">Your admin account has been created with role: <b>${role}</b>.</p>
          <p style="margin:0 0 12px 0;">Sign in with the password your administrator set for you.</p>
          ${appUrl ? `<p style="margin:0;"><a href="${appUrl}/admin/sign-in" style="color:#b91c1c;">Open admin sign in</a></p>` : ""}
          <p style="margin:12px 0 0 0; color:#525252; font-size:12px;">Transactional message from Raktodaan.</p>
        </div>
      `;
      const text = [
        "Welcome to Raktodaan Admin",
        `Your admin account has been created with role: ${role}.`,
        "Sign in with the password your administrator set for you.",
        appUrl ? `Admin sign in: ${appUrl}/admin/sign-in` : "",
        "",
        "Transactional message from Raktodaan.",
      ]
        .filter(Boolean)
        .join("\n");

      const vars = {
        role,
        adminSignInUrl: appUrl ? `${appUrl}/admin/sign-in` : "",
      };

      let subject = "Your Raktodaan admin account";
      let preheader = "Your admin sign-in details — Raktodaan.";
      let htmlToSend = html;
      let textToSend = text;

      type TemplateRow = {
        subject_template: string | null;
        preheader_template: string | null;
        html_template: string | null;
        text_template: string | null;
      };

      const { data: tplRow } = await adminClient
        .from("email_templates")
        .select(
          "subject_template,preheader_template,html_template,text_template",
        )
        .eq("template_key", "admin_account_created_welcome")
        .maybeSingle();
      if (tplRow) {
        const t = tplRow as TemplateRow;
        subject = fillTemplate(t.subject_template ?? subject, vars);
        preheader = fillTemplate(
          t.preheader_template ?? preheader,
          vars,
        );
        htmlToSend = fillHtmlTemplate(
          t.html_template ?? html,
          vars,
        );
        textToSend = fillTemplate(
          t.text_template ?? text,
          vars,
        );
      }

      const credsHtml = `
        <div style="margin-top:14px; padding-top:12px; border-top:1px solid #e5e7eb;">
          <div style="font-weight:700; margin-bottom:6px;">Credentials (from admin)</div>
          <p style="margin:0 0 6px 0;"><b>User ID:</b> ${escapeHtmlText(userId)}</p>
          <p style="margin:0;"><b>Password:</b> ${escapeHtmlText(password)}</p>
        </div>
      `;
      const credsText = `Credentials (from admin)
User ID: ${userId}
Password: ${password}`;
      htmlToSend = `${htmlToSend}${credsHtml}`;
      textToSend = `${textToSend}\n\n${credsText}`;

      try {
        await sendMailjetMessage(mj.config, {
          toEmail: email,
          subject,
          html: htmlToSend,
          text: textToSend,
          preheader,
          customId: `admin_welcome:${userId}`,
        });
        emailResult = { sent: true };
        await logEmailEvent(adminClient, {
          event_type: "admin_account_created_welcome",
          actor_user_id: callerUserId,
          target_user_id: userId,
          target_email: email,
          status: "sent",
          metadata: { admin_role: role },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Mailjet send failed";
        emailResult = { sent: false, error: msg };
        await logEmailEvent(adminClient, {
          event_type: "admin_account_created_welcome",
          actor_user_id: callerUserId,
          target_user_id: userId,
          target_email: email,
          status: "failed",
          error_message: msg,
          metadata: { admin_role: role },
        });
      }
    } else {
      emailResult = { sent: false, error: mj.reason };
      await logEmailEvent(adminClient, {
        event_type: "admin_account_created_welcome",
        actor_user_id: callerUserId,
        target_user_id: userId,
        target_email: email,
        status: "skipped",
        error_message: mj.reason,
        metadata: { admin_role: role, reason: "mailjet_env_missing" },
      });
    }
    await logSuperAdminAction(adminClient, {
      actor_user_id: callerUserId,
      action_type: "admin_created",
      target_kind: "admin_user",
      target_id: userId,
      metadata: { email, admin_role: role },
    });
    return json({ ok: true, user_id: userId, emailResult });
  }

  if (rawBody.action === "create_hospital") {
    const email = rawBody.email.trim().toLowerCase();
    const password = rawBody.password;
    const hospitalName = (rawBody.hospital_name ?? "").trim() || null;
    if (!email || password.length < 6) return json({ error: "Invalid payload" }, 400);

    let userId: string | null = null;
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr) {
      const { data: listRes } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 200 });
      userId = (listRes?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
    } else {
      userId = created.user?.id ?? null;
    }
    if (!userId) return json({ error: "Unable to create or find user." }, 500);

    // Ensure the provided password works even if the auth user already existed.
    {
      const { error: pwErr } = await adminClient.auth.admin.updateUserById(userId, {
        password,
      });
      if (pwErr) return json({ error: `Failed to set password: ${pwErr.message}` }, 500);
    }

    await adminClient.from("profiles").upsert({ user_id: userId, role: "hospital" }, { onConflict: "user_id" });
    await adminClient
      .from("profiles")
      .update({
        role: "hospital",
        must_change_password: false,
        temp_password_set_at: null,
        temp_password_expires_at: null,
      })
      .eq("user_id", userId);
    await adminClient.from("hospital_users").upsert({ user_id: userId, name: hospitalName }, { onConflict: "user_id" });

    const hospitalPermissions = rawBody.hospital_permissions ?? {};
    await adminClient.from("hospital_permissions").upsert(
      {
        user_id: userId,
        can_post_emergency: hospitalPermissions.can_post_emergency ?? true,
        can_update_own_emergency_status:
          hospitalPermissions.can_update_own_emergency_status ?? true,
      },
      { onConflict: "user_id" },
    );

    let emailResult: { sent: boolean; error?: string } | null = null;
    if (mj.ok) {
      const hospHtml = hospitalName ? escapeHtmlText(hospitalName) : "";
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color: #111;">
          <h2 style="margin:0 0 12px 0; font-size: 18px;">Welcome to Raktodaan Hospital Portal</h2>
          <p style="margin:0 0 12px 0;">Your hospital account has been created${hospitalName ? ` for <b>${hospHtml}</b>` : ""}.</p>
          <p style="margin:0 0 12px 0;">Sign in with the password your administrator set for you.</p>
          ${appUrl ? `<p style="margin:0;"><a href="${appUrl}/hospital/sign-in" style="color:#b91c1c;">Hospital sign in</a></p>` : ""}
          <p style="margin:12px 0 0 0; color:#525252; font-size:12px;">Transactional message from Raktodaan.</p>
        </div>
      `;
      const text = [
        "Welcome to Raktodaan Hospital Portal",
        `Your hospital account has been created${hospitalName ? ` for ${hospitalName}` : ""}.`,
        "Sign in with the password your administrator set for you.",
        appUrl ? `Hospital sign in: ${appUrl}/hospital/sign-in` : "",
        "",
        "Transactional message from Raktodaan.",
      ]
        .filter(Boolean)
        .join("\n");

      const vars = {
        hospitalNamePart: hospitalName ? ` for ${hospitalName}` : "",
        hospitalSignInUrl: appUrl ? `${appUrl}/hospital/sign-in` : "",
      };

      let subject = "Your Raktodaan hospital account";
      let preheader = "Hospital portal access — Raktodaan.";
      let htmlToSend = html;
      let textToSend = text;

      type TemplateRow = {
        subject_template: string | null;
        preheader_template: string | null;
        html_template: string | null;
        text_template: string | null;
      };

      const { data: tplRow } = await adminClient
        .from("email_templates")
        .select(
          "subject_template,preheader_template,html_template,text_template",
        )
        .eq("template_key", "hospital_account_created_welcome")
        .maybeSingle();
      if (tplRow) {
        const t = tplRow as TemplateRow;
        subject = fillTemplate(t.subject_template ?? subject, vars);
        preheader = fillTemplate(
          t.preheader_template ?? preheader,
          vars,
        );
        htmlToSend = fillHtmlTemplate(
          t.html_template ?? html,
          vars,
        );
        textToSend = fillTemplate(
          t.text_template ?? text,
          vars,
        );
      }

      const credsHtml = `
        <div style="margin-top:14px; padding-top:12px; border-top:1px solid #e5e7eb;">
          <div style="font-weight:700; margin-bottom:6px;">Credentials (from admin)</div>
          <p style="margin:0 0 6px 0;"><b>User ID:</b> ${escapeHtmlText(userId)}</p>
          <p style="margin:0;"><b>Password:</b> ${escapeHtmlText(password)}</p>
        </div>
      `;
      const credsText = `Credentials (from admin)
User ID: ${userId}
Password: ${password}`;
      htmlToSend = `${htmlToSend}${credsHtml}`;
      textToSend = `${textToSend}\n\n${credsText}`;

      try {
        await sendMailjetMessage(mj.config, {
          toEmail: email,
          subject,
          html: htmlToSend,
          text: textToSend,
          preheader,
          customId: `hospital_welcome:${userId}`,
        });
        emailResult = { sent: true };
        await logEmailEvent(adminClient, {
          event_type: "hospital_account_created_welcome",
          actor_user_id: callerUserId,
          target_user_id: userId,
          target_email: email,
          status: "sent",
          metadata: { hospital_name: hospitalName },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Mailjet send failed";
        emailResult = { sent: false, error: msg };
        await logEmailEvent(adminClient, {
          event_type: "hospital_account_created_welcome",
          actor_user_id: callerUserId,
          target_user_id: userId,
          target_email: email,
          status: "failed",
          error_message: msg,
          metadata: { hospital_name: hospitalName },
        });
      }
    } else {
      emailResult = { sent: false, error: mj.reason };
      await logEmailEvent(adminClient, {
        event_type: "hospital_account_created_welcome",
        actor_user_id: callerUserId,
        target_user_id: userId,
        target_email: email,
        status: "skipped",
        error_message: mj.reason,
        metadata: { hospital_name: hospitalName, reason: "mailjet_env_missing" },
      });
    }
    await logSuperAdminAction(adminClient, {
      actor_user_id: callerUserId,
      action_type: "hospital_account_created",
      target_kind: "hospital_user",
      target_id: userId,
      metadata: { email, hospital_name: hospitalName },
    });
    return json({ ok: true, user_id: userId, emailResult });
  }

  if (rawBody.action === "resend_admin_credentials") {
    const userId = rawBody.user_id;
    if (!userId) return json({ error: "Invalid payload" }, 400);

    const { data: adminRow } = await adminClient
      .from("admin_users")
      .select("admin_role")
      .eq("user_id", userId)
      .maybeSingle();
    if (!adminRow) return json({ error: "Admin user not found" }, 404);

    const { data: userRes, error: userErr } = await adminClient.auth.admin.getUserById(userId);
    const email = userRes?.user?.email?.toLowerCase() ?? null;
    if (userErr || !email) return json({ error: "Admin auth email not found" }, 404);

    const tempPassword = generateTempPassword(12);
    const { error: pwErr } = await adminClient.auth.admin.updateUserById(userId, {
      password: tempPassword,
    });
    if (pwErr) return json({ error: `Failed to reset password: ${pwErr.message}` }, 500);

    let emailResult: { sent: boolean; error?: string } | null = null;
    const role = String((adminRow as { admin_role?: string | null }).admin_role ?? "staff");
    if (mj.ok) {
      const signInUrl = appUrl ? `${appUrl}/admin/sign-in` : "";
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color: #111;">
          <h2 style="margin:0 0 12px 0; font-size: 18px;">Welcome to Raktodaan Admin</h2>
          <p style="margin:0 0 12px 0;">Your admin credentials were reset by super admin.</p>
          <p style="margin:0 0 8px 0;"><b>User ID:</b> ${escapeHtmlText(userId)}</p>
          <p style="margin:0 0 12px 0;"><b>Password:</b> ${escapeHtmlText(tempPassword)}</p>
          ${signInUrl ? `<p style="margin:0;"><a href="${signInUrl}" style="color:#b91c1c;">Open admin sign in</a></p>` : ""}
        </div>
      `;
      const text = [
        "Welcome to Raktodaan Admin",
        "Your admin credentials were reset by super admin.",
        `User ID: ${userId}`,
        `Password: ${tempPassword}`,
        signInUrl ? `Admin sign in: ${signInUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      try {
        await sendMailjetMessage(mj.config, {
          toEmail: email,
          subject: "Your Raktodaan admin credentials (reset)",
          html,
          text,
          preheader: "Admin sign-in credentials reset.",
          customId: `admin_credentials_reset:${userId}`,
        });
        emailResult = { sent: true };
      } catch (e: unknown) {
        emailResult = { sent: false, error: e instanceof Error ? e.message : "Mailjet send failed" };
      }
    } else {
      emailResult = { sent: false, error: mj.reason };
    }

    await logEmailEvent(adminClient, {
      event_type: "admin_credentials_reset",
      actor_user_id: callerUserId,
      target_user_id: userId,
      target_email: email,
      status: emailResult?.sent ? "sent" : "failed",
      error_message: emailResult?.sent ? null : emailResult?.error ?? null,
      metadata: { admin_role: role },
    });
    await logSuperAdminAction(adminClient, {
      actor_user_id: callerUserId,
      action_type: "admin_credentials_resent",
      target_kind: "admin_user",
      target_id: userId,
      metadata: { email, admin_role: role },
    });

    return json({ ok: true, user_id: userId, email, temp_password: tempPassword, emailResult });
  }

  if (rawBody.action === "resend_hospital_credentials") {
    const userId = rawBody.user_id;
    if (!userId) return json({ error: "Invalid payload" }, 400);
    const { data: hospitalRow } = await adminClient
      .from("hospital_users")
      .select("name")
      .eq("user_id", userId)
      .maybeSingle();
    if (!hospitalRow) return json({ error: "Hospital user not found" }, 404);

    const { data: userRes, error: userErr } = await adminClient.auth.admin.getUserById(userId);
    const email = userRes?.user?.email?.toLowerCase() ?? null;
    if (userErr || !email) return json({ error: "Hospital auth email not found" }, 404);

    const tempPassword = generateTempPassword(12);
    const { error: pwErr } = await adminClient.auth.admin.updateUserById(userId, {
      password: tempPassword,
    });
    if (pwErr) return json({ error: `Failed to reset password: ${pwErr.message}` }, 500);

    let emailResult: { sent: boolean; error?: string } | null = null;
    const hospitalName = String((hospitalRow as { name?: string | null }).name ?? "");
    if (mj.ok) {
      const signInUrl = appUrl ? `${appUrl}/hospital/sign-in` : "";
      const html = `
        <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.55; color: #111;">
          <h2 style="margin:0 0 12px 0; font-size: 18px;">Welcome to Raktodaan Hospital Portal</h2>
          <p style="margin:0 0 12px 0;">Your hospital credentials were reset by super admin.</p>
          ${hospitalName ? `<p style="margin:0 0 8px 0;"><b>Hospital:</b> ${escapeHtmlText(hospitalName)}</p>` : ""}
          <p style="margin:0 0 8px 0;"><b>User ID:</b> ${escapeHtmlText(userId)}</p>
          <p style="margin:0 0 12px 0;"><b>Password:</b> ${escapeHtmlText(tempPassword)}</p>
          ${signInUrl ? `<p style="margin:0;"><a href="${signInUrl}" style="color:#b91c1c;">Open hospital sign in</a></p>` : ""}
        </div>
      `;
      const text = [
        "Welcome to Raktodaan Hospital Portal",
        "Your hospital credentials were reset by super admin.",
        hospitalName ? `Hospital: ${hospitalName}` : "",
        `User ID: ${userId}`,
        `Password: ${tempPassword}`,
        signInUrl ? `Hospital sign in: ${signInUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      try {
        await sendMailjetMessage(mj.config, {
          toEmail: email,
          subject: "Your Raktodaan hospital credentials (reset)",
          html,
          text,
          preheader: "Hospital sign-in credentials reset.",
          customId: `hospital_credentials_reset:${userId}`,
        });
        emailResult = { sent: true };
      } catch (e: unknown) {
        emailResult = { sent: false, error: e instanceof Error ? e.message : "Mailjet send failed" };
      }
    } else {
      emailResult = { sent: false, error: mj.reason };
    }
    await logEmailEvent(adminClient, {
      event_type: "hospital_credentials_reset",
      actor_user_id: callerUserId,
      target_user_id: userId,
      target_email: email,
      status: emailResult?.sent ? "sent" : "failed",
      error_message: emailResult?.sent ? null : emailResult?.error ?? null,
      metadata: { hospital_name: hospitalName || null },
    });
    await logSuperAdminAction(adminClient, {
      actor_user_id: callerUserId,
      action_type: "hospital_credentials_resent",
      target_kind: "hospital_user",
      target_id: userId,
      metadata: { email, hospital_name: hospitalName || null },
    });

    return json({ ok: true, user_id: userId, email, temp_password: tempPassword, hospital_name: hospitalName || null, emailResult });
  }

  return json({ error: "Unknown action" }, 400);
}

