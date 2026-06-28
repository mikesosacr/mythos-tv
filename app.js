/* ═══════════════════════════════════════════════════════════════
   MythOS TV — app.js v2.0
   Config global desde servidor · HLS.js player · Live TV / Movies
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const API = '/api';

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
};

/* ══════════════════════════════════════════════════════════════
   LOAD CONFIG FROM SERVER (global, all devices)
   ══════════════════════════════════════════════════════════════ */
async function loadConfig() {
  try {
    const res = await fetch(`${API}/config`);
    if (!res.ok) throw new Error('Server error');
    const cfg = await res.json();
    applyConfig(cfg);
  } catch {
    // Fallback: use defaults so the app still works offline
    applyConfig({});
  }
}

function applyConfig(cfg) {
  state.systemName   = cfg.systemName   || 'MythOS TV';
  state.wallpaper    = cfg.wallpaper    || 'default';
  state.glassEnabled = cfg.glassEnabled !== false;
  state.soundEnabled = cfg.soundEnabled !== false;
  state.apps         = cfg.launcher     || DEFAULT_APPS;
  state.livetv       = cfg.livetv       || [];
  state.movies       = cfg.movies       || [];
  state.radio        = cfg.radio        || [];
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
  const configPromise = loadConfig();

  for (let i = 0; i < BOOT_MESSAGES.length; i++) {
    await delay(320 + Math.random() * 140);
    fill.style.width   = Math.round(((i + 1) / BOOT_MESSAGES.length) * 100) + '%';
    status.textContent = BOOT_MESSAGES[i];
  }

  await configPromise; // ensure config loaded before UI
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
// Llamado desde index.html después del login + boot para mostrar el banner PWA
function triggerPWABanner() {
  if (typeof showPWABanner === 'function') {
    setTimeout(showPWABanner, 4000);
  }
}

function initUI() {
  applySettings(false);
  renderAppGrid();
  renderSuggestions();
  initClock();
  initRemoteNav();
  initFocusGlow();
  initAudio();
  createModal();
  initDetailModal();
  state.focusZone = 'dock';
  focusTile(0);

  // Logo clickeable → volver al home
  const brand = document.querySelector('.topbar-brand');
  if (brand) {
    brand.style.cursor = 'pointer';
    brand.addEventListener('click', () => navigateTo('home', 'Inicio'));
  }
}

/* ── Clock ───────────────────────────────────────────────────── */
function initClock() {
  function tick() {
    const now  = new Date();
    const hh   = String(now.getHours()).padStart(2,'0');
    const mm   = String(now.getMinutes()).padStart(2,'0');
    document.getElementById('topbar-time').textContent = `${hh}:${mm}`;
    const days  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const month = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    document.getElementById('topbar-date').textContent =
      `${days[now.getDay()]} ${now.getDate()} ${month[now.getMonth()]}`;
    const h = now.getHours();
    const g = h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    const el = document.getElementById('home-greeting');
    if (el) el.textContent = g;
  }
  tick();
  setInterval(tick, 30000);
}

/* ── Apply Settings ──────────────────────────────────────────── */
function applySettings() {
  document.body.className = '';
  if (state.wallpaper && state.wallpaper !== 'default')
    document.body.classList.add(`wallpaper-${state.wallpaper}`);
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
        ? `<img src="${app.logo}" alt="" data-fallback="${app.emoji || '🚀'}" onerror="handleImgError(this)" />`
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
  });
}

/* ══════════════════════════════════════════════════════════════
   REMOTE / KEYBOARD NAV
   ══════════════════════════════════════════════════════════════ */
function initRemoteNav() { document.addEventListener('keydown', handleKey); }

function handleKey(e) {
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Backspace','Escape'].includes(e.key))
    e.preventDefault();
  if (state.currentScreen === 'home')     handleHomeKey(e.key);
  else if (state.currentScreen === 'settings') handleSettingsKey(e.key);
  else handleAppKey(e.key);
}

function handleHomeKey(key) {
  // Si el modal de detalle está abierto, manejarlo primero
  if (!document.getElementById('detail-overlay').classList.contains('hidden')) {
    const playBtn  = document.getElementById('detail-play-btn');
    const closeBtn = document.getElementById('detail-close-btn');
    if (key === 'Escape' || key === 'Backspace') { playSnd('nav'); closeDetailModal(); return; }
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      playSnd('nav');
      state._detailFocusBtn = state._detailFocusBtn === 'play' ? 'close' : 'play';
      setRemoteFocus(playBtn,  state._detailFocusBtn === 'play');
      setRemoteFocus(closeBtn, state._detailFocusBtn === 'close');
      (state._detailFocusBtn === 'play' ? playBtn : closeBtn).focus();
      return;
    }
    if (key === 'Enter') { playSnd('enter'); (state._detailFocusBtn === 'close' ? closeBtn : playBtn).click(); }
    return;
  }

  const tiles = getTiles();

  // focusZone: 'dock' | 'movies' | 'livetv'
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
      }
      break;
    case 'ArrowDown':
      playSnd('nav');
      if (zone === 'movies') {
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

function renderSuggestions() {
  renderMovieSuggestions();
  renderLiveTVSuggestions();
  // Ocultar sección si no hay contenido
  document.getElementById('suggestions-movies-wrap').style.display =
    state.movies.length ? '' : 'none';
  document.getElementById('suggestions-livetv-wrap').style.display =
    state.livetv.length ? '' : 'none';
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
      ? `<img class="sm-poster" src="${m.poster}" alt="" onerror="handleImgError(this)" data-fallback="${m.emoji || '🎬'}" />`
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
      ? `<img class="ch-logo" src="${ch.logo}" alt="" onerror="handleImgError(this)" data-fallback="${ch.emoji || '📺'}" />`
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
  document.querySelectorAll('.sugg-movie-card, .sugg-ch-card').forEach(c => c.classList.remove('focused'));

  if (zone === 'dock') {
    updateTileFocus();
  } else if (zone === 'movies') {
    state.suggMovieIdx = state.suggMovieIdx || 0;
    updateSuggFocus('movies');
  } else if (zone === 'livetv') {
    state.suggLivetvIdx = state.suggLivetvIdx || 0;
    updateSuggFocus('livetv');
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
  }
}

function updateSuggFocus(zone) {
  if (zone === 'movies') {
    const cards = [...document.querySelectorAll('#suggestions-movies .sugg-movie-card')];
    cards.forEach((c, i) => c.classList.toggle('focused', i === state.suggMovieIdx));
  } else if (zone === 'livetv') {
    const cards = [...document.querySelectorAll('#suggestions-livetv .sugg-ch-card')];
    cards.forEach((c, i) => c.classList.toggle('focused', i === state.suggLivetvIdx));
  }
}

function openDetailForFocused(zone) {
  if (zone === 'movies' && state._suggMovies) {
    openDetailModal('movie', state._suggMovies[state.suggMovieIdx]);
  } else if (zone === 'livetv' && state._suggLivetv) {
    openDetailModal('livetv', state._suggLivetv[state.suggLivetvIdx]);
  }
}

/* ══════════════════════════════════════════════════════════════
   DETAIL MODAL
   ══════════════════════════════════════════════════════════════ */
function initDetailModal() {
  document.getElementById('detail-close-btn').addEventListener('click', closeDetailModal);
  document.getElementById('detail-play-btn').addEventListener('click', () => {
    const item = state._detailItem;
    const type = state._detailType;
    if (!item || !type) return;
    closeDetailModal();
    playStream(item.url, item.name || item.title || '');
  });
}

function openDetailModal(type, item) {
  state._detailType = type;
  state._detailItem = item;

  const overlay = document.getElementById('detail-overlay');
  const badge   = document.getElementById('detail-badge');
  const title   = document.getElementById('detail-title');
  const meta    = document.getElementById('detail-meta');
  const desc    = document.getElementById('detail-desc');
  const poster  = document.getElementById('detail-poster');
  const playBtn = document.getElementById('detail-play-btn');

  if (type === 'livetv') {
    badge.classList.remove('hidden');
    poster.innerHTML = item.logo
      ? `<img src="${item.logo}" alt="" style="width:100%;height:100%;object-fit:contain;" onerror="this.parentElement.textContent='${item.emoji||'📺'}'">`
      : (item.emoji || '📺');
    title.textContent = item.name || '';
    meta.textContent  = item.group || item.category || 'Canal en vivo';
    desc.textContent  = item.description || 'Canal de televisión en vivo.';
    playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Ver ahora';
  } else {
    badge.classList.add('hidden');
    poster.innerHTML = item.poster
      ? `<img src="${item.poster}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.textContent='${item.emoji||'🎬'}'">`
      : (item.emoji || '🎬');
    title.textContent = item.name || item.title || '';
    meta.textContent  = [item.year, item.genre, item.duration].filter(Boolean).join(' · ') || 'Película';
    desc.textContent  = item.description || '';
    playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Reproducir';
  }

  overlay.classList.remove('hidden');
  state._detailFocusBtn = 'play';
  setRemoteFocus(playBtn, true);
  setRemoteFocus(document.getElementById('detail-close-btn'), false);
  playBtn.focus();
}

function closeDetailModal() {
  document.getElementById('detail-overlay').classList.add('hidden');
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
  if (!next || next === current) return;

  if (current) {
    current.classList.add('exit-left');
    setTimeout(() => current.classList.remove('active','exit-left'), 300);
  }
  next.classList.add('enter-right');
  setTimeout(() => { next.classList.add('active'); next.classList.remove('enter-right'); }, 30);

  state.currentScreen = screenId;
  state.appNavHandler = null;
  state.settingsNavHandler = null;
  const tb = document.getElementById('topbar-title');
  if (tb) tb.textContent = title || 'Inicio';
  if (renderFn) renderFn();
  if (screenId === 'home') setTimeout(() => { state.focusZone = 'dock'; focusTile(state.focusIndex); }, 350);
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

function stopHLS() {
  if (state.hlsInstance) { state.hlsInstance.destroy(); state.hlsInstance = null; }
  const v = document.getElementById('hls-video');
  if (v) {
    v.pause();
    v.removeAttribute('src');
    v.load(); // cancela la conexión HTTP activa (incluyendo streams de transcodificación)
  }
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
  stopHLS();
  exitPlayerFullscreen();
  const overlay = document.getElementById('player-overlay');
  if (overlay) {
    if (overlay._keyHandler) document.removeEventListener('keydown', overlay._keyHandler);
    overlay.remove();
  }
  document.addEventListener('keydown', handleKey);
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

function playStream(url, title) {
  stopHLS();

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
          <button id="player-fullscreen" style="${PLAYER_BTN_STYLE}">⛶</button>
        </div>
      </div>

      <style>
        @keyframes player-spin { to { transform: rotate(360deg); } }
        #player-seek, #player-volume { -webkit-appearance:none; appearance:none; background:rgba(255,255,255,0.25); border-radius:2px; outline:none; }
        #player-seek::-webkit-slider-thumb, #player-volume::-webkit-slider-thumb { -webkit-appearance:none; width:13px; height:13px; border-radius:50%; background:#fff; cursor:pointer; margin-top:-4.5px; }
        #player-back:hover, #player-playpause:hover, #player-mute:hover, #player-fullscreen:hover { background:rgba(255,255,255,0.22); }
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
    });

    fsBtn.onclick = () => {
      if (document.fullscreenElement || document.webkitFullscreenElement) exitPlayerFullscreen();
      else enterPlayerFullscreen(overlay);
    };

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
  document.getElementById('player-status').textContent = '';
  document.getElementById('player-seek-row').style.display = 'none'; // se muestra de nuevo en loadedmetadata si es VOD
  document.getElementById('player-playpause').textContent  = '⏸';
  document.getElementById('player-mute').textContent       = '🔊';
  document.getElementById('player-volume').value = 1;

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
    const proxied    = `${API}/proxy-stream?url=${encodeURIComponent(url)}`;
    const transcoded = `${API}/transcode?url=${encodeURIComponent(url)}`;

    function tryDirect() {
      // Intento 2: directo desde el navegador (IP del usuario)
      const status = document.getElementById('player-status');
      if (status) status.textContent = '↩️ Reintentando…';
      video.src = url;
      video.load();
      video.play().catch(() => {});
      checkCodecAfterLoad();
    }

    function tryTranscode() {
      // Intento 3: transcodificación en tiempo real (último recurso)
      const status = document.getElementById('player-status');
      if (status) status.textContent = '⚙️ Transcodificando…';
      showToast('⚙️ Codec incompatible — transcodificando, espera unos segundos…');
      video.src = transcoded;
      video.load();
      video.play().catch(() => {});
    }

    function checkCodecAfterLoad() {
      video.addEventListener('loadedmetadata', function onMeta() {
        if (video.videoWidth === 0 && video.videoHeight === 0) {
          console.warn('[MythOS] Sin pista de video — activando transcodificación');
          tryTranscode();
        }
      }, { once: true });
    }

    // Intento 1: proxy normal
    video.src = proxied;
    video.play().catch(() => showToast('⚠️ El navegador bloqueó el autoplay'));
    checkCodecAfterLoad();

    // Si el proxy da 403/502 → ir directo
    video.addEventListener('error', function onErr() {
      fetch(proxied, { method: 'HEAD' })
        .then(r => {
          if (r.status === 403 || r.status === 502 || r.status === 504) tryDirect();
        })
        .catch(() => tryDirect());
    }, { once: true });

    return;
  }

  // Try HLS.js first, then native
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
      backBufferLength: 30,
    });
    state.hlsInstance = hls;
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => showToast('⚠️ El navegador bloqueó el autoplay'));
    });
    hls.on(Hls.Events.ERROR, (e, data) => {
      if (data.fatal) {
        status.textContent = '⚠️ Error de stream';
        loading.style.display = 'none';
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Native HLS (Safari, smart TVs)
    video.src = url;
    video.play().catch(() => {});
  } else {
    // Fallback: direct src
    video.src = url;
    video.play().catch(() => {});
  }
}

/* ══════════════════════════════════════════════════════════════
   LIVE TV SCREEN  (Smarters-style: categories left, list right)
   ══════════════════════════════════════════════════════════════ */
function openLiveTV() {
  navigateTo('app', 'Live TV', () => {
    const title = document.getElementById('app-screen-title');
    const body  = document.getElementById('app-screen-body');
    const back  = document.getElementById('app-back');
    title.textContent = 'Live TV';
    back.onclick = () => navigateTo('home', 'Inicio');

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
      <div id="tv-list" style="flex:1;overflow-y:auto;padding:8px 0;"></div>
    `;

    function renderChannelList(cat) {
      const list = document.getElementById('tv-list');
      const filtered = cat === 'Todos' ? channels : channels.filter(c => (c.cat || 'General') === cat);
      list.innerHTML = filtered.map((ch, i) => `
        <div class="tv-channel-row" data-index="${i}" data-url="${ch.url}" data-name="${ch.name}" style="
          display:flex;align-items:center;gap:14px;
          padding:11px 18px;cursor:pointer;
          border-bottom:1px solid rgba(255,255,255,0.04);
          transition:0.15s;
        ">
          <div style="
            width:44px;height:44px;border-radius:10px;
            background:rgba(255,255,255,0.06);
            display:flex;align-items:center;justify-content:center;
            font-size:1.4rem;flex-shrink:0;overflow:hidden;
          ">${ch.logo
            ? `<img src="${ch.logo}" alt="" data-fallback="${ch.emoji || '📡'}" onerror="handleImgError(this)" style="width:100%;height:100%;object-fit:contain;background:#0a0a14;" />`
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
        row.addEventListener('click', () => {
          const url  = row.dataset.url;
          const name = row.dataset.name;
          if (!url) { showToast('⚠️ Canal sin URL configurada'); return; }
          playStream(url, name);
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

    /* Navegación con control remoto: ←→ cambia de panel, ↑↓ recorre la lista activa */
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
      if (!els.length) return;
      tvChanIdx = Math.max(0, Math.min(i, els.length - 1));
      els.forEach((el, j) => setRemoteFocus(el, tvPane === 'list' && j === tvChanIdx));
      els[tvChanIdx]?.scrollIntoView({ block: 'nearest' });
    }
    state.appNavHandler = (key) => {
      // Escape/Backspace: foco al botón Atrás y volver al home
      if (key === 'Escape' || key === 'Backspace') {
        playSnd('nav');
        stopAll();
        navigateTo('home', 'Inicio');
        return true; // indica que lo manejamos
      }

      // CH+ / CH- durante reproducción (canales: PageUp/PageDown o MediaTrackNext)
      if (key === 'ChannelUp' || key === 'PageUp') {
        const chans = getChanEls();
        if (chans.length) { focusChan(tvChanIdx - 1); getChanEls()[tvChanIdx]?.click(); }
        return true;
      }
      if (key === 'ChannelDown' || key === 'PageDown') {
        const chans = getChanEls();
        if (chans.length) { focusChan(tvChanIdx + 1); getChanEls()[tvChanIdx]?.click(); }
        return true;
      }

      if (key === 'Enter') {
        playSnd('enter');
        if (tvPane === 'back') {
          back.click();
        } else if (tvPane === 'cats') {
          getCatEls()[tvCatIdx]?.click();
          tvChanIdx = 0;
          focusChan(0);
        } else {
          getChanEls()[tvChanIdx]?.click();
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

    body.style.cssText = 'align-items:flex-start;padding:12px 0;';
    body.innerHTML = `
      <div id="movies-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;width:100%;padding:4px;">
        ${movies.map((m, i) => `
          <div class="movie-card" data-index="${i}" data-url="${m.url}" data-name="${m.name}" style="
            background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
            border-radius:12px;overflow:hidden;cursor:pointer;transition:0.2s;
          ">
            <div style="
              height:100px;background:rgba(255,255,255,0.05);
              display:flex;align-items:center;justify-content:center;font-size:2.5rem;
              overflow:hidden;
            ">${m.poster
              ? `<img src="${m.poster}" alt="" data-fallback="${m.emoji || '🎬'}" onerror="handleImgError(this)" style="width:100%;height:100%;object-fit:cover;" />`
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
        const url  = card.dataset.url;
        const name = card.dataset.name;
        if (!url) { showToast('⚠️ Sin URL configurada'); return; }
        // Hide live badge for VOD
        playStream(url, name);
        setTimeout(() => {
          const badge = document.getElementById('player-live-badge');
          if (badge) badge.textContent = 'VOD';
        }, 100);
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
        if (atBack) back.click(); else cards[_movIdx]?.click();
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
   RADIO SCREEN
   ══════════════════════════════════════════════════════════════ */
function openRadio() {
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
        else if (radioZone === 'controls') getControlEls()[radioCtrlIdx]?.click();
        else getStationEls()[radioStatIdx]?.click();
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
  const proxied = url.startsWith('/api/') ? url : `${API}/proxy-stream?url=${encodeURIComponent(url)}`;

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
   SETTINGS SCREEN
   ══════════════════════════════════════════════════════════════ */
function openSettings() {
  navigateTo('settings', 'Configuración', () => {
    syncSettingsUI();
    initSettingsListeners();
    initSettingsNav();
  });
}

function initSettingsNav() {
  // Construir lista de elementos focusables DESPUÉS de que renderSettingsAppList los haya creado
  function getFocusables() {
    return [
      document.getElementById('setting-system-name'),
      document.getElementById('setting-wallpaper'),
      document.getElementById('setting-glass'),
      document.getElementById('setting-sound'),
      ...document.querySelectorAll('.settings-url-input'),
      document.getElementById('settings-save'),
    ].filter(Boolean);
  }

  let idx = 0;

  function applyFocus(i) {
    const items = getFocusables();
    if (!items.length) return;
    idx = Math.max(0, Math.min(i, items.length - 1));
    items.forEach((el, j) => {
      const on = j === idx;
      el.setAttribute('tabindex', on ? '0' : '-1');
      setRemoteFocus(el, on);
    });
    const target = items[idx];
    target.focus();
    // Para checkboxes mostramos el foco pero no activamos con focus()
    // para evitar que el estado cambie solo al navegar
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
        // inputs y select — darles foco nativo para que el teclado físico funcione
        el.focus();
      }
      return;
    }

    // ←→ en select: cambiar opción
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

  // Foco inicial en el primer elemento
  applyFocus(0);
}


function syncSettingsUI() {
  document.getElementById('setting-system-name').value = state.systemName;
  document.getElementById('setting-wallpaper').value   = state.wallpaper;
  document.getElementById('setting-glass').checked     = state.glassEnabled;
  document.getElementById('setting-sound').checked     = state.soundEnabled;
  renderSettingsAppList();
}

function renderSettingsAppList() {
  const list = document.getElementById('settings-apps-list');
  if (!list) return;
  list.innerHTML = state.apps.filter(a => a.type === 'external').map(app => `
    <div class="settings-app-item">
      <div class="settings-app-name"><span class="app-emoji">${app.emoji}</span>${app.label}</div>
      <div class="settings-app-url-row">
        <input type="url" class="settings-url-input" data-app-id="${app.id}"
          placeholder="https://..." value="${app.url || ''}" />
      </div>
    </div>`).join('');
}

function initSettingsListeners() {
  const backBtn = document.getElementById('settings-back');
  const saveBtn = document.getElementById('settings-save');
  if (backBtn._init) return;
  backBtn._init = true;
  backBtn.addEventListener('click', () => navigateTo('home', 'Inicio'));
  saveBtn.addEventListener('click', () => {
    state.systemName   = document.getElementById('setting-system-name').value.trim() || 'MythOS TV';
    state.wallpaper    = document.getElementById('setting-wallpaper').value;
    state.glassEnabled = document.getElementById('setting-glass').checked;
    state.soundEnabled = document.getElementById('setting-sound').checked;
    document.querySelectorAll('.settings-url-input').forEach(inp => {
      const app = state.apps.find(a => a.id === inp.dataset.appId);
      if (app) app.url = inp.value.trim();
    });
    applySettings();
    showToast('✅ Configuración guardada');
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

// Dominios que bloquean iframe — van directo al lanzador nativo
const NATIVE_LAUNCH_DOMAINS = [
  'youtube.com', 'youtu.be',
  'plex.tv', 'app.plex.tv',
  'twitch.tv',
  'netflix.com',
  'disneyplus.com',
  'primevideo.com',
  'runtime.tv', 'www.runtime.tv',
];

function isNativeDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return NATIVE_LAUNCH_DOMAINS.some(d => host === d || host.endsWith('.' + d));
  } catch { return false; }
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

/* Modo iframe — para sitios que sí lo permiten */
function showIframeBrowser(app) {
  // Contenedor del iframe — deja espacio arriba para la barra
  const overlay = document.createElement('div');
  overlay.id = 'inapp-browser';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#000;display:flex;flex-direction:column;';

  // Barra superior SIEMPRE visible, fuera del iframe, z-index máximo
  const topbar = document.createElement('div');
  topbar.style.cssText = `
    flex-shrink:0;
    display:flex;align-items:center;gap:12px;
    height:48px;padding:0 16px;
    background:rgba(7,7,16,0.97);
    border-bottom:1px solid rgba(255,255,255,0.1);
    z-index:9001;
  `;
  topbar.innerHTML = `
    <button id="inapp-back" style="
      display:flex;align-items:center;gap:8px;
      background:rgba(255,255,255,0.1);
      border:1px solid rgba(255,255,255,0.15);
      color:#fff;padding:7px 16px;border-radius:8px;
      font-size:0.85rem;font-family:Inter,sans-serif;
      cursor:pointer;flex-shrink:0;
    ">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="15,18 9,12 15,6"/>
      </svg>
      MythOS TV
    </button>
    <span style="font-size:1.1rem;">${app.emoji || '🌐'}</span>
    <span style="font-size:0.9rem;font-weight:500;color:#f0f0fa;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">
      ${app.label}
    </span>
  `;

  // iframe ocupa el resto de la pantalla debajo de la barra
  const frame = document.createElement('iframe');
  frame.id = 'inapp-frame';
  frame.src = app.url;
  frame.style.cssText = 'flex:1;border:none;width:100%;';
  frame.allowFullscreen = true;
  frame.setAttribute('allow', 'autoplay; fullscreen; encrypted-media');

  overlay.appendChild(topbar);
  overlay.appendChild(frame);
  document.body.appendChild(overlay);

  function doClose() {
    document.removeEventListener('keydown', handleInAppKey);
    overlay.remove();
    document.addEventListener('keydown', handleKey);
    state.focusZone = 'dock';
    focusTile(state.focusIndex || 0);
  }

  document.getElementById('inapp-back').addEventListener('click', doClose);
  document.addEventListener('keydown', handleInAppKey);
  // Guardar referencia para handleInAppKey
  overlay._close = doClose;

  // Detectar bloqueo de iframe tras 4s
  const timer = setTimeout(() => {
    try {
      if (!frame.contentDocument || !frame.contentDocument.body ||
          frame.contentDocument.body.innerHTML === '') {
        doClose();
        showNativeLauncher(app);
      }
    } catch {
      doClose();
      showNativeLauncher(app);
    }
  }, 4000);

  frame.addEventListener('load', () => clearTimeout(timer));
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
   GRID NAVIGATION
   ══════════════════════════════════════════════════════════════ */
function initGridNavigation(selector, cols) {
  let idx = 0;
  function getItems() { return [...document.querySelectorAll(selector)]; }
  function focus(i) {
    const items = getItems();
    if (!items.length) return;
    idx = Math.max(0, Math.min(i, items.length - 1));
    items.forEach((el, j) => { el.classList.toggle('focused', j === idx); el.setAttribute('tabindex', j === idx ? '0' : '-1'); });
    items[idx].scrollIntoView({ block: 'nearest' });
  }
  function handler(e) {
    const items = getItems();
    if (!items.length) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); focus(idx + 1); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); focus(idx - 1); }
    if (e.key === 'ArrowDown')  { e.preventDefault(); focus(idx + cols); }
    if (e.key === 'ArrowUp')    { e.preventDefault(); focus(idx - cols); }
    if (e.key === 'Enter')      { items[idx]?.click(); }
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      document.removeEventListener('keydown', handler);
      navigateTo('home', 'Inicio');
    }
  }
  document.removeEventListener('keydown', handleKey);
  document.addEventListener('keydown', handler);
  focus(0);
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
   SERVICE WORKER
   ══════════════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then(reg => console.log('[MythOS TV] SW:', reg.scope))
      .catch(err => console.warn('[MythOS TV] SW error:', err));
  });
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
