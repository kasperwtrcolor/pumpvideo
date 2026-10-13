/*
 * A deliberately empty service worker.
 *
 * It exists for one reason: Chromium will not offer to install a web app that
 * has no service worker with a fetch handler. This one answers nothing, so every
 * request falls through to the network untouched.
 *
 * That is the point. Pemp serves live prices and a live feed — a cache-first
 * service worker here would hand someone a stale market, which is worse than no
 * offline support at all.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// The handler that makes the app installable. No `respondWith`, so the browser
// performs the fetch itself.
self.addEventListener("fetch", () => {});
