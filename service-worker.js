// MythOS TV — Service Worker
// Habilita instalación PWA y caché offline básico

const CACHE_NAME = 'mythos-tv-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
];

// Instalación — pre-cachear archivos core
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Activación — limpiar caches viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, caché como fallback
// Los streams y la API siempre van a la red
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Nunca cachear: API, streams, admin, fuentes externas
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin') ||
    url.hostname !== location.hostname
  ) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Network first para archivos propios
  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Actualizar caché con respuesta fresca
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request)) // Fallback a caché si no hay red
  );
});
