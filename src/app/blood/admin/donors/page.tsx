"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseOrNull } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

type DonorAdminRow = {
  user_id: string;
  email?: string | null;
  name: string;
  blood_group: string;
  district: string;
  block: string;
  panchayat: string;
  village?: string | null;
  last_donation_date: string;
  contact_number?: string | null;
  photo_object_path?: string | null;
  id_card_object_path: string;
  id_card_verified: boolean;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  trusted_donor?: boolean | null;
  verification_notes?: string | null;
};

function daysSince(dateIso: string) {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export default function AdminDonorsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [canDeleteDonor, setCanDeleteDonor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [donors, setDonors] = useState<DonorAdminRow[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [photoSignedUrls, setPhotoSignedUrls] = useState<Record<string, string>>(
    {},
  );

  function digitsOnly(s: string) {
    return (s ?? "").replace(/[^0-9]/g, "");
  }

  function toWhatsAppLink(contact: string) {
    const digits = digitsOnly(contact);
    return digits ? `https://wa.me/${digits}` : "#";
  }

  async function loadDonors() {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
      );
      return;
    }
    setError(null);
    const { data, error: listErr } = await supabase.rpc("admin_list_donors");

    if (listErr) {
      setError(listErr.message);
      return;
    }

    const base = (data as DonorAdminRow[]) ?? [];
    if (base.length === 0) {
      setDonors([]);
      return;
    }

    // Load admin metadata (trusted donor + notes).
    try {
      const ids = base.map((d) => d.user_id);
      const { data: metaRows, error: metaErr } = await supabase
        .from("donor_verification_metadata")
        .select("donor_user_id,trusted_donor,verification_notes")
        .in("donor_user_id", ids);

      if (!metaErr && metaRows) {
        const map = new Map<
          string,
          { trusted_donor: boolean | null; verification_notes: string | null }
        >();
        for (const m of metaRows as Array<{
          donor_user_id: string;
          trusted_donor: boolean | null;
          verification_notes: string | null;
        }>) {
          map.set(m.donor_user_id, {
            trusted_donor: m.trusted_donor,
            verification_notes: m.verification_notes,
          });
        }

        setDonors(
          base.map((d) => {
            const meta = map.get(d.user_id);
            return {
              ...d,
              trusted_donor: meta?.trusted_donor ?? false,
              verification_notes: meta?.verification_notes ?? null,
            };
          }),
        );
        return;
      }
    } catch {
      // If metadata table isn't present yet, keep donors list.
    }

    setDonors(base);
  }

  async function callEdgeFunction<T>(
    functionName: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const supabase = getSupabaseOrNull();
    if (!supabase) throw new Error("Supabase is not configured.");

    const apiPath = `/api/admin/${functionName}`;
    const invoke = async (token: string) =>
      fetch(apiPath, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

    const getTokenOrThrow = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Missing access token. Please sign in again.");
      return token;
    };

    let accessToken = await getTokenOrThrow();
    let resp = await invoke(accessToken);

    const text = await resp.text();
    let json: { error?: string; ok?: boolean } = {};
    try {
      json = (text ? JSON.parse(text) : {}) as { error?: string; ok?: boolean };
    } catch {
      json = {};
    }

    if (!resp.ok) {
      let details =
        json?.error ??
        (text && text.length < 500 ? text : "") ??
        `HTTP ${resp.status}`;

      const msg = details || `Edge function ${functionName} failed.`;
      if (resp.status === 401 && msg.toLowerCase().includes("invalid jwt")) {
        // Token can be stale; refresh and retry once before asking user to sign in again.
        const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
        const nextToken = refreshed.session?.access_token;
        if (!refreshErr && nextToken) {
          accessToken = nextToken;
          resp = await invoke(accessToken);
          const retryText = await resp.text();
          let retryJson: { error?: string; ok?: boolean } = {};
          try {
            retryJson = (retryText ? JSON.parse(retryText) : {}) as {
              error?: string;
              ok?: boolean;
            };
          } catch {
            retryJson = {};
          }

          if (resp.ok) {
            return (retryJson as unknown as T) ?? ({} as T);
          }

          details =
            retryJson?.error ??
            (retryText && retryText.length < 500 ? retryText : "") ??
            `HTTP ${resp.status}`;
          throw new Error(details || "Session expired / Invalid JWT. Please sign in again.");
        }

        throw new Error("Session expired / Invalid JWT. Please sign in again.");
      }
      throw new Error(msg);
    }

    return (json as unknown as T) ?? ({} as T);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      const supabase = getSupabaseOrNull();
      if (!supabase) {
        setIsAdmin(false);
        setError(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
        );
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

      const { data: isAdminData, error: adminErr } = await supabase.rpc(
        "is_admin"
      );
      if (adminErr) {
        setError(adminErr.message);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      const ok = Boolean(isAdminData);
      setIsAdmin(ok);
      if (ok) {
        const { data: canDeleteData } = await supabase.rpc("admin_can", {
          action: "delete_donor",
        });
        setCanDeleteDonor(Boolean(canDeleteData));
        await loadDonors();
      }

      setLoading(false);
    })();
  }, [router]);

  async function onVerify(userId: string) {
    try {
      setError(null);
      await callEdgeFunction("approve-donor", { donor_user_id: userId });
      await loadDonors();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to approve donor.";
      setError(msg);
    }
  }

  async function onReject(userId: string) {
    const reason = window.prompt(
      "Reason for rejection (optional):",
      "ID details not matching."
    );
    if (reason === null) return;

    try {
      setError(null);
      await callEdgeFunction("reject-donor", {
        donor_user_id: userId,
        rejection_reason: reason.trim(),
      });
      await loadDonors();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to reject donor.";
      setError(msg);
    }
  }

  async function onDeleteDonor(userId: string, displayName: string) {
    const confirmed = window.confirm(
      `Permanently delete donor "${displayName}"?\n\nThis removes their account and uploaded ID/photo files. This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      setError(null);
      await callEdgeFunction("delete-donor", { donor_user_id: userId });
      await loadDonors();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete donor.";
      setError(msg);
    }
  }

  async function onRateDonor(donorUserId: string, displayName: string) {
    const rawStars = window.prompt(
      `Rate donor "${displayName}" (1-5):`,
      "5",
    );
    if (rawStars === null) return;
    const stars = Number(rawStars.trim());
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
      alert("Stars must be a number from 1 to 5.");
      return;
    }

    const comment = window.prompt("Optional comment (can be empty):", "") ?? "";

    const supabase = getSupabaseOrNull();
    if (!supabase) {
      alert(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user ?? null;
    if (!user) {
      router.replace("/admin/sign-in");
      return;
    }

    setError(null);
    const { error: insErr } = await supabase.from("donor_ratings").insert({
      donor_user_id: donorUserId,
      rater_user_id: user.id,
      stars,
      comment: comment.trim() ? comment.trim() : null,
    });
    if (insErr) {
      setError(insErr.message);
      return;
    }
    alert("Rating saved.");
  }

  async function onViewId(donor: DonorAdminRow) {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      alert(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
      );
      return;
    }
    setError(null);
    if (!donor.id_card_object_path) return;

    const { data, error: signedErr } = await supabase.storage
      .from("donor-ids")
      .createSignedUrl(donor.id_card_object_path, 60 * 60);

    if (signedErr) {
      setError(signedErr.message);
      return;
    }

    setSignedUrls((prev) => ({ ...prev, [donor.user_id]: data.signedUrl }));
  }

  async function onViewPhoto(donor: DonorAdminRow) {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      alert(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
      );
      return;
    }
    setError(null);
    const path = donor.photo_object_path ?? "";
    if (!path) return;

    const { data, error: signedErr } = await supabase.storage
      .from("donor-photos")
      .createSignedUrl(path, 60 * 60);

    if (signedErr) {
      setError(signedErr.message);
      return;
    }

    setPhotoSignedUrls((prev) => ({ ...prev, [donor.user_id]: data.signedUrl }));
  }

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          Loading...
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-10">
        <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
          <h1 className="text-lg font-semibold">Admin access required</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Only admin users can verify donors and view ID cards.
          </p>
          <div className="mt-4">
            <Link
              className="text-sm font-semibold underline decoration-rose-500/40 underline-offset-4 hover:decoration-rose-500"
              href="/admin/sign-in"
            >
              Admin sign in
            </Link>
          </div>
          {error ? (
            <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-xl font-semibold">Admin: Donor Verification</h1>
          <button
            type="button"
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
            onClick={loadDonors}
          >
            Refresh list
          </button>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 space-y-3">
          {donors.map((d) => (
            <div
              key={d.user_id}
              className="rounded-xl border border-zinc-200 bg-white/80 p-4 shadow-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold">{d.name}</div>
                    <div className="text-sm text-zinc-600">({d.blood_group})</div>
                    {d.id_card_verified ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-800">
                        Verified
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-900">
                        Pending
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-zinc-700">
                    {d.district} / {d.block} / {d.panchayat}
                    {d.village ? (
                      <span className="text-zinc-500"> / {d.village}</span>
                    ) : null}
                  </div>
                  {d.email ? (
                    <div className="mt-1 text-sm text-zinc-700">
                      Email: <span className="font-semibold">{d.email}</span>
                    </div>
                  ) : null}
                  {d.contact_number ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-zinc-700">
                        WhatsApp:{" "}
                        <span className="font-semibold">{d.contact_number}</span>
                      </span>
                      <a
                        href={toWhatsAppLink(d.contact_number)}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
                      >
                        Open chat
                      </a>
                    </div>
                  ) : null}
                  <div className="text-xs text-zinc-500">
                    Last donation: {d.last_donation_date}
                    {(() => {
                      const days = daysSince(d.last_donation_date);
                      if (days === null) return null;
                      if (days >= 90) {
                        return (
                          <span className="ml-2 inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                            Eligible
                          </span>
                        );
                      }
                      return (
                        <span className="ml-2 inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                          {90 - days} days to eligible
                        </span>
                      );
                    })()}
                  </div>

                </div>

                <div className="flex flex-col gap-2 sm:items-end">
                  <div className="flex flex-col gap-2 sm:items-end sm:flex-row">
                    <button
                      type="button"
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 sm:w-auto"
                      onClick={() => void onViewPhoto(d)}
                    >
                      View photo
                    </button>
                    <button
                      type="button"
                      className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50 sm:w-auto"
                      onClick={() => onViewId(d)}
                    >
                      View ID
                    </button>
                    {d.id_card_verified ? (
                      <button
                        type="button"
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold hover:bg-zinc-50 sm:w-auto"
                        onClick={() => void onRateDonor(d.user_id, d.name)}
                      >
                        Rate donor
                      </button>
                    ) : null}
                    {!d.id_card_verified ? (
                      <button
                        type="button"
                        className="w-full rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 sm:w-auto"
                        onClick={() => onVerify(d.user_id)}
                      >
                        Verify
                      </button>
                    ) : null}

                    {!d.id_card_verified ? (
                      <button
                        type="button"
                        className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 shadow-sm transition hover:bg-rose-100 sm:w-auto"
                        onClick={() => onReject(d.user_id)}
                      >
                        Reject
                      </button>
                    ) : null}

                    {canDeleteDonor ? (
                      <button
                        type="button"
                        className="w-full rounded-xl border border-zinc-300 bg-zinc-100 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-200 sm:w-auto"
                        onClick={() => void onDeleteDonor(d.user_id, d.name)}
                      >
                        Delete donor
                      </button>
                    ) : null}

                  </div>

                  {!d.id_card_verified && d.rejection_reason ? (
                    <div className="w-full rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                      Rejection: {d.rejection_reason}
                    </div>
                  ) : null}

                  <div className="grid w-full gap-2 sm:w-[700px] sm:grid-cols-2">
                    {photoSignedUrls[d.user_id] ? (
                      <div className="w-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photoSignedUrls[d.user_id]}
                          alt="Donor photo"
                          className="max-h-64 w-full object-contain rounded-xl border bg-white"
                        />
                      </div>
                    ) : null}
                    {signedUrls[d.user_id] ? (
                      <div className="w-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={signedUrls[d.user_id]}
                          alt="Donor ID card"
                          className="max-h-64 w-full object-contain rounded-xl border bg-white"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {donors.length === 0 ? (
            <div className="text-sm text-zinc-600">No donors found.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

