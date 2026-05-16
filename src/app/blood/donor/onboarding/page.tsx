"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseOrNull } from "@/lib/supabaseClient";
import WbAddressFields, { emptyWbAddress, type WbAddressValue } from "@/components/WbAddressFields";
import { normalizeWbAddress } from "@/lib/wbAddress";

type BloodGroupRow = {
  blood_group: string;
  display_name: string;
};

const fallbackBloodGroups: BloodGroupRow[] = [
  { blood_group: "O+", display_name: "O+" },
  { blood_group: "O-", display_name: "O-" },
  { blood_group: "A+", display_name: "A+" },
  { blood_group: "A-", display_name: "A-" },
  { blood_group: "B+", display_name: "B+" },
  { blood_group: "B-", display_name: "B-" },
  { blood_group: "AB+", display_name: "AB+" },
  { blood_group: "AB-", display_name: "AB-" },
];
const MAX_UPLOAD_BYTES = 200 * 1024; // 200KB

function fileExt(file: File | null) {
  const name = file?.name ?? "";
  const lastDot = name.lastIndexOf(".");
  if (lastDot < 0) return "jpg";
  const ext = name.slice(lastDot + 1).trim().toLowerCase();
  return ext || "jpg";
}

function isFileTooLarge(file: File | null) {
  if (!file) return false;
  return file.size > MAX_UPLOAD_BYTES;
}

async function compressImageFile(opts: {
  file: File;
  maxBytes: number;
  mimeType?: string; // prefer image/jpeg
  maxDimension?: number; // max width/height
}): Promise<File> {
  const { file, maxBytes } = opts;
  const mimeType = opts.mimeType ?? "image/jpeg";
  const maxDimension = opts.maxDimension ?? 1024;

  // Decode image.
  const bitmap = await createImageBitmap(file);
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  if (!srcW || !srcH) throw new Error("Invalid image");

  // Resize to maxDimension while keeping aspect ratio.
  const scale = Math.min(1, maxDimension / Math.max(srcW, srcH));
  const outW = Math.max(1, Math.floor(srcW * scale));
  const outH = Math.max(1, Math.floor(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas context not available");

  ctx.drawImage(bitmap, 0, 0, outW, outH);

  const toBlobWithQuality = (quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (!b) reject(new Error("Failed to compress image"));
          else resolve(b);
        },
        mimeType,
        quality,
      );
    });

  // If it's already small enough, avoid quality loss.
  if (file.size <= maxBytes) {
    // Ensure we return a File (some uploads use type checking).
    const safeBlob = await toBlobWithQuality(0.92);
    const safeFile = new File([safeBlob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, {
      type: mimeType,
      lastModified: file.lastModified,
    });
    if (safeFile.size <= maxBytes) return safeFile;
    // Otherwise fall through to binary search below.
  }

  // Binary search quality.
  let low = 0.35;
  let high = 0.95;
  let best: Blob | null = null;

  for (let i = 0; i < 7; i++) {
    const mid = (low + high) / 2;
    const blob = await toBlobWithQuality(mid);
    if (blob.size <= maxBytes) {
      best = blob;
      low = mid; // try higher quality
    } else {
      high = mid; // reduce quality
    }
  }

  // If still too big, do one more aggressive resize and try again.
  if (!best) {
    const aggressiveScale = 0.75;
    canvas.width = Math.max(1, Math.floor(outW * aggressiveScale));
    canvas.height = Math.max(1, Math.floor(outH * aggressiveScale));
    const ctx2 = canvas.getContext("2d", { alpha: false });
    if (!ctx2) throw new Error("Canvas context not available");
    ctx2.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await toBlobWithQuality(0.5);
    best = blob.size <= maxBytes ? blob : blob;
  }

  const safeFileName = `${file.name.replace(/\.[^.]+$/, "")}.jpg`;
  return new File([best], safeFileName, {
    type: mimeType,
    lastModified: file.lastModified,
  });
}

export default function DonorOnboardingPage() {
  const router = useRouter();
  const [isPendingApproval, setIsPendingApproval] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [bloodGroup, setBloodGroup] = useState("");
  const [bloodGroups, setBloodGroups] = useState<BloodGroupRow[]>([]);
  const [address, setAddress] = useState<WbAddressValue>(emptyWbAddress);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [lastDonationDate, setLastDonationDate] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [idFrontFile, setIdFrontFile] = useState<File | null>(null);

  useEffect(() => {
    // Avoid `useSearchParams()` suspense requirements by reading from `window` on the client.
    const pending = new URLSearchParams(window.location.search).get("pending");
    queueMicrotask(() => setIsPendingApproval(pending === "1"));
  }, []);

  useEffect(() => {
    const supabase = getSupabaseOrNull();
    if (!supabase) return;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      const userEmail = data.session?.user?.email ?? null;
      if (userEmail) {
        queueMicrotask(() => {
          setSessionEmail(userEmail);
          setEmail(userEmail);
        });
      }
    })();
  }, []);

  useEffect(() => {
    const supabase = getSupabaseOrNull();
    if (!supabase) {
      queueMicrotask(() => setBloodGroups([]));
      return;
    }
    void (async () => {
      const { data: bgData } = await supabase
        .from("blood_groups")
        .select("blood_group, display_name")
        .order("sort_order");
      if (bgData && bgData.length > 0) {
        setBloodGroups(bgData as BloodGroupRow[]);
      }
    })();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isPendingApproval) {
      alert("You already submitted for admin verification. Please wait for approval.");
      return;
    }
    setLoading(true);
    setSubmitted(null);
    try {
      const supabase = getSupabaseOrNull();
      if (!supabase) {
        alert(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
        );
        return;
      }

      let { data: sessionData } = await supabase.auth.getSession();
      let user = sessionData.session?.user;

      // Create user ID/password during donor registration if not already signed in.
      if (!user) {
        if (!email.trim() || !password) {
          alert("Email and password are required to create your donor account.");
          return;
        }

        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
        });

        if (signUpErr) {
          alert(signUpErr.message);
          return;
        }

        // If email confirmation is enabled, session may be null.
        if (!signUpData.session) {
          setSubmitted(
            "Account created. Please check your email to confirm, then sign in and complete donor registration.",
          );
          router.replace("/sign-in");
          return;
        }

        sessionData = { session: signUpData.session };
        user = signUpData.session.user;
      }

      if (!idFrontFile) {
        alert("ID card front image is required.");
        return;
      }

      if (!photoFile) {
        alert("Donor photo is required.");
        return;
      }

      // Compress images on-device so they fit MAX_UPLOAD_BYTES.
      let idUploadFile: File = idFrontFile;
      let photoUploadFile: File = photoFile;
      try {
        if (isFileTooLarge(idFrontFile)) {
          idUploadFile = await compressImageFile({
            file: idFrontFile,
            maxBytes: MAX_UPLOAD_BYTES,
            mimeType: "image/jpeg",
            maxDimension: 1024,
          });
        }
        if (isFileTooLarge(photoFile)) {
          photoUploadFile = await compressImageFile({
            file: photoFile,
            maxBytes: MAX_UPLOAD_BYTES,
            mimeType: "image/jpeg",
            maxDimension: 1024,
          });
        }
      } catch {
        // If compression fails, keep original files and validate below.
      }

      if (isFileTooLarge(idUploadFile)) {
        alert("ID card image must be 200KB or less (we could not compress enough).");
        return;
      }
      if (isFileTooLarge(photoUploadFile)) {
        alert("Donor photo must be 200KB or less (we could not compress enough).");
        return;
      }

      if (address.pincode.length !== 6) {
        alert("Please enter a valid 6-digit West Bengal PIN code.");
        return;
      }
      if (!address.district.trim()) {
        alert("Please look up your PIN code or select a post office to fill District.");
        return;
      }
      if (!address.block.trim()) {
        alert("Please look up your PIN code or select a post office to fill Block.");
        return;
      }
      if (!address.panchayat.trim()) {
        alert("Please look up your PIN code or select a post office to fill Panchayat / locality.");
        return;
      }
      if (!address.village.trim()) {
        alert("Please enter your village name.");
        return;
      }
      if (addressError) {
        alert(addressError);
        return;
      }

      const userId = user.id;

      // 1) Mark profile as donor (RLS allows self update).
      // On some setups, the `handle_new_user` trigger may take a moment to create `profiles`,
      // so we retry until the row exists.
      const deadline = Date.now() + 8000;
      let roleUpdated = false;
      let lastRoleErr: string | null = null;
      while (Date.now() < deadline) {
        const { data: updated, error: roleErr } = await supabase
          .from("profiles")
          .update({ role: "donor" })
          .eq("user_id", userId)
          .select("user_id")
          .maybeSingle();

        if (roleErr) {
          lastRoleErr = roleErr.message;
          await new Promise((r) => setTimeout(r, 350));
          continue;
        }

        if (updated?.user_id) {
          roleUpdated = true;
          break;
        }

        await new Promise((r) => setTimeout(r, 350));
      }

      if (!roleUpdated) {
        alert(
          lastRoleErr ??
            "Unable to set your profile role. Please ensure you ran the Supabase SQL (01_schema_and_functions.sql) so the profiles trigger exists.",
        );
        return;
      }

      // 2) Upload mandatory ID card (front side only) to private bucket
      const idUploadExt = fileExt(idUploadFile);
      const idObjectPath = `${userId}/id_front_${Date.now()}.${idUploadExt}`;
      const { error: idUploadErr } = await supabase.storage
        .from("donor-ids")
        .upload(idObjectPath, idUploadFile, {
          contentType: idUploadFile.type || "image/jpeg",
          upsert: false,
        });

      if (idUploadErr) {
        const msg = idUploadErr.message.toLowerCase();
        if (msg.includes("bucket") && msg.includes("not found")) {
          alert(
            "Storage bucket 'donor-ids' was not found in your Supabase project.\n\n" +
              "Fix:\n" +
              "- Run supabase/03b_storage_buckets.sql in Supabase SQL Editor\n" +
              "- Then run supabase/03_storage.sql (policies)\n\n" +
              "After that, try registration again.",
          );
          return;
        }
        alert(idUploadErr.message);
        return;
      }

      // 3) Donor photo
      const photoUploadExt = fileExt(photoUploadFile);
      const photoObjectPath = `${userId}/photo_${Date.now()}.${photoUploadExt}`;
      const { error: photoUploadErr } = await supabase.storage
        .from("donor-photos")
        .upload(photoObjectPath, photoUploadFile, {
          contentType: photoUploadFile.type || "image/jpeg",
          upsert: true,
        });

      if (photoUploadErr) {
        const msg = photoUploadErr.message.toLowerCase();
        if (msg.includes("bucket") && msg.includes("not found")) {
          alert(
            "Storage bucket 'donor-photos' was not found in your Supabase project.\n\n" +
              "Fix:\n" +
              "- Run supabase/03b_storage_buckets.sql in Supabase SQL Editor\n" +
              "- Then run supabase/03_storage.sql (policies)\n\n" +
              "After that, try registration again.",
          );
          return;
        }
        alert(photoUploadErr.message);
        return;
      }

      // 4) Upsert donor profile in database
      const payloadWithVillage = {
        user_id: userId,
        name,
        photo_object_path: photoObjectPath,
        blood_group: bloodGroup,
        district: address.district.trim(),
        block: address.block.trim(),
        panchayat: address.panchayat.trim(),
        village: address.village.trim(),
        last_donation_date: lastDonationDate,
        contact_number: contactNumber,
        id_card_object_path: idObjectPath,
        id_card_verified: false, // admin will verify
      };

      const { error: donorErr } = await supabase.from("donors").upsert(payloadWithVillage);

      let villageFallbackUsed = false;
      if (donorErr) {
        // Backward compatibility for databases that don't have the village column yet.
        if (
          donorErr.message.toLowerCase().includes("column") &&
          donorErr.message.toLowerCase().includes("village")
        ) {
          const payloadWithoutVillage = {
            user_id: userId,
            name,
            photo_object_path: photoObjectPath,
            blood_group: bloodGroup,
            district: address.district.trim(),
            block: address.block.trim(),
            panchayat: address.panchayat.trim(),
            last_donation_date: lastDonationDate,
            contact_number: contactNumber,
            id_card_object_path: idObjectPath,
            id_card_verified: false,
          };
          const { error: donorErrFallback } = await supabase
            .from("donors")
            .upsert(payloadWithoutVillage);
          if (!donorErrFallback) villageFallbackUsed = true;
        }
        if (!villageFallbackUsed) {
          alert(
            donorErr.message +
              "\n\nIf admin cannot see your submission, this usually means Supabase RLS blocked the insert. Ensure you ran 01_schema_and_functions.sql + 02_rls.sql.",
          );
          return;
        }
      }

      // Lock the user until admin approval is completed.
      // This prevents the donor from signing in and searching until approved.
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const accessToken = sessionData.session?.access_token;
      if (!supabaseUrl || !accessToken) {
        alert("Missing NEXT_PUBLIC_SUPABASE_URL / access token. Cannot lock donor.");
        return;
      }

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 20000);
      const lockResp = await fetch(`${supabaseUrl}/functions/v1/lock-donor`, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ donor_user_id: userId }),
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeout));

      if (!lockResp.ok) {
        const errJson = await lockResp.json().catch(() => ({}));
        alert(errJson?.error ?? "Failed to lock donor account.");
        return;
      }

      // Best-effort "registration received" email (doesn't block submission).
      try {
        await fetch(`${supabaseUrl}/functions/v1/donor-registration-received`, {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=utf-8",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ donor_user_id: userId }),
        });
      } catch {
        // ignore
      }

      // Sign out after locking so they must wait for admin approval email/temp password.
      await supabase.auth.signOut();

      setSubmitted(
        villageFallbackUsed
          ? "Submitted! Admin will verify your ID before you appear in searches. (Note: your current database doesn't have the `village` column yet.)"
          : "Submitted! Waiting for admin approval. Please check your email after approval for a temporary password.",
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.name === "AbortError"
            ? "Request timed out while locking donor account. Please try again."
            : err.message
          : "Registration failed. Please try again.";
      alert(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Donor Registration</h1>
            <p className="mt-2 text-sm text-zinc-600">
              ID card front upload is mandatory and will be visible only to
              admin.
            </p>
          </div>
          <div className="hidden h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-rose-500 text-white shadow-sm sm:flex">
            <span className="text-sm font-bold">ID</span>
          </div>
        </div>

        {isPendingApproval ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900">
            Your registration is submitted. Please wait for admin approval.
          </div>
        ) : null}

        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={onSubmit}>
          {!sessionEmail ? (
            <>
              <label className="sm:col-span-2 block">
                <span className="text-sm font-medium">Email (User ID)</span>
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

              <label className="sm:col-span-2 block">
                <span className="text-sm font-medium">Password</span>
                <input
                  className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="Create password"
                  required
                  autoComplete="new-password"
                />
              </label>
            </>
          ) : (
            <div className="sm:col-span-2 rounded-xl border border-zinc-200 bg-white/60 p-3 text-sm text-zinc-700">
              Signed in as <span className="font-semibold">{sessionEmail}</span>
            </div>
          )}

          <label className="sm:col-span-2 block">
            <span className="text-sm font-medium">Full Name</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Blood Group</span>
            <select
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20 disabled:opacity-70"
              value={bloodGroup}
              onChange={(e) => setBloodGroup(e.target.value)}
              required
            >
              <option value="" disabled>
                Select blood group
              </option>
              {(bloodGroups.length > 0 ? bloodGroups : fallbackBloodGroups).map(
                (bg) => (
                  <option key={bg.blood_group} value={bg.blood_group}>
                    {bg.display_name}
                  </option>
                ),
              )}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Last Donation Date</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              value={lastDonationDate}
              onChange={(e) => setLastDonationDate(e.target.value)}
              type="date"
              required
            />
          </label>

          <WbAddressFields
            value={address}
            onChange={(next) => setAddress(normalizeWbAddress(next))}
            onError={setAddressError}
            showVillage
            panchayatMode="required"
          />

          <label className="sm:col-span-2 block">
            <span className="text-sm font-medium">Contact Number (for WhatsApp)</span>
            <input
              className="mt-1 w-full rounded-xl border border-zinc-200 bg-white/80 px-3 py-2.5 text-sm outline-none transition focus:border-rose-500/40 focus:ring-2 focus:ring-rose-500/20"
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
              placeholder="10-digit mobile number"
              required
            />
          </label>

          <label className="sm:col-span-2 block">
            <span className="text-sm font-medium">ID Card Front Image (Required)</span>
            <input
              className="mt-2 block w-full text-sm"
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (isFileTooLarge(f)) {
                  alert("ID card image must be 200KB or less.");
                  e.currentTarget.value = "";
                  setIdFrontFile(null);
                  return;
                }
                setIdFrontFile(f);
              }}
              required
            />
            <div className="mt-1 text-xs text-zinc-500">Max file size: 200KB</div>
          </label>

          <label className="sm:col-span-2 block">
            <span className="text-sm font-medium">
              Donor Photo (Required)
            </span>
            <input
              className="mt-2 block w-full text-sm"
              type="file"
              accept="image/*"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (isFileTooLarge(f)) {
                  alert("Donor photo must be 200KB or less.");
                  e.currentTarget.value = "";
                  setPhotoFile(null);
                  return;
                }
                setPhotoFile(f);
              }}
              required
            />
            <div className="mt-1 text-xs text-zinc-500">Max file size: 200KB</div>
          </label>

          <div className="sm:col-span-2">
            <button
              disabled={Boolean(loading)}
              suppressHydrationWarning
              type="submit"
              className="w-full rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
            >
              {loading ? "Submitting..." : "Submit for Admin Verification"}
            </button>
          </div>
        </form>

        {submitted ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            {submitted}
          </div>
        ) : null}
      </div>
    </div>
  );
}

