"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = getSupabaseOrNull();
      if (!supabase) {
        setError(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
        );
        return;
      }
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (!user) {
        router.replace("/sign-in");
        return;
      }

      type ProfileTry = {
        role: "donor" | "seeker";
        must_change_password?: boolean | null;
      };
      type ProfileFallback = { role: "donor" | "seeker" };

      let profileRow: ProfileTry | ProfileFallback | null = null;
      let mustChangePassword = false;

      const { data: profileTry, error: profileErr } = await supabase
        .from("profiles")
        .select("role,must_change_password")
        .eq("user_id", user.id)
        .single();

      if (!profileErr && profileTry) {
        profileRow = profileTry as ProfileTry;
        mustChangePassword = Boolean(profileTry.must_change_password);
      } else {
        // Backward compatibility if migration 04 hasn't been applied yet.
        const { data: profileFallback, error: profileFallbackErr } = await supabase
          .from("profiles")
          .select("role")
          .eq("user_id", user.id)
          .single();
        if (profileFallbackErr || !profileFallback) {
          setError(profileFallbackErr?.message ?? profileErr?.message ?? "Unable to load profile.");
          return;
        }
        profileRow = profileFallback as ProfileFallback;
        mustChangePassword = false;
      }

      if (mustChangePassword) {
        router.replace("/change-password");
        return;
      }

      if (profileRow.role === "donor") {
        // Extra guard: unapproved donors should stay in onboarding (they're also locked by lock-donor).
        const { data: donorRow, error: donorErr } = await supabase
          .from("donors")
          .select("id_card_verified")
          .eq("user_id", user.id)
          .single();

        if (!donorErr && donorRow && donorRow.id_card_verified === false) {
          router.replace("/donor/onboarding?pending=1");
          return;
        }

        if (!donorErr && donorRow && donorRow.id_card_verified === true) {
          router.replace("/donor/dashboard");
          return;
        }
      }

      router.replace(profileRow.role === "donor" ? "/donor/onboarding" : "/search");
    })();
  }, [router]);

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="h-10 w-10 animate-spin rounded-2xl border-2 border-rose-500/20 border-t-rose-500"
          />
          <div>
            <h1 className="text-lg font-semibold">Signing you in...</h1>
            <p className="text-sm text-zinc-600">Please wait.</p>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}

