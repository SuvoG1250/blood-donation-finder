import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import AdminAuthButton from "@/components/AdminAuthButton";
import PwaRegister from "@/components/PwaRegister";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Raktodaan - Blood Donation & Finder",
  description:
    "Raktodaan.com - a free, non-profit blood donation finder with admin-verified donors.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <meta name="theme-color" content="#dc2626" />
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-50 border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <Link
              href="/"
              className="flex items-center gap-3 font-semibold tracking-tight"
              aria-label="Raktodaan home"
            >
              <Image
                src="/raktodaan-logo.png"
                alt="Raktodaan logo"
                width={160}
                height={40}
                className="object-contain"
                priority
              />
            </Link>

            <nav className="hidden items-center gap-2 text-sm md:flex">
              <Link
                className="rounded-full px-3 py-1.5 hover:bg-black/5"
                href="/search"
              >
                Find Donors
              </Link>
              <Link
                className="rounded-full px-3 py-1.5 hover:bg-black/5"
                href="/emergency"
              >
                Emergency
              </Link>
              <Link
                className="rounded-full px-3 py-1.5 hover:bg-black/5"
                href="/donor/onboarding"
              >
                Donor Signup
              </Link>
              <Link
                className="rounded-full px-3 py-1.5 hover:bg-black/5"
                href="/hospital/sign-in"
              >
                Hospital
              </Link>
              <Link
                className="rounded-full px-3 py-1.5 hover:bg-black/5"
                href="/donor/dashboard#profile"
              >
                Profile
              </Link>
              <AdminAuthButton />
            </nav>

            <div className="md:hidden">
              <AdminAuthButton compact />
            </div>
          </div>
        </header>

        <main className="flex-1 pb-20 md:pb-0">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-50 border-t bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 md:hidden">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-around px-3 py-2">
            <Link
              href="/search"
              className="flex flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-[11px] font-semibold text-zinc-700 hover:bg-black/5"
            >
              <span
                aria-hidden="true"
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-red-500/10 ring-1 ring-red-500/20"
              >
                <span className="absolute inset-0 rounded-2xl bg-red-500/25 opacity-70 animate-ping" />
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="relative h-4 w-4 text-red-600"
                >
                  <path d="M14 3s-1 3-4 6-6 3-6 10a8 8 0 0 0 16 0c0-7-4-8-6-10Z" />
                </svg>
                <span className="pointer-events-none absolute -bottom-0.5 left-1/2 -translate-x-1/2 text-[10px] font-bold text-red-700">
                  B+
                </span>
              </span>
              Find
            </Link>
            <Link
              href="/emergency"
              className="flex flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-[11px] font-semibold text-zinc-700 hover:bg-black/5"
            >
              <span
                aria-hidden="true"
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-red-500/10 ring-1 ring-red-500/20"
              >
                <span className="absolute inset-0 rounded-2xl bg-red-500/25 opacity-70 animate-ping" />
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="relative h-4 w-4 text-red-600"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4" />
                  <path d="M12 16h.01" />
                </svg>
              </span>
              <span className="text-base leading-none">SOS</span>
              Emergency
            </Link>
            <Link
              href="/donor/onboarding"
              className="flex flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-[11px] font-semibold text-zinc-700 hover:bg-black/5"
            >
              <span
                aria-hidden="true"
                className="relative inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-rose-500/10 ring-1 ring-rose-500/20"
              >
                <span className="absolute inset-0 rounded-2xl bg-rose-500/25 opacity-70 animate-pulse" />
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="relative h-4 w-4 text-rose-600"
                >
                  <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8Z" />
                </svg>
              </span>
              Donate
            </Link>
            <Link
              href="/donor/dashboard#profile"
              className="flex flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-[11px] font-semibold text-zinc-700 hover:bg-black/5"
            >
              <span
                aria-hidden="true"
                className="inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-rose-500/10 ring-1 ring-rose-500/20"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4 text-rose-700"
                >
                  <path d="M20 21a8 8 0 0 0-16 0" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              Profile
            </Link>
          </div>
        </nav>

        <PwaRegister />
        <Analytics />
        <SpeedInsights />

        <footer className="border-t bg-white/50">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-zinc-500 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              © {new Date().getFullYear()} Raktodaan.com. Free blood donation finder with admin-verified donors.
            </div>
            <div className="font-semibold text-zinc-700">
              Developed and Control By : The Phoenix
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
