"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Service workers require HTTPS in production and won't work on localhost
    // unless using secure context.
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-blocking: PWA can still work (manifest) even if SW fails.
    });
  }, []);

  return null;
}

