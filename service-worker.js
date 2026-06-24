/* ═══════════════════════════════════════════════════════════════
   MyTV OS — service-worker.js
   Cache-first strategy · Offline support · Network fallback
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME    = 'mytv-os-v1.0.0';
const RUNTIME_CACHE = 'mytv-os-runtime-v1';

/* Assets to pre-cache on install */
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/styles.css',
  '/app.js',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  /* Fonts cached at runtime via networkFirst */
];

/* ── INSTALL ─────────────────────────────────────────────────── */
self.addEventListener('install', event => {
  console.log('[SW] Installing MyTV OS cache...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching core assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Pre-cache error (non-fatal):', err))
  );
});

/* ── ACTIVATE ────────────────────────────────────────────────── */
self.addEventListener('activate', event => {
  console.log('[SW] Activating, cleaning old caches...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== RUNTIME_CACHE)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

/* ── FETCH ───────────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin and CDN font requests
  const isSameOrigin = url.origin === self.location.origin;
  const isFontCDN    = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http
  if (!request.url.startsWith('http')) return;

  if (isSameOrigin) {
    // Core app assets → cache-first with network fallback
    event.respondWith(cacheFirst(request));
  } else if (isFontCDN) {
    // Fonts → stale-while-revalidate
    event.respondWith(staleWhileRevalidate(request));
  }
  // External URLs (Jellyfin, YouTube, etc.) → network only (default)
});

/* ── CACHE STRATEGIES ────────────────────────────────────────── */

/**
 * Cache First — serve from cache if available, else fetch and cache
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Offline fallback
    return offlineFallback(request);
  }
}

/**
 * Stale While Revalidate — serve cached, update in background
 */
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise;
}

/**
 * Offline Fallback — return the cached index.html for navigation requests
 */
async function offlineFallback(request) {
  if (request.destination === 'document') {
    const cached = await caches.match('/index.html');
    if (cached) return cached;
  }

  // Generic offline response
  return new Response(
    JSON.stringify({ error: 'offline', message: 'MyTV OS está sin conexión' }),
    {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

/* ── BACKGROUND SYNC (future-proof) ─────────────────────────── */
self.addEventListener('sync', event => {
  console.log('[SW] Background sync:', event.tag);
});

/* ── PUSH NOTIFICATIONS (future-proof) ──────────────────────── */
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'MyTV OS', {
      body: data.body || '',
      icon: '/assets/icons/icon-192.png',
      badge: '/assets/icons/icon-192.png',
    })
  );
});

/* ── MESSAGE HANDLER (for cache busting from app) ────────────── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(() => event.ports[0].postMessage({ success: true }))
    );
  }
});
