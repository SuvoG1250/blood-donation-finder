"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

type AuthState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "signed_in_seeker"; email: string }
  | { status: "signed_in_donor"; email: string }
  | { status: "signed_in_admin"; email: string }
  | { status: "signed_in_hospital"; email: string };

export default function AdminAuthButton({
  className,
  compact,
}: {
  className?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const signInHref = "/sign-in";
  const adminSignInHref = "/admin/sign-in";

  useEffect(() => {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      queueMicrotask(() => setState({ status: "signed_out" }));
      return;
    }

    let mounted = true;

    const refresh = async () => {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user ?? null;
      if (!mounted) return;
      if (!user?.email) {
        setState({ status: "signed_out" });
        return;
      }

      const { data: isAdminData } = await supabase.rpc("is_admin");
      if (!mounted) return;

      if (isAdminData) {
        setState({ status: "signed_in_admin", email: user.email });
        return;
      }

      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .single();

      if (!mounted) return;
      const role = profileErr ? null : (profile?.role as string | null);
      if (role === "donor") {
        setState({ status: "signed_in_donor", email: user.email });
        return;
      }

      if (role === "hospital") {
        setState({ status: "signed_in_hospital", email: user.email });
        return;
      }

      setState({ status: "signed_in_seeker", email: user.email });
    };

    void refresh();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (e.target.closest("[data-admin-auth-root]")) return;
      setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const isAdmin = state.status === "signed_in_admin";
  const signedIn =
    state.status === "signed_in_admin" ||
    state.status === "signed_in_hospital" ||
    state.status === "signed_in_donor" ||
    state.status === "signed_in_seeker";

  const label = useMemo(() => {
    if (state.status === "loading") return "Loading...";
    if (state.status === "signed_out") return "Sign In";
    if (state.status === "signed_in_admin") return "Admin";
    if (state.status === "signed_in_donor") return "Donor";
    if (state.status === "signed_in_hospital") return "Hospital";
    return "Account";
  }, [state.status]);

  async function onSignOut() {
    const supabase = getSupabaseOrNull();
    if (!supabase) return;
    await supabase.auth.signOut();
    setOpen(false);
  }

  if (state.status === "loading") {
    return (
      <div
        className={
          className ??
          "inline-flex items-center justify-center rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700"
        }
      >
        {compact ? "…" : "Loading"}
      </div>
    );
  }

  if (!signedIn) {
    return (
      <Link
        href={signInHref}
        aria-label="Sign in"
        className={
          className ??
          "group relative inline-flex overflow-hidden rounded-full bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-rose-500/20 ring-1 ring-inset ring-white/15 transition hover:-translate-y-0.5 hover:shadow-md hover:shadow-rose-500/30 hover:brightness-105 active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-rose-300/70"
        }
      >
        <span className="relative z-10 inline-flex items-center gap-2">
          <span>{label}</span>
        </span>
      </Link>
    );
  }

  return (
    <div className="relative" data-admin-auth-root>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          className ??
          "inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50"
        }
      >
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-rose-500 text-xs font-bold text-white">
          {state.status === "signed_in_admin"
            ? "A"
            : state.status === "signed_in_donor"
              ? "D"
              : state.status === "signed_in_hospital"
                ? "H"
                : "U"}
        </span>
        <span className="hidden sm:inline">{label}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-[280px] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg">
          <div className="px-4 py-3">
            <div className="text-xs font-semibold text-zinc-500">Signed in as</div>
            <div className="mt-1 truncate text-sm font-semibold text-zinc-900">
              {state.status === "signed_in_admin" ||
              state.status === "signed_in_donor" ||
              state.status === "signed_in_hospital" ||
              state.status === "signed_in_seeker"
                ? state.email
                : ""}
            </div>
          </div>

          <div className="border-t border-zinc-100" />

          {isAdmin ? (
            <>
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                Admin Dashboard
              </Link>
              <Link
                href="/admin/donors"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                Verify Donors
              </Link>
              <Link
                href="/change-password"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                Change Password
              </Link>
            </>
          ) : state.status === "signed_in_donor" ? (
            <>
              <Link
                href="/donor/dashboard"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                Donor Dashboard
              </Link>
              <Link
                href="/change-password"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                Change Password
              </Link>
            </>
          ) : state.status === "signed_in_hospital" ? (
            <>
              <Link
                href="/hospital/dashboard"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                Hospital Dashboard
              </Link>
              <Link
                href="/change-password"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                Change Password
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/change-password"
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                Change Password
              </Link>
              <Link
                href={adminSignInHref}
                onClick={() => setOpen(false)}
                className="block px-4 py-2.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
              >
                Admin sign in
              </Link>
            </>
          )}

          <button
            type="button"
            onClick={onSignOut}
            className="block w-full px-4 py-2.5 text-left text-sm font-semibold text-rose-700 hover:bg-rose-50"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

