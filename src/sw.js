const CACHE = "bhc-field-shell-v17";
const SHELL = ["/", "/index.html", "/app.css", "/app.js", "/db.js", "/manifest.webmanifest", "/logo.png", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname === "/manager" || url.pathname.startsWith("/manager/")) {
    event.respondWith(fetch(request));
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ offline: true }), { status: 503, headers: { "content-type": "application/json" } })));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    const copy = response.clone();
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, copy));
    return response;
  }).catch(() => caches.match("/index.html"))));
});
