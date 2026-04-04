"use client";

import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, type Messaging } from "firebase/messaging";

type FirebaseConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

function getFirebaseConfigFromEnv(): FirebaseConfig {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "";
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "";
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "";
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "";
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "";
  const measurementId = process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? undefined;

  if (
    !apiKey ||
    !authDomain ||
    !projectId ||
    !storageBucket ||
    !messagingSenderId ||
    !appId
  ) {
    throw new Error(
      "Missing Firebase env vars. Add NEXT_PUBLIC_FIREBASE_* to .env.local.",
    );
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket,
    messagingSenderId,
    appId,
    measurementId,
  };
}

function getMessagingOrThrow(): Messaging {
  const config = getFirebaseConfigFromEnv();
  const app = getApps().length ? getApps()[0] : initializeApp(config);
  return getMessaging(app);
}

export async function requestFcmToken(opts: {
  vapidKey: string;
  // The service worker registration to bind the token to.
  serviceWorkerRegistration: ServiceWorkerRegistration;
}): Promise<string> {
  const vapidKey = opts.vapidKey?.trim();
  if (!vapidKey) throw new Error("Missing NEXT_PUBLIC_FIREBASE_VAPID_KEY.");

  const messaging = getMessagingOrThrow();
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: opts.serviceWorkerRegistration,
  });
  if (!token) throw new Error("FCM token not returned (permission denied or unsupported browser).");
  return token;
}

