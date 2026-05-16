"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

export default function HospitalSignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseOrNull();
    if (!supabase) return;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .single();

      if (profile?.role === "hospital") {
        router.replace("/hospital/dashboard");
      }
    })();
  }, [router]);

  async function onSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setLoading(false);
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      return;
    }

    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInErr) {
      setLoading(false);
      setError(signInErr.message);
      return;
    }

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "")
      .single();

    setLoading(false);

    if (profileErr) {
      setError(profileErr.message);
      return;
    }

    if (profile?.role !== "hospital") {
      setError("This account is not a hospital. Contact owner to grant hospital access.");
      return;
    }

    router.replace("/hospital/dashboard");
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Hospital sign in</h1>
            <p className="mt-2 text-sm text-zinc-600">
              Only hospital accounts can manage their emergency requests.
            </p>
          </div>
          <div className="hidden h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-rose-500 text-white shadow-sm sm:flex">
            <span className="text-sm font-bold">H</span>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={onSignIn}>
          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="hospital@example.com"
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
              placeholder="Password"
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
            href="/sign-in"
          >
            Normal sign in
          </Link>
          <Link
            className="font-semibold text-zinc-900 underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
            href="/forgot-password"
          >
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  );
}

