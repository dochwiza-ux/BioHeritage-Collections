const CACHE = "bhc-field-shell-v22";
const ARCHIVE_PATH = "/AkWmn09hT55-_~!xQ7Bv3";
const SHELL = [
  "/",
  "/index.html",
  "/app.css?v=2.1.0",
  "/app.js?v=2.1.0",
  "/db.js?v=2.1.0",
  "/manifest.webmanifest",
  "/logo.png",
  "/og.png",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map(async (url) => {
        const request = new Request(url, { cache: "reload" });
        const response = await fetch(request);
        if (!response.ok) throw new Error(`Could not refresh ${url}`);
        await cache.put(request, response);
      })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname === "/manager" || url.pathname.startsWith("/manager/") || url.pathname === "/field-archive" || url.pathname.startsWith("/field-archive/") || url.pathname === ARCHIVE_PATH || url.pathname.startsWith(`${ARCHIVE_PATH}/`)) {
    event.respondWith(fetch(request));
    return;
  }
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/media/")) {
    event.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ offline: true }), { status: 503, headers: { "content-type": "application/json" } })));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put("/index.html", response.clone());
      }
      return response;
    }).catch(() => caches.match("/index.html")));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    const copy = response.clone();
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(request, copy));
    return response;
  }).catch(() => caches.match("/index.html"))));
});
