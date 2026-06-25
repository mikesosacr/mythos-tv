/* ═══════════════════════════════════════════════════════════════
   MyTV OS — service-worker.js (FIXED AUTO-UPDATE VERSION)
   Cache-first strategy · Offline support · Forced update system
   ═══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v1.0.1'; // 🔥 CAMBIA ESTO EN CADA DEPLOY
const CACHE_NAME    = `mytv-os-${CACHE_VERSION}`;
const RUNTIME_CACHE = `mytv-os-runtime-${CACHE_VERSION}`;

/* Assets to pre-cache */
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/styles.css',
  `/app.js?v=${CACHE_VERSION}`, // 🔥 cache-bust real
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
];

/* ── INSTALL ─────────────────────────────────────────────────── */
self.addEventListener('install', event => {
  self.skipWaiting(); // 🔥 fuerza instalación inmediata

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
  );
});

/* ── ACTIVATE ────────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          // 🔥 borra TODO cache viejo sin piedad
          if (!key.includes(CACHE_VERSION)) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH ───────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (isSameOrigin) {
    event.respondWith(networkFirst(request));
  }
});

/* ── STRATEGY: NETWORK FIRST (IMPORTANTE PARA TU CASO) ───────── */
async function networkFirst(request) {
  try {
    const fresh = await fetch(request);

    const cache = await caches.open(CACHE_NAME);
    cache.put(request, fresh.clone());

    return fresh;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

/* ── FORCE UPDATE FROM APP ───────────────────────────────────── */
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys =>
        Promise.all(keys.map(k => caches.delete(k)))
      )
    );
  }
});