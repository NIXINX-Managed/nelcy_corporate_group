/* PWA instalable: caché SOLO para iconos y archivos estáticos.
 * Deliberadamente NO guarda páginas, tokens, Firestore ni datos financieros.
 * Las operaciones requieren conexión a internet.
 */
const STATIC_CACHE = "ncg-static-v1";
const INITIAL_FILES = ["/icons/icon-192.png", "/icons/icon-512.png"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(INITIAL_FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))
  )));
  self.clients.claim();
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const isSafeStatic = url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/_next/static/");
  if (!isSafeStatic) return;
  event.respondWith(caches.match(event.request).then((cached) => {
    if (cached) return cached;
    return fetch(event.request).then((response) => {
      if (response.ok && response.type === "basic") {
        const clone = response.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
      }
      return response;
    });
  }));
});
