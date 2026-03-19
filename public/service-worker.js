const CACHE_NAME = "audiobook-studio-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/app.js",
  "/stile.css",
  "/manifest.webmanifest",
  "/offline.html",
  "/icons/icon-app.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/generated/")) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({
            error: "Connessione assente. Riprova quando torni online.",
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
            status: 503,
          }
        )
      )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).catch(() => caches.match("/offline.html"));
    })
  );
});
