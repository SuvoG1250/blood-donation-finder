"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

export default function ChangePasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-md px-4 py-10">
          <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
            Loading...
          </div>
        </div>
      }
    >
      <ChangePasswordInner />
    </Suspense>
  );
}

function ChangePasswordInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const accessToken = searchParams.get("access_token");
  const refreshToken = searchParams.get("refresh_token");
  const isRecoveryFlow = Boolean(accessToken && refreshToken);

  const [loading, setLoading] = useState(false);
  const [initLoading, setInitLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);

  async function init() {
    setInitLoading(true);
    setError(null);
    setSubmitted(null);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
      );
      setInitLoading(false);
      return;
    }

    // Recovery links provide tokens in URL query params.
    if (isRecoveryFlow && accessToken && refreshToken) {
      const { error: setSessErr } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (setSessErr) {
        setError(setSessErr.message);
        setInitLoading(false);
        return;
      }
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) {
      setError("You are not signed in. Please sign in again.");
      setInitLoading(false);
      return;
    }
    setSignedInEmail(user.email ?? null);

    const { data: profileRow, error: profileErr } = await supabase
      .from("profiles")
      .select("must_change_password")
      .eq("user_id", user.id)
      .single();

    if (profileErr) {
      // Backward compatibility if migration 04 hasn't been applied yet.
      const msg = profileErr.message.toLowerCase();
      if (isRecoveryFlow && msg.includes("must_change_password")) {
        setMustChangePassword(false);
        setInitLoading(false);
        return;
      }

      setError(profileErr.message ?? "Unable to load profile.");
      setInitLoading(false);
      return;
    }

    if (!profileRow) {
      setError("Unable to load profile.");
      setInitLoading(false);
      return;
    }

    setMustChangePassword(
      Boolean(
        (profileRow as { must_change_password?: boolean | null }).must_change_password,
      ),
    );
    setInitLoading(false);
  }

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canShowForm = useMemo(() => {
    if (error) return false;
    if (isRecoveryFlow) return true;
    return true;
  }, [error, isRecoveryFlow]);

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitted(null);
    setLoading(true);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setLoading(false);
      setError("Supabase is not configured.");
      return;
    }

    const { error: updErr } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updErr) {
      setLoading(false);
      setError(updErr.message);
      return;
    }

    // If this was a forced change (temp password), clear the flags.
    if (mustChangePassword) {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (user) {
        await supabase
          .from("profiles")
          .update({
            must_change_password: false,
            temp_password_set_at: null,
            temp_password_expires_at: null,
          })
          .eq("user_id", user.id);
      }
    }

    setLoading(false);
    setSubmitted("Password updated successfully.");

    // Route using auth callback guard logic.
    window.location.href = "/auth/callback";
  }

  if (initLoading) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          Loading...
        </div>
      </div>
    );
  }

  if (!canShowForm) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 className="text-lg font-semibold">Change password</h1>
          <p className="mt-2 text-sm text-zinc-600">
            {error ? error : "No password change is required right now."}
          </p>
          <div className="mt-4">
            <button
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50"
              type="button"
              onClick={() => router.replace("/sign-in")}
            >
              Go to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <h1 className="text-xl font-semibold">Change password</h1>
        <p className="mt-2 text-sm text-zinc-600">
          {mustChangePassword
            ? "You must change your temporary password."
            : signedInEmail
              ? `Signed in as ${signedInEmail}. Choose a new password.`
              : "Choose a new password."}
        </p>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {submitted ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            {submitted}
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={onChangePassword}>
          <label className="block">
            <span className="text-sm font-medium">New password</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              type="password"
              placeholder="Enter new password"
              required
              autoComplete="new-password"
            />
          </label>

          <button
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
            type="submit"
          >
            {loading ? "Updating..." : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}


