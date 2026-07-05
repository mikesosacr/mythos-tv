// MythOS TV — Service Worker
// Habilita instalación PWA y caché offline básico

// v2: bump manual para forzar una activación limpia (se descarta el
// cache viejo mythos-tv-v1 en el evento activate). Subir este número
// en cada deploy que quieras forzar a limpiar caché vieja de golpe.
const CACHE_NAME = 'mythos-tv-v2';
const PRECACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
];

// Instalación — pre-cachear archivos core.
// IMPORTANTE: cache.addAll() es todo-o-nada — si UNA sola URL de
// PRECACHE falla (404, ruta movida, red caída un instante), la
// promesa completa rechaza y el navegador descarta esta versión del
// SW entera, quedándose pegado en la versión anterior para siempre
// (aunque subas correcciones después, nunca se instalan). Por eso
// acá se cachea cada recurso por separado con su propio catch, así
// un ícono roto no tumba la actualización del resto.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache =>
        Promise.all(
          PRECACHE.map(url =>
            cache.add(url).catch(err => {
              console.warn('[SW] no se pudo precachear', url, err);
            })
          )
        )
      )
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

  // Network first para archivos propios. cache:'reload' fuerza a
  // ignorar también el caché HTTP normal del navegador (no solo el
  // caché del Service Worker) — si el server manda cache-control
  // largo en los estáticos, "network first" sin esto podía terminar
  // resolviendo igual desde el disco local del navegador en vez de
  // pedir el archivo fresco de verdad.
  e.respondWith(
    fetch(e.request, { cache: 'reload' })
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
