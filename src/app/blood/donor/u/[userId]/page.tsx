"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import type { PublicDonorProfile } from "@/app/blood/api/donor/public-profile/[userId]/route";

function formatLocation(p: PublicDonorProfile) {
  return [p.district, p.block, p.panchayat, p.village]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" / ");
}

function waLink(number: string) {
  const digits = number.replace(/[^0-9]/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

export default function PublicDonorProfilePage() {
  const params = useParams();
  const userId = typeof params.userId === "string" ? params.userId : "";

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PublicDonorProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const location = useMemo(() => (profile ? formatLocation(profile) : "—"), [profile]);
  const whatsappHref = useMemo(
    () => (profile ? waLink(profile.contact_number) : null),
    [profile],
  );

  useEffect(() => {
    if (!userId) {
      setError("Invalid profile link.");
      setLoading(false);
      return;
    }

    void (async () => {
      setLoading(true);
      setError(null);

      const paths = [
        `/blood/api/donor/public-profile/${userId}`,
        `/api/donor/public-profile/${userId}`,
      ];

      for (const path of paths) {
        try {
          const resp = await fetch(path, { cache: "no-store" });
          const payload = (await resp.json()) as {
            profile?: PublicDonorProfile;
            error?: string;
          };
          if (resp.ok && payload.profile) {
            setProfile(payload.profile);
            setLoading(false);
            return;
          }
          if (resp.status !== 404) {
            setError(payload.error ?? "Unable to load profile.");
            setProfile(null);
            setLoading(false);
            return;
          }
        } catch {
          // try next path
        }
      }

      setError("Unable to load donor profile.");
      setProfile(null);
      setLoading(false);
    })();
  }, [userId]);

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-8 sm:py-10">
      <div className="overflow-hidden rounded-3xl border border-rose-200/60 bg-white shadow-lg shadow-rose-500/10">
        <div className="bg-gradient-to-r from-red-700 via-red-600 to-rose-500 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest opacity-90">
                Raktodaan.com
              </div>
              <h1 className="mt-1 text-lg font-bold">Verified donor profile</h1>
              <p className="mt-0.5 text-xs text-white/90">Scanned from digital ID card</p>
            </div>
            {profile?.id_card_verified ? (
              <span className="shrink-0 rounded-full border border-white/40 bg-white/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide">
                Verified
              </span>
            ) : null}
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {loading ? (
            <p className="text-sm text-zinc-600">Loading donor details…</p>
          ) : null}

          {!loading && !profile ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {error ?? "Donor profile not found, not verified, or not eligible right now."}
            </div>
          ) : null}

          {profile ? (
            <div className="space-y-5">
              <div className="flex gap-4">
                {profile.photo_url ? (
                  <Image
                    src={profile.photo_url}
                    alt={profile.name}
                    width={96}
                    height={96}
                    unoptimized
                    className="h-24 w-24 shrink-0 rounded-2xl border-2 border-rose-100 object-cover shadow-sm"
                  />
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border-2 border-rose-100 bg-rose-50 text-2xl font-bold text-rose-700">
                    {(profile.name.trim()[0] ?? "D").toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-bold text-zinc-900">{profile.name}</h2>
                  {profile.email ? (
                    <p className="mt-1 truncate text-sm text-zinc-600">{profile.email}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="rounded-full bg-red-500/10 px-2.5 py-0.5 text-xs font-bold text-red-700">
                      {profile.blood_group}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        profile.is_eligible
                          ? "bg-emerald-500/10 text-emerald-800"
                          : "bg-amber-500/10 text-amber-800"
                      }`}
                    >
                      {profile.is_eligible ? "Eligible to donate" : "Not eligible yet"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    WhatsApp
                  </div>
                  {whatsappHref ? (
                    <a
                      href={whatsappHref}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block text-sm font-semibold text-emerald-700 underline"
                    >
                      {profile.contact_number}
                    </a>
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-zinc-900">
                      {profile.contact_number || "—"}
                    </p>
                  )}
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    Last donation
                  </div>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">
                    {profile.last_donation_date}
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4">
                <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                  Location
                </div>
                <p className="mt-1 text-sm font-semibold leading-relaxed text-zinc-900">
                  {location}
                </p>
                {profile.pincode.trim() ? (
                  <p className="mt-1 text-xs text-zinc-500">PIN: {profile.pincode.trim()}</p>
                ) : null}
              </div>

              {(profile.preferred_days?.length ?? 0) > 0 ||
              (profile.preferred_time_slots?.length ?? 0) > 0 ? (
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    Availability preference
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(profile.preferred_days ?? []).map((d) => (
                      <span
                        key={d}
                        className="rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-semibold text-sky-800"
                      >
                        {d}
                      </span>
                    ))}
                    {(profile.preferred_time_slots ?? []).map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-semibold text-violet-800"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <Link
                  href="/search"
                  className="rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
                >
                  Find donors
                </Link>
                <Link
                  href="/"
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                >
                  Home
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
