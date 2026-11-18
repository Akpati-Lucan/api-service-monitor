const CACHE = "operator-shell-field-register";
const SHELL = [
  "/operator/",
  "/operator/index.html",
  "/operator/app.css",
  "/operator/app.js",
  "/operator/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !SHELL.includes(url.pathname)) {
    return;
  }
  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(event.request).then((cached) => cached || fetch(event.request))),
  );
});
