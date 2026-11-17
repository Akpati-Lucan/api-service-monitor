const SHELL = [
  "/operator/",
  "/operator/index.html",
  "/operator/app.css",
  "/operator/app.js",
  "/operator/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open("operator-shell").then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !SHELL.includes(url.pathname)) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
