"use client";

import { useMemo, useState } from "react";
import { getSupabaseOrNull } from "@/lib/supabaseClient";

export default function DonorPushEnable() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [perm, setPerm] = useState<NotificationPermission>(() => {
    if (typeof window === "undefined") return "default";
    return Notification.permission;
  });

  const vapidKey = useMemo(() => {
    return (
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
      process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ??
      ""
    );
  }, []);

  function urlBase64ToUint8Array(base64String: string) {
    // Base64URL → Base64
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  async function onEnable() {
    setBusy(true);
    setMsg(null);
    try {
      if (typeof window === "undefined") return;
      if (!("Notification" in window)) {
        setMsg("This browser does not support notifications.");
        return;
      }
      if (!vapidKey?.trim()) {
        setMsg(
          "Missing VAPID public key. Add NEXT_PUBLIC_VAPID_PUBLIC_KEY (or NEXT_PUBLIC_FIREBASE_VAPID_KEY) in .env.local and restart app.",
        );
        return;
      }

      const next = await Notification.requestPermission();
      setPerm(next);
      if (next !== "granted") {
        setMsg("Notifications not enabled.");
        return;
      }

      const supabase = getSupabaseOrNull();
      if (!supabase) {
        setMsg("Supabase is not configured.");
        return;
      }

      const sessionData = await supabase.auth.getSession();
      const userId = sessionData.data.session?.user?.id;
      if (!userId) {
        setMsg("Please sign in again to enable notifications.");
        return;
      }

      const swReg = await navigator.serviceWorker.ready;
      const existing = await swReg.pushManager.getSubscription();

      const subscription = existing
        ? existing
        : await swReg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          });

      const subJson = subscription.toJSON();
      const { error } = await supabase.from("donor_webpush_subscriptions").upsert(
        { donor_user_id: userId, subscription: subJson },
        { onConflict: "donor_user_id" },
      );
      if (error) {
        setMsg(error.message);
        return;
      }

      setMsg("Notifications enabled. You will get emergency alerts.");
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : "Failed to enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  if (perm === "granted") {
    return (
      <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-800">
        Push notifications are enabled.
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-zinc-200 bg-white/70 p-4 text-sm">
      <div className="font-semibold text-zinc-900">Emergency alerts</div>
      <div className="mt-1 text-zinc-600 text-xs">
        Enable push notifications to get alerts when an emergency is posted near you.
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onEnable()}
          disabled={busy}
          className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-red-600 to-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:brightness-105 disabled:opacity-60"
        >
          {busy ? "Enabling..." : "Enable notifications"}
        </button>
        {perm === "denied" ? (
          <div className="flex items-center text-xs text-rose-700">
            Permission blocked in browser. Enable it in site settings.
          </div>
        ) : null}
      </div>
      {msg ? <div className="mt-2 text-xs text-zinc-700">{msg}</div> : null}
    </div>
  );
}

