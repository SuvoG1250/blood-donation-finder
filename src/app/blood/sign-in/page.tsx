"use client";

import { useState } from "react";
import Link from "next/link";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setLoading(false);
      alert(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
      );
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setLoading(false);
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("banned") || msg.includes("locked")) {
        alert("Your account is waiting for admin approval. Please try again later.");
        return;
      }
      alert(error.message);
      return;
    }

    // Route based on `profiles.role` and `must_change_password` in auth callback.
    window.location.href = "/auth/callback";
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Use your email and password.
            </p>
          </div>
          <div className="hidden h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-rose-500 text-white shadow-sm sm:flex">
            <span className="text-sm font-bold">ID</span>
          </div>
        </div>

        <form className="mt-6 space-y-4" onSubmit={onSignIn}>
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

          <label className="block">
            <span className="text-sm font-medium">Password</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="Your password"
              required
              autoComplete="current-password"
            />
          </label>

          <button
            disabled={loading}
            className="w-full rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
            type="submit"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-between gap-4 text-sm">
          <Link
            className="font-semibold text-zinc-900 underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
            href="/forgot-password"
          >
            Forgot password?
          </Link>
          <Link
            className="font-semibold text-zinc-900 underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
            href="/donor/onboarding"
          >
            Donor Registration
          </Link>
        </div>
      </div>
    </div>
  );
}

