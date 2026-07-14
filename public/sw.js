const CACHE = "mic-plate-static-v2";
const CACHE_PREFIX = "mic-plate-";
const STATIC_PATHS = ["/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_PATHS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.url.includes("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request));
    return;
  }

  const url = new URL(event.request.url);
  const shouldCache =
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || STATIC_PATHS.includes(url.pathname));

  if (!shouldCache) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
