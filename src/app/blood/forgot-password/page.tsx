"use client";

import { useState } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);

  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(null);
    setLoading(true);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setLoading(false);
      alert(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
      );
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/change-password`,
    });

    setLoading(false);
    if (error) {
      alert(error.message);
      return;
    }

    setSubmitted(
      "If your email exists in our system, you'll receive a password reset link."
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <h1 className="text-xl font-semibold">Forgot password</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Enter your email and we will send a reset link.
        </p>

        <form className="mt-6 space-y-4" onSubmit={onReset}>
          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </label>

          <button
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
            type="submit"
          >
            {loading ? "Sending..." : "Send reset link"}
          </button>
        </form>

        {submitted ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            {submitted}
          </div>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-4 text-sm">
          <div className="text-zinc-600">Remembered?</div>
          <Link
            className="font-semibold text-zinc-900 underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
            href="/sign-in"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

