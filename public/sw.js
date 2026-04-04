/* Minimal service worker for PWA install + VAPID Web Push.
   - caches the app shell (/) for basic resilience
   - uses network-first for navigations, cache-first fallback
   - shows notifications from background `push` events */

const CACHE_NAME = "raktodaan-pwa-v1";
const APP_SHELL_URL = "/";

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = {};
      try {
        payload = event.data ? event.data.json() : {};
      } catch {
        payload = {};
      }

      const title = payload.title || "Emergency blood request";
      const body = payload.body || "Tap to view emergency details.";
      const route = payload.route || "/emergency";

      await self.registration.showNotification(title, {
        body,
        data: { route },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = event.notification?.data?.route || "/emergency";
  event.waitUntil(
    clients
      .openWindow(route)
      .catch(() => {}),
  );
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([APP_SHELL_URL])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET requests.
  if (req.method !== "GET") return;

  const isNavigation = req.mode === "navigate";
  if (isNavigation) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put(APP_SHELL_URL, fresh.clone());
          return fresh;
        } catch {
          const cached = await caches.match(APP_SHELL_URL);
          return cached ?? new Response("Offline", { status: 200 });
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;

      const fresh = await fetch(req);
      // Cache some simple assets by default (safe for our case).
      if (
        req.url.startsWith(self.location.origin) &&
        (req.destination === "script" ||
          req.destination === "style" ||
          req.destination === "image" ||
          req.destination === "document")
      ) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
      }
      return fresh;
    })(),
  );
});

