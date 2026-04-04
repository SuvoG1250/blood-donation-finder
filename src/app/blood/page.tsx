import Link from "next/link";
import { getPublicSiteSettings } from "@/lib/publicSiteSettings";

export default async function Home() {
  const settings = await getPublicSiteSettings();
  const homeTagline =
    settings.home_tagline?.trim() ||
    "Donors are admin-verified. We enforce a 90-day eligibility rule so search results show only donors who should be available.";
  const supportNote = settings.home_support_note?.trim();
  const waDigits = (settings.support_whatsapp ?? "").replace(/[^0-9]/g, "");

  return (
    <div className="relative overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-red-500/10 blur-2xl" />
        <div className="absolute -right-24 top-10 h-72 w-72 rounded-full bg-rose-500/10 blur-2xl" />
        <div className="absolute left-1/2 top-1/2 h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-tr from-red-500/10 to-orange-500/10 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <section className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1.5 text-xs text-zinc-600 shadow-sm">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-gradient-to-br from-red-600 to-rose-500" />
              Non-profit blood donation finder
            </div>

            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Find eligible donors in your{" "}
              <span className="bg-gradient-to-r from-red-600 via-rose-600 to-orange-500 bg-clip-text text-transparent">
                district, block & panchayat
              </span>
              .
            </h1>

            <p className="max-w-xl text-base leading-relaxed text-zinc-700 sm:text-lg">
              {homeTagline}
            </p>

            {supportNote ? (
              <p className="max-w-xl text-sm leading-relaxed text-zinc-600">{supportNote}</p>
            ) : null}

            {waDigits ? (
              <p className="text-sm text-zinc-600">
                Support:{" "}
                <a
                  href={`https://wa.me/${waDigits}`}
                  className="font-semibold text-rose-700 underline decoration-rose-500/30 underline-offset-4 hover:decoration-rose-500"
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp ({settings.support_whatsapp?.trim()})
                </a>
              </p>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/search"
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:brightness-105"
              >
                Find Donors
              </Link>
              <Link
                href="/emergency"
                className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white/70 px-5 py-3 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-white"
              >
                Emergency Requests
              </Link>
            </div>

            <p className="text-sm text-zinc-600">
              Donor signup includes a mandatory front-side ID upload (only admin
              can verify & view it).
            </p>
          </section>

          <aside className="space-y-4">
            <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
              <h2 className="text-lg font-semibold">Why this is trusted</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border bg-white/80 p-4">
                  <div className="text-sm font-semibold">Admin verification</div>
                  <div className="mt-1 text-sm text-zinc-600">
                    ID cards are private and visible only to admin.
                  </div>
                </div>
                <div className="rounded-xl border bg-white/80 p-4">
                  <div className="text-sm font-semibold">90-day eligibility</div>
                  <div className="mt-1 text-sm text-zinc-600">
                    Donors are hidden if last donation is under 90 days.
                  </div>
                </div>
                <div className="rounded-xl border bg-white/80 p-4">
                  <div className="text-sm font-semibold">WhatsApp contact</div>
                  <div className="mt-1 text-sm text-zinc-600">
                    One-tap wa.me links; no chat API needed.
                  </div>
                </div>
                <div className="rounded-xl border bg-white/80 p-4">
                  <div className="text-sm font-semibold">Public emergency feed</div>
                  <div className="mt-1 text-sm text-zinc-600">
                    Post urgent blood requirements for everyone to see.
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-xl bg-gradient-to-r from-red-600/10 to-rose-500/10 p-4">
                <div className="text-sm font-semibold">Want to donate?</div>
                <div className="mt-1 text-sm text-zinc-600">
                  Submit your details and ID front for admin verification.
                </div>
                <div className="mt-3">
                  <Link
                    href="/donor/onboarding"
                    className="group relative inline-flex w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-r from-red-600 via-rose-600 to-orange-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-rose-500/25 ring-1 ring-inset ring-white/15 transition hover:-translate-y-0.5 hover:shadow-md hover:shadow-rose-500/35 hover:brightness-105 active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-rose-300/70 sm:w-auto"
                  >
                    <span className="pointer-events-none absolute inset-0 after:absolute after:inset-0 after:bg-gradient-to-r after:from-white/0 after:via-white/25 after:to-white/0 after:translate-x-[-140%] after:skew-x-[-20deg] after:opacity-0 after:transition after:duration-700 group-hover:after:translate-x-[140%] group-hover:after:opacity-100" />
                    <span className="pointer-events-none absolute -inset-6 opacity-0 blur-xl transition-opacity duration-500 group-hover:opacity-100 before:absolute before:inset-0 before:bg-gradient-to-r before:from-rose-400/45 before:to-orange-400/35" />
                    <span className="relative z-10 inline-flex items-center gap-2">
                      <span className="relative grid h-7 w-7 place-items-center rounded-lg bg-white/15 ring-1 ring-white/15">
                        <span className="absolute inset-0 rounded-lg bg-white/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-4 w-4 transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-110"
                          aria-hidden="true"
                        >
                          <path d="M12 21s-6-4.35-9-8.5C.7 9.2 2.2 6.5 5 5.6c1.9-.6 3.9.1 5 1.6 1.1-1.5 3.1-2.2 5-1.6 2.8.9 4.3 3.6 2 6.9-3 4.15-9 8.5-9 8.5Z" />
                        </svg>
                      </span>
                      <span>Start Donor Signup</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5"
                        aria-hidden="true"
                      >
                        <path d="M5 12h14" />
                        <path d="m13 6 6 6-6 6" />
                      </svg>
                    </span>
                  </Link>
                </div>
              </div>
            </div>

            {/* Removed "Seeker access is required" warning card as requested */}
          </aside>
        </div>
      </div>
    </div>
  );
}
