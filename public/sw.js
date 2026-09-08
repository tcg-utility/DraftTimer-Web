// GitHub Pages builds replace this fallback with a content-hashed, fully precached worker.
const CACHE_PREFIX = 'draft-timer-';
const CACHE_NAME = `${CACHE_PREFIX}fallback-v3`;
const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, '');
const scopedPath = (path) => `${SCOPE_PATH}${path}` || '/';
const APP_SHELL = [
  scopedPath('/'),
  scopedPath('/manifest.webmanifest'),
  scopedPath('/icon-192.png'),
  scopedPath('/icon-512.png'),
  scopedPath('/apple-touch-icon.png'),
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match(scopedPath('/')))),
  );
});
