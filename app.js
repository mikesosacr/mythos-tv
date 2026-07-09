/* ═══════════════════════════════════════════════════════════════
   MythOS TV — app.js v2.1
   Config global desde servidor · HLS.js player · Live TV / Movies
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const API = '/api';

/* ══════════════════════════════════════════════════════════════
   AUTENTICACIÓN — helpers para mandar el token de sesión (admin o
   usuario) en cada llamada a la API. Sin esto, /api/config, los
   proxies de streaming y /api/progress quedan cerrados (403).
   ══════════════════════════════════════════════════════════════ */
function getAuthHeaders() {
  if (typeof _currentUser === 'undefined' || !_currentUser) return {};
  if (_currentUser.isAdmin && _currentUser.adminToken) return { 'X-Admin-Token': _currentUser.adminToken };
  if (_currentUser.token) return { 'X-User-Token': _currentUser.token };
  return {};
}
// Para URLs que se usan como src de <video>/hls.js (no pueden mandar
// headers custom) — el mismo token, pero como query param ?token=.
function getAuthTokenParam() {
  if (typeof _currentUser === 'undefined' || !_currentUser) return '';
  if (_currentUser.isAdmin && _currentUser.adminToken) return _currentUser.adminToken;
  if (_currentUser.token) return _currentUser.token;
  return '';
}

// Paleta rotativa para la barra de progreso de "Continuar viendo"
// (compartida entre Home y el tema Netflix de Películas).
const CW_ACCENTS = ['#7c6af7', '#3ecfcf', '#f5b942', '#e55353', '#38b48b', '#64b5f6'];

/* ══════════════════════════════════════════════════════════════
   MODO TV vs MODO NAVEGADOR
   ══════════════════════════════════════════════════════════════
   Un TV Box (Android TV/T95, Tizen, webOS, etc.) siempre se trata
   como modo TV vía user-agent. Cualquier otro dispositivo (desktop,
   móvil) se trata como modo TV solo mientras esté en pantalla
   completa real (Fullscreen API) — que es cuando tiene sentido
   depender del salto de foco por flechas y mostrar la barra de
   hints de control remoto ("↔ Navegar · Enter Abrir · Esc Volver").
   Fuera de fullscreen, el scroll normal con mouse/trackpad ya
   funciona (overflow-y:auto en .screen) y la barra de hints se
   oculta vía CSS (body sin la clase .tv-mode). */
const UA_IS_TV = /tv|smart-tv|googletv|androidtv|webos|tizen|netcast|viera|hbbtv/i.test(navigator.userAgent);

function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function updateTvModeClass() {
  document.body.classList.toggle('tv-mode', UA_IS_TV || isFullscreenActive());
}

document.addEventListener('DOMContentLoaded', updateTvModeClass);
document.addEventListener('fullscreenchange', updateTvModeClass);
document.addEventListener('webkitfullscreenchange', updateTvModeClass);
// Por si boot() corre antes de DOMContentLoaded (acceso directo sin login)
updateTvModeClass();

/* ── DEFAULT APPS (fallback si el servidor no responde) ─────── */
const DEFAULT_APPS = [
  { id:'livetv',   label:'Live TV',       sublabel:'Canales en vivo', emoji:'📺', type:'internal', screen:'livetv',   color:'cyan',   badge:'LIVE'  },
  { id:'movies',   label:'Películas',     sublabel:'VOD',             emoji:'🎬', type:'internal', screen:'movies',   color:'orange', badge:'VOD'   },
  { id:'radio',    label:'Radio',         sublabel:'Estaciones',      emoji:'📻', type:'internal', screen:'radio',    color:'green',  badge:'AUDIO' },
  { id:'jellyfin', label:'Jellyfin',      sublabel:'Media Server',    emoji:'🖥️', type:'external', url:'',            color:'purple', badge:'MEDIA' },
  { id:'youtube',  label:'YouTube',       sublabel:'Streaming',       emoji:'▶️', type:'external', url:'https://www.youtube.com/tv', color:'red', badge:'WEB' },
  { id:'settings', label:'Configuración', sublabel:'Sistema',         emoji:'⚙️', type:'internal', screen:'settings', color:'blue'               },
];

/* ── STATE ───────────────────────────────────────────────────── */
const state = {
  apps:                [],
  livetv:              [],
  movies:              [],
  radio:               [],
  currentScreen:       'home',
  focusIndex:          0,
  soundEnabled:        true,
  glassEnabled:        true,
  systemName:          'MythOS TV',
  wallpaper:           'default',
  radioPlaying:        false,
  currentRadioStation: 0,
  radioAudio:          null,
  hlsInstance:         null,
  currentChannel:      null,
  theme:               'default',
  progress:            [],   // "Continuar viendo" del usuario actual: [{movieName,url,position,duration,timestamp}]
  _trackMovie:         null, // {name,url} — película actual en reproducción cuyo progreso se guarda
  _resumeAt:           0,    // segundos a los que saltar al arrancar (botón "Continuar")
  _lastProgressSave:   0,    // timestamp del último POST de progreso (throttle a 10s)
};

/* ══════════════════════════════════════════════════════════════
   PROGRESO DE REPRODUCCIÓN — "Continuar viendo" (por usuario)
   ══════════════════════════════════════════════════════════════ */
function getUsername() {
  return (typeof _currentUser !== 'undefined' && _currentUser && _currentUser.username)
    ? _currentUser.username : null;
}

async function fetchProgress() {
  const username = getUsername();
  if (!username) { state.progress = []; return; }
  try {
    const res = await fetch(`${API}/progress/${encodeURIComponent(username)}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Server error');
    const data = await res.json();
    state.progress = data.progress || [];
  } catch {
    state.progress = [];
  }
}

function saveProgressToServer(movieName, url, position, duration) {
  const username = getUsername();
  if (!username || !movieName || !isFinite(duration) || duration <= 0) return;
  fetch(`${API}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ username, movieName, url: url || '', position, duration }),
  }).catch(() => {});
}

// Quitar una película de "Continuar viendo" a pedido del usuario
// (no la marca como vista, solo borra el progreso guardado). Actualiza
// state.progress local al toque (para que la fila/UI reaccione ya
// mismo) y avisa al servidor en paralelo.
function removeProgressFromServer(movieName) {
  const username = getUsername();
  if (!username || !movieName) return;
  state.progress = (state.progress || []).filter(p => p.movieName !== movieName);
  fetch(`${API}/progress/${encodeURIComponent(username)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ movieName }),
  }).catch(() => {});
}

// Mismo umbral que usa server.js para marcar una película como
// "vista" y sacarla de Continuar viendo (ver WATCHED_THRESHOLD ahí).
// Se duplica acá porque el front necesita poder decidir esto al
// instante, sin esperar la respuesta del servidor.
const PROGRESS_WATCHED_THRESHOLD = 0.90;

// Actualiza state.progress EN EL MOMENTO (sin esperar red) para que
// "Continuar viendo" refleje el avance apenas se cierra el reproductor,
// en vez de quedar desactualizado hasta el próximo refresh de página.
// saveProgressToServer() ya manda esto al backend por su cuenta — esta
// función solo mantiene sincronizado el estado local con lo que el
// backend va a terminar guardando.
function upsertLocalProgress(movieName, url, position, duration) {
  if (!movieName) return;
  const dur   = Number(duration) || 0;
  const pos   = Number(position) || 0;
  const ratio = dur > 0 ? pos / dur : 0;

  state.progress = (state.progress || []).filter(p => p.movieName !== movieName);

  // >=90% visto: el backend la marca "finished" y deja de devolverla
  // en /api/progress — acá, en vez de agregarla, directamente no se
  // vuelve a meter en la lista local (mismo resultado, sin red).
  if (ratio < PROGRESS_WATCHED_THRESHOLD) {
    state.progress.unshift({ movieName, url: url || '', position: pos, duration: dur, timestamp: Date.now(), finished: false });
  }
}

function getMovieProgress(movieName) {
  if (!movieName || !state.progress) return null;
  return state.progress.find(p => p.movieName === movieName) || null;
}

function findMovieByName(name) {
  return state.movies.find(m => (m.name || m.title) === name) || null;
}

/* ══════════════════════════════════════════════════════════════
   LOAD CONFIG FROM SERVER (global, all devices)
   ══════════════════════════════════════════════════════════════ */
async function loadConfig() {
  try {
    const res = await fetch(`${API}/config`, { cache: 'no-store', headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Server error');
    const cfg = await res.json();
    applyConfig(cfg);
  } catch {
    // Sin respuesta del servidor — no forzar tema clásico por un fallo
    // transitorio; se mantiene el último tema conocido (localStorage)
    // hasta que startThemePolling() logre reconectar.
    let cachedTheme = 'default';
    try { cachedTheme = localStorage.getItem('mythos-theme') || 'default'; } catch (e) { /* sin storage */ }
    applyConfig({ theme: cachedTheme });
  }
}

function applyConfig(cfg) {
  state.systemName   = cfg.systemName   || 'MythOS TV';
  state.wallpaper    = cfg.wallpaper    || 'default';
  state.glassEnabled = cfg.glassEnabled !== false;
  state.soundEnabled = cfg.soundEnabled !== false;
  state.timeFormat   = cfg.timeFormat   || '24h';
  state.timezone     = cfg.timezone     || 'America/Costa_Rica';
  state.apps         = cfg.launcher     || DEFAULT_APPS;
  state.livetv       = cfg.livetv       || [];
  state.movies       = groupMovies(cfg.movies || []);
  state.radio        = cfg.radio        || [];
  applyTheme(cfg.theme || 'default');
  // FIX (jul 2026): injectAdminTile() agrega el tile "adminpanel" a
  // state.apps, pero antes se llamaba recién en el render del escritorio
  // (línea ~422), DESPUÉS de este renderNfTopnav() — por eso "Panel Admin"
  // nunca llegaba a tiempo para aparecer en el dropdown "Más" del topnav,
  // aunque sí se veía el tile en el escritorio y el badge de la topbar.
  // injectAdminTile() ya es idempotente (chequea alreadyHas), así que
  // llamarla acá también, más temprano, es seguro.
  injectAdminTile();
  renderNfTopnav();
}

/* ══════════════════════════════════════════════════════════════
   MENÚ SUPERIOR — TEMA NETFLIX (persistente: vive en <header>,
   fuera de .screen, así que no se destruye al navegar entre
   Inicio/Películas/Live TV/Radio). Se arma a partir del dock
   configurado en admin: Inicio + las apps con screen 'movies' /
   'livetv' (o alias 'iptv') / 'radio' quedan visibles siempre;
   el resto (YouTube, Plex, Configuración, Panel Admin, etc.) va
   agrupado en el desplegable "Más".
   ══════════════════════════════════════════════════════════════ */
// Ítems de "sistema" (no son apps de streaming): Configuración y Panel
// Admin. En el tema Whale estos dos son los ÚNICOS que van en el
// desplegable "Más" del riel — el resto de las apps (YouTube, Plex,
// Whale TV+, etc.) ya viven abajo en la fila "Tus apps" del Home, así
// que mostrarlas también acá las duplicaba (Mike, jul 2026).
function isSystemNavApp(a) {
  return a.id === 'settings' || a.id === 'adminpanel';
}

function renderNfTopnav() {
  const nav = document.getElementById('nf-topnav');
  if (!nav) return;
  const apps = state.apps || [];
  const isWhale = document.body.classList.contains('theme-whale');
  const isLiveTv = (a) => a.screen === 'livetv' || a.screen === 'iptv';
  const primary = [
    apps.find(a => a.screen === 'movies'),
    apps.find(isLiveTv),
    apps.find(a => a.screen === 'radio'),
  ].filter(Boolean);
  const rest = apps.filter(a => !primary.includes(a));
  // En Whale, el desplegable "Más" solo muestra Configuración/Panel Admin;
  // en el resto de los temas se mantiene el comportamiento de siempre
  // (todo lo que no es primary va al desplegable).
  const dropdownApps = isWhale ? rest.filter(isSystemNavApp) : rest;

  nav.innerHTML = '';

  const homeBtn = document.createElement('button');
  homeBtn.type = 'button';
  homeBtn.className = 'nf-topnav-item';
  homeBtn.dataset.nfNav = 'home';
  homeBtn.innerHTML = '<span class="tn-icon">🏠</span>Inicio';
  nav.appendChild(homeBtn);

  // Cada botón guarda la app en una propiedad del propio elemento
  // (btn._nfApp), no un índice de array — así el clic siempre abre
  // exactamente la app que se ve en el botón, sin depender de que
  // state.apps mantenga el mismo orden entre el render y el clic.
  // El ícono (tn-icon) se agrega siempre, no solo en el desplegable
  // "Más" — lo usa el riel vertical del tema Whale (ver styles.css)
  // para mostrar solo el ícono en los 74px de ancho del riel; en el
  // menú horizontal clásico simplemente se ve como un ícono chico
  // antes del texto, sin romper nada de lo que ya había.
  function makeAppBtn(a, isDropdown) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = isDropdown ? 'nf-topnav-dropdown-item' : 'nf-topnav-item';
    btn.dataset.nfApp = '1';
    btn._nfApp = a;
    const icon = document.createElement('span');
    icon.className = 'tn-icon';
    icon.textContent = a.emoji || '🚀';
    btn.appendChild(icon);
    if (isDropdown) {
      btn.appendChild(document.createTextNode(a.label));
    } else {
      btn.appendChild(document.createTextNode(a.label));
    }
    return btn;
  }

  primary.forEach(a => nav.appendChild(makeAppBtn(a, false)));

  if (dropdownApps.length) {
    const moreWrap = document.createElement('div');
    moreWrap.className = 'nf-topnav-more';
    moreWrap.id = 'nf-topnav-more';
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'nf-topnav-item nf-topnav-more-btn';
    moreBtn.id = 'nf-topnav-more-btn';
    // Ícono de engrane real (mismo tn-icon que usan home/movies/tv/radio)
    // en vez de la flechita "▾" chiquita — en el riel de Whale (ícono
    // solo, texto oculto) antes quedaba como un puntito casi invisible.
    moreBtn.innerHTML = '<span class="tn-icon">⚙️</span>Más <span class="nf-topnav-caret">▾</span>';
    moreWrap.appendChild(moreBtn);
    const dropdown = document.createElement('div');
    dropdown.className = 'nf-topnav-dropdown';
    dropdown.id = 'nf-topnav-dropdown';
    dropdownApps.forEach(a => dropdown.appendChild(makeAppBtn(a, true)));
    moreWrap.appendChild(dropdown);
    nav.appendChild(moreWrap);
  }

  // .onclick (no addEventListener) para ser idempotente entre re-renders
  nav.onclick = (e) => {
    if (e.target.closest('[data-nf-nav="home"]')) { navigateTo('home', 'Inicio'); return; }
    if (e.target.closest('#nf-topnav-more-btn')) {
      document.getElementById('nf-topnav-dropdown')?.classList.toggle('open');
      return;
    }
    const appBtn = e.target.closest('[data-nf-app]');
    if (appBtn && appBtn._nfApp) {
      document.getElementById('nf-topnav-dropdown')?.classList.remove('open');
      launchApp(appBtn._nfApp);
    }
  };

  // Cerrar "Más" al hacer clic afuera — listener global, se conecta una sola vez
  if (!window._nfTopnavOutsideClickWired) {
    window._nfTopnavOutsideClickWired = true;
    document.addEventListener('click', (e) => {
      const more = document.getElementById('nf-topnav-more');
      if (more && !more.contains(e.target)) {
        document.getElementById('nf-topnav-dropdown')?.classList.remove('open');
      }
    });
  }

  updateNfTopnavActive();
}

function updateNfTopnavActive() {
  const nav = document.getElementById('nf-topnav');
  if (!nav) return;
  nav.querySelectorAll('.nf-topnav-item').forEach(el => el.classList.remove('active'));
  if (state.currentScreen === 'home') {
    nav.querySelector('[data-nf-nav="home"]')?.classList.add('active');
  } else if (state.currentScreen === 'app') {
    nav.querySelectorAll('[data-nf-app]').forEach(btn => {
      const a = btn._nfApp;
      if (a && (a.screen === state._currentApp || (state._currentApp === 'livetv' && a.screen === 'iptv'))) {
        btn.classList.add('active');
      }
    });
  }
}

/* ══════════════════════════════════════════════════════════════
   THEMES — sistema de temas seleccionables desde admin
   El dock/barra de navegación se mantiene igual en todos los temas;
   lo que cambia es cómo se renderiza el contenido (home, detalle,
   pantallas de categoría). El cambio se aplica vía clase en <body>
   (.theme-netflix, futuros .theme-X) que activa reglas específicas
   en styles.css sin tocar el resto de la UI.
   ══════════════════════════════════════════════════════════════ */
function applyTheme(theme) {
  const changed = state.theme !== theme;
  state.theme = theme;
  // 'whale' reutiliza toda la lógica/DOM del tema Netflix (filas,
  // navegación por control remoto, banner) y solo le suma su propia
  // clase para el reskin visual (riel lateral, colores, tarjetas).
  // Así no hace falta duplicar renderHomeNetflix() ni el manejo de teclas.
  document.body.classList.toggle('theme-netflix', theme === 'netflix' || theme === 'whale');
  document.body.classList.toggle('theme-whale', theme === 'whale');
  try { localStorage.setItem('mythos-theme', theme); } catch (e) { /* ignorar si no hay storage */ }
  // Si el tema cambió mientras el usuario ya estaba dentro de una
  // pantalla de categoría, la re-renderizamos al instante.
  if (changed) rerenderCurrentScreenForTheme();
}

function rerenderCurrentScreenForTheme() {
  if (state.currentScreen === 'home') {
    if (document.body.classList.contains('theme-netflix')) renderHomeNetflix();
    return; // volviendo a 'default' no hace falta re-render: home-default-view ya está intacto
  }
  if (state.currentScreen !== 'app') return;
  const reopen = { movies: openMovies, livetv: openLiveTV, radio: openRadio }[state._currentApp];
  if (reopen) reopen();
}

/* ── Polling ligero de tema para cambio instantáneo sin recargar ──
   No hay WebSockets montados en el backend; un polling corto y
   liviano (compara solo el campo theme) es la forma más simple y
   confiable de detectar el cambio hecho desde admin.html en
   cualquier TV conectada, sin saturar el VPS. ─────────────────── */
function startThemePolling() {
  setInterval(async () => {
    try {
      const res = await fetch(`${API}/theme`, { cache: 'no-store', headers: getAuthHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      applyTheme(data.theme || 'default');
    } catch { /* sin red — se reintenta en el siguiente ciclo */ }
  }, 4000);
}

/* ── Agrupa películas duplicadas por nombre normalizado ─────────
   Cada película queda con urls:[] (array deduplicado de enlaces).
   El campo url mantiene el primer link para compatibilidad. */
function groupMovies(rawMovies) {
  function normalizeName(n) {
    return n.toLowerCase()
      .trim()
      .replace(/\(\d{4}\)/g, '')   // quita (2023)
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[^a-z0-9 ]/g, '')  // quita caracteres especiales
      .trim();
  }

  const groups = new Map();
  for (const m of rawMovies) {
    const key = normalizeName(m.name || '');
    if (!key) continue;
    if (!groups.has(key)) {
      // Primera vez — crear grupo con copia del objeto
      groups.set(key, { ...m, urls: [] });
    }
    const group = groups.get(key);
    // Agregar URL solo si no es duplicada exacta
    const url = (m.url || '').trim();
    if (url && !group.urls.includes(url)) {
      group.urls.push(url);
    }
    // Heredar metadata si el grupo aún no la tiene
    if (!group.poster  && m.poster)      group.poster      = m.poster;
    if (!group.backdrop && m.backdrop)   group.backdrop    = m.backdrop;
    if (!group.description && m.description) group.description = m.description;
    if (!group.year    && m.year)        group.year        = m.year;
    if (!group.genre   && m.genre)       group.genre       = m.genre;
    if (!group.duration && m.duration)   group.duration    = m.duration;
    if (!group.rating  && m.rating)      group.rating      = m.rating;
  }

  // Fijar url = primer link (compatibilidad con código que usa item.url)
  return [...groups.values()].map(m => ({
    ...m,
    url: m.urls[0] || m.url || '',
  }));
}

/* ══════════════════════════════════════════════════════════════
   BOOT SEQUENCE
   ══════════════════════════════════════════════════════════════ */
const BOOT_MESSAGES = [
  'Iniciando MythOS TV…',
  'Cargando configuración…',
  'Preparando launcher…',
  'Listo para usar',
];

async function boot() {
  const fill   = document.getElementById('boot-bar-fill');
  const status = document.getElementById('boot-status');
  const bootEl = document.getElementById('boot-screen');
  const appEl  = document.getElementById('app');

  // Load config in background while boot animation plays
  const configPromise   = loadConfig();
  const progressPromise = fetchProgress();

  for (let i = 0; i < BOOT_MESSAGES.length; i++) {
    await delay(320 + Math.random() * 140);
    fill.style.width   = Math.round(((i + 1) / BOOT_MESSAGES.length) * 100) + '%';
    status.textContent = BOOT_MESSAGES[i];
  }

  await configPromise; // ensure config loaded before UI
  await progressPromise;
  await delay(300);

  appEl.classList.remove('hidden');
  requestAnimationFrame(() => requestAnimationFrame(() => appEl.classList.add('visible')));

  initUI();

  await delay(100);
  bootEl.classList.add('fade-out');
  await delay(650);
  bootEl.style.display = 'none';
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ══════════════════════════════════════════════════════════════
   INIT UI
   ══════════════════════════════════════════════════════════════ */
function initUI() {
  applySettings(false);
  injectAdminTile();   // añade tile de admin al dock si corresponde
  renderAppGrid();
  renderSuggestions();
  if (document.body.classList.contains('theme-netflix')) renderHomeNetflix();
  initClock();
  initRemoteNav();
  initFocusGlow();
  initAudio();
  createModal();
  initDetailModal();
  startThemePolling();
  renderAdminBadge();  // badge en topbar si es admin
  state.focusZone = 'dock';
  focusTile(0);

  // Logo clickeable → volver al home
  const brand = document.querySelector('.topbar-brand');
  if (brand) {
    brand.style.cursor = 'pointer';
    brand.addEventListener('click', () => navigateTo('home', 'Inicio'));
  }
}

/* ── Admin: inyectar tile y badge si el usuario es admin ──────── */
function injectAdminTile() {
  if (!_currentUser || !_currentUser.isAdmin) return;
  // Añadir tile de Panel Admin al inicio del launcher si no está ya
  const alreadyHas = state.apps.some(a => a.id === 'adminpanel');
  if (!alreadyHas) {
    state.apps.unshift({
      id: 'adminpanel', label: 'Panel Admin', sublabel: 'Gestión del sistema',
      emoji: '🛡️', type: 'external', url: '/admin.html', color: 'purple', badge: 'ADMIN',
    });
  }
}

function renderAdminBadge() {
  if (!_currentUser || !_currentUser.isAdmin) return;
  const right = document.querySelector('.topbar-right');
  if (!right || document.getElementById('admin-topbar-badge')) return;
  const badge = document.createElement('span');
  badge.id = 'admin-topbar-badge';
  badge.textContent = '⚙️ ADMIN';
  badge.style.cssText = `
    font-size:0.65rem;font-weight:700;letter-spacing:0.06em;
    background:linear-gradient(135deg,#7c6af7,#3ecfcf);
    color:#fff;padding:3px 9px;border-radius:20px;
    margin-right:8px;flex-shrink:0;
  `;
  right.insertBefore(badge, right.firstChild);
}

/* ── Clock ───────────────────────────────────────────────────── */
function initClock() {
  function tick() {
    const prefs      = (_currentUser && _currentUser.prefs) ? _currentUser.prefs : {};
    const tz         = prefs.timezone   || state.timezone   || 'America/Costa_Rica';
    const timeFormat = prefs.timeFormat || state.timeFormat || '24h';

    const now = new Date();
    // Hora en la zona del usuario
    const timeStr = now.toLocaleTimeString('es-CR', {
      timeZone: tz,
      hour:   '2-digit',
      minute: '2-digit',
      hour12: timeFormat === '12h',
    });
    document.getElementById('topbar-time').textContent = timeStr;

    const dateStr = now.toLocaleDateString('es-CR', {
      timeZone: tz,
      weekday: 'short',
      day:     'numeric',
      month:   'short',
    });
    document.getElementById('topbar-date').textContent = dateStr;

    // Saludo según hora local del usuario
    const h = parseInt(now.toLocaleString('es-CR', { timeZone: tz, hour: 'numeric', hour12: false }));
    const g = h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    const shownName = _currentUser ? (_currentUser.displayName || _currentUser.username) : null;
    const username = shownName ? `, ${shownName}` : '';
    const el = document.getElementById('home-greeting');
    if (el) el.textContent = g + username;
  }
  tick();
  setInterval(tick, 30000);
}

/* ── Apply Settings ──────────────────────────────────────────── */
function applySettings() {
  // Prefs del usuario tienen prioridad sobre el estado global
  const prefs = (_currentUser && _currentUser.prefs) ? _currentUser.prefs : {};
  const wallpaper = prefs.wallpaper || state.wallpaper || 'default';

  // IMPORTANTE: no usar `document.body.className = ''` — eso borraba
  // TODAS las clases del body (theme-netflix, tv-mode, etc.), no solo
  // las de fondo de pantalla que maneja esta función. Se remueven
  // puntualmente solo las clases wallpaper-* anteriores.
  [...document.body.classList].forEach(cls => {
    if (cls.startsWith('wallpaper-')) document.body.classList.remove(cls);
  });
  if (wallpaper && wallpaper !== 'default')
    document.body.classList.add(`wallpaper-${wallpaper}`);
  document.body.classList.toggle('no-glass', !state.glassEnabled);
  document.title = state.systemName;
}

/* ══════════════════════════════════════════════════════════════
   APP GRID
   ══════════════════════════════════════════════════════════════ */
function renderAppGrid() {
  const grid = document.getElementById('app-grid');
  grid.innerHTML = '';
  state.apps.forEach((app, i) => {
    const tile = document.createElement('div');
    tile.className = `app-tile tile-color-${app.color || 'purple'}`;
    tile.setAttribute('role', 'gridcell');
    tile.setAttribute('tabindex', i === 0 ? '0' : '-1');
    tile.setAttribute('aria-label', `${app.label}${app.sublabel ? ' · ' + app.sublabel : ''}`);
    tile.dataset.index = i;
    tile.innerHTML = `
      <div class="tile-bg" aria-hidden="true"></div>
      ${app.badge ? `<span class="tile-badge">${app.badge}</span>` : ''}
      <div class="tile-icon">${app.logo
        ? `<img src="${app.logo}" alt="" loading="lazy" decoding="async" data-fallback="${app.emoji || '🚀'}" onerror="handleImgError(this)" />`
        : app.emoji}</div>
      <div class="tile-label">${app.label}</div>
      ${app.sublabel ? `<div class="tile-sublabel">${app.sublabel}</div>` : ''}
    `;
    tile.addEventListener('click', () => launchApp(app));
    tile.addEventListener('mouseenter', () => { state.focusZone = 'dock'; state.focusIndex = i; updateTileFocus(); });
    grid.appendChild(tile);
  });
}

function getTiles() { return [...document.querySelectorAll('.app-tile')]; }

function focusTile(index) {
  const tiles = getTiles();
  if (!tiles.length) return;
  state.focusZone = 'dock';
  state.focusIndex = Math.max(0, Math.min(index, tiles.length - 1));
  updateTileFocus();
}

function updateTileFocus() {
  const tiles = getTiles();
  const inDock = state.focusZone === 'dock';
  tiles.forEach((t, i) => {
    const isFocused = inDock && i === state.focusIndex;
    t.classList.toggle('focused', isFocused);
    t.setAttribute('tabindex', isFocused ? '0' : '-1');
    if (isFocused) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

/* ══════════════════════════════════════════════════════════════
   REMOTE / KEYBOARD NAV
   ══════════════════════════════════════════════════════════════ */
function initRemoteNav() {
  document.addEventListener('keydown', handleKey);
  initUniversalBackCapture();
  initBackButtonTrap();
}

/* ── Soporte universal de botón "Atrás" físico (TV Box Android, Google TV,
   Tizen, webOS, controles Bluetooth, teclados remotos) ──────────────────
   Problema: la tecla atrás física en muchos TV Box no llega como
   keydown('Escape'/'Backspace') — llega como navegación de historial real
   (popstate) o como un key/keyCode distinto según el fabricante. Si no se
   intercepta, el navegador retrocede su propio historial o "sale" de la
   PWA hacia la pestaña/launcher anterior.
   Solución: 1) atrapamos el historial para que un popstate real nunca
   escape de la app, y lo convertimos en un Escape sintético; 2) normalizamos
   las variantes de tecla atrás conocidas hacia ese mismo Escape sintético.
   Así toda la lógica de cierre ya existente (modal, settings, player, etc.)
   sigue funcionando sin tocarla. ─────────────────────────────────────── */

const BACK_KEY_NAMES = ['GoBack', 'BrowserBack'];
const BACK_KEYCODES = [10009, 461, 166, 4]; // Tizen, webOS, Android TV antiguos

function dispatchSyntheticBack() {
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
  }));
}

function initUniversalBackCapture() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Backspace') return; // ya cubierto por handleKey
    if (BACK_KEY_NAMES.includes(e.key) || BACK_KEYCODES.includes(e.keyCode)) {
      e.preventDefault();
      e.stopPropagation();
      dispatchSyntheticBack();
    }
  }, true); // fase de captura: intercepta antes que cualquier otra cosa
}

function initBackButtonTrap() {
  // Estado "trampa": mientras exista, un back físico dispara popstate
  // dentro de la página en vez de sacar al usuario de la app/PWA.
  history.pushState({ mytvTrap: true }, '');
  window.addEventListener('popstate', () => {
    // Re-armar la trampa inmediatamente para nunca quedarnos sin historial
    history.pushState({ mytvTrap: true }, '');
    dispatchSyntheticBack();
  });
}

function handleKey(e) {
  if (window._pwaNavLocked) {
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      window._pwaNavLocked = false;
      const banner = document.getElementById('pwa-banner');
      if (banner) banner.style.display = 'none';
      localStorage.setItem('pwa-dismissed', '1');
    }
    return;
  }
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Backspace','Escape'].includes(e.key))
    e.preventDefault();
  if (state.currentScreen === 'home')     handleHomeKey(e.key);
  else if (state.currentScreen === 'settings') handleSettingsKey(e.key);
  else handleAppKey(e.key);
}

function handleHomeKey(key) {
  // Si el modal de detalle está abierto, manejarlo primero
  if (!document.getElementById('detail-overlay').classList.contains('hidden')) {
    const playBtn    = document.getElementById('detail-play-btn');
    const closeBtn   = document.getElementById('detail-close-btn');
    const restartBtn = document.getElementById('detail-restart-btn');
    const removeBtn  = document.getElementById('detail-remove-btn');
    const hasRestart = !restartBtn.classList.contains('hidden');
    const order = hasRestart ? ['play', 'restart', 'remove', 'close'] : ['play', 'close'];
    const btnOf = (id) => id === 'play' ? playBtn : id === 'restart' ? restartBtn : id === 'remove' ? removeBtn : closeBtn;
    if (key === 'Escape' || key === 'Backspace') { playSnd('nav'); closeDetailModal(); return; }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      playSnd('nav');
      const cur  = order.includes(state._detailFocusBtn) ? state._detailFocusBtn : 'play';
      const idx  = order.indexOf(cur);
      const next = order[(idx + (key === 'ArrowRight' ? 1 : -1) + order.length) % order.length];
      state._detailFocusBtn = next;
      order.forEach(id => setRemoteFocus(btnOf(id), id === next));
      btnOf(next).focus();
      return;
    }
    if (key === 'Enter') { playSnd('enter'); btnOf(order.includes(state._detailFocusBtn) ? state._detailFocusBtn : 'play').click(); }
    return;
  }

  // Tema Netflix: navegación por filas independiente del sistema de
  // zonas clásico (dock/movies/livetv/continue) — ver handleHomeNetflixKey.
  if (document.body.classList.contains('theme-netflix')) {
    handleHomeNetflixKey(key);
    return;
  }

  const tiles = getTiles();

  // focusZone: 'dock' | 'movies' | 'livetv' | 'continue'
  const zone = state.focusZone || 'dock';

  switch (key) {
    case 'ArrowRight':
      playSnd('nav');
      if (zone === 'dock') {
        focusTile((state.focusIndex + 1) % tiles.length);
      } else {
        moveSuggFocus(zone, 1);
      }
      break;
    case 'ArrowLeft':
      playSnd('nav');
      if (zone === 'dock') {
        focusTile((state.focusIndex - 1 + tiles.length) % tiles.length);
      } else {
        moveSuggFocus(zone, -1);
      }
      break;
    case 'ArrowUp':
      playSnd('nav');
      if (zone === 'dock') {
        setFocusZone('livetv');
      } else if (zone === 'livetv') {
        setFocusZone('movies');
      } else if (zone === 'movies' && state._suggContinue && state._suggContinue.length) {
        setFocusZone('continue');
      }
      break;
    case 'ArrowDown':
      playSnd('nav');
      if (zone === 'continue') {
        setFocusZone('movies');
      } else if (zone === 'movies') {
        setFocusZone('livetv');
      } else if (zone === 'livetv') {
        setFocusZone('dock');
      }
      break;
    case 'Enter':
      playSnd('enter');
      if (zone === 'dock') {
        const app = state.apps[state.focusIndex];
        if (app) launchApp(app);
      } else {
        openDetailForFocused(zone);
      }
      break;
  }
}

/* ══════════════════════════════════════════════════════════════
   HOME — TEMA NETFLIX (banner destacado + filas)
   Activado vía body.theme-netflix (mismo selector de tema que ya
   existe para Películas). #home-netflix-view es un contenedor
   alternativo a #home-default-view (ver CSS: solo uno de los dos
   está visible a la vez). Se reconstruye por completo cada vez que
   se llama — el banner destacado se re-sortea al azar en cada
   entrada a Inicio (navigateTo), no solo una vez al bootear.
   ══════════════════════════════════════════════════════════════ */
function playRadioFromHome(station) {
  const idx = state.radio.indexOf(station);
  openRadio();
  if (idx >= 0) { selectStation(idx); toggleRadioPlay(); }
}

function homeNfPosterCard(rowType, idx, imgUrl, fallbackEmoji, title, contain) {
  const img = imgUrl
    ? `<img class="${contain ? 'nf-card-poster-contain' : 'nf-card-poster'}" src="${imgUrl}" alt="" loading="lazy" decoding="async" data-fallback="${fallbackEmoji || '🎬'}" onerror="handleImgError(this)" />`
    : `<div class="nf-card-fallback">${fallbackEmoji || '🎬'}</div>`;
  return `
    <div class="nf-card" tabindex="-1" data-row-type="${rowType}" data-idx="${idx}">
      ${img}
      <div class="nf-card-title">${title || ''}</div>
    </div>`;
}

function homeNfMoreCard(rowType) {
  return `
    <div class="nf-card" tabindex="-1" data-row-type="more-${rowType}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.25);border-radius:8px;">
      <div style="font-size:1.8rem;opacity:0.85;">➕</div>
      <div style="font-size:0.8rem;font-weight:600;color:var(--text-primary);">Ver más</div>
    </div>`;
}

function homeNfRowHtml(rIdx, title, accent, innerHtml) {
  return `
    <div class="nf-row" data-row="${rIdx}">
      <div class="nf-row-title"><span class="nf-row-accent" style="background:${accent}"></span>${title}</div>
      <div class="nf-row-track-wrap">
        <button type="button" class="nf-row-arrow nf-arrow-left nf-arrow-hidden" aria-label="Anterior">&#8249;</button>
        <div class="nf-row-track">${innerHtml}</div>
        <button type="button" class="nf-row-arrow nf-arrow-right nf-arrow-hidden" aria-label="Siguiente">&#8250;</button>
      </div>
    </div>`;
}

/* ── TEMA WHALE — dock de apps horizontal en Home. Reusa 100% los
   datos y el click (launchApp) del dock/launcher clásico ya
   configurado desde admin — solo cambia el contenedor (fila con
   scroll en vez de grid), reusando la clase .app-tile existente
   (ver CSS ".home-netflix-view .nf-row-track .app-tile" ya previsto). */
function homeWhaleDockRowHtml(rIdx) {
  // "Panel Admin" y "Configuración" NO se incluyen acá: son ítems de
  // sistema y ya están disponibles en el desplegable "Más" del riel
  // lateral (ver isSystemNavApp() en renderNfTopnav). Esta fila solo
  // muestra las apps de streaming/contenido (Mike, jul 2026).
  const apps = (state.apps || []).filter(app => !isSystemNavApp(app));
  if (!apps.length) return '';
  const inner = apps.map((app, i) => `
    <div class="app-tile tile-color-${app.color || 'purple'}" tabindex="-1" data-row-type="dockapp" data-idx="${i}">
      <div class="tile-bg" aria-hidden="true"></div>
      <div class="tile-icon">${app.logo
        ? `<img src="${app.logo}" alt="" loading="lazy" decoding="async" data-fallback="${app.emoji || '🚀'}" onerror="handleImgError(this)" />`
        : (app.emoji || '🚀')}</div>
      <div class="tile-label">${app.label || ''}</div>
    </div>`).join('');
  return homeNfRowHtml(rIdx, 'Tus apps', '#d4537e', inner);
}

function renderHomeNetflix() {
  const root = document.getElementById('home-netflix-view');
  if (!root) return;

  const movies = state.movies || [];
  const livetv = state.livetv || [];
  const radio  = state.radio  || [];

  /* Tema whale (v2, jul 2026): la referencia real de Whale OS usa un
     banner de 1 sola película/serie destacada — no la fila de 3
     categorías de la v1. Se vuelve a activar el hero normal para
     whale, solo con piel visual distinta (ver CSS body.theme-whale
     .home-hero-*). */
  const isWhale = document.body.classList.contains('theme-whale');

  /* Banner destacado — solo películas (nunca Live TV/Radio). Usa el
     backdrop real de TMDB (horizontal, admin.html → auto-metadata) si
     la película lo tiene; si no, cae al póster desenfocado de fondo
     + una miniatura nítida del póster al costado (no hay backdrop
     real para películas sin match de TMDB / agregadas manualmente). */
  const heroPool = movies.filter(m => m.poster || m.backdrop);
  const heroItem = heroPool.length ? heroPool[Math.floor(Math.random() * heroPool.length)] : null;
  const hero = heroItem ? { type: 'movie', item: heroItem } : null;
  state._homeNfHero = hero;

  const hasBackdrop = hero && hero.item.backdrop;
  const heroBgHtml = !hero ? '' : hasBackdrop
    ? `<div class="home-hero-bg" style="background-image:url('${hero.item.backdrop}');"></div>`
    : hero.item.poster
      ? `<div class="home-hero-bg home-hero-bg-blur" style="background-image:url('${hero.item.poster}');"></div>`
      : `<div class="home-hero-bg home-hero-bg-fallback">${hero.item.emoji || '🎬'}</div>`;
  const heroThumbHtml = (!hero || hasBackdrop || !hero.item.poster) ? '' : `
    <div class="home-hero-thumb"><img src="${hero.item.poster}" alt="" onerror="this.parentElement.style.display='none'" /></div>`;

  const heroHtml = !hero ? '' : `
    <div id="home-hero-banner" class="home-hero-banner${heroThumbHtml ? ' has-thumb' : ''}">
      ${heroBgHtml}
      ${heroThumbHtml}
      <div class="home-hero-scrim"></div>
      <div class="home-hero-info">
        <div class="home-hero-title">${hero.item.name || hero.item.title || ''}</div>
        <div class="home-hero-meta">${[hero.item.year, hero.item.genre, hero.item.duration].filter(Boolean).join(' · ') || 'Película'}</div>
        <div class="home-hero-buttons">
          <button type="button" class="home-hero-btn home-hero-btn-play" id="home-hero-play" tabindex="-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Reproducir
          </button>
          <button type="button" class="home-hero-btn home-hero-btn-info" id="home-hero-info" tabindex="-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> Más información
          </button>
        </div>
      </div>
    </div>`;

  /* Continuar viendo — mismo criterio que el resto de la app */
  const continueItems = (state.progress || [])
    .map(p => ({ p, m: findMovieByName(p.movieName) }))
    .filter(x => x.m)
    .slice(0, 10);

  const HOME_ROW_CAP = 10;

  /* Nuevo en MythOS TV — películas con sello addedAt (agregado desde admin.html) */
  const newItemsAll = movies
    .filter(m => !!m.addedAt)
    .sort((a, b) => b.addedAt - a.addedAt);
  const newItems = newItemsAll.slice(0, HOME_ROW_CAP);

  const moviesAll = shuffle(movies);
  const livetvAll = shuffle(livetv);
  const radioAll  = shuffle(radio);
  const moviesRow = moviesAll.slice(0, HOME_ROW_CAP);
  const livetvRow = livetvAll.slice(0, HOME_ROW_CAP);
  const radioRow  = radioAll.slice(0, HOME_ROW_CAP);

  state._homeNfData = { continueItems, newItems, moviesRow, livetvRow, radioRow, newItemsAll };

  let rIdx = 0;
  const rowsHtml = [];

  if (continueItems.length) {
    const inner = continueItems.map(({ p, m }, i) => {
      const pct = p.duration > 0 ? Math.min(100, Math.round((p.position / p.duration) * 100)) : 0;
      const accent = CW_ACCENTS[i % CW_ACCENTS.length];
      const frameHtml = m.poster
        ? `<img src="${m.poster}" alt="" loading="lazy" decoding="async" data-fallback="${m.emoji || '🎬'}" onerror="handleImgError(this)" />`
        : `<div class="cw-frame-fallback">${m.emoji || '🎬'}</div>`;
      return `
        <div class="nf-card cw-card" tabindex="-1" data-row-type="continue" data-idx="${i}">
          <div class="cw-frame" style="--cw-accent:${accent}">
            ${frameHtml}
            <div class="cw-scrim"></div>
            <button type="button" class="cw-remove-btn" data-remove-idx="${i}" title="Quitar de Continuar viendo" aria-label="Quitar de Continuar viendo">✕</button>
            <div class="cw-play"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="5,3 19,12 5,21"/></svg></div>
            <div class="cw-title">${m.name || m.title || ''}</div>
            <div class="cw-progress"><div class="cw-progress-fill" style="width:${pct}%"></div></div>
          </div>
        </div>`;
    }).join('');
    rowsHtml.push(homeNfRowHtml(rIdx++, 'Continuar viendo', '#ffffff', inner));
  }

  if (newItems.length) {
    const inner = newItems.map((m, i) =>
      homeNfPosterCard('new', i, m.poster, m.emoji, m.name || m.title, false)).join('')
      + (newItemsAll.length > HOME_ROW_CAP ? homeNfMoreCard('new') : '');
    rowsHtml.push(homeNfRowHtml(rIdx++, 'Nuevo en MythOS TV', '#22c55e', inner));
  }

  if (moviesRow.length) {
    const inner = moviesRow.map((m, i) =>
      homeNfPosterCard('movies', i, m.poster, m.emoji, m.name || m.title, false)).join('')
      + (movies.length > HOME_ROW_CAP ? homeNfMoreCard('movies') : '');
    rowsHtml.push(homeNfRowHtml(rIdx++, 'Películas', '#D85A30', inner));
  }

  if (livetvRow.length) {
    const inner = livetvRow.map((c, i) =>
      homeNfPosterCard('livetv', i, c.logo, c.emoji || '📺', c.name, true)).join('')
      + (livetv.length > HOME_ROW_CAP ? homeNfMoreCard('livetv') : '');
    rowsHtml.push(homeNfRowHtml(rIdx++, 'Live TV', '#378ADD', inner));
  }

  if (radioRow.length) {
    const inner = radioRow.map((s, i) => `
      <div class="home-radio-tile" tabindex="-1" data-row-type="radio" data-idx="${i}">
        <div class="home-radio-disc">
          ${s.logo
            ? `<img src="${s.logo}" alt="" loading="lazy" decoding="async" data-fallback="${s.emoji || '📻'}" onerror="handleImgError(this)" />`
            : (s.emoji || '📻')}
        </div>
        <div class="home-radio-name">${s.name || ''}</div>
      </div>`).join('')
      + (radio.length > HOME_ROW_CAP ? `
      <div class="home-radio-tile" tabindex="-1" data-row-type="more-radio">
        <div class="home-radio-disc" style="border:1px dashed rgba(255,255,255,0.25);">➕</div>
        <div class="home-radio-name">Ver más</div>
      </div>` : '');
    rowsHtml.push(homeNfRowHtml(rIdx++, 'Radio', '#993556', inner));
  }

  if (isWhale) {
    const dockRow = homeWhaleDockRowHtml(rIdx++);
    if (dockRow) rowsHtml.push(dockRow);
  }

  root.innerHTML = heroHtml + `<div class="nf-rows">${rowsHtml.join('')}</div>`;

  // Wiring de clics — un solo listener delegado, .onclick para ser
  // idempotente entre re-renders (igual criterio que wireRowArrows).
  root.onclick = (e) => {
    const removeBtn = e.target.closest('.cw-remove-btn');
    if (removeBtn) {
      e.stopPropagation();
      const { continueItems: _continueItems } = state._homeNfData;
      const _idx = parseInt(removeBtn.dataset.removeIdx, 10);
      const _ci  = _continueItems[_idx];
      if (_ci && _ci.m) {
        removeProgressFromServer(_ci.m.name || _ci.m.title || '');
        renderHomeNetflix();
      }
      return;
    }
    const card = e.target.closest('[data-row-type]');
    if (!card) return;
    const { continueItems, newItems, moviesRow, livetvRow, radioRow, newItemsAll } = state._homeNfData;
    const idx = parseInt(card.dataset.idx, 10);
    switch (card.dataset.rowType) {
      case 'continue':    { const _ci = continueItems[idx]; const m = _ci ? _ci.m : undefined; if (m) openDetailModal('movie', m); break; }
      case 'new':         { const m = newItems[idx];         if (m) openDetailModal('movie', m); break; }
      case 'movies':      { const m = moviesRow[idx];        if (m) openDetailModal('movie', m); break; }
      case 'livetv':      { const c = livetvRow[idx];        if (c) openDetailModal('livetv', c); break; }
      case 'radio':       { const s = radioRow[idx];         if (s) playRadioFromHome(s); break; }
      case 'more-new':    openNewMoviesView(newItemsAll); break;
      case 'more-movies': openMovies(); break;
      case 'more-livetv': openLiveTV(); break;
      case 'more-radio':  openRadio(); break;
      case 'dockapp':     { const app = (state.apps || [])[idx]; if (app) launchApp(app); break; }
    }
  };

  const heroPlayBtn = document.getElementById('home-hero-play');
  const heroInfoBtn = document.getElementById('home-hero-info');
  if (heroPlayBtn) heroPlayBtn.onclick = () => {
    const h = state._homeNfHero;
    if (!h) return;
    if (h.type === 'movie') {
      const urls = (h.item.urls && h.item.urls.length) ? h.item.urls : [h.item.url];
      const progress = getMovieProgress(h.item.name || h.item.title || '');
      playMovieWithFallback(urls, h.item.name || h.item.title || '', progress ? progress.position : 0);
    } else {
      playStream(h.item.url, h.item.name || '');
    }
  };
  if (heroInfoBtn) heroInfoBtn.onclick = () => {
    const h = state._homeNfHero;
    if (h) openDetailModal(h.type, h.item);
  };

  root.querySelectorAll('.nf-row-track-wrap').forEach(wireRowArrows);

  // Foco inicial: banner (botón Reproducir) si existe, si no la primera fila
  state._homeNfRow = hero ? -1 : 0;
  state._homeNfCol = 0;
  state._homeNfHeroBtn = 'play';
  state._homeNfTopIdx = 0;
  state._homeNfDropdownIdx = -1;
  if (hero) updateHomeHeroFocus();
  else focusHomeNf(0, 0);
}

/* ── Navegación remota del Home en tema Netflix — menú superior +
   banner + filas. Independiente del sistema de zonas del tema
   clásico (ver handleHomeKey). state._homeNfRow: -2 = menú
   superior, -1 = banner, 0..N = filas. El menú superior vive en
   <header> (persistente entre pantallas) pero solo es alcanzable
   por control remoto desde Inicio — ver aviso en el chat. */
function getHomeNfRows() {
  return [...document.querySelectorAll('#home-netflix-view .nf-row-track')];
}
function getHomeNfCards(rowEl) {
  return rowEl ? [...rowEl.querySelectorAll('.nf-card, .app-tile, .home-radio-tile')] : [];
}
function updateHomeHeroFocus() {
  const playBtn = document.getElementById('home-hero-play');
  const infoBtn = document.getElementById('home-hero-info');
  if (playBtn) playBtn.classList.toggle('focused', state._homeNfHeroBtn === 'play');
  if (infoBtn) infoBtn.classList.toggle('focused', state._homeNfHeroBtn === 'info');
  // BUG FIX (jul 2026): antes esta función solo togleaba el foco de los
  // botones Reproducir/Más info, pero nunca hacía scroll hasta el banner
  // en sí. Resultado: al subir con el control desde la primera fila, el
  // banner quedaba fuera de la pantalla (más arriba, sin verse) y la
  // siguiente flecha Arriba ya saltaba al menú, dando la sensación de que
  // el banner se "saltaba" por completo. Con block:'start' se fuerza el
  // scroll completo hasta que el banner quede arriba del todo, visible,
  // antes de poder pasar al menú — igual en todos los temas (Netflix,
  // Whale, etc.), ya que esta función es compartida por todos.
  const banner = document.getElementById('home-hero-banner');
  if (banner) banner.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function focusHomeNf(row, col) {
  const rows = getHomeNfRows();
  if (!rows.length) return;
  row = Math.max(0, Math.min(row, rows.length - 1));
  const cards = getHomeNfCards(rows[row]);
  if (!cards.length) return;
  col = Math.max(0, Math.min(col, cards.length - 1));
  state._homeNfRow = row;
  state._homeNfCol = col;
  rows.forEach(r => getHomeNfCards(r).forEach(c => c.classList.remove('focused')));
  cards[col].classList.add('focused');
  cards[col].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}
function getTopnavItems() {
  return [...document.querySelectorAll('#nf-topnav .nf-topnav-item')];
}
function getTopnavDropdownItems() {
  return [...document.querySelectorAll('#nf-topnav-dropdown .nf-topnav-dropdown-item')];
}
function closeTopnavDropdown() {
  document.getElementById('nf-topnav-dropdown')?.classList.remove('open');
  state._homeNfDropdownIdx = -1;
}
function focusTopnav(idx) {
  const items = getTopnavItems();
  if (!items.length) return;
  closeTopnavDropdown();
  idx = Math.max(0, Math.min(idx, items.length - 1));
  state._homeNfTopIdx = idx;
  items.forEach((it, i) => it.classList.toggle('focused', i === idx));
  items[idx].scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function focusTopnavDropdown(idx) {
  const items = getTopnavDropdownItems();
  if (!items.length) return;
  document.getElementById('nf-topnav-dropdown')?.classList.add('open');
  idx = Math.max(0, Math.min(idx, items.length - 1));
  state._homeNfDropdownIdx = idx;
  items.forEach((it, i) => it.classList.toggle('focused', i === idx));
}
function handleHomeNetflixKey(key) {
  const rows = getHomeNfRows();
  const hero = state._homeNfHero;
  switch (key) {
    case 'ArrowRight':
      playSnd('nav');
      if (state._homeNfRow === -2) {
        if (state._homeNfDropdownIdx >= 0) focusTopnavDropdown(state._homeNfDropdownIdx + 1);
        else focusTopnav((state._homeNfTopIdx || 0) + 1);
      } else if (state._homeNfRow === -1) {
        state._homeNfHeroBtn = 'info'; updateHomeHeroFocus();
      } else {
        focusHomeNf(state._homeNfRow, (state._homeNfCol || 0) + 1);
      }
      break;
    case 'ArrowLeft':
      playSnd('nav');
      if (state._homeNfRow === -2) {
        if (state._homeNfDropdownIdx >= 0) focusTopnavDropdown(state._homeNfDropdownIdx - 1);
        else focusTopnav((state._homeNfTopIdx || 0) - 1);
      } else if (state._homeNfRow === -1) {
        state._homeNfHeroBtn = 'play'; updateHomeHeroFocus();
      } else {
        focusHomeNf(state._homeNfRow, (state._homeNfCol || 0) - 1);
      }
      break;
    case 'ArrowDown':
      playSnd('nav');
      if (state._homeNfRow === -2) {
        if (state._homeNfDropdownIdx >= 0) { /* último nivel, sin más abajo */ }
        else {
          const activeEl = getTopnavItems()[state._homeNfTopIdx || 0];
          if (activeEl && activeEl.id === 'nf-topnav-more-btn') {
            focusTopnavDropdown(0);
          } else {
            getTopnavItems().forEach(it => it.classList.remove('focused'));
            if (hero) { state._homeNfRow = -1; updateHomeHeroFocus(); }
            else { state._homeNfRow = 0; focusHomeNf(0, 0); }
          }
        }
      } else if (state._homeNfRow === -1) {
        focusHomeNf(0, 0);
      } else {
        focusHomeNf(state._homeNfRow + 1, state._homeNfCol || 0);
      }
      break;
    case 'ArrowUp':
      playSnd('nav');
      if (state._homeNfRow === -2) {
        if (state._homeNfDropdownIdx >= 0) { closeTopnavDropdown(); focusTopnav(state._homeNfTopIdx || 0); }
      } else if (state._homeNfRow === -1) {
        state._homeNfRow = -2; focusTopnav(state._homeNfTopIdx || 0);
      } else if (state._homeNfRow === 0) {
        rows.forEach(r => getHomeNfCards(r).forEach(c => c.classList.remove('focused')));
        if (hero) { state._homeNfRow = -1; updateHomeHeroFocus(); }
        else { state._homeNfRow = -2; focusTopnav(state._homeNfTopIdx || 0); }
      } else if (state._homeNfRow > 0) {
        focusHomeNf(state._homeNfRow - 1, state._homeNfCol || 0);
      }
      break;
    case 'Enter':
      playSnd('enter');
      if (state._homeNfRow === -2) {
        if (state._homeNfDropdownIdx >= 0) {
          var _tnDDitem = getTopnavDropdownItems()[state._homeNfDropdownIdx];
          if (_tnDDitem) _tnDDitem.click();
        } else {
          const el = getTopnavItems()[state._homeNfTopIdx || 0];
          if (el && el.id === 'nf-topnav-more-btn') focusTopnavDropdown(0);
          else el?.click();
        }
      } else if (state._homeNfRow === -1) {
        (state._homeNfHeroBtn === 'info' ? document.getElementById('home-hero-info') : document.getElementById('home-hero-play'))?.click();
      } else {
        var _nfCard = getHomeNfCards(rows[state._homeNfRow])[state._homeNfCol];
        if (_nfCard) _nfCard.click();
      }
      break;
  }
}

/* ══════════════════════════════════════════════════════════════
   SUGERENCIAS — renderizado y navegación
   ══════════════════════════════════════════════════════════════ */

/* Mezcla aleatoria (Fisher-Yates) */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Conecta las flechas de navegación (‹ ›) de una fila horizontal tipo
   Netflix. `wrap` debe contener .nf-row-track + .nf-arrow-left/.nf-arrow-right.
   Reutilizable: la usan tanto las filas del tema Netflix como la fila
   "Continuar viendo" del Home. Idempotente (se puede llamar de nuevo tras
   re-renderizar la fila; simplemente vuelve a conectar los listeners). */
function wireRowArrows(wrap) {
  if (!wrap) return;
  const track = wrap.querySelector('.nf-row-track');
  const leftBtn = wrap.querySelector('.nf-arrow-left');
  const rightBtn = wrap.querySelector('.nf-arrow-right');
  if (!track || !leftBtn || !rightBtn) return;
  function updateArrows() {
    const maxScroll = track.scrollWidth - track.clientWidth;
    leftBtn.classList.toggle('nf-arrow-hidden', track.scrollLeft <= 4);
    rightBtn.classList.toggle('nf-arrow-hidden', maxScroll <= 4 || track.scrollLeft >= maxScroll - 4);
  }
  leftBtn.onclick = () => track.scrollBy({ left: -track.clientWidth * 0.85, behavior: 'smooth' });
  rightBtn.onclick = () => track.scrollBy({ left: track.clientWidth * 0.85, behavior: 'smooth' });
  track.onscroll = updateArrows;
  updateArrows();
}

function renderSuggestions() {
  renderContinueWatching();
  renderMovieSuggestions();
  renderLiveTVSuggestions();
  // Ocultar sección si no hay contenido
  document.getElementById('suggestions-movies-wrap').style.display =
    state.movies.length ? '' : 'none';
  document.getElementById('suggestions-livetv-wrap').style.display =
    state.livetv.length ? '' : 'none';
}

function renderContinueWatching() {
  const wrap  = document.getElementById('suggestions-continue-wrap');
  const track = document.getElementById('suggestions-continue');
  if (!track || !wrap) return;
  track.innerHTML = '';

  // Emparejar progreso guardado con las películas del catálogo actual (últimas 10)
  const items = (state.progress || [])
    .map(p => ({ p, m: findMovieByName(p.movieName) }))
    .filter(x => x.m)
    .slice(0, 10);

  wrap.style.display = items.length ? '' : 'none';
  if (!items.length) { state._suggContinue = []; return; }

  items.forEach(({ p, m }, i) => {
    const pct = p.duration > 0 ? Math.min(100, Math.round((p.position / p.duration) * 100)) : 0;
    const accent = CW_ACCENTS[i % CW_ACCENTS.length];
    const card = document.createElement('div');
    // .sugg-continue-card: clase usada por la navegación remota (ver
    // setFocusZone/moveSuggFocus/updateSuggFocus). .cw-card: tarjeta
    // panorámica compartida con el tema Netflix (ver styles.css).
    card.className = 'sugg-continue-card cw-card';
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '-1');
    card.dataset.idx = i;
    const frameHtml = m.poster
      ? `<img src="${m.poster}" alt="" loading="lazy" decoding="async" onerror="handleImgError(this)" data-fallback="${m.emoji || '🎬'}" />`
      : `<div class="cw-frame-fallback">${m.emoji || '🎬'}</div>`;
    card.innerHTML = `
      <div class="cw-frame" style="--cw-accent:${accent}">
        ${frameHtml}
        <div class="cw-scrim"></div>
        <div class="cw-play"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="5,3 19,12 5,21"/></svg></div>
        <div class="cw-title">${m.name || m.title || ''}</div>
        <div class="cw-progress"><div class="cw-progress-fill" style="width:${pct}%"></div></div>
      </div>`;
    card.addEventListener('click', () => openDetailModal('movie', m));
    track.appendChild(card);
  });
  state._suggContinue = items.map(x => x.m);
  state.suggContinueIdx = 0;

  wireRowArrows(wrap.querySelector('.nf-row-track-wrap'));
}

function renderMovieSuggestions() {
  const row = document.getElementById('suggestions-movies');
  if (!row) return;
  row.innerHTML = '';
  const items = shuffle(state.movies).slice(0, 12);
  items.forEach((m, i) => {
    const card = document.createElement('div');
    card.className = 'sugg-movie-card';
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '-1');
    card.dataset.idx = i;
    card.dataset.type = 'movie';
    const posterHtml = m.poster
      ? `<img class="sm-poster" src="${m.poster}" alt="" loading="lazy" decoding="async" onerror="handleImgError(this)" data-fallback="${m.emoji || '🎬'}" />`
      : `<div class="sm-poster-fallback">${m.emoji || '🎬'}</div>`;
    card.innerHTML = `${posterHtml}<div class="sm-title">${m.name || m.title || ''}</div>`;
    card.addEventListener('click', () => openDetailModal('movie', m));
    row.appendChild(card);
  });
  // guardar items shuffle para navegación
  state._suggMovies = items;
  state.suggMovieIdx = 0;
}

function renderLiveTVSuggestions() {
  const row = document.getElementById('suggestions-livetv');
  if (!row) return;
  row.innerHTML = '';
  const items = shuffle(state.livetv).slice(0, 12);
  items.forEach((ch, i) => {
    const card = document.createElement('div');
    card.className = 'sugg-ch-card';
    card.setAttribute('role', 'listitem');
    card.setAttribute('tabindex', '-1');
    card.dataset.idx = i;
    card.dataset.type = 'livetv';
    const logoHtml = ch.logo
      ? `<img class="ch-logo" src="${ch.logo}" alt="" loading="lazy" decoding="async" onerror="handleImgError(this)" data-fallback="${ch.emoji || '📺'}" />`
      : `<span class="ch-logo-fallback">${ch.emoji || '📺'}</span>`;
    card.innerHTML = `${logoHtml}<div class="ch-name">${ch.name || ''}</div>`;
    card.addEventListener('click', () => openDetailModal('livetv', ch));
    row.appendChild(card);
  });
  state._suggLivetv = items;
  state.suggLivetvIdx = 0;
}

function setFocusZone(zone) {
  state.focusZone = zone;
  // Quitar foco visual de todas las tiles del dock
  getTiles().forEach(t => t.classList.remove('focused'));
  // Quitar foco de todas las sugg cards
  document.querySelectorAll('.sugg-movie-card, .sugg-ch-card, .sugg-continue-card').forEach(c => c.classList.remove('focused'));

  if (zone === 'dock') {
    updateTileFocus();
  } else if (zone === 'movies') {
    state.suggMovieIdx = state.suggMovieIdx || 0;
    updateSuggFocus('movies');
  } else if (zone === 'livetv') {
    state.suggLivetvIdx = state.suggLivetvIdx || 0;
    updateSuggFocus('livetv');
  } else if (zone === 'continue') {
    state.suggContinueIdx = state.suggContinueIdx || 0;
    updateSuggFocus('continue');
  }
}

function moveSuggFocus(zone, dir) {
  if (zone === 'movies') {
    const cards = [...document.querySelectorAll('#suggestions-movies .sugg-movie-card')];
    state.suggMovieIdx = Math.max(0, Math.min(state.suggMovieIdx + dir, cards.length - 1));
    updateSuggFocus('movies');
  } else if (zone === 'livetv') {
    const cards = [...document.querySelectorAll('#suggestions-livetv .sugg-ch-card')];
    state.suggLivetvIdx = Math.max(0, Math.min(state.suggLivetvIdx + dir, cards.length - 1));
    updateSuggFocus('livetv');
  } else if (zone === 'continue') {
    const cards = [...document.querySelectorAll('#suggestions-continue .sugg-continue-card')];
    state.suggContinueIdx = Math.max(0, Math.min(state.suggContinueIdx + dir, cards.length - 1));
    updateSuggFocus('continue');
  }
}

function updateSuggFocus(zone) {
  if (zone === 'movies') {
    const cards = [...document.querySelectorAll('#suggestions-movies .sugg-movie-card')];
    cards.forEach((c, i) => c.classList.toggle('focused', i === state.suggMovieIdx));
    if (cards[state.suggMovieIdx]) cards[state.suggMovieIdx].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  } else if (zone === 'livetv') {
    const cards = [...document.querySelectorAll('#suggestions-livetv .sugg-ch-card')];
    cards.forEach((c, i) => c.classList.toggle('focused', i === state.suggLivetvIdx));
    if (cards[state.suggLivetvIdx]) cards[state.suggLivetvIdx].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  } else if (zone === 'continue') {
    const cards = [...document.querySelectorAll('#suggestions-continue .sugg-continue-card')];
    cards.forEach((c, i) => c.classList.toggle('focused', i === state.suggContinueIdx));
    if (cards[state.suggContinueIdx]) cards[state.suggContinueIdx].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
}

function openDetailForFocused(zone) {
  if (zone === 'movies' && state._suggMovies) {
    openDetailModal('movie', state._suggMovies[state.suggMovieIdx]);
  } else if (zone === 'livetv' && state._suggLivetv) {
    openDetailModal('livetv', state._suggLivetv[state.suggLivetvIdx]);
  } else if (zone === 'continue' && state._suggContinue) {
    openDetailModal('movie', state._suggContinue[state.suggContinueIdx]);
  }
}

/* ══════════════════════════════════════════════════════════════
   DETAIL MODAL
   ══════════════════════════════════════════════════════════════ */
function initDetailModal() {
  document.getElementById('detail-close-btn').addEventListener('click', closeDetailModal);
  document.getElementById('detail-restart-btn').addEventListener('click', () => {
    const item = state._detailItem;
    if (!item) return;
    closeDetailModal();
    const urls = (item.urls && item.urls.length) ? item.urls : [item.url];
    const startIdx = state._detailServerIdx || 0;
    const ordered = [...urls.slice(startIdx), ...urls.slice(0, startIdx)];
    playMovieWithFallback(ordered, item.name || item.title || '', 0);
  });
  document.getElementById('detail-play-btn').addEventListener('click', () => {
    const item = state._detailItem;
    const type = state._detailType;
    if (!item || !type) return;
    closeDetailModal();
    if (type === 'livetv') {
      state._trackMovie = null;
      playStream(item.url, item.name || '', null, true);
      return;
    }
    // Películas: arrancar desde el servidor seleccionado, con fallback automático
    const urls = (item.urls && item.urls.length) ? item.urls : [item.url];
    const startIdx = state._detailServerIdx || 0;
    // Reordenar: el seleccionado va primero, los demás como fallback en orden
    const ordered = [...urls.slice(startIdx), ...urls.slice(0, startIdx)];
    const progress = getMovieProgress(item.name || item.title || '');
    const resumeAt = progress ? progress.position : 0;
    playMovieWithFallback(ordered, item.name || item.title || '', resumeAt);
  });
}

function openDetailModal(type, item) {
  state._detailType = type;
  state._detailItem = item;

  const overlay  = document.getElementById('detail-overlay');
  const badge    = document.getElementById('detail-badge');
  const title    = document.getElementById('detail-title');
  const meta     = document.getElementById('detail-meta');
  const desc     = document.getElementById('detail-desc');
  const poster   = document.getElementById('detail-poster');
  const card     = document.getElementById('detail-card');
  const playBtn  = document.getElementById('detail-play-btn');
  const progWrap = document.getElementById('detail-progress-wrap');
  const progFill = document.getElementById('detail-progress-fill');
  const progLbl  = document.getElementById('detail-progress-label');
  const restartBtn = document.getElementById('detail-restart-btn');
  const isNF     = state.theme === 'netflix';

  // Botón "Quitar de Continuar viendo" — se crea una sola vez, al lado
  // del restartBtn, igual que el selector de servidores más abajo
  // (así no depende de tener que tocar index.html para agregarlo).
  let removeBtn = document.getElementById('detail-remove-btn');
  if (!removeBtn) {
    removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.id = 'detail-remove-btn';
    removeBtn.className = 'detail-btn-restart';
    removeBtn.textContent = 'Quitar de Continuar viendo';
    restartBtn.parentElement.insertBefore(removeBtn, restartBtn.nextSibling);
    removeBtn.addEventListener('click', () => {
      const item = state._detailItem;
      if (!item) return;
      removeProgressFromServer(item.name || item.title || '');
      closeDetailModal();
      if (document.body.classList.contains('theme-netflix')) renderHomeNetflix();
    });
  }

  // Reset por defecto — se vuelve a mostrar más abajo solo si aplica
  progWrap.classList.add('hidden');
  restartBtn.classList.add('hidden');
  removeBtn.classList.add('hidden');

  // Limpiar hero Netflix de llamadas anteriores
  card.style.backgroundImage = '';
  card.style.backgroundSize  = '';
  card.style.backgroundPosition = '';
  poster.style.display = '';

  if (type === 'livetv') {
    badge.classList.remove('hidden');
    title.textContent = item.name || '';
    meta.textContent  = item.group || item.category || 'Canal en vivo';
    desc.textContent  = item.description || 'Canal de televisión en vivo.';
    playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Ver ahora';
    // Live TV: logo centrado siempre (logos transparentes no sirven como hero a sangre)
    poster.innerHTML = item.logo
      ? `<img src="${item.logo}" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;" onerror="this.parentElement.textContent='${item.emoji||'📺'}'">` 
      : (item.emoji || '📺');
  } else {
    badge.classList.add('hidden');
    title.textContent = item.name || item.title || '';
    meta.textContent  = [item.year, item.genre, item.duration].filter(Boolean).join(' · ') || 'Película';
    desc.textContent  = item.description || '';
    playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Reproducir';

    if (isNF && item.poster) {
      // Netflix: poster como hero a todo ancho en el card
      card.style.backgroundImage    = `url('${item.poster}')`;
      card.style.backgroundSize     = 'cover';
      card.style.backgroundPosition = 'center top';
      poster.style.display = 'none';
    } else {
      poster.innerHTML = item.poster
        ? `<img src="${item.poster}" alt="" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.textContent='${item.emoji||'🎬'}'">` 
        : (item.emoji || '🎬');
    }

    // "Continuar viendo": barra de progreso + botón Continuar si hay posición guardada
    const progress = getMovieProgress(item.name || item.title || '');
    if (progress && progress.duration > 0) {
      const pct = Math.min(100, Math.round((progress.position / progress.duration) * 100));
      progFill.style.width = pct + '%';
      progLbl.textContent  = `${pct}% visto`;
      progWrap.classList.remove('hidden');
      restartBtn.classList.remove('hidden');
      removeBtn.classList.remove('hidden');
      playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Continuar';
    }

    // Selector de servidores si hay más de uno
    const urls = (item.urls && item.urls.length > 1) ? item.urls : null;
    let serverSel = document.getElementById('detail-server-selector');
    if (!serverSel) {
      serverSel = document.createElement('div');
      serverSel.id = 'detail-server-selector';
      serverSel.style.cssText = 'margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;';
      playBtn.parentElement.insertBefore(serverSel, playBtn);
    }
    if (urls) {
      state._detailServerIdx = 0;
      serverSel.style.display = 'flex';
      serverSel.innerHTML = urls.map((u, i) => `
        <button class="detail-server-btn${i===0?' active':''}" data-idx="${i}" style="
          font-size:0.72rem;padding:4px 10px;border-radius:20px;cursor:pointer;border:1px solid;
          background:${i===0?'rgba(124,106,247,0.25)':'rgba(255,255,255,0.05)'};
          color:${i===0?'#a89dff':'rgba(255,255,255,0.4)'};
          border-color:${i===0?'rgba(124,106,247,0.5)':'rgba(255,255,255,0.12)'};
          transition:0.15s;font-family:inherit;">Servidor ${i+1}
        </button>`).join('');
      serverSel.querySelectorAll('.detail-server-btn').forEach((btn, j) => {
        btn.addEventListener('click', () => {
          state._detailServerIdx = j;
          serverSel.querySelectorAll('.detail-server-btn').forEach((b, k) => {
            const on = k === j;
            b.style.background  = on ? 'rgba(124,106,247,0.25)' : 'rgba(255,255,255,0.05)';
            b.style.color       = on ? '#a89dff' : 'rgba(255,255,255,0.4)';
            b.style.borderColor = on ? 'rgba(124,106,247,0.5)' : 'rgba(255,255,255,0.12)';
          });
        });
      });
    } else {
      serverSel.style.display = 'none';
      state._detailServerIdx = 0;
    }
  }

  overlay.classList.remove('hidden');
  state._detailFocusBtn = 'play';
  setRemoteFocus(playBtn, true);
  setRemoteFocus(document.getElementById('detail-close-btn'), false);
  playBtn.focus();
}

function closeDetailModal() {
  document.getElementById('detail-overlay').classList.add('hidden');
  const card = document.getElementById('detail-card');
  if (card) { card.style.backgroundImage = ''; card.style.backgroundSize = ''; card.style.backgroundPosition = ''; }
  const poster = document.getElementById('detail-poster');
  if (poster) poster.style.display = '';
  state._detailItem = null;
  state._detailType = null;
}
function handleSettingsKey(key) {
  if (key === 'Backspace' || key === 'Escape') { playSnd('nav'); navigateTo('home', 'Inicio'); return; }
  if (typeof state.settingsNavHandler === 'function') state.settingsNavHandler(key);
}
function handleAppKey(key) {
  // Si hay un appNavHandler activo, dejarle manejar Backspace/Escape primero
  // (por ejemplo, Live TV puede querer subir al botón Atrás antes de cerrar)
  if (typeof state.appNavHandler === 'function') {
    const handled = state.appNavHandler(key);
    if (handled) return;
  }
  if (key === 'Backspace' || key === 'Escape') { playSnd('nav'); stopAll(); navigateTo('home', 'Inicio'); return; }
}

/* Foco visual de control remoto — clase .remote-focus (ver styles.css), no pisa estilos inline existentes */
function setRemoteFocus(el, on) {
  if (!el) return;
  el.classList.toggle('remote-focus', on);
}
/* Sube/baja el foco al botón Atrás del header. Compartido por Live TV, Películas
   y Radio para cuando ArrowUp llega a la fila más alta de su pantalla. */
function focusAppBack(on) {
  setRemoteFocus(document.getElementById('app-back'), on);
}

/* ══════════════════════════════════════════════════════════════
   ROUTER
   ══════════════════════════════════════════════════════════════ */
function navigateTo(screenId, title, renderFn) {
  const screenMap = { home: 'home', settings: 'settings' };
  const domId = screenMap[screenId] || 'app';
  const current = document.querySelector('.screen.active');
  const next    = document.getElementById(`screen-${domId}`);
  if (!next) return;

  // Películas/Live TV/Radio comparten el mismo contenedor #screen-app
  // (el contenido interno cambia según qué función lo puebla). Si ya
  // estaba activo pero se pidió OTRA app (ej. saltar Películas→Live TV
  // directo desde el menú superior, sin pasar por Inicio), no hay que
  // cortar acá — solo se omite la animación de entrada/salida (sería
  // redundante, el panel ya está visible), pero el contenido SIEMPRE
  // se vuelve a renderizar.
  const sameScreenAlreadyActive = next === current;
  if (sameScreenAlreadyActive && screenId === state.currentScreen && !renderFn) return;

  if (!sameScreenAlreadyActive) {
    if (current) {
      current.classList.add('exit-left');
      setTimeout(() => current.classList.remove('active','exit-left'), 300);
    }
    next.classList.add('enter-right');
    setTimeout(() => { next.classList.add('active'); next.classList.remove('enter-right'); }, 30);
  }

  state.currentScreen = screenId;
  state.appNavHandler = null;
  state.settingsNavHandler = null;
  updateNfTopnavActive();
  const tb = document.getElementById('topbar-title');
  if (tb) tb.textContent = title || 'Inicio';
  if (renderFn) renderFn();
  if (screenId === 'home') {
    if (document.body.classList.contains('theme-netflix')) {
      renderHomeNetflix();
    } else {
      setTimeout(() => { state.focusZone = 'dock'; focusTile(state.focusIndex); }, 350);
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   APP LAUNCHER
   ══════════════════════════════════════════════════════════════ */
function launchApp(app) {
  if (app.type === 'external') { openGenericApp(app); return; }
  switch (app.screen) {
    case 'settings': openSettings();   break;
    case 'livetv':   openLiveTV();     break;
    case 'movies':   openMovies();     break;
    case 'radio':    openRadio();      break;
    case 'iptv':     openLiveTV();     break; // legacy alias
    default:         openGenericApp(app); break;
  }
}

function stopAll() {
  stopRadio();
  stopHLS();
}

/* ── External Link Modal ────────────────────────────────────── */
function createModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'link-modal';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-icon" id="modal-icon">🚀</div>
      <div class="modal-title" id="modal-title">Abrir aplicación</div>
      <div class="modal-desc"  id="modal-desc">¿Deseas abrir esta app?</div>
      <div class="modal-url"   id="modal-url">—</div>
      <div class="modal-buttons">
        <button class="modal-btn modal-btn-cancel"  id="modal-cancel">Cancelar</button>
        <button class="modal-btn modal-btn-confirm" id="modal-confirm">Abrir ahora</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
}

let _modalApp = null;
function showLinkModal(app) {
  _modalApp = app;
  document.getElementById('modal-icon').textContent  = app.emoji;
  document.getElementById('modal-title').textContent = app.label;
  document.getElementById('modal-desc').textContent  = `Serás redirigido a ${app.label}`;
  document.getElementById('modal-url').textContent   = app.url || 'URL no configurada';
  document.getElementById('modal-confirm').onclick   = () => { if (_modalApp?.url) window.open(_modalApp.url,'_blank'); closeModal(); };
  document.getElementById('link-modal').classList.add('active');
  document.addEventListener('keydown', handleModalKey);
}
function closeModal() {
  document.getElementById('link-modal').classList.remove('active');
  document.removeEventListener('keydown', handleModalKey);
  _modalApp = null;
}
function handleModalKey(e) {
  if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); closeModal(); }
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('modal-confirm').click(); }
}

/* ══════════════════════════════════════════════════════════════
   HLS.js PLAYER (shared for Live TV & Movies)
   ══════════════════════════════════════════════════════════════ */
const PLAYER_BTN_STYLE = 'background:rgba(255,255,255,0.12);border:none;color:#fff;' +
  'font-size:1.05rem;width:38px;height:38px;border-radius:50%;cursor:pointer;' +
  'display:flex;align-items:center;justify-content:center;transition:background 0.15s;flex-shrink:0;';

// Botón de ajuste de imagen (zoom): con texto además del ícono, para que
// sea obvio en qué modo está aunque no se conozca el ícono de memoria.
const PLAYER_ZOOM_BTN_STYLE = 'background:rgba(255,255,255,0.12);border:none;color:#fff;' +
  'font-size:0.8rem;font-weight:600;padding:0 14px;height:38px;border-radius:19px;cursor:pointer;' +
  'display:flex;align-items:center;gap:6px;transition:background 0.15s;flex-shrink:0;white-space:nowrap;';

// Modos de ajuste, en el orden en que el botón los cicla al hacer click.
const PLAYER_ZOOM_MODES = [
  { fit: 'contain', label: 'Ajustar'  }, // respeta proporción, puede dejar franjas negras
  { fit: 'cover',   label: 'Rellenar' }, // llena la pantalla, recorta bordes si hace falta
  { fit: 'fill',    label: 'Estirar'  }  // llena la pantalla, distorsiona si hace falta
];

function stopHLS() {
  if (state.hlsInstance) { state.hlsInstance.destroy(); state.hlsInstance = null; }
  clearTimeout(state._playerLoadTimer);
  clearTimeout(state._playerCodecTimer);
  // Invalida cualquier timer/escalado de fallback (proxy/transcode) que
  // haya quedado pendiente de una sesión de reproducción anterior — sin
  // esto, un timeout tardío podía "revivir" un canal viejo encima del
  // que el usuario eligió después (bug: seguía sonando en el fondo).
  state._playerToken = (state._playerToken || 0) + 1;
  const v = document.getElementById('hls-video');
  if (v) { v.pause(); v.removeAttribute('src'); v.onerror = null; v.load(); }
}

function enterPlayerFullscreen(el) {
  try {
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (!req) return;
    const p = req.call(el);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {}
}

function exitPlayerFullscreen() {
  try {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (!exit) return;
    const p = exit.call(document);
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch {}
}

function closePlayer() {
  // Guardar progreso final antes de cerrar (solo si era una película trackeada)
  if (state._trackMovie) {
    const video = document.getElementById('hls-video');
    if (video && isFinite(video.duration) && video.duration > 0) {
      const url = (state._movieUrls && state._movieUrls[state._movieUrlIdx]) || state._trackMovie.url;
      saveProgressToServer(state._trackMovie.name, url, video.currentTime, video.duration);
      upsertLocalProgress(state._trackMovie.name, url, video.currentTime, video.duration);
    }
    state._trackMovie = null;
    state._resumeAt   = 0;
  }
  stopHLS();
  exitPlayerFullscreen();
  const overlay = document.getElementById('player-overlay');
  if (overlay) {
    if (overlay._keyHandler) document.removeEventListener('keydown', overlay._keyHandler);
    overlay.remove();
  }
  document.addEventListener('keydown', handleKey);
  if (state.playerOnClose) {
    const cb = state.playerOnClose;
    state.playerOnClose = null;
    cb();
  }
  // BUG FIX (jul 2026): la gran mayoría de los playStream(...) de
  // películas NO pasan un onClose (queda null) — el player es un
  // overlay a pantalla completa por encima del Home, así que al
  // cerrarlo simplemente reaparecía el Home tal cual había quedado
  // ANTES de entrar a ver la película, sin repintarse nunca. Antes de
  // esto solo se actualizaba state.progress (arriba), pero nadie le
  // pedía a la fila "Continuar viendo" que se vuelva a dibujar con ese
  // dato nuevo — de ahí que hiciera falta refrescar la página entera.
  // Si el onClose de arriba ya navegó a otra pantalla, esto no hace
  // nada extra (currentScreen ya no sería 'home').
  if (state.currentScreen === 'home' && document.body.classList.contains('theme-netflix')) {
    renderHomeNetflix();
  }
}

// Si el usuario sale de fullscreen (Esc del navegador, gesto remoto TV),
// solo minimizamos la UI — NO cerramos el player ni detenemos el stream.
// El usuario puede seguir escuchando/viendo y volver a fullscreen con el botón.
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    const overlay = document.getElementById('player-overlay');
    if (overlay) overlay.classList.add('player-chrome-visible');
  }
});
document.addEventListener('webkitfullscreenchange', () => {
  if (!document.webkitFullscreenElement) {
    const overlay = document.getElementById('player-overlay');
    if (overlay) overlay.classList.add('player-chrome-visible');
  }
});

function formatPlayerTime(s) {
  if (!isFinite(s) || isNaN(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/* ── Reproductor con fallback automático entre servidores ───────
   urls: array ordenado [seleccionado, fallback1, fallback2, ...]
   Intenta cada URL en orden. Si falla, prueba la siguiente.
   El botón "Srv N/N — Cambiar" en el player permite saltar manualmente. */
function playMovieWithFallback(urls, title, resumeAt) {
  if (!urls || !urls.length) { showToast('⚠️ Sin URL configurada'); return; }
  const cleanUrls = [...new Set(urls.filter(Boolean))];
  state._movieUrls   = cleanUrls;
  state._movieTitle  = title;
  state._trackMovie  = { name: title, url: cleanUrls[0] };
  state._resumeAt    = resumeAt > 0 ? resumeAt : 0;
  state._lastProgressSave = 0;
  _playMovieAtIdx(0);
}

function _playMovieAtIdx(idx) {
  const urls  = state._movieUrls || [];
  const title = state._movieTitle || '';
  if (idx >= urls.length) { showToast('❌ Todos los servidores fallaron'); closePlayer(); return; }
  state._movieUrlIdx = idx;
  _updatePlayerServerBadge(idx, urls.length);
  playStream(urls[idx], title, null);

  // Fallback automático en error
  setTimeout(() => {
    const video = document.getElementById('hls-video');
    if (!video) return;
    if (video._fallbackHandler) video.removeEventListener('error', video._fallbackHandler);
    let _done = false;
    const fallback = () => {
      if (_done) return; _done = true;
      clearTimeout(state._movieFallbackTimer);
      const remaining = urls.length - idx - 1;
      if (remaining > 0) {
        showToast(`⚠️ Servidor ${idx+1} falló — probando ${idx+2}…`);
        setTimeout(() => _playMovieAtIdx(idx + 1), 800);
      } else {
        showToast('❌ Todos los servidores fallaron');
      }
    };
    video._fallbackHandler = fallback;
    video.addEventListener('error', fallback);
    // Timeout 15s si no arranca
    clearTimeout(state._movieFallbackTimer);
    state._movieFallbackTimer = setTimeout(() => {
      const v = document.getElementById('hls-video');
      if (v && v.readyState === 0) fallback();
    }, 15000);
    video.addEventListener('playing', () => clearTimeout(state._movieFallbackTimer), { once: true });
  }, 300);
}

function _updatePlayerServerBadge(idx, total) {
  let badge = document.getElementById('player-server-badge');
  const topbar = document.getElementById('player-topbar');
  if (!topbar) return;
  if (total <= 1) { if (badge) badge.remove(); return; }
  if (!badge) {
    badge = document.createElement('button');
    badge.id = 'player-server-badge';
    badge.style.cssText = 'background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);' +
      'color:#fff;font-size:0.72rem;padding:5px 12px;border-radius:20px;cursor:pointer;font-family:inherit;flex-shrink:0;';
    badge.onmouseover = () => badge.style.background = 'rgba(255,255,255,0.2)';
    badge.onmouseout  = () => badge.style.background = 'rgba(255,255,255,0.1)';
    badge.addEventListener('click', () => {
      const next = ((state._movieUrlIdx || 0) + 1) % (state._movieUrls || []).length;
      showToast('Cambiando servidor…');
      _playMovieAtIdx(next);
    });
    const spacer = topbar.querySelector('div[style*="flex:1"]');
    if (spacer) topbar.insertBefore(badge, spacer); else topbar.appendChild(badge);
  }
  badge.textContent = `Srv ${idx+1}/${total} — Cambiar`;
}

function playStream(url, title, onClose, isLive = false) {
  stopHLS();
  state.playerOnClose = typeof onClose === 'function' ? onClose : null;

  // Show fullscreen player overlay
  let overlay = document.getElementById('player-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'player-overlay';
    overlay.tabIndex = -1;
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:9000;background:#000;
      display:flex;flex-direction:column;
    `;
    overlay.innerHTML = `
      <div id="player-topbar" style="
        display:flex;align-items:center;gap:14px;padding:14px 20px;
        background:linear-gradient(to bottom,rgba(0,0,0,0.9),transparent);
        position:absolute;top:0;left:0;right:0;z-index:2;
        transition:opacity 0.3s;
      ">
        <button id="player-back" style="
          background:rgba(255,255,255,0.12);border:none;color:#fff;
          font-size:1rem;padding:8px 14px;border-radius:8px;cursor:pointer;
          display:flex;align-items:center;gap:6px;
        ">← Atrás</button>
        <span id="player-title" style="color:#fff;font-size:1rem;font-weight:600;"></span>
        <span id="player-live-badge" style="
          display:none;
          background:linear-gradient(135deg,#7c6af7,#3ecfcf);color:#fff;padding:3px 10px;
          border-radius:20px;font-size:0.7rem;font-weight:700;letter-spacing:0.03em;
        ">● LIVE</span>
        <div style="flex:1"></div>
        <span id="player-status" style="color:rgba(255,255,255,0.6);font-size:0.75rem;"></span>
      </div>

      <video id="hls-video" style="width:100%;height:100%;object-fit:contain;background:#000;" playsinline></video>

      <div id="player-loading" style="
        position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        background:rgba(0,0,0,0.6);z-index:3;pointer-events:none;
      ">
        <div style="text-align:center;color:#fff;">
          <div style="
            width:46px;height:46px;border-radius:50%;margin:0 auto 14px;
            border:3px solid rgba(255,255,255,0.15);border-top-color:#7c6af7;
            animation:player-spin 0.9s linear infinite;
          "></div>
          <div style="font-size:0.85rem;opacity:0.7;">Cargando stream…</div>
        </div>
      </div>

      <div id="player-controls" style="
        position:absolute;bottom:0;left:0;right:0;z-index:2;
        display:flex;flex-direction:column;gap:6px;
        padding:8px 20px 16px;
        background:linear-gradient(to top, rgba(0,0,0,0.88), transparent);
        transition:opacity 0.3s;
      ">
        <div id="player-seek-row" style="display:none;align-items:center;gap:10px;">
          <span id="player-time-current" style="color:#fff;font-size:0.72rem;min-width:36px;font-variant-numeric:tabular-nums;">0:00</span>
          <input type="range" id="player-seek" min="0" max="100" value="0" step="0.1" style="flex:1;height:4px;cursor:pointer;accent-color:#7c6af7;" />
          <span id="player-time-duration" style="color:#fff;font-size:0.72rem;min-width:36px;font-variant-numeric:tabular-nums;">0:00</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <button id="player-playpause" style="${PLAYER_BTN_STYLE}">⏸</button>
          <button id="player-mute" style="${PLAYER_BTN_STYLE}">🔊</button>
          <input type="range" id="player-volume" min="0" max="1" value="1" step="0.05" style="width:70px;height:4px;cursor:pointer;accent-color:#3ecfcf;" />
          <div style="flex:1"></div>
          <button id="player-zoom" style="${PLAYER_ZOOM_BTN_STYLE}">🔍 Ajustar</button>
          <button id="player-fullscreen" style="${PLAYER_BTN_STYLE}">⛶</button>
        </div>
      </div>

      <style>
        @keyframes player-spin { to { transform: rotate(360deg); } }
        #player-seek, #player-volume { -webkit-appearance:none; appearance:none; background:rgba(255,255,255,0.25); border-radius:2px; outline:none; }
        #player-seek::-webkit-slider-thumb, #player-volume::-webkit-slider-thumb { -webkit-appearance:none; width:13px; height:13px; border-radius:50%; background:#fff; cursor:pointer; margin-top:-4.5px; }
        #player-back:hover, #player-playpause:hover, #player-mute:hover, #player-fullscreen:hover, #player-zoom:hover { background:rgba(255,255,255,0.22); }
      </style>
    `;
    document.body.appendChild(overlay);

    const backBtn      = document.getElementById('player-back');
    const playPauseBtn = document.getElementById('player-playpause');
    const muteBtn       = document.getElementById('player-mute');
    const volumeSlider  = document.getElementById('player-volume');
    const seekSlider     = document.getElementById('player-seek');
    const seekRow        = document.getElementById('player-seek-row');
    const fsBtn          = document.getElementById('player-fullscreen');
    const zoomBtn         = document.getElementById('player-zoom');
    const videoEl         = document.getElementById('hls-video');

    backBtn.onclick = closePlayer;

    const togglePlayPause = () => { videoEl.paused ? videoEl.play().catch(() => {}) : videoEl.pause(); };
    playPauseBtn.onclick = togglePlayPause;
    videoEl.addEventListener('click', togglePlayPause);
    videoEl.addEventListener('play',  () => { playPauseBtn.textContent = '⏸'; });
    videoEl.addEventListener('pause', () => { playPauseBtn.textContent = '▶'; });

    muteBtn.onclick = () => {
      videoEl.muted = !videoEl.muted;
      muteBtn.textContent = (videoEl.muted || videoEl.volume === 0) ? '🔇' : '🔊';
    };
    volumeSlider.oninput = () => {
      videoEl.volume = parseFloat(volumeSlider.value);
      videoEl.muted  = videoEl.volume === 0;
      muteBtn.textContent = videoEl.muted ? '🔇' : '🔊';
    };

    let _seeking = false;
    seekSlider.addEventListener('mousedown', () => { _seeking = true; });
    seekSlider.addEventListener('touchstart', () => { _seeking = true; }, { passive: true });
    seekSlider.addEventListener('input', () => {
      if (isFinite(videoEl.duration) && videoEl.duration > 0) {
        const t = (seekSlider.value / 100) * videoEl.duration;
        document.getElementById('player-time-current').textContent = formatPlayerTime(t);
      }
    });
    seekSlider.addEventListener('change', () => {
      // Solo hacer seek al soltar — no en cada tick del slider
      if (isFinite(videoEl.duration) && videoEl.duration > 0) {
        videoEl.currentTime = (seekSlider.value / 100) * videoEl.duration;
      }
      _seeking = false;
    });

    // timeupdate: actualizar UI solo si los controles son visibles Y no está seeking
    // Usar requestAnimationFrame para sincronizar con el ciclo de repintado
    let _rafPending = false;
    videoEl.addEventListener('timeupdate', () => {
      if (_seeking || !overlay.classList.contains('player-chrome-visible')) return;
      if (_rafPending) return;
      _rafPending = true;
      requestAnimationFrame(() => {
        _rafPending = false;
        if (isFinite(videoEl.duration) && videoEl.duration > 0 && !_seeking) {
          seekSlider.value = (videoEl.currentTime / videoEl.duration) * 100;
          document.getElementById('player-time-current').textContent = formatPlayerTime(videoEl.currentTime);
        }
      });
    });

    videoEl.addEventListener('loadedmetadata', () => {
      const isVOD = isFinite(videoEl.duration) && videoEl.duration > 0;
      seekRow.style.display = isVOD ? 'flex' : 'none';
      if (isVOD) document.getElementById('player-time-duration').textContent = formatPlayerTime(videoEl.duration);
      // "Continuar viendo": saltar a la posición guardada una sola vez
      if (isVOD && state._resumeAt > 0) {
        videoEl.currentTime = Math.min(state._resumeAt, Math.max(videoEl.duration - 5, 0));
        state._resumeAt = 0;
      }
    });

    // Guardar progreso cada 10s mientras se reproduce una película trackeada
    videoEl.addEventListener('timeupdate', () => {
      if (!state._trackMovie) return;
      if (!isFinite(videoEl.duration) || videoEl.duration <= 0) return;
      const now = Date.now();
      if (now - state._lastProgressSave < 10000) return;
      state._lastProgressSave = now;
      const url = (state._movieUrls && state._movieUrls[state._movieUrlIdx]) || state._trackMovie.url;
      saveProgressToServer(state._trackMovie.name, url, videoEl.currentTime, videoEl.duration);
      upsertLocalProgress(state._trackMovie.name, url, videoEl.currentTime, videoEl.duration);
    });

    fsBtn.onclick = () => {
      if (document.fullscreenElement || document.webkitFullscreenElement) exitPlayerFullscreen();
      else enterPlayerFullscreen(overlay);
    };

    // Ajuste de imagen (zoom): cicla Ajustar -> Rellenar -> Estirar -> Ajustar...
    // El texto en el botón deja claro el modo activo (no solo el ícono).
    let zoomIdx = 0;
    function applyZoomMode() {
      const mode = PLAYER_ZOOM_MODES[zoomIdx];
      videoEl.style.objectFit = mode.fit;
      zoomBtn.textContent = '🔍 ' + mode.label;
    }
    zoomBtn.onclick = () => {
      zoomIdx = (zoomIdx + 1) % PLAYER_ZOOM_MODES.length;
      applyZoomMode();
    };
    // Guardado en el overlay para poder resetear a "Ajustar" cada vez que
    // se abre un video nuevo (ver más abajo, fuera de este bloque).
    overlay._resetZoomMode = () => { zoomIdx = 0; applyZoomMode(); };

    // Auto-hide — solo reaccionar cuando el chrome está oculto para mostrar,
    // o cuando está visible para reiniciar el timer. Nunca en cada píxel.
    let hideTimer;
    let _lastMove = 0;
    function showChrome() {
      const now = Date.now();
      if (now - _lastMove < 300) return; // throttle real basado en tiempo
      _lastMove = now;
      overlay.classList.add('player-chrome-visible');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        overlay.classList.remove('player-chrome-visible');
      }, 3500);
    }
    overlay.addEventListener('pointermove', showChrome, { passive: true });
    overlay.addEventListener('click', showChrome, { passive: true });
    showChrome();

    // Keyboard inside player — el overlay necesita foco para recibir eventos
    overlay.setAttribute('tabindex', '-1');
    overlay.focus();
    document.removeEventListener('keydown', handleKey);
    // Usar document para capturar teclas en TV (el overlay puede perder foco)
    function playerKeyHandler(e) {
      showChrome();
      if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); closePlayer(); return; }
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); togglePlayPause(); }
      if (e.key === 'ArrowRight' && isFinite(videoEl.duration)) videoEl.currentTime = Math.min(videoEl.currentTime + 10, videoEl.duration);
      if (e.key === 'ArrowLeft'  && isFinite(videoEl.duration)) videoEl.currentTime = Math.max(videoEl.currentTime - 10, 0);
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        videoEl.volume = Math.min(videoEl.volume + 0.1, 1);
        videoEl.muted  = false;
        volumeSlider.value = videoEl.volume;
        muteBtn.textContent = videoEl.volume === 0 ? '🔇' : '🔊';
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        videoEl.volume = Math.max(videoEl.volume - 0.1, 0);
        videoEl.muted  = videoEl.volume === 0;
        volumeSlider.value = videoEl.volume;
        muteBtn.textContent = videoEl.muted ? '🔇' : '🔊';
      }
    }
    document.addEventListener('keydown', playerKeyHandler);
    // Guardar referencia para poder removerlo al cerrar
    overlay._keyHandler = playerKeyHandler;
  }

  document.getElementById('player-title').textContent  = title || '';
  document.getElementById('player-live-badge').style.display = isLive ? '' : 'none';
  document.getElementById('player-status').textContent = '';
  document.getElementById('player-seek-row').style.display = 'none'; // se muestra de nuevo en loadedmetadata si es VOD
  document.getElementById('player-playpause').textContent  = '⏸';
  document.getElementById('player-mute').textContent       = '🔊';
  document.getElementById('player-volume').value = 1;
  if (overlay._resetZoomMode) overlay._resetZoomMode(); // vuelve a "Ajustar" en cada video nuevo

  const video   = document.getElementById('hls-video');
  const loading = document.getElementById('player-loading');
  const status  = document.getElementById('player-status');

  video.volume = 1;
  video.muted  = false;

  video.addEventListener('playing', () => { loading.style.display = 'none'; }, { once: true });
  video.addEventListener('waiting', () => { loading.style.display = 'flex'; });
  video.addEventListener('canplay', () => { loading.style.display = 'none'; });

  // Fullscreen real del navegador (oculta la barra de direcciones del TV)
  enterPlayerFullscreen(overlay);

  // Detectar tipo de stream:
  //  - .m3u8  -> HLS.js / HLS nativo (Safari, smart TVs)
  //  - cualquier otra cosa (.mp4, .mkv, sin extensión, etc.) -> <video> nativo
  //    a través del proxy del servidor, para evitar el bloqueo CORS de
  //    servidores externos (object storage, archive.org, etc.)
  const isM3U8 = /\.m3u8(\?|#|$)/i.test(url);

  if (!isM3U8) {
    const proxied = `${API}/proxy-stream?url=${encodeURIComponent(url)}&token=${encodeURIComponent(getAuthTokenParam())}`;
    video.src = proxied;
    video.play().catch(() => showToast('⚠️ El navegador bloqueó el autoplay'));
    return;
  }

  // FIX AGRESIVO (jul 2026) — canales m3u8 rotos, 3 niveles de fallback,
  // cada uno ataca una causa distinta de por qué "en VLC anda y acá no":
  //
  //  Nivel 1 — URL directa (o proxy-m3u8 forzado si es http:// en página
  //            https://, mixed-content: el navegador lo bloquea sí o sí).
  //  Nivel 2 — proxy-m3u8: soluciona CORS del servidor de origen (server.js
  //            reescribe manifiesto + segmentos + URIs embebidas).
  //  Nivel 3 — /api/transcode: soluciona códec de video incompatible con el
  //            navegador (típico: HEVC/H.265 o MPEG-2 — VLC los decodifica
  //            sin problema, Chrome/HTML5 no; por eso se escucha audio pero
  //            no hay video). Reencodea en el servidor a H.264/AAC con
  //            ffmpeg y se reproduce como MP4 directo, sin HLS.js.
  //
  // Además: si un nivel tarda demasiado en arrancar (canal caído/timeout de
  // red) o si se detecta audio sonando sin video (buen indicio de códec
  // incompatible), se escala automáticamente al siguiente nivel en vez de
  // dejar al usuario esperando indefinidamente.
  // Excepción mdstrm (jul 2026): el CDN de mdstrm.com bloquea silenciosamente
  // el tráfico desde IPs de datacenter (confirmado: el VPS -Oracle Cloud- no
  // recibe ni siquiera un error, se cuelga; el navegador del usuario, con IP
  // residencial, sí llega bien). Para estos dominios NO conviene forzar el
  // proxy aunque sea http:// en página https:// -> se deja pasar directo
  // (nivel 1), confiando en que el usuario habilitó "contenido inseguro"
  // para este sitio en su navegador. Si no lo habilitó, el navegador lo
  // bloqueará por su cuenta (mismo resultado que forzar proxy y que el
  // proxy falle igual, pero sin gastar el VPS en el intento).
  const isMdstrm = /(^|\.)mdstrm\.com$/i.test((() => { try { return new URL(url).hostname; } catch { return ''; } })());
  const forceProxy = !isMdstrm && location.protocol === 'https:' && /^http:\/\//i.test(url);
  const proxiedM3U8   = `${API}/proxy-m3u8?url=${encodeURIComponent(url)}&token=${encodeURIComponent(getAuthTokenParam())}`;
  const transcodedUrl = `${API}/transcode?url=${encodeURIComponent(url)}&token=${encodeURIComponent(getAuthTokenParam())}`;
  let currentTier = forceProxy ? 2 : 1;

  // Token de sesión: stopHLS() (llamada al cerrar el player o al arrancar
  // OTRO playStream()) incrementa state._playerToken. Cualquier callback
  // async (timer de timeout, error de HLS.js) que dispare después de que
  // el usuario ya cambió de canal queda invalidado acá — sin esto, un
  // fallback tardío de un canal viejo podía pisar el video.src del canal
  // que el usuario eligió después ("sigue sonando en el fondo").
  const myToken = state._playerToken;

  function clearLoadGuards() {
    clearTimeout(state._playerLoadTimer);
    clearTimeout(state._playerCodecTimer);
  }

  function playerStillOpen() {
    return myToken === state._playerToken
      && document.body.contains(video)
      && !!document.getElementById('player-overlay');
  }

  function loadTranscoded() {
    if (!playerStillOpen()) return;
    clearLoadGuards();
    currentTier = 3;
    status.textContent = '🔄 Convirtiendo video…';
    video.src = transcodedUrl;
    video.play().catch(() => showToast('⚠️ El navegador bloqueó el autoplay'));
    state._playerLoadTimer = setTimeout(() => {
      if (playerStillOpen() && video.readyState < 2) {
        status.textContent = '⚠️ Este canal no está disponible';
        loading.style.display = 'none';
      }
    }, 15000);
    video.onerror = () => {
      if (!playerStillOpen()) return;
      status.textContent = '⚠️ Este canal no está disponible';
      loading.style.display = 'none';
    };
  }

  function loadHlsSource(src) {
    if (!playerStillOpen()) return;
    clearLoadGuards();
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
      });
      state.hlsInstance = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      let escalated = false;
      let recoverAttempted = false;
      const escalate = () => {
        if (escalated || !playerStillOpen()) return;
        escalated = true;
        clearLoadGuards();
        hls.destroy();
        if (currentTier === 1) { currentTier = 2; loadHlsSource(proxiedM3U8); }
        else loadTranscoded();
      };

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (!playerStillOpen()) return;
        video.play().catch(() => showToast('⚠️ El navegador bloqueó el autoplay'));
      });
      hls.on(Hls.Events.ERROR, (e, data) => {
        if (!data.fatal || !playerStillOpen()) return;
        // Muchos servidores IPTV caseros tienen cortes de red de un
        // segundo o discontinuidades de playlist que HLS.js marca como
        // "fatal" aunque son perfectamente recuperables in-place sin
        // cambiar de URL ni de nivel. Se intenta UNA vez la recuperación
        // nativa antes de tirar todo y escalar — evita terminar en
        // transcodificación por un hipo de red que se hubiera arreglado solo.
        if (!recoverAttempted) {
          recoverAttempted = true;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
        }
        escalate();
      });

      // Canal caído / red lenta: no llegó a reproducir en un tiempo razonable
      state._playerLoadTimer = setTimeout(() => {
        if (playerStillOpen() && video.readyState < 2) escalate();
      }, 9000);

      // Audio sonando pero sin video -> indicio fuerte de códec de video
      // incompatible (VLC lo abre porque decodifica más códecs que el navegador)
      video.addEventListener('playing', function onPlaying() {
        video.removeEventListener('playing', onPlaying);
        state._playerCodecTimer = setTimeout(() => {
          if (playerStillOpen() && !escalated && !video.paused && video.currentTime > 0 && video.videoWidth === 0) {
            escalate();
          }
        }, 4000);
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari, smart TVs)
      video.src = src;
      video.play().catch(() => {});
    } else {
      // Fallback: direct src
      video.src = src;
      video.play().catch(() => {});
    }
  }

  loadHlsSource(currentTier === 2 ? proxiedM3U8 : url);
}

/* ══════════════════════════════════════════════════════════════
   LIVE TV SCREEN  (Smarters-style: categories left, list right)
   ══════════════════════════════════════════════════════════════ */
function openLiveTV() {
  state._currentApp = 'livetv';
  navigateTo('app', 'Live TV', () => {
    const title = document.getElementById('app-screen-title');
    const body  = document.getElementById('app-screen-body');
    const back  = document.getElementById('app-back');
    title.textContent = 'Live TV';
    back.onclick = () => { stopLivePreview(); navigateTo('home', 'Inicio'); };

    const channels = state.livetv;

    if (!channels.length) {
      body.style.cssText = '';
      body.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--text-muted);">
          <div style="font-size:3rem;margin-bottom:16px;">📡</div>
          <div style="font-size:1rem;margin-bottom:8px;">Sin canales configurados</div>
          <div style="font-size:0.8rem;">Agrega canales desde el <a href="/admin.html" style="color:var(--accent)">panel admin</a></div>
        </div>`;
      return;
    }

    // Get unique categories
    const cats = ['Todos', ...new Set(channels.map(c => c.cat || 'General'))];
    let activeCat = cats[0];
    let tvPane    = 'list'; // 'cats' | 'list'
    let tvCatIdx  = 0;
    let tvChanIdx = 0;
    let previewHls = null;
    let previewedUrl = null;
    let previewPlaying = false;

    body.style.cssText = 'padding:0;align-items:stretch;flex-direction:row;gap:0;overflow:hidden;';
    body.innerHTML = `
      <div id="tv-cats" style="
        width:200px;flex-shrink:0;
        background:rgba(0,0,0,0.3);
        border-right:1px solid rgba(255,255,255,0.06);
        overflow-y:auto;padding:8px 0;
      ">
        ${cats.map(c => `
          <div class="tv-cat-item ${c === activeCat ? 'tv-cat-active' : ''}"
               data-cat="${c}"
               style="
                 padding:12px 18px;cursor:pointer;font-size:0.82rem;
                 color:${c === activeCat ? '#a89dff' : 'var(--text-muted)'};
                 background:${c === activeCat ? 'rgba(124,106,247,0.15)' : 'transparent'};
                 border-left:3px solid ${c === activeCat ? 'var(--accent)' : 'transparent'};
                 transition:0.15s;display:flex;justify-content:space-between;align-items:center;
               ">
            <span>${c}</span>
            <span style="font-size:0.7rem;opacity:0.5;">${c === 'Todos' ? channels.length : channels.filter(ch=>(ch.cat||'General')===c).length}</span>
          </div>`).join('')}
      </div>
      <div id="tv-list" style="width:340px;flex-shrink:0;overflow-y:auto;padding:8px 0;border-right:1px solid rgba(255,255,255,0.06);"></div>
      <div id="livetv-preview" style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px;">
        <div id="livetv-preview-stage" style="
          position:relative;width:100%;max-width:480px;aspect-ratio:16/9;
          border-radius:14px;background:#0a0a14;overflow:hidden;
          display:flex;align-items:center;justify-content:center;
          border:1px solid rgba(255,255,255,0.08);
        ">
          <video id="livetv-preview-video" muted playsinline style="width:100%;height:100%;object-fit:contain;display:none;"></video>
          <div id="livetv-preview-fallback" style="display:flex;align-items:center;justify-content:center;">
            <div id="livetv-preview-logo-wrap" style="
              width:72px;height:72px;border-radius:16px;
              background:rgba(255,255,255,0.06);
              display:flex;align-items:center;justify-content:center;
              font-size:2.2rem;overflow:hidden;
            "></div>
          </div>
          <div id="livetv-preview-loading" style="
            position:absolute;inset:0;display:none;align-items:center;justify-content:center;
            background:rgba(0,0,0,0.45);
          ">
            <div style="
              width:30px;height:30px;border-radius:50%;
              border:3px solid rgba(255,255,255,0.15);border-top-color:#3ecfcf;
              animation:player-spin 0.9s linear infinite;
            "></div>
          </div>
          <div id="livetv-preview-controls" style="
            position:absolute;left:0;right:0;bottom:0;display:none;
            align-items:center;gap:10px;padding:8px 12px;
            background:linear-gradient(to top,rgba(0,0,0,0.75),transparent);
          ">
            <button type="button" id="livetv-preview-mute" style="
              background:none;border:none;color:#fff;font-size:1rem;
              cursor:pointer;padding:2px 4px;line-height:1;flex-shrink:0;
            ">🔊</button>
            <input type="range" id="livetv-preview-volume" min="0" max="1" step="0.05" value="1" style="
              flex:1;accent-color:#3ecfcf;height:4px;cursor:pointer;
            " />
            <span style="
              font-size:0.65rem;color:rgba(255,255,255,0.6);
              background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;flex-shrink:0;
            ">● EN VIVO</span>
          </div>
        </div>
        <div id="livetv-preview-name" style="
          font-size:0.95rem;font-weight:600;color:var(--text-primary);
          text-align:center;max-width:90%;overflow:hidden;
          text-overflow:ellipsis;white-space:nowrap;
        "></div>
        <div id="livetv-preview-hint" style="font-size:0.72rem;color:var(--text-muted);">⏎ Enter para reproducir</div>
      </div>
    `;

    function renderChannelList(cat) {
      const list = document.getElementById('tv-list');
      const filtered = cat === 'Todos' ? channels : channels.filter(c => (c.cat || 'General') === cat);
      list.innerHTML = filtered.map((ch, i) => `
        <div class="tv-channel-row" data-index="${i}" data-url="${ch.url}" data-name="${ch.name}" data-logo="${ch.logo || ''}" data-emoji="${ch.emoji || '📡'}" style="
          display:flex;align-items:center;gap:14px;
          padding:11px 18px;cursor:pointer;
          border-bottom:1px solid rgba(255,255,255,0.04);
          transition:0.15s;
          content-visibility:auto;contain-intrinsic-size:340px 70px;
        ">
          <div style="
            width:44px;height:44px;border-radius:10px;
            background:rgba(255,255,255,0.06);
            display:flex;align-items:center;justify-content:center;
            font-size:1.4rem;flex-shrink:0;overflow:hidden;
          ">${ch.logo
            ? `<img src="${ch.logo}" alt="" loading="lazy" decoding="async" data-fallback="${ch.emoji || '📡'}" onerror="handleImgError(this)" style="width:100%;height:100%;object-fit:contain;background:#0a0a14;" />`
            : (ch.emoji || '📡')}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.88rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ch.name}</div>
            <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${ch.cat || 'General'}</div>
          </div>
          <div style="
            width:8px;height:8px;border-radius:50%;flex-shrink:0;
            background:${ch.url ? '#22c55e' : '#5a5a78'};
          "></div>
        </div>
      `).join('') || '<div style="padding:24px;color:var(--text-muted);font-size:0.8rem;">Sin canales en esta categoría</div>';

      list.querySelectorAll('.tv-channel-row').forEach(row => {
        row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.05)');
        row.addEventListener('mouseleave', () => row.style.background = 'transparent');

        // Click único = vista previa (mismo comportamiento que Enter 1° con
        // el control remoto). Doble click = pantalla completa (Enter 2°).
        // Antes el click simple llamaba a playStream() directo y se
        // saltaba la vista previa por completo — de ahí el reclamo de
        // "un clic y me manda a fullscreen".
        let clickTimer = null;
        row.addEventListener('click', () => {
          if (!row.dataset.url) { showToast('⚠️ Canal sin URL configurada'); return; }
          clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
            focusChan(parseInt(row.dataset.index, 10));
            startPreviewForFocused();
          }, 220);
        });
        row.addEventListener('dblclick', () => {
          if (!row.dataset.url) return;
          clearTimeout(clickTimer);
          focusChan(parseInt(row.dataset.index, 10));
          expandPreviewToFullscreen();
        });
      });
    }

    // Category click handlers
    document.querySelectorAll('.tv-cat-item').forEach(el => {
      el.addEventListener('click', () => {
        activeCat = el.dataset.cat;
        document.querySelectorAll('.tv-cat-item').forEach(c => {
          const active = c.dataset.cat === activeCat;
          c.style.color      = active ? '#a89dff' : 'var(--text-muted)';
          c.style.background = active ? 'rgba(124,106,247,0.15)' : 'transparent';
          c.style.borderLeft = `3px solid ${active ? 'var(--accent)' : 'transparent'}`;
        });
        renderChannelList(activeCat);
        tvChanIdx = 0;
        focusChan(0);
      });
    });

    renderChannelList(activeCat);

    // Controles de la vista previa (mute + volumen) — se atan una sola vez,
    // los elementos ya existen en el DOM desde el innerHTML de arriba.
    const previewVideoEl = document.getElementById('livetv-preview-video');
    const previewMuteBtn = document.getElementById('livetv-preview-mute');
    const previewVolume  = document.getElementById('livetv-preview-volume');
    if (previewMuteBtn && previewVideoEl) {
      previewMuteBtn.addEventListener('click', () => {
        previewVideoEl.muted = !previewVideoEl.muted;
        if (!previewVideoEl.muted && previewVideoEl.volume === 0) {
          previewVideoEl.volume = 1;
          if (previewVolume) previewVolume.value = 1;
        }
        previewMuteBtn.textContent = (previewVideoEl.muted || previewVideoEl.volume === 0) ? '🔇' : '🔊';
      });
    }
    if (previewVolume && previewVideoEl) {
      previewVolume.addEventListener('input', () => {
        previewVideoEl.volume = parseFloat(previewVolume.value);
        previewVideoEl.muted  = previewVideoEl.volume === 0;
        if (previewMuteBtn) previewMuteBtn.textContent = previewVideoEl.muted ? '🔇' : '🔊';
      });
    }

    /* Navegación con control remoto: ←→ cambia de panel, ↑↓ recorre la lista activa */
    /* Vista previa de Live TV — modelo explícito:
       Enter (1°) -> reproduce en la vista previa chica, sin pantalla completa
       Enter (2°, mismo canal ya en preview) -> pasa a pantalla completa
       Atrás/Escape dentro del reproductor -> vuelve a esta pantalla con la
       vista previa retomando el mismo canal (ver playStream(...,onClose)) */
    function stopLivePreviewVideo() {
      if (previewHls) { previewHls.destroy(); previewHls = null; }
      const v = document.getElementById('livetv-preview-video');
      const fallback = document.getElementById('livetv-preview-fallback');
      const loading = document.getElementById('livetv-preview-loading');
      const controls = document.getElementById('livetv-preview-controls');
      if (v) { v.pause(); v.removeAttribute('src'); v.onerror = null; v.load(); v.style.display = 'none'; }
      if (fallback) fallback.style.display = 'flex';
      if (loading)  loading.style.display = 'none';
      if (controls) controls.style.display = 'none';
    }
    function stopLivePreview() {
      stopLivePreviewVideo();
      previewedUrl = null;
      previewPlaying = false;
    }
    function startLivePreviewVideo(url) {
      const v        = document.getElementById('livetv-preview-video');
      const fallback = document.getElementById('livetv-preview-fallback');
      const loading  = document.getElementById('livetv-preview-loading');
      const controls = document.getElementById('livetv-preview-controls');
      if (!v || !url) return;
      const isM3U8 = /\.m3u8(\?|#|$)/i.test(url);
      v.volume = 1;
      v.muted  = false; // acción explícita del usuario (Enter) -> con audio
      const syncMuteIcon = () => {
        const btn = document.getElementById('livetv-preview-mute');
        if (btn) btn.textContent = (v.muted || v.volume === 0) ? '🔇' : '🔊';
      };
      if (loading) loading.style.display = 'flex';
      const reveal = () => {
        v.style.display = 'block';
        if (fallback) fallback.style.display = 'none';
        if (loading)  loading.style.display = 'none';
        if (controls) controls.style.display = 'flex';
        syncMuteIcon();
      };
      const attemptPlay = () => v.play().then(reveal).catch(() => {
        // el navegador bloqueó autoplay con audio -> reintentar silenciado
        v.muted = true;
        v.play().then(reveal).catch(() => failPreview());
      });
      const failPreview = () => {
        if (loading) loading.style.display = 'none';
        if (controls) controls.style.display = 'none';
        previewPlaying = false;
        updatePreviewHint();
        showToast('⚠️ No se pudo cargar la vista previa de este canal');
      };

      if (!isM3U8) {
        // mp4/audio/sin extensión -> proxy (evita CORS), igual que el reproductor principal
        const proxied = `${API}/proxy-stream?url=${encodeURIComponent(url)}&token=${encodeURIComponent(getAuthTokenParam())}`;
        v.src = proxied;
        v.onerror = failPreview;
        attemptPlay();
        return;
      }

      // FIX AGRESIVO (jul 2026): antes se usaba SIEMPRE la URL directa acá
      // porque una versión vieja del proxy rompía las rutas de los .ts
      // (no reescribía URIs embebidas en tags como EXT-X-MAP/EXT-X-KEY).
      // Ya está corregido en server.js. Mismo criterio que el reproductor
      // principal: forzar proxy si es http:// (mixed-content, bloqueo
      // seguro del navegador) y reintentar por proxy una vez si falla.
      // Excepción mdstrm (jul 2026): ver nota igual en playStream() -> el
      // CDN de mdstrm bloquea IPs de datacenter del VPS, así que para estos
      // dominios se deja pasar directo (nivel 1) en vez de forzar proxy.
      const isMdstrm = /(^|\.)mdstrm\.com$/i.test((() => { try { return new URL(url).hostname; } catch { return ''; } })());
      const forceProxy = !isMdstrm && location.protocol === 'https:' && /^http:\/\//i.test(url);
      const proxiedM3U8   = `${API}/proxy-m3u8?url=${encodeURIComponent(url)}&token=${encodeURIComponent(getAuthTokenParam())}`;
      const transcodedUrl = `${API}/transcode?url=${encodeURIComponent(url)}&token=${encodeURIComponent(getAuthTokenParam())}`;
      let usedProxyFallback = forceProxy;

      // Nivel 3 (jul 2026): mismo criterio que playStream() -> si ya se
      // intentó proxy y sigue fallando, es señal de códec incompatible
      // (no de CORS/mixed-content), así que se re-encodea con /api/transcode
      // y se reproduce como MP4 directo, sin HLS.js.
      function loadPreviewTranscoded() {
        if (previewHls) { previewHls.destroy(); previewHls = null; }
        v.src = transcodedUrl;
        v.onerror = failPreview;
        attemptPlay();
      }

      function loadPreviewHls(src) {
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
          hls.loadSource(src);
          hls.attachMedia(v);
          hls.on(Hls.Events.MANIFEST_PARSED, attemptPlay);
          hls.on(Hls.Events.ERROR, (e, data) => {
            if (!data.fatal) return;
            if (!usedProxyFallback) {
              usedProxyFallback = true;
              hls.destroy();
              loadPreviewHls(proxiedM3U8);
              return;
            }
            hls.destroy();
            loadPreviewTranscoded();
          });
          previewHls = hls;
        } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
          v.src = src;
          v.onerror = failPreview;
          attemptPlay();
        } else {
          failPreview();
        }
      }

      loadPreviewHls(forceProxy ? proxiedM3U8 : url);
    }
    function updatePreviewHint() {
      const hint = document.getElementById('livetv-preview-hint');
      if (hint) hint.textContent = previewPlaying
        ? '⏎ Enter para pantalla completa  ·  Atrás para volver aquí'
        : '⏎ Enter para reproducir';
    }
    /* Solo actualiza logo/nombre — NO reproduce nada. Se llama en cada
       cambio de foco (mover el control no debe arrancar streams solo). */
    function setPreviewIdle(ch) {
      stopLivePreviewVideo();
      previewPlaying = false;
      previewedUrl = ch && ch.url ? ch.url : null;

      const nameEl   = document.getElementById('livetv-preview-name');
      const logoWrap = document.getElementById('livetv-preview-logo-wrap');
      if (nameEl) nameEl.textContent = ch ? (ch.name || '') : '';
      if (logoWrap) {
        logoWrap.innerHTML = !ch ? '' : (ch.logo
          ? `<img src="${ch.logo}" alt="" loading="lazy" decoding="async" data-fallback="${ch.emoji || '📡'}" onerror="handleImgError(this)" style="width:100%;height:100%;object-fit:contain;" />`
          : `<span>${ch.emoji || '📡'}</span>`);
      }
      updatePreviewHint();
    }
    /* Enter (1°): arranca el video en la vista previa chica del canal enfocado */
    function startPreviewForFocused() {
      const row = getChanEls()[tvChanIdx];
      if (!row) return;
      const url = row.dataset.url;
      if (!url) { showToast('⚠️ Canal sin URL configurada'); return; }
      previewedUrl = url;
      previewPlaying = true;
      updatePreviewHint();
      startLivePreviewVideo(url);
    }
    /* Enter (2°): el canal ya está en preview -> pasa a pantalla completa.
       Al volver (Atrás/Escape del reproductor), retoma la vista previa. */
    function expandPreviewToFullscreen() {
      const row = getChanEls()[tvChanIdx];
      if (!row) return;
      const url = row.dataset.url, name = row.dataset.name;
      stopLivePreviewVideo(); // libera el video chico, pero NO borra previewedUrl/previewPlaying
      state._trackMovie = null;
      playStream(url, name, () => {
        if (previewedUrl === url) { startLivePreviewVideo(url); updatePreviewHint(); }
      }, true);
    }

    const getCatEls  = () => [...document.querySelectorAll('.tv-cat-item')];
    const getChanEls = () => [...document.querySelectorAll('.tv-channel-row')];
    function focusCat(i) {
      const els = getCatEls();
      if (!els.length) return;
      tvCatIdx = Math.max(0, Math.min(i, els.length - 1));
      els.forEach((el, j) => setRemoteFocus(el, tvPane === 'cats' && j === tvCatIdx));
      els[tvCatIdx].scrollIntoView({ block: 'nearest' });
    }
    function focusChan(i) {
      const els = getChanEls();
      if (!els.length) { setPreviewIdle(null); return; }
      tvChanIdx = Math.max(0, Math.min(i, els.length - 1));
      els.forEach((el, j) => setRemoteFocus(el, tvPane === 'list' && j === tvChanIdx));
      const row = els[tvChanIdx];
      row?.scrollIntoView({ block: 'nearest' });
      if (row) setPreviewIdle({ url: row.dataset.url, name: row.dataset.name, logo: row.dataset.logo, emoji: row.dataset.emoji });
    }
    state.appNavHandler = (key) => {
      // Escape/Backspace: foco al botón Atrás y volver al home
      if (key === 'Escape' || key === 'Backspace') {
        playSnd('nav');
        stopLivePreview();
        stopAll();
        navigateTo('home', 'Inicio');
        return true; // indica que lo manejamos
      }

      // CH+ / CH- durante reproducción (canales: PageUp/PageDown o MediaTrackNext)
      if (key === 'ChannelUp' || key === 'PageUp') {
        const chans = getChanEls();
        if (chans.length) { focusChan(tvChanIdx - 1); var _ce1 = getChanEls()[tvChanIdx]; if (_ce1) _ce1.click(); }
        return true;
      }
      if (key === 'ChannelDown' || key === 'PageDown') {
        const chans = getChanEls();
        if (chans.length) { focusChan(tvChanIdx + 1); var _ce2 = getChanEls()[tvChanIdx]; if (_ce2) _ce2.click(); }
        return true;
      }

      if (key === 'Enter') {
        playSnd('enter');
        if (tvPane === 'back') {
          back.click();
        } else if (tvPane === 'cats') {
          var _cate = getCatEls()[tvCatIdx];
          if (_cate) _cate.click();
          tvChanIdx = 0;
          focusChan(0);
        } else if (previewPlaying) {
          expandPreviewToFullscreen();
        } else {
          startPreviewForFocused();
        }
        return true;
      }
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)) return false;
      playSnd('nav');
      if (tvPane === 'back') {
        if (key === 'ArrowDown') { tvPane = 'cats'; focusAppBack(false); focusCat(tvCatIdx); }
      } else if (tvPane === 'cats') {
        if (key === 'ArrowUp') {
          if (tvCatIdx > 0) focusCat(tvCatIdx - 1);
          else { tvPane = 'back'; focusCat(tvCatIdx); focusAppBack(true); }
        }
        if (key === 'ArrowDown')  focusCat(tvCatIdx + 1);
        if (key === 'ArrowRight') { tvPane = 'list'; focusChan(tvChanIdx); focusCat(tvCatIdx); }
      } else {
        if (key === 'ArrowUp')   { tvChanIdx > 0 ? focusChan(tvChanIdx - 1) : (()=>{ tvPane='cats'; focusCat(tvCatIdx); })(); }
        if (key === 'ArrowDown') focusChan(tvChanIdx + 1);
        if (key === 'ArrowLeft') { tvPane = 'cats'; focusCat(tvCatIdx); focusChan(tvChanIdx); }
      }
      return true;
    };
    focusChan(0);
  });
}

/* ══════════════════════════════════════════════════════════════
   MOVIES SCREEN  (VOD grid)
   ══════════════════════════════════════════════════════════════ */
function openMovies() {
  state._currentApp = 'movies';
  navigateTo('app', 'Películas', () => {
    const title = document.getElementById('app-screen-title');
    const body  = document.getElementById('app-screen-body');
    const back  = document.getElementById('app-back');
    title.textContent = 'Películas';
    back.onclick = () => navigateTo('home', 'Inicio');

    const movies = state.movies;

    if (!movies.length) {
      body.style.cssText = '';
      body.innerHTML = `
        <div style="text-align:center;padding:40px;color:var(--text-muted);">
          <div style="font-size:3rem;margin-bottom:16px;">🎬</div>
          <div style="font-size:1rem;margin-bottom:8px;">Sin películas configuradas</div>
          <div style="font-size:0.8rem;">Agrega contenido VOD desde el <a href="/admin.html" style="color:var(--accent)">panel admin</a></div>
        </div>`;
      return;
    }

    if (state.theme === 'netflix') { renderMoviesNetflix(body, back, movies); return; }

    body.style.cssText = 'align-items:flex-start;padding:12px 0;';
    body.innerHTML = `
      <div id="movies-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;width:100%;padding:4px;">
        ${movies.map((m, i) => `
          <div class="movie-card" data-index="${i}" data-url="${m.url}" data-name="${m.name}" style="
            background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
            border-radius:12px;overflow:hidden;cursor:pointer;transition:0.2s;
            content-visibility:auto;contain-intrinsic-size:160px 170px;
          ">
            <div style="
              height:100px;background:rgba(255,255,255,0.05);
              display:flex;align-items:center;justify-content:center;font-size:2.5rem;
              overflow:hidden;
            ">${m.poster
              ? `<img src="${m.poster}" alt="" loading="lazy" decoding="async" data-fallback="${m.emoji || '🎬'}" onerror="handleImgError(this)" style="width:100%;height:100%;object-fit:cover;" />`
              : (m.emoji || '🎬')}</div>
            <div style="padding:10px 12px;">
              <div style="font-size:0.82rem;font-weight:600;color:var(--text-primary);margin-bottom:3px;
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.name}</div>
              <div style="font-size:0.7rem;color:var(--text-muted);">${m.cat || 'Película'}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    body.querySelectorAll('.movie-card').forEach(card => {
      card.addEventListener('mouseenter', () => { card.style.transform='translateY(-3px)'; card.style.borderColor='rgba(124,106,247,0.4)'; });
      card.addEventListener('mouseleave', () => { card.style.transform=''; card.style.borderColor='rgba(255,255,255,0.07)'; });
      card.addEventListener('click', () => {
        const idx  = parseInt(card.dataset.index);
        const m    = state.movies[idx];
        if (!m) return;
        const urls = (m.urls && m.urls.length) ? m.urls : [m.url];
        if (!urls[0]) { showToast('⚠️ Sin URL configurada'); return; }
        playMovieWithFallback(urls, m.name || '');
      });
    });

    /* Navegación con control remoto: columnas reales calculadas del grid renderizado */
    let _movIdx = 0;
    const getMovieCards = () => [...body.querySelectorAll('.movie-card')];
    const getMovieCols  = () => {
      const grid = document.getElementById('movies-grid');
      if (!grid) return 1;
      return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
    };
    function focusMovie(i) {
      const cards = getMovieCards();
      if (!cards.length) return;
      _movIdx = Math.max(0, Math.min(i, cards.length - 1));
      cards.forEach((c, j) => setRemoteFocus(c, j === _movIdx));
      cards[_movIdx].scrollIntoView({ block: 'nearest' });
    }
    let atBack = false;
    state.appNavHandler = (key) => {
      const cards = getMovieCards();
      if (!cards.length) return;
      if (key === 'Enter') {
        playSnd('enter');
        if (atBack) back.click(); else { var _c1 = cards[_movIdx]; if (_c1) _c1.click(); }
        return true;
      }
      if (!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(key)) return false;
      playSnd('nav');
      const cols = getMovieCols();
      if (atBack) {
        if (key === 'ArrowDown') { atBack = false; focusAppBack(false); focusMovie(_movIdx); }
        return true;
      }
      if (key === 'ArrowRight') focusMovie(_movIdx + 1);
      if (key === 'ArrowLeft')  focusMovie(_movIdx - 1);
      if (key === 'ArrowDown')  focusMovie(_movIdx + cols);
      if (key === 'ArrowUp') {
        if (_movIdx - cols >= 0) focusMovie(_movIdx - cols);
        else { atBack = true; cards.forEach(c => setRemoteFocus(c, false)); focusAppBack(true); }
      }
      return true;
    };
    focusMovie(0);
  });
}

/* ══════════════════════════════════════════════════════════════
   TEMA NETFLIX — Películas en filas horizontales por categoría
   ══════════════════════════════════════════════════════════════ */
function renderMoviesNetflix(body, back, movies) {
  body.style.cssText = 'align-items:flex-start;justify-content:flex-start;padding:18px 0;overflow-y:auto;';

  // Filas por género TMDB + "Mejor valoradas" + "Sin clasificar"
  const RATING_MIN = 7.5;
  const GENRE_MIN  = 3;
  const ACCENTS = ['#f5c518','#e55353','#7c6af7','#3da9fc','#38b48b','#f59e0b','#ec4899','#64b5f6'];

  const topRated = movies
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => parseFloat(m.rating) >= RATING_MIN)
    .sort((a, b) => parseFloat(b.m.rating) - parseFloat(a.m.rating));

  const genreMap = new Map();
  movies.forEach((m, i) => {
    if (!m.genre) return;
    m.genre.split(',').map(g => g.trim()).filter(Boolean).forEach(g => {
      if (!genreMap.has(g)) genreMap.set(g, []);
      genreMap.get(g).push({ m, i });
    });
  });
  genreMap.forEach((items, g) => { if (items.length < GENRE_MIN) genreMap.delete(g); });

  const unclassified = movies
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !m.genre && !m.tmdbConfirmed);

  // "Continuar viendo" — mapea el progreso guardado a índices dentro de `movies`
  const continueItems = (state.progress || [])
    .map(p => {
      const i = movies.findIndex(m => (m.name || m.title) === p.movieName);
      return i >= 0 ? { m: movies[i], i, p } : null;
    })
    .filter(Boolean)
    .slice(0, 10);

  // "Nuevo en MythOS TV" — películas con sello addedAt (admin.html), más recientes primero.
  // NEW_ROW_LIMIT tarjetas visibles en la fila; si hay más, se agrega una tarjeta "Ver más"
  // que abre openNewMoviesView() con el listado completo (sin sacar el contenido del resto
  // de Películas: sigue apareciendo también en su fila de género/valoración normal).
  const NEW_ROW_LIMIT = 10;
  const newItemsAll = movies
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !!m.addedAt)
    .sort((a, b) => b.m.addedAt - a.m.addedAt);
  const newItemsRow = newItemsAll.slice(0, NEW_ROW_LIMIT);

  function buildNewRow(rIdx) {
    if (!newItemsRow.length) return '';
    const hasMore = newItemsAll.length > NEW_ROW_LIMIT;
    return `
      <div class="nf-row" data-row="${rIdx}">
        <div class="nf-row-title">
          <span class="nf-row-accent" style="background:#22c55e"></span>Nuevo en MythOS TV
        </div>
        <div class="nf-row-track-wrap">
          <button type="button" class="nf-row-arrow nf-arrow-left nf-arrow-hidden" aria-label="Anterior">&#8249;</button>
          <div class="nf-row-track" data-row="${rIdx}">
            ${newItemsRow.map(({ m, i }) => `
              <div class="nf-card" tabindex="-1" data-index="${i}">
                ${m.poster
                  ? `<img class="nf-card-poster" src="${m.poster}" alt="" loading="lazy" decoding="async" data-fallback="${m.emoji || '🎬'}" onerror="handleImgError(this)" />`
                  : `<div class="nf-card-fallback">${m.emoji || '🎬'}</div>`}
                <div class="nf-card-title">${m.name || m.title || ''}</div>
              </div>
            `).join('')}
            ${hasMore ? `
              <div class="nf-card" tabindex="-1" data-more="new" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(255,255,255,0.03);border:1px dashed rgba(255,255,255,0.25);border-radius:8px;">
                <div style="font-size:1.8rem;opacity:0.85;">➕</div>
                <div style="font-size:0.8rem;font-weight:600;color:var(--text-primary);">Ver más</div>
              </div>` : ''}
          </div>
          <button type="button" class="nf-row-arrow nf-arrow-right nf-arrow-hidden" aria-label="Siguiente">&#8250;</button>
        </div>
      </div>`;
  }

  function buildRow(label, items, accentColor, rIdx) {
    if (!items.length) return '';
    return `
      <div class="nf-row" data-row="${rIdx}">
        <div class="nf-row-title">
          <span class="nf-row-accent" style="background:${accentColor}"></span>${label}
        </div>
        <div class="nf-row-track-wrap">
          <button type="button" class="nf-row-arrow nf-arrow-left nf-arrow-hidden" aria-label="Anterior">&#8249;</button>
          <div class="nf-row-track" data-row="${rIdx}">
            ${items.map(({ m, i }) => `
              <div class="nf-card" tabindex="-1" data-index="${i}">
                ${m.poster
                  ? `<img class="nf-card-poster" src="${m.poster}" alt="" loading="lazy" decoding="async" data-fallback="${m.emoji || '🎬'}" onerror="handleImgError(this)" />`
                  : `<div class="nf-card-fallback">${m.emoji || '🎬'}</div>`}
                <div class="nf-card-title">${m.name || m.title || ''}</div>
              </div>
            `).join('')}
          </div>
          <button type="button" class="nf-row-arrow nf-arrow-right nf-arrow-hidden" aria-label="Siguiente">&#8250;</button>
        </div>
      </div>`;
  }

  function buildContinueRow(rIdx) {
    if (!continueItems.length) return '';
    // .nf-card: mantiene el foco/navegación remota y el clic ya cableados
    // más abajo (mismo selector que el resto de filas). .cw-card: tarjeta
    // panorámica compartida con la fila "Continuar viendo" del Home.
    return `
      <div class="nf-row" data-row="${rIdx}">
        <div class="nf-row-title">
          <span class="nf-row-accent" style="background:#ffffff"></span>Continuar viendo
        </div>
        <div class="nf-row-track-wrap">
          <button type="button" class="nf-row-arrow nf-arrow-left nf-arrow-hidden" aria-label="Anterior">&#8249;</button>
          <div class="nf-row-track" data-row="${rIdx}">
            ${continueItems.map(({ m, i, p }, idx) => {
              const pct = p.duration > 0 ? Math.min(100, Math.round((p.position / p.duration) * 100)) : 0;
              const accent = CW_ACCENTS[idx % CW_ACCENTS.length];
              const frameHtml = m.poster
                ? `<img src="${m.poster}" alt="" loading="lazy" decoding="async" data-fallback="${m.emoji || '🎬'}" onerror="handleImgError(this)" />`
                : `<div class="cw-frame-fallback">${m.emoji || '🎬'}</div>`;
              return `
                <div class="nf-card cw-card" tabindex="-1" data-index="${i}">
                  <div class="cw-frame" style="--cw-accent:${accent}">
                    ${frameHtml}
                    <div class="cw-scrim"></div>
                    <div class="cw-play"><svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><polygon points="5,3 19,12 5,21"/></svg></div>
                    <div class="cw-title">${m.name || m.title || ''}</div>
                    <div class="cw-progress"><div class="cw-progress-fill" style="width:${pct}%"></div></div>
                  </div>
                </div>`;
            }).join('')}
          </div>
          <button type="button" class="nf-row-arrow nf-arrow-right nf-arrow-hidden" aria-label="Siguiente">&#8250;</button>
        </div>
      </div>`;
  }

  let rIdx = 0;
  const rowsHtml = [];
  if (continueItems.length) rowsHtml.push(buildContinueRow(rIdx++));
  if (newItemsRow.length) rowsHtml.push(buildNewRow(rIdx++));
  if (topRated.length) rowsHtml.push(buildRow('Mejor valoradas', topRated, ACCENTS[0], rIdx++));
  [...genreMap.entries()].forEach(([genre, items], gi) => {
    rowsHtml.push(buildRow(genre, items, ACCENTS[1 + (gi % (ACCENTS.length - 1))], rIdx++));
  });
  if (unclassified.length) rowsHtml.push(buildRow('Sin clasificar', unclassified, '#555', rIdx++));

  body.innerHTML = `<div id="nf-movies-rows" class="nf-rows" style="padding-top:8px">${rowsHtml.join('')}</div>`;

  body.querySelectorAll('.nf-card').forEach(card => {
    if (card.dataset.more === 'new') {
      card.addEventListener('click', () => openNewMoviesView(newItemsAll.map(x => x.m)));
      card.addEventListener('mouseenter', () => { card.classList.add('focused'); });
      card.addEventListener('mouseleave', () => { card.classList.remove('focused'); });
      return;
    }
    card.addEventListener('click', () => {
      const m = movies[parseInt(card.dataset.index)];
      if (m) openDetailModal('movie', m);
    });
    card.addEventListener('mouseenter', () => { card.classList.add('focused'); });
    card.addEventListener('mouseleave', () => { card.classList.remove('focused'); });
  });

  /* Flechas de navegación por mouse en cada fila: aparecen al hover
     (ver CSS .nf-row-track-wrap:hover .nf-row-arrow), se ocultan según
     posición de scroll (izquierda al inicio, derecha al final). */
  body.querySelectorAll('.nf-row-track-wrap').forEach(wireRowArrows);

  /* Navegación remoto: Arriba/Abajo = fila, Izq/Der = dentro de la fila.
     Virtualización simple: solo se hace scrollIntoView de la tarjeta
     enfocada; el navegador ya no pinta lo que está fuera del viewport
     gracias a content-visibility en CSS (ver styles.css .nf-row-track). */
  const rowEls = () => [...body.querySelectorAll('.nf-row-track')];
  let _row = 0, _col = 0, atBack = false;

  function cardsOf(rowIdx) { return [...rowEls()[rowIdx].querySelectorAll('.nf-card')]; }
  function clearFocus() { body.querySelectorAll('.nf-card.focused').forEach(c => c.classList.remove('focused')); }
  function focusCard() {
    clearFocus();
    const cards = cardsOf(_row);
    _col = Math.max(0, Math.min(_col, cards.length - 1));
    const card = cards[_col];
    if (!card) return;
    card.classList.add('focused');
    card.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    rowEls()[_row].closest('.nf-row').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  state.appNavHandler = (key) => {
    if (key === 'Enter') {
      playSnd('enter');
      if (atBack) back.click(); else { var _c2 = cardsOf(_row)[_col]; if (_c2) _c2.click(); }
      return true;
    }
    if (!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(key)) return false;
    playSnd('nav');
    const totalRows = rowEls().length;
    if (atBack) {
      if (key === 'ArrowDown') { atBack = false; focusAppBack(false); focusCard(); }
      return true;
    }
    if (key === 'ArrowRight') { _col++; focusCard(); }
    if (key === 'ArrowLeft')  { _col--; focusCard(); }
    if (key === 'ArrowDown')  { if (_row < totalRows - 1) { _row++; focusCard(); } }
    if (key === 'ArrowUp') {
      if (_row > 0) { _row--; focusCard(); }
      else { atBack = true; clearFocus(); focusAppBack(true); }
    }
    return true;
  };
  focusCard();
}

/* ── "Ver más" de "Nuevo en MythOS TV" — grilla filtrada, mismo patrón
   visual/de navegación remota que openMovies() en modo grilla plana,
   pero solo con las películas recién agregadas (addedAt). Vuelve al
   tema Netflix de Películas al presionar atrás. ── */
function openNewMoviesView(items) {
  const body  = document.getElementById('app-screen-body');
  const back  = document.getElementById('app-back');
  const title = document.getElementById('app-screen-title');
  title.textContent = 'Nuevo en MythOS TV';
  back.onclick = () => { title.textContent = 'Películas'; renderMoviesNetflix(body, back, state.movies); };

  body.style.cssText = 'align-items:flex-start;padding:12px 0;';
  body.innerHTML = `
    <div id="new-movies-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;width:100%;padding:4px;">
      ${items.map((m, i) => `
        <div class="movie-card" data-index="${i}" style="
          background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
          border-radius:12px;overflow:hidden;cursor:pointer;transition:0.2s;
          content-visibility:auto;contain-intrinsic-size:160px 170px;
        ">
          <div style="
            height:100px;background:rgba(255,255,255,0.05);
            display:flex;align-items:center;justify-content:center;font-size:2.5rem;
            overflow:hidden;
          ">${m.poster
            ? `<img src="${m.poster}" alt="" loading="lazy" decoding="async" data-fallback="${m.emoji || '🎬'}" onerror="handleImgError(this)" style="width:100%;height:100%;object-fit:cover;" />`
            : (m.emoji || '🎬')}</div>
          <div style="padding:10px 12px;">
            <div style="font-size:0.82rem;font-weight:600;color:var(--text-primary);margin-bottom:3px;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${m.name || m.title || ''}</div>
            <div style="font-size:0.7rem;color:var(--text-muted);">${m.cat || 'Película'}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  body.querySelectorAll('.movie-card').forEach(card => {
    card.addEventListener('mouseenter', () => { card.style.transform='translateY(-3px)'; card.style.borderColor='rgba(124,106,247,0.4)'; });
    card.addEventListener('mouseleave', () => { card.style.transform=''; card.style.borderColor='rgba(255,255,255,0.07)'; });
    card.addEventListener('click', () => {
      const m = items[parseInt(card.dataset.index)];
      if (m) openDetailModal('movie', m);
    });
  });

  /* Navegación remota: mismo patrón de grilla que openMovies() */
  let _newIdx = 0;
  const getCards = () => [...body.querySelectorAll('.movie-card')];
  const getCols  = () => {
    const grid = document.getElementById('new-movies-grid');
    if (!grid) return 1;
    return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
  };
  function focusNew(i) {
    const cards = getCards();
    if (!cards.length) return;
    _newIdx = Math.max(0, Math.min(i, cards.length - 1));
    cards.forEach((c, j) => setRemoteFocus(c, j === _newIdx));
    cards[_newIdx].scrollIntoView({ block: 'nearest' });
  }
  let atBackNew = false;
  state.appNavHandler = (key) => {
    const cards = getCards();
    if (!cards.length) return;
    if (key === 'Enter') {
      playSnd('enter');
      if (atBackNew) back.click(); else { var _c3 = cards[_newIdx]; if (_c3) _c3.click(); }
      return true;
    }
    if (!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(key)) return false;
    playSnd('nav');
    const cols = getCols();
    if (atBackNew) {
      if (key === 'ArrowDown') { atBackNew = false; focusAppBack(false); focusNew(_newIdx); }
      return true;
    }
    if (key === 'ArrowRight') focusNew(_newIdx + 1);
    if (key === 'ArrowLeft')  focusNew(_newIdx - 1);
    if (key === 'ArrowDown')  focusNew(_newIdx + cols);
    if (key === 'ArrowUp') {
      if (_newIdx - cols >= 0) focusNew(_newIdx - cols);
      else { atBackNew = true; cards.forEach(c => setRemoteFocus(c, false)); focusAppBack(true); }
    }
    return true;
  };
  focusNew(0);
}

/* ══════════════════════════════════════════════════════════════
   RADIO SCREEN
   ══════════════════════════════════════════════════════════════ */
function openRadio() {
  state._currentApp = 'radio';
  navigateTo('app', 'Radio', () => {
    const stations = state.radio;
    const title = document.getElementById('app-screen-title');
    const body  = document.getElementById('app-screen-body');
    const back  = document.getElementById('app-back');
    title.textContent = 'Radio';
    back.onclick = () => { stopRadio(); navigateTo('home', 'Inicio'); };

    if (!stations.length) {
      body.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">
        <div style="font-size:3rem;margin-bottom:16px;">📻</div>
        <div>Sin estaciones. Agrega desde el <a href="/admin.html" style="color:var(--accent)">admin</a></div>
      </div>`;
      return;
    }

    body.style.cssText = 'align-items:flex-start;padding:0;';
    body.innerHTML = `
      <div style="width:100%;display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">
        <div>
          <div class="radio-now-playing">
            <div class="radio-disc" id="radio-disc">
              <div style="position:relative;z-index:2;font-size:1.8rem;" id="radio-disc-emoji">📻</div>
            </div>
            <div class="radio-station-name" id="radio-station-name">Selecciona una estación</div>
            <div class="radio-station-freq" id="radio-station-freq">── ── ──</div>
            <div class="radio-controls">
              <button class="radio-btn" id="radio-prev" title="Anterior">⏮</button>
              <button class="radio-btn play-pause" id="radio-play" title="Play/Pause">▶</button>
              <button class="radio-btn" id="radio-next" title="Siguiente">⏭</button>
            </div>
          </div>
        </div>
        <div class="radio-stations" id="radio-stations">
          ${stations.map((s, i) => `
            <div class="radio-station-item" data-index="${i}" tabindex="${i===0?0:-1}">
              <span class="radio-emoji">${s.emoji}</span>
              <div class="radio-info">
                <div class="radio-name">${s.name}</div>
                <div class="radio-genre">${s.genre}</div>
              </div>
              <div class="radio-live-dot"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    document.getElementById('radio-play').addEventListener('click', toggleRadioPlay);
    document.getElementById('radio-prev').addEventListener('click', () => changeStation(-1));
    document.getElementById('radio-next').addEventListener('click', () => changeStation(1));
    document.querySelectorAll('.radio-station-item').forEach((el, i) => {
      el.addEventListener('click', () => selectStation(i));
    });
    selectStation(state.currentRadioStation);

    /* Navegación con control remoto: ←→ entre controles ↔ lista, ↑↓ recorre la lista de estaciones */
    let radioZone   = 'stations'; // 'controls' | 'stations'
    let radioCtrlIdx = 1;          // 0 prev · 1 play · 2 next
    let radioStatIdx = state.currentRadioStation || 0;
    const getStationEls = () => [...document.querySelectorAll('.radio-station-item')];
    const getControlEls = () => [document.getElementById('radio-prev'), document.getElementById('radio-play'), document.getElementById('radio-next')];
    function focusStationItem(i) {
      const els = getStationEls();
      if (!els.length) return;
      radioStatIdx = Math.max(0, Math.min(i, els.length - 1));
      els.forEach((el, j) => setRemoteFocus(el, radioZone === 'stations' && j === radioStatIdx));
      els[radioStatIdx].scrollIntoView({ block: 'nearest' });
    }
    function focusControlItem(i) {
      const els = getControlEls();
      radioCtrlIdx = Math.max(0, Math.min(i, els.length - 1));
      els.forEach((el, j) => setRemoteFocus(el, radioZone === 'controls' && j === radioCtrlIdx));
    }
    state.appNavHandler = (key) => {
      if (key === 'Enter') {
        playSnd('enter');
        if (radioZone === 'back') back.click();
        else if (radioZone === 'controls') { var _ce3 = getControlEls()[radioCtrlIdx]; if (_ce3) _ce3.click(); }
        else { var _se1 = getStationEls()[radioStatIdx]; if (_se1) _se1.click(); }
        return true;
      }
      if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)) return false;
      playSnd('nav');
      if (radioZone === 'back') {
        if (key === 'ArrowDown') { radioZone = 'stations'; focusAppBack(false); focusStationItem(radioStatIdx); focusControlItem(radioCtrlIdx); }
      } else if (radioZone === 'stations') {
        if (key === 'ArrowUp') {
          if (radioStatIdx > 0) focusStationItem(radioStatIdx - 1);
          else { radioZone = 'back'; focusStationItem(radioStatIdx); focusAppBack(true); }
        }
        if (key === 'ArrowDown') focusStationItem(radioStatIdx + 1);
        if (key === 'ArrowLeft') { radioZone = 'controls'; focusControlItem(radioCtrlIdx); focusStationItem(radioStatIdx); }
      } else {
        if (key === 'ArrowUp') { radioZone = 'back'; focusControlItem(radioCtrlIdx); focusAppBack(true); }
        if (key === 'ArrowLeft')  focusControlItem(radioCtrlIdx - 1);
        if (key === 'ArrowRight') {
          if (radioCtrlIdx === 2) { radioZone = 'stations'; focusStationItem(radioStatIdx); focusControlItem(radioCtrlIdx); }
          else focusControlItem(radioCtrlIdx + 1);
        }
      }
      return true;
    };
    focusStationItem(radioStatIdx);
    focusControlItem(radioCtrlIdx);
  });
}

function selectStation(i) {
  const stations = state.radio;
  if (!stations.length) return;
  state.currentRadioStation = i;
  const s = stations[i];
  document.getElementById('radio-station-name').textContent = s.name;
  document.getElementById('radio-station-freq').textContent = s.genre;
  document.getElementById('radio-disc-emoji').textContent   = s.emoji;
  document.querySelectorAll('.radio-station-item').forEach((el, j) => el.classList.toggle('active', j === i));
  if (state.radioPlaying) startRadioStream(s.url);
}

function toggleRadioPlay() {
  if (state.radioPlaying) { stopRadio(); return; }
  const s = state.radio[state.currentRadioStation];
  if (s) startRadioStream(s.url);
}

function startRadioStream(url) {
  stopRadio();
  state.radioPlaying = true;
  document.getElementById('radio-play').textContent = '⏸';
  document.getElementById('radio-disc').classList.add('playing');
  if (!url) { showToast('ℹ️ URL de stream no configurada'); return; }

  // Siempre pasar por proxy: resuelve mixed-content (HTTP en HTTPS) y CORS
  const proxied = url.startsWith('/api/') ? url : `${API}/proxy-stream?url=${encodeURIComponent(url)}&token=${encodeURIComponent(getAuthTokenParam())}`;

  if (!state.radioAudio) state.radioAudio = new Audio();
  state.radioAudio.src = proxied;
  state.radioAudio.load();

  // Intentar con proxy primero; si falla, reintentar con URL directa
  state.radioAudio.play().catch(() => {
    // Fallback: URL directa (puede funcionar si el stream es HTTPS y tiene CORS abierto)
    state.radioAudio.src = url;
    state.radioAudio.load();
    state.radioAudio.play().catch(() => {
      showToast('⚠️ No se pudo cargar el stream');
      state.radioPlaying = false;
      document.getElementById('radio-play').textContent = '▶';
      document.getElementById('radio-disc').classList.remove('playing');
    });
  });
}

function stopRadio() {
  state.radioPlaying = false;
  if (state.radioAudio) state.radioAudio.pause();
  const pb = document.getElementById('radio-play');
  const d  = document.getElementById('radio-disc');
  if (pb) pb.textContent = '▶';
  if (d)  d.classList.remove('playing');
}

function changeStation(dir) {
  const stations = state.radio;
  const next = (state.currentRadioStation + dir + stations.length) % stations.length;
  selectStation(next);
}

/* ══════════════════════════════════════════════════════════════
   SETTINGS SCREEN — preferencias del usuario
   ══════════════════════════════════════════════════════════════ */
function openSettings() {
  navigateTo('settings', 'Configuración', () => {
    syncSettingsUI();
    initSettingsListeners();
    initSettingsNav();
  });
}

function initSettingsNav() {
  function getFocusables() {
    return [
      document.getElementById('setting-wallpaper'),
      document.getElementById('setting-time-format'),
      document.getElementById('setting-timezone'),
      document.getElementById('setting-glass'),
      document.getElementById('setting-sound'),
      document.getElementById('settings-save'),
      document.getElementById('settings-logout'),
    ].filter(Boolean);
  }

  let idx = 0;

  function applyFocus(i) {
    const items = getFocusables();
    if (!items.length) return;
    idx = Math.max(0, Math.min(i, items.length - 1));
    items.forEach((el, j) => {
      el.setAttribute('tabindex', j === idx ? '0' : '-1');
      setRemoteFocus(el, j === idx);
    });
    items[idx].focus();
  }

  state.settingsNavHandler = (key) => {
    const items = getFocusables();
    if (!items.length) return;
    if (key === 'ArrowDown') { playSnd('nav'); applyFocus(idx + 1); return; }
    if (key === 'ArrowUp')   { playSnd('nav'); applyFocus(idx - 1); return; }
    if (key === 'Enter') {
      const el = items[idx];
      if (!el) return;
      playSnd('enter');
      if (el.type === 'checkbox') {
        el.checked = !el.checked;
        el.dispatchEvent(new Event('change'));
      } else if (el.tagName === 'BUTTON') {
        el.click();
      } else {
        el.focus();
      }
      return;
    }
    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const el = items[idx];
      if (el && el.tagName === 'SELECT') {
        playSnd('nav');
        const dir = key === 'ArrowRight' ? 1 : -1;
        el.selectedIndex = Math.max(0, Math.min(el.selectedIndex + dir, el.options.length - 1));
        el.dispatchEvent(new Event('change'));
      }
    }
  };

  applyFocus(0);
}

function syncSettingsUI() {
  const prefs = (_currentUser && _currentUser.prefs) ? _currentUser.prefs : {};
  const wallpaper = prefs.wallpaper || state.wallpaper || 'default';
  const timeFormat = prefs.timeFormat || state.timeFormat || '24h';
  const timezone   = prefs.timezone   || state.timezone   || 'America/Costa_Rica';

  const wpEl = document.getElementById('setting-wallpaper');
  const tfEl = document.getElementById('setting-time-format');
  const tzEl = document.getElementById('setting-timezone');
  const glEl = document.getElementById('setting-glass');
  const sdEl = document.getElementById('setting-sound');

  if (wpEl) wpEl.value = wallpaper;
  if (tfEl) tfEl.value = timeFormat;
  if (tzEl) tzEl.value = timezone;
  if (glEl) glEl.checked = state.glassEnabled;
  if (sdEl) sdEl.checked = state.soundEnabled;
}

function initSettingsListeners() {
  const backBtn = document.getElementById('settings-back');
  const saveBtn = document.getElementById('settings-save');
  // Limpiar listeners previos clonando el botón
  const newSave = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSave, saveBtn);
  const newBack = backBtn.cloneNode(true);
  backBtn.parentNode.replaceChild(newBack, backBtn);

  document.getElementById('settings-back').addEventListener('click', () => navigateTo('home', 'Inicio'));

  document.getElementById('settings-save').addEventListener('click', async () => {
    const wallpaper  = document.getElementById('setting-wallpaper').value;
    const timeFormat = document.getElementById('setting-time-format').value;
    const timezone   = document.getElementById('setting-timezone').value;
    const glassEnabled = document.getElementById('setting-glass').checked;
    const soundEnabled = document.getElementById('setting-sound').checked;

    // Actualizar estado local
    state.wallpaper    = wallpaper;
    state.glassEnabled = glassEnabled;
    state.soundEnabled = soundEnabled;
    state.timeFormat   = timeFormat;
    state.timezone     = timezone;
    applySettings();

    if (_currentUser && _currentUser.isAdmin && _currentUser.adminToken) {
      // Admin no tiene PIN -> sus preferencias se guardan en el config GLOBAL
      // (hay que traer el config completo primero: /api/admin/config reemplaza
      // todo el archivo, si solo mandamos estos campos se perderían canales/launcher/etc.)
      try {
        const cfgRes = await fetch(`${API}/config`, { headers: getAuthHeaders() });
        const cfg    = await cfgRes.json();
        Object.assign(cfg, { wallpaper, timeFormat, timezone, glassEnabled, soundEnabled });
        const r = await fetch(`${API}/admin/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Token': _currentUser.adminToken },
          body: JSON.stringify(cfg),
        });
        const data = await r.json();
        if (data.ok) {
          _currentUser.prefs = { ...(_currentUser.prefs || {}), wallpaper, timeFormat, timezone };
          showToast('✅ Preferencias guardadas');
        } else {
          showToast('⚠️ Error al guardar: ' + (data.error || 'desconocido'));
        }
      } catch {
        showToast('⚠️ Sin conexión al servidor');
      }
    } else if (_currentUser && _currentUser.username && _currentUser.pin) {
      try {
        const r = await fetch(`${API}/users/prefs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: _currentUser.username,
            pin:      _currentUser.pin,
            prefs:    { wallpaper, timeFormat, timezone },
          }),
        });
        const data = await r.json();
        if (data.ok) {
          if (_currentUser.prefs) {
            _currentUser.prefs.wallpaper  = wallpaper;
            _currentUser.prefs.timeFormat = timeFormat;
            _currentUser.prefs.timezone   = timezone;
          }
          showToast('✅ Preferencias guardadas');
        } else {
          showToast('⚠️ Error al guardar: ' + (data.error || 'desconocido'));
        }
      } catch {
        showToast('⚠️ Sin conexión al servidor');
      }
    } else {
      showToast('✅ Configuración aplicada');
    }

    setTimeout(() => navigateTo('home', 'Inicio'), 800);
  });
}

function openGenericApp(app) {
  if (app.url) {
    openInAppBrowser(app);
  } else {
    navigateTo('app', app.label, () => {
      const title = document.getElementById('app-screen-title');
      const body  = document.getElementById('app-screen-body');
      const back  = document.getElementById('app-back');
      title.textContent = app.label;
      back.onclick = () => navigateTo('home', 'Inicio');
      body.style.cssText = '';
      body.innerHTML = `
        <div class="app-placeholder-icon">${app.emoji}</div>
        <div class="app-placeholder-title">${app.label}</div>
        <div class="app-placeholder-desc">Esta app está lista para conectarse.<br/>Configura la URL en el <a href="/admin.html" style="color:var(--accent)">panel admin</a>.</div>
      `;
    });
  }
}

function openInAppBrowser(app) {
  document.removeEventListener('keydown', handleKey);
  showNativeLauncher(app);
}

function closeInAppBrowser() {
  const el = document.getElementById('inapp-browser');
  if (el) el.remove();
  document.addEventListener('keydown', handleKey);
  state.focusZone = 'dock';
  focusTile(state.focusIndex || 0);
}

function handleInAppKey(e) {
  if (e.key === 'Escape' || e.key === 'Backspace') {
    e.preventDefault();
    document.removeEventListener('keydown', handleInAppKey);
    const overlay = document.getElementById('inapp-browser');
    if (overlay?._close) overlay._close();
    else closeInAppBrowser();
  }
}

/* Barra superior reutilizable */
function buildInAppTopbar(app) {
  return `
    <div style="
      display:flex;align-items:center;gap:14px;
      padding:0 20px;height:52px;flex-shrink:0;
      background:rgba(7,7,16,0.98);
      border-bottom:1px solid rgba(255,255,255,0.07);
      position:relative;z-index:2;
    ">
      <button id="inapp-back" style="
        display:flex;align-items:center;gap:8px;
        background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);
        color:#fff;padding:8px 18px;border-radius:8px;
        font-size:0.85rem;cursor:pointer;flex-shrink:0;
        transition:background 0.15s;
      " onmouseover="this.style.background='rgba(255,255,255,0.15)'"
         onmouseout="this.style.background='rgba(255,255,255,0.08)'">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="15,18 9,12 15,6"/>
        </svg>
        Inicio
      </button>
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
        <span style="font-size:1.3rem;">${app.emoji || '🌐'}</span>
        <span style="font-size:0.95rem;font-weight:500;color:#f0f0fa;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${app.label}
        </span>
      </div>
    </div>`;
}

/* Modo lanzador nativo — para sitios que bloquean iframe */
function showNativeLauncher(app) {
  const overlay = document.createElement('div');
  overlay.id = 'inapp-browser';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:500;display:flex;flex-direction:column;background:var(--bg-void);';

  overlay.innerHTML = `
    ${buildInAppTopbar(app)}
    <div style="
      flex:1;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:28px;
      background:
        radial-gradient(ellipse 70% 60% at 50% 40%, rgba(124,106,247,0.12) 0%, transparent 70%),
        var(--bg-void);
    ">
      <div style="font-size:5rem;filter:drop-shadow(0 0 32px rgba(124,106,247,0.5));">
        ${app.emoji || '🌐'}
      </div>
      <div style="text-align:center;">
        <div style="font-size:1.8rem;font-weight:500;color:#f0f0fa;margin-bottom:8px;">
          ${app.label}
        </div>
        <div style="font-size:0.9rem;color:rgba(255,255,255,0.4);">
          Se abrirá en pantalla completa
        </div>
      </div>
      <button id="native-launch-btn" style="
        display:flex;align-items:center;gap:10px;
        background:linear-gradient(90deg,#7c6af7,#3ecfcf);
        border:none;color:#fff;
        padding:14px 36px;border-radius:12px;
        font-size:1rem;font-weight:500;cursor:pointer;
        box-shadow:0 0 32px rgba(124,106,247,0.4);
        transition:opacity 0.15s;
      " onmouseover="this.style.opacity='0.85'"
         onmouseout="this.style.opacity='1'">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
        Abrir ${app.label}
      </button>
    </div>`;

  document.body.appendChild(overlay);

  document.getElementById('inapp-back').addEventListener('click', closeInAppBrowser);

  document.getElementById('native-launch-btn').addEventListener('click', () => {
    closeInAppBrowser();
    window.location.href = app.url;
  });

  // Enter lanza, Esc vuelve
  function handleNativeKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.removeEventListener('keydown', handleNativeKey);
      document.getElementById('native-launch-btn')?.click();
    }
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      document.removeEventListener('keydown', handleNativeKey);
      closeInAppBrowser();
    }
  }
  document.addEventListener('keydown', handleNativeKey);
}

/* ══════════════════════════════════════════════════════════════
   FOCUS GLOW
   ══════════════════════════════════════════════════════════════ */
function initFocusGlow() {
  const glow = document.getElementById('focus-glow');
  document.addEventListener('mousemove', e => {
    glow.style.setProperty('--gx', (e.clientX / window.innerWidth * 100).toFixed(1) + '%');
    glow.style.setProperty('--gy', (e.clientY / window.innerHeight * 100).toFixed(1) + '%');
  });
}

/* ══════════════════════════════════════════════════════════════
   AUDIO ENGINE
   ══════════════════════════════════════════════════════════════ */
let _audioCtx = null;
function initAudio() {
  document.addEventListener('click',   initAudioCtx, { once: true });
  document.addEventListener('keydown', initAudioCtx, { once: true });
}
function initAudioCtx() {
  try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
}
function playSnd(type) {
  if (!state.soundEnabled || !_audioCtx) return;
  try {
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain); gain.connect(_audioCtx.destination);
    if (type === 'nav')   { osc.frequency.value = 660; gain.gain.setValueAtTime(0.04, _audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.08); osc.start(_audioCtx.currentTime); osc.stop(_audioCtx.currentTime + 0.08); }
    if (type === 'enter') { osc.frequency.value = 880; gain.gain.setValueAtTime(0.06, _audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.14); osc.start(_audioCtx.currentTime); osc.stop(_audioCtx.currentTime + 0.14); }
  } catch {}
}

/* ══════════════════════════════════════════════════════════════
   IMAGE FALLBACK (carátulas / logos que no cargan)
   ══════════════════════════════════════════════════════════════ */
function handleImgError(img) {
  const fallback = img.dataset.fallback || '🎬';
  const span = document.createElement('span');
  span.style.fontSize = '1.4em';
  span.textContent = fallback;
  img.replaceWith(span);
}

/* ══════════════════════════════════════════════════════════════
   TOAST
   ══════════════════════════════════════════════════════════════ */
let _toastTimer = null;
function showToast(msg, dur = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove('show'), dur);
}

/* ══════════════════════════════════════════════════════════════
   BACK BUTTON
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('app-back').addEventListener('click', () => {
    stopAll();
    navigateTo('home', 'Inicio');
    document.addEventListener('keydown', handleKey);
  });
});

/* ══════════════════════════════════════════════════════════════
   KICK OFF
   ══════════════════════════════════════════════════════════════ */
// boot() se llama desde index.html una vez el usuario está autenticado
// Si no hay pantalla de usuario (acceso directo), arranca igual
if (!document.getElementById("user-screen")) boot();
