/* ═══════════════════════════════════════════════════════════════
   MyTV OS — app.js v2.0
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
  systemName:          'MyTV OS',
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
  state.systemName   = cfg.systemName   || 'MyTV OS';
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
  'Iniciando MyTV OS…',
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
function initUI() {
  applySettings(false);
  renderAppGrid();
  initClock();
  initRemoteNav();
  initFocusGlow();
  initAudio();
  createModal();
  focusTile(0);
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
      <div class="tile-icon">${app.emoji}</div>
      <div class="tile-label">${app.label}</div>
      ${app.sublabel ? `<div class="tile-sublabel">${app.sublabel}</div>` : ''}
    `;
    tile.addEventListener('click', () => launchApp(app));
    tile.addEventListener('mouseenter', () => { state.focusIndex = i; updateTileFocus(); });
    grid.appendChild(tile);
  });
}

function getTiles() { return [...document.querySelectorAll('.app-tile')]; }

function focusTile(index) {
  const tiles = getTiles();
  if (!tiles.length) return;
  state.focusIndex = Math.max(0, Math.min(index, tiles.length - 1));
  updateTileFocus();
}

function updateTileFocus() {
  const tiles = getTiles();
  tiles.forEach((t, i) => {
    t.classList.toggle('focused', i === state.focusIndex);
    t.setAttribute('tabindex', i === state.focusIndex ? '0' : '-1');
  });
  tiles[state.focusIndex]?.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'nearest' });
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
  const tiles = getTiles();
  if (!tiles.length) return;
  const grid = document.getElementById('app-grid');
  const tileW = tiles[0].offsetWidth + parseInt(getComputedStyle(grid).gap || '24');
  const cols  = Math.max(1, Math.floor(grid.offsetWidth / tileW));
  switch (key) {
    case 'ArrowRight': playSnd('nav'); focusTile((state.focusIndex + 1) % tiles.length); break;
    case 'ArrowLeft':  playSnd('nav'); focusTile((state.focusIndex - 1 + tiles.length) % tiles.length); break;
    case 'ArrowDown':  playSnd('nav'); focusTile(Math.min(state.focusIndex + cols, tiles.length - 1)); break;
    case 'ArrowUp':    playSnd('nav'); focusTile(Math.max(state.focusIndex - cols, 0)); break;
    case 'Enter': { playSnd('enter'); const app = state.apps[state.focusIndex]; if (app) launchApp(app); break; }
  }
}
function handleSettingsKey(key) { if (key === 'Backspace' || key === 'Escape') { playSnd('nav'); navigateTo('home'); } }
function handleAppKey(key) { if (key === 'Backspace' || key === 'Escape') { playSnd('nav'); stopAll(); navigateTo('home'); } }

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
  const tb = document.getElementById('topbar-title');
  if (tb) tb.textContent = title || 'Inicio';
  if (renderFn) renderFn();
  if (screenId === 'home') setTimeout(() => focusTile(state.focusIndex), 350);
}

/* ══════════════════════════════════════════════════════════════
   APP LAUNCHER
   ══════════════════════════════════════════════════════════════ */
function launchApp(app) {
  if (app.type === 'external') { showLinkModal(app); return; }
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
function stopHLS() {
  if (state.hlsInstance) { state.hlsInstance.destroy(); state.hlsInstance = null; }
  const v = document.getElementById('hls-video');
  if (v) { v.pause(); v.src = ''; }
}

function playStream(url, title) {
  stopHLS();

  // Show fullscreen player overlay
  let overlay = document.getElementById('player-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'player-overlay';
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
          font-size:1.1rem;padding:8px 14px;border-radius:8px;cursor:pointer;
        ">← Atrás</button>
        <span id="player-title" style="color:#fff;font-size:1rem;font-weight:600;"></span>
        <span id="player-live-badge" style="
          background:rgba(239,68,68,0.8);color:#fff;padding:3px 10px;
          border-radius:20px;font-size:0.7rem;font-weight:700;
        ">● LIVE</span>
        <div style="flex:1"></div>
        <span id="player-status" style="color:rgba(255,255,255,0.5);font-size:0.75rem;"></span>
      </div>
      <video id="hls-video" style="width:100%;height:100%;object-fit:contain;" playsinline></video>
      <div id="player-loading" style="
        position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
        background:rgba(0,0,0,0.6);z-index:3;
      ">
        <div style="text-align:center;color:#fff;">
          <div style="font-size:2.5rem;margin-bottom:12px;">⏳</div>
          <div style="font-size:0.9rem;opacity:0.7;">Cargando stream…</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('player-back').onclick = () => {
      stopHLS();
      overlay.remove();
      document.addEventListener('keydown', handleKey);
    };

    // Hide controls on mouse idle
    let hideTimer;
    overlay.addEventListener('mousemove', () => {
      document.getElementById('player-topbar').style.opacity = '1';
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        document.getElementById('player-topbar').style.opacity = '0';
      }, 3000);
    });

    // Keyboard inside player
    document.removeEventListener('keydown', handleKey);
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        stopHLS(); overlay.remove();
        document.addEventListener('keydown', handleKey);
      }
      if (e.key === ' ' || e.key === 'Enter') {
        const v = document.getElementById('hls-video');
        v?.paused ? v.play() : v?.pause();
      }
    });
  }

  document.getElementById('player-title').textContent = title || '';
  document.getElementById('player-status').textContent = '';

  const video   = document.getElementById('hls-video');
  const loading = document.getElementById('player-loading');
  const status  = document.getElementById('player-status');

  video.addEventListener('playing', () => { loading.style.display = 'none'; }, { once: true });
  video.addEventListener('waiting', () => { loading.style.display = 'flex'; });
  video.addEventListener('canplay', () => { loading.style.display = 'none'; });

  // Detectar tipo de stream:
  //  - .m3u8  -> HLS.js / HLS nativo (Safari, smart TVs)
  //  - cualquier otra cosa (.mp4, .mkv, sin extensión, etc.) -> <video> nativo
  //    a través del proxy del servidor, para evitar el bloqueo CORS de
  //    servidores externos (object storage, archive.org, etc.)
  const isM3U8 = /\.m3u8(\?|#|$)/i.test(url);

  if (!isM3U8) {
    const proxied = `${API}/proxy-stream?url=${encodeURIComponent(url)}`;
    video.src = proxied;
    video.play().catch(() => showToast('⚠️ El navegador bloqueó el autoplay'));
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
      });
    });

    renderChannelList(activeCat);
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
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;width:100%;padding:4px;">
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
  if (url) {
    if (!state.radioAudio) state.radioAudio = new Audio();
    state.radioAudio.src = url;
    state.radioAudio.play().catch(() => {
      showToast('⚠️ No se pudo cargar el stream');
      state.radioPlaying = false;
      document.getElementById('radio-play').textContent = '▶';
      document.getElementById('radio-disc').classList.remove('playing');
    });
  } else { showToast('ℹ️ URL de stream no configurada'); }
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
  });
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
    state.systemName   = document.getElementById('setting-system-name').value.trim() || 'MyTV OS';
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
      ${app.url ? `<a class="app-launch-btn" href="${app.url}" target="_blank"><span>🚀</span> Abrir ${app.label}</a>` : ''}
    `;
  });
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
      .then(reg => console.log('[MyTV OS] SW:', reg.scope))
      .catch(err => console.warn('[MyTV OS] SW error:', err));
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
boot();
