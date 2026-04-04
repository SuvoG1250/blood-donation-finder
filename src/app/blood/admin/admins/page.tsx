"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

type AdminRow = {
  user_id: string;
  email: string | null;
  admin_role: "staff" | "super_admin" | string;
  created_at: string | null;
};

type HospitalRow = {
  user_id: string;
  email: string | null;
  name: string | null;
  is_verified: boolean;
  created_at: string | null;
};

type StaffPermState = {
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

const DEFAULT_STAFF_PERMS: StaffPermState = {
  can_delete_donor: false,
  can_delete_emergency: false,
  can_update_emergency_status: false,
  can_bulk_expire_open_emergencies: false,
  can_resend_emergency_notify: false,
  can_manage_admins: false,
  can_view_audit_log: false,
  can_preview_emergency_notifications: false,
  can_send_mailjet_test_email: false,
  can_edit_email_templates: false,
  can_view_donor_lookup: false,
  can_view_duplicate_contacts: false,
  can_edit_site_settings: false,
  can_view_system_health: false,
  can_broadcast: false,
};

const STAFF_PERM_FIELDS: Array<{ key: keyof StaffPermState; label: string }> = [
  { key: "can_delete_donor", label: "Delete donor" },
  { key: "can_delete_emergency", label: "Delete emergency" },
  { key: "can_update_emergency_status", label: "Update emergency status" },
  { key: "can_bulk_expire_open_emergencies", label: "Bulk expire open" },
  { key: "can_resend_emergency_notify", label: "Re-notify emergency" },
  { key: "can_manage_admins", label: "Manage admins/hospitals" },
  { key: "can_view_audit_log", label: "View audit log" },
  { key: "can_preview_emergency_notifications", label: "Preview emergency recipients" },
  { key: "can_send_mailjet_test_email", label: "Send Mailjet test email" },
  { key: "can_edit_email_templates", label: "Edit email templates" },
  { key: "can_view_donor_lookup", label: "Donor lookup" },
  { key: "can_view_duplicate_contacts", label: "Duplicates report" },
  { key: "can_edit_site_settings", label: "Site settings + retention purge" },
  { key: "can_view_system_health", label: "View system health" },
  { key: "can_broadcast", label: "District broadcast" },
];

async function callEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const supabase = getSupabaseOrNull();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error("Missing access token. Please sign in again.");

  const route =
    functionName === "admin-manage-admins"
      ? "/api/admin/manage-admins"
      : `/api/admin/${functionName}`;
  const resp = await fetch(route, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  type EdgeFnJson = { error?: string; ok?: boolean };
  const json = (await resp.json().catch(() => ({}))) as EdgeFnJson;
  if (!resp.ok) {
    throw new Error(json?.error ?? `Edge function ${functionName} failed.`);
  }
  return json as unknown as T;
}

export default function AdminAdminsPage() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [hospitals, setHospitals] = useState<HospitalRow[]>([]);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createWhatsappNumber, setCreateWhatsappNumber] = useState("");
  const [createSuper, setCreateSuper] = useState(false);
  const [creating, setCreating] = useState(false);
  const [hospitalEmail, setHospitalEmail] = useState("");
  const [hospitalPassword, setHospitalPassword] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [hospitalWhatsappNumber, setHospitalWhatsappNumber] = useState("");
  const [creatingHospital, setCreatingHospital] = useState(false);

  const [lastCreatedAdmin, setLastCreatedAdmin] = useState<null | {
    userId: string;
    email: string;
    role: "staff" | "super_admin";
    password: string;
  }>(null);

  const [lastCreatedHospital, setLastCreatedHospital] = useState<null | {
    userId: string;
    email: string;
    hospitalName: string | null;
    password: string;
  }>(null);

  const [adminPermissions, setAdminPermissions] = useState<StaffPermState>(DEFAULT_STAFF_PERMS);

  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<StaffPermState>(DEFAULT_STAFF_PERMS);
  const [editLoading, setEditLoading] = useState(false);

  const [hospitalPermissions, setHospitalPermissions] = useState({
    can_post_emergency: true,
    can_update_own_emergency_status: true,
  });

  async function load() {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const { data: isAdminData } = await supabase.rpc("is_admin");
    const okAdmin = Boolean(isAdminData);
    setIsAdmin(okAdmin);
    if (!okAdmin) {
      setLoading(false);
      return;
    }

    const [{ data: okSuperData }, { data: canManageData }] = await Promise.all([
      supabase.rpc("is_super_admin"),
      supabase.rpc("admin_can", { action: "manage_admins" }),
    ]);
    const okSuper = Boolean(okSuperData || canManageData);
    setIsSuperAdmin(okSuper);
    if (!okSuper) {
      setLoading(false);
      return;
    }

    setError(null);
    const [adminsRes, hospitalsRes] = await Promise.all([
      callEdgeFunction<{ admins: AdminRow[] }>("admin-manage-admins", {
        action: "list",
      }),
      callEdgeFunction<{ hospitals: HospitalRow[] }>("admin-manage-admins", {
        action: "list_hospitals",
      }),
    ]);
    setAdmins(adminsRes.admins ?? []);
    setHospitals(hospitalsRes.hospitals ?? []);
    setLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    void load().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to load admins.";
      setError(msg);
      setLoading(false);
    });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return admins;
    return admins.filter((a) => {
      const email = (a.email ?? "").toLowerCase();
      return email.includes(q) || a.user_id.toLowerCase().includes(q);
    });
  }, [admins, query]);

  async function onSetRole(userId: string, role: "staff" | "super_admin") {
    try {
      setSavingUserId(userId);
      setError(null);
      await callEdgeFunction("admin-manage-admins", {
        action: "set_role",
        user_id: userId,
        admin_role: role,
      });
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update role.";
      setError(msg);
    } finally {
      setSavingUserId(null);
    }
  }

  async function onToggleHospitalVerified(userId: string, next: boolean) {
    try {
      setSavingUserId(userId);
      setError(null);
      await callEdgeFunction("admin-manage-admins", {
        action: "set_hospital_verified",
        user_id: userId,
        is_verified: next,
      });
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update hospital verification.";
      setError(msg);
    } finally {
      setSavingUserId(null);
    }
  }

  async function openEditPermissions(a: AdminRow) {
    if (a.admin_role === "super_admin") return;
    setEditUserId(a.user_id);
    setEditEmail(a.email);
    setEditPerms(DEFAULT_STAFF_PERMS);
    setEditLoading(true);
    setError(null);
    try {
      const res = await callEdgeFunction<{ permissions: StaffPermState }>("admin-manage-admins", {
        action: "get_admin_permissions",
        user_id: a.user_id,
      });
      setEditPerms(res.permissions ?? DEFAULT_STAFF_PERMS);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load permissions.";
      setError(msg);
      setEditUserId(null);
      setEditEmail(null);
    } finally {
      setEditLoading(false);
    }
  }

  function closeEditPermissions() {
    setEditUserId(null);
    setEditEmail(null);
    setEditPerms(DEFAULT_STAFF_PERMS);
  }

  async function saveEditPermissions() {
    if (!editUserId) return;
    try {
      setSavingUserId(editUserId);
      setError(null);
      await callEdgeFunction("admin-manage-admins", {
        action: "update_admin_permissions",
        user_id: editUserId,
        permissions: editPerms,
      });
      closeEditPermissions();
      await load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save permissions.";
      setError(msg);
    } finally {
      setSavingUserId(null);
    }
  }

  function generateTempPassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$";
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
    setCreatePassword(out);
  }

  function digitsOnly(s: string) {
    return s.replace(/[^0-9]/g, "");
  }

  function buildWhatsAppLink(digits: string, message: string) {
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
  }

  function onSendAdminWhatsApp() {
    if (!lastCreatedAdmin) return;
    const digits = digitsOnly(createWhatsappNumber);
    if (!digits) {
      setError("Enter a valid WhatsApp number first.");
      return;
    }
    const origin = window.location.origin;
    const signInUrl = `${origin}/blood/admin/sign-in`;
    const msg = [
      `Welcome to Raktodaan Admin`,
      `Role: ${lastCreatedAdmin.role}`,
      `User ID: ${lastCreatedAdmin.userId}`,
      `Password: ${lastCreatedAdmin.password}`,
      `Sign in: ${signInUrl}`,
    ].join("\n");
    window.open(buildWhatsAppLink(digits, msg), "_blank", "noreferrer");
  }

  function onSendHospitalWhatsApp() {
    if (!lastCreatedHospital) return;
    const digits = digitsOnly(hospitalWhatsappNumber);
    if (!digits) {
      setError("Enter a valid WhatsApp number first.");
      return;
    }
    const origin = window.location.origin;
    const signInUrl = `${origin}/blood/hospital/sign-in`;
    const msg = [
      `Welcome to Raktodaan Hospital Portal`,
      `Hospital: ${lastCreatedHospital.hospitalName ?? "—"}`,
      `User ID: ${lastCreatedHospital.userId}`,
      `Password: ${lastCreatedHospital.password}`,
      `Sign in: ${signInUrl}`,
    ].join("\n");
    window.open(buildWhatsAppLink(digits, msg), "_blank", "noreferrer");
  }

  async function onResendAdminCredentials(a: AdminRow) {
    try {
      setSavingUserId(a.user_id);
      setError(null);
      const res = await callEdgeFunction<{
        ok?: boolean;
        user_id?: string;
        email?: string;
        temp_password?: string;
      }>("admin-manage-admins", {
        action: "resend_admin_credentials",
        user_id: a.user_id,
      });
      const tempPassword = String(res.temp_password ?? "");
      const userId = String(res.user_id ?? a.user_id);
      const wa = window.prompt(
        "Credentials reset. Enter WhatsApp number to send now (optional):",
        "",
      );
      if (wa && wa.trim()) {
        const digits = digitsOnly(wa);
        if (digits) {
          const origin = window.location.origin;
          const signInUrl = `${origin}/blood/admin/sign-in`;
          const msg = [
            "Welcome to Raktodaan Admin",
            `User ID: ${userId}`,
            `Password: ${tempPassword}`,
            `Sign in: ${signInUrl}`,
          ].join("\n");
          window.open(buildWhatsAppLink(digits, msg), "_blank", "noreferrer");
        }
      }
      alert("Credentials reset and welcome email sent (if Mailjet configured).");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to resend admin credentials.";
      setError(msg);
    } finally {
      setSavingUserId(null);
    }
  }

  async function onResendHospitalCredentials(h: HospitalRow) {
    try {
      setSavingUserId(h.user_id);
      setError(null);
      const res = await callEdgeFunction<{
        ok?: boolean;
        user_id?: string;
        email?: string;
        temp_password?: string;
        hospital_name?: string | null;
      }>("admin-manage-admins", {
        action: "resend_hospital_credentials",
        user_id: h.user_id,
      });
      const tempPassword = String(res.temp_password ?? "");
      const userId = String(res.user_id ?? h.user_id);
      const hospitalName = String(res.hospital_name ?? h.name ?? "");
      const wa = window.prompt(
        "Credentials reset. Enter WhatsApp number to send now (optional):",
        "",
      );
      if (wa && wa.trim()) {
        const digits = digitsOnly(wa);
        if (digits) {
          const origin = window.location.origin;
          const signInUrl = `${origin}/blood/hospital/sign-in`;
          const msg = [
            "Welcome to Raktodaan Hospital Portal",
            hospitalName ? `Hospital: ${hospitalName}` : "",
            `User ID: ${userId}`,
            `Password: ${tempPassword}`,
            `Sign in: ${signInUrl}`,
          ]
            .filter(Boolean)
            .join("\n");
          window.open(buildWhatsAppLink(digits, msg), "_blank", "noreferrer");
        }
      }
      alert("Credentials reset and welcome email sent (if Mailjet configured).");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to resend hospital credentials.";
      setError(msg);
    } finally {
      setSavingUserId(null);
    }
  }

  async function onCreateAdmin(e: React.FormEvent) {
    e.preventDefault();
    try {
      setCreating(true);
      setError(null);
      const email = createEmail.trim().toLowerCase();
      if (!email) throw new Error("Email is required.");
      if (!createPassword || createPassword.length < 6) {
        throw new Error("Password must be at least 6 characters.");
      }
      const password = createPassword;
      const role = createSuper ? ("super_admin" as const) : ("staff" as const);
      const res = await callEdgeFunction<{ ok?: boolean; user_id?: string }>(
        "admin-manage-admins",
        {
        action: "create_admin",
        email,
        password,
        admin_role: role,
        permissions: adminPermissions,
        },
      );
      const createdUserId = String(res?.user_id ?? "");
      if (!createdUserId) throw new Error("Admin created but user_id missing.");
      setLastCreatedAdmin({ userId: createdUserId, email, role, password });
      setCreateEmail("");
      setCreatePassword("");
      setCreateSuper(false);
      await load();
      alert("Admin created / updated. Welcome email sent (if Mailjet configured).");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create admin.";
      setError(msg);
    } finally {
      setCreating(false);
    }
  }

  async function onCreateHospital(e: React.FormEvent) {
    e.preventDefault();
    try {
      setCreatingHospital(true);
      setError(null);
      const email = hospitalEmail.trim().toLowerCase();
      const password = hospitalPassword;
      if (!email) throw new Error("Hospital email is required.");
      if (!password || password.length < 6) {
        throw new Error("Hospital password must be at least 6 characters.");
      }
      const res = await callEdgeFunction<{ ok?: boolean; user_id?: string }>(
        "admin-manage-admins",
        {
        action: "create_hospital",
        email,
        password,
        hospital_name: hospitalName.trim() || null,
        hospital_permissions: hospitalPermissions,
        },
      );
      const createdUserId = String(res?.user_id ?? "");
      if (!createdUserId) throw new Error("Hospital created but user_id missing.");
      setLastCreatedHospital({
        userId: createdUserId,
        email,
        hospitalName: hospitalName.trim() || null,
        password,
      });
      setHospitalEmail("");
      setHospitalPassword("");
      setHospitalName("");
      alert("Hospital account created/updated. Welcome email sent (if Mailjet configured).");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create hospital.";
      setError(msg);
    } finally {
      setCreatingHospital(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <div className="text-sm font-semibold text-zinc-700">Loading…</div>
        </div>
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 className="text-xl font-semibold">Admins</h1>
          <p className="mt-2 text-sm text-zinc-600">You must sign in as admin.</p>
          <div className="mt-5">
            <Link
              className="inline-flex rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-105"
              href="/admin/sign-in"
            >
              Admin sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 className="text-xl font-semibold">Admins</h1>
          <p className="mt-2 text-sm text-zinc-600">
            This page requires the “manage admins” permission.
          </p>
          <div className="mt-5">
            <Link
              className="inline-flex rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
              href="/admin"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Manage admins</h1>
          <p className="mt-1 text-sm text-zinc-600">
            Promote/demote admin accounts. Super admin actions are audited by DB roles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
          >
            Back
          </Link>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="mt-6 rounded-2xl border bg-white/70 p-5 shadow-sm backdrop-blur">
        <div className="rounded-2xl border border-zinc-200 bg-white/70 p-4">
          <div className="text-sm font-semibold text-zinc-900">Create admin</div>
          <p className="mt-1 text-xs text-zinc-600">
            Creates a new admin login (or upgrades an existing user) and sends a welcome email.
          </p>
          <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={onCreateAdmin}>
            <label className="block sm:col-span-2">
              <span className="text-xs font-semibold text-zinc-700">Email</span>
              <input
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                type="email"
                required
                placeholder="newadmin@example.com"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-700">Password</span>
              <input
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                type="text"
                required
                placeholder="Click Generate"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-700">WhatsApp number (for credentials)</span>
              <input
                value={createWhatsappNumber}
                onChange={(e) => setCreateWhatsappNumber(e.target.value)}
                type="text"
                placeholder="e.g. +91 98XXXXXX12"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={generateTempPassword}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50"
              >
                Generate
              </button>
              <label className="ml-auto inline-flex items-center gap-2 text-sm font-semibold text-zinc-800">
                <input
                  type="checkbox"
                  checked={createSuper}
                  onChange={(e) => setCreateSuper(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                Make super admin
              </label>
            </div>

            {!createSuper ? (
              <div className="sm:col-span-2 rounded-xl border border-zinc-200 bg-white/80 p-3">
                <div className="text-xs font-semibold text-zinc-700">
                  Extra permissions (staff only)
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_delete_donor}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_delete_donor: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Delete donor
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_delete_emergency}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_delete_emergency: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Delete emergency
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_update_emergency_status}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_update_emergency_status: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Update emergency status
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_bulk_expire_open_emergencies}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_bulk_expire_open_emergencies: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Bulk expire open
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_resend_emergency_notify}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_resend_emergency_notify: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Re-notify emergency
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_manage_admins}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_manage_admins: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Manage admins/hospitals
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_view_audit_log}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_view_audit_log: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    View audit log
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_preview_emergency_notifications}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_preview_emergency_notifications: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Preview emergency recipients
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_send_mailjet_test_email}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_send_mailjet_test_email: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Send Mailjet test email
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_edit_email_templates}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_edit_email_templates: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Edit email templates
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_view_donor_lookup}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_view_donor_lookup: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Donor lookup
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_view_duplicate_contacts}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_view_duplicate_contacts: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Duplicates report
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_edit_site_settings}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_edit_site_settings: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    Site settings + retention purge
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_view_system_health}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_view_system_health: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    View system health
                  </label>
                  <label className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={adminPermissions.can_broadcast}
                      onChange={(e) =>
                        setAdminPermissions((p) => ({
                          ...p,
                          can_broadcast: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    District broadcast
                  </label>
                </div>
              </div>
            ) : null}

            <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={creating}
                className="rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-105 disabled:opacity-60"
              >
                {creating ? "Creating…" : "Create / Update admin"}
              </button>
              <Link
                href="/change-password"
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-zinc-50"
              >
                Change my password
              </Link>
            </div>
          </form>
          {lastCreatedAdmin ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
              <div className="text-xs font-semibold text-emerald-900">Admin created</div>
              <div className="mt-2 text-xs text-emerald-800">
                <div>
                  User ID: <span className="font-mono">{lastCreatedAdmin.userId}</span>
                </div>
                <div>
                  Password: <span className="font-mono">{lastCreatedAdmin.password}</span>
                </div>
                <div>
                  Role: <span className="font-semibold">{lastCreatedAdmin.role}</span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onSendAdminWhatsApp()}
                  disabled={!digitsOnly(createWhatsappNumber)}
                  className="rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
                >
                  Send WhatsApp credentials
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/70 p-4">
          <div className="text-sm font-semibold text-zinc-900">Create hospital account</div>
          <p className="mt-1 text-xs text-zinc-600">
            Creates/updates a hospital login and grants hospital dashboard access.
          </p>
          <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={onCreateHospital}>
            <label className="block sm:col-span-2">
              <span className="text-xs font-semibold text-zinc-700">Hospital name (optional)</span>
              <input
                value={hospitalName}
                onChange={(e) => setHospitalName(e.target.value)}
                type="text"
                placeholder="ABC Hospital / Blood Bank"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-700">Hospital email</span>
              <input
                value={hospitalEmail}
                onChange={(e) => setHospitalEmail(e.target.value)}
                type="email"
                required
                placeholder="hospital@example.com"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-700">Temporary password</span>
              <input
                value={hospitalPassword}
                onChange={(e) => setHospitalPassword(e.target.value)}
                type="text"
                required
                placeholder="Set password"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-700">WhatsApp number (for credentials)</span>
              <input
                value={hospitalWhatsappNumber}
                onChange={(e) => setHospitalWhatsappNumber(e.target.value)}
                type="text"
                placeholder="e.g. +91 98XXXXXX12"
                className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              />
            </label>

            <div className="sm:col-span-2 rounded-xl border border-zinc-200 bg-white/80 p-3">
              <div className="text-xs font-semibold text-zinc-700">
                Hospital permissions
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm text-zinc-800">
                  <input
                    type="checkbox"
                    checked={hospitalPermissions.can_post_emergency}
                    onChange={(e) =>
                      setHospitalPermissions((p) => ({
                        ...p,
                        can_post_emergency: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  Post emergency
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-800">
                  <input
                    type="checkbox"
                    checked={hospitalPermissions.can_update_own_emergency_status}
                    onChange={(e) =>
                      setHospitalPermissions((p) => ({
                        ...p,
                        can_update_own_emergency_status: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                  Update own status
                </label>
              </div>
            </div>

            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={creatingHospital}
                className="rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-105 disabled:opacity-60"
              >
                {creatingHospital ? "Creating..." : "Create / Update hospital"}
              </button>
            </div>
          </form>
          {lastCreatedHospital ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
              <div className="text-xs font-semibold text-emerald-900">Hospital created</div>
              <div className="mt-2 text-xs text-emerald-800">
                <div>
                  User ID:{" "}
                  <span className="font-mono">{lastCreatedHospital.userId}</span>
                </div>
                <div>
                  Password:{" "}
                  <span className="font-mono">{lastCreatedHospital.password}</span>
                </div>
                <div>
                  Hospital:{" "}
                  <span className="font-semibold">
                    {lastCreatedHospital.hospitalName ?? "—"}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void onSendHospitalWhatsApp()}
                  disabled={!digitsOnly(hospitalWhatsappNumber)}
                  className="rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
                >
                  Send WhatsApp credentials
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white/70 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-zinc-900">
                Hospital accounts ({hospitals.length})
              </div>
              <div className="mt-1 text-xs text-zinc-600">
                Mark hospitals as verified to show a badge on emergency feed.
              </div>
            </div>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-xs font-semibold text-zinc-500">
                  <th className="border-b px-3 py-2">Name</th>
                  <th className="border-b px-3 py-2">Email</th>
                  <th className="border-b px-3 py-2">Verified</th>
                  <th className="border-b px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {hospitals.map((h) => {
                  const saving = savingUserId === h.user_id;
                  return (
                    <tr key={h.user_id} className="text-sm">
                      <td className="border-b px-3 py-3 font-semibold text-zinc-900">
                        {h.name ?? <span className="text-zinc-500">—</span>}
                      </td>
                      <td className="border-b px-3 py-3 text-zinc-800">
                        {h.email ?? <span className="text-zinc-500">Unknown</span>}
                      </td>
                      <td className="border-b px-3 py-3">
                        {h.is_verified ? (
                          <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                            Verified
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-semibold text-zinc-700">
                            Not verified
                          </span>
                        )}
                      </td>
                      <td className="border-b px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={saving || h.is_verified}
                            onClick={() => void onToggleHospitalVerified(h.user_id, true)}
                            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                          >
                            Verify
                          </button>
                          <button
                            type="button"
                            disabled={saving || !h.is_verified}
                            onClick={() => void onToggleHospitalVerified(h.user_id, false)}
                            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-60"
                          >
                            Unverify
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void onResendHospitalCredentials(h)}
                            className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-60"
                          >
                            Resend credentials
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {hospitals.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-sm font-semibold text-zinc-600" colSpan={4}>
                      No hospital accounts yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-semibold text-zinc-900">
            Admin accounts ({admins.length})
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by email or user id…"
            className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
          />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-xs font-semibold text-zinc-500">
                <th className="border-b px-3 py-2">Email</th>
                <th className="border-b px-3 py-2">User ID</th>
                <th className="border-b px-3 py-2">Role</th>
                <th className="border-b px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const saving = savingUserId === a.user_id;
                const isSuper = a.admin_role === "super_admin";
                return (
                  <tr key={a.user_id} className="text-sm">
                    <td className="border-b px-3 py-3 font-semibold text-zinc-900">
                      {a.email ?? <span className="text-zinc-500">Unknown</span>}
                    </td>
                    <td className="border-b px-3 py-3 font-mono text-xs text-zinc-700">
                      {a.user_id}
                    </td>
                    <td className="border-b px-3 py-3">
                      <span
                        className={
                          isSuper
                            ? "inline-flex rounded-full border border-emerald-200 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-800"
                            : "inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-semibold text-zinc-700"
                        }
                      >
                        {isSuper ? "super admin" : "staff"}
                      </span>
                    </td>
                    <td className="border-b px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={saving || isSuper}
                          onClick={() => void onSetRole(a.user_id, "super_admin")}
                          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-60"
                        >
                          Make super
                        </button>
                        {isSuper ? null : (
                          <button
                            type="button"
                            disabled={saving || isSuper}
                            onClick={() => void onSetRole(a.user_id, "staff")}
                            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-60"
                          >
                            Make staff
                          </button>
                        )}
                        {!isSuper ? (
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void openEditPermissions(a)}
                            className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-60"
                          >
                            Permissions
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void onResendAdminCredentials(a)}
                          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
                        >
                          Resend credentials
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-6 text-sm font-semibold text-zinc-600"
                    colSpan={4}
                  >
                    No matching admins.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    {editUserId ? (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div
          className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-perms-title"
        >
          <h2 id="edit-perms-title" className="text-sm font-semibold text-zinc-900">
            Edit staff permissions
          </h2>
          <div className="mt-1 break-all text-xs text-zinc-600">{editEmail}</div>
          {editLoading ? (
            <div className="mt-6 text-sm text-zinc-600">Loading…</div>
          ) : (
            <>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {STAFF_PERM_FIELDS.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-zinc-800">
                    <input
                      type="checkbox"
                      checked={editPerms[key]}
                      onChange={(e) =>
                        setEditPerms((p) => ({ ...p, [key]: e.target.checked }))
                      }
                      className="h-4 w-4 rounded border-zinc-300"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveEditPermissions()}
                  disabled={savingUserId === editUserId}
                  className="rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {savingUserId === editUserId ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={closeEditPermissions}
                  disabled={savingUserId === editUserId}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    ) : null}
    </>
  );
}

