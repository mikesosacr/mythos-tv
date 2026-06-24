/* ═══════════════════════════════════════════════════════════════
   MyTV OS — app.js
   Full OS runtime: boot, router, remote nav, apps, settings
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ── CONFIG ─────────────────────────────────────────────────────
   Edit these to configure your apps.
   External: opens link in new tab (with confirmation)
   Internal: loads built-in screen (screen-iptv, screen-radio, etc.)
   ──────────────────────────────────────────────────────────────── */
const DEFAULT_APPS = [
  {
    id: 'jellyfin',
    label: 'Jellyfin',
    sublabel: 'Media Server',
    emoji: '🎬',
    type: 'external',
    url: 'http://localhost:8096',
    color: 'purple',
    badge: 'MEDIA',
  },
  {
    id: 'iptv',
    label: 'IPTV',
    sublabel: 'TV en vivo',
    emoji: '📺',
    type: 'internal',
    screen: 'iptv',
    color: 'cyan',
    badge: 'LIVE',
  },
  {
    id: 'radio',
    label: 'Radio',
    sublabel: 'Estaciones',
    emoji: '📻',
    type: 'internal',
    screen: 'radio',
    color: 'green',
    badge: 'AUDIO',
  },
  {
    id: 'videos',
    label: 'Videos',
    sublabel: 'Biblioteca',
    emoji: '🎥',
    type: 'internal',
    screen: 'videos',
    color: 'orange',
    badge: 'LOCAL',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    sublabel: 'Streaming',
    emoji: '▶️',
    type: 'external',
    url: 'https://www.youtube.com/tv',
    color: 'red',
    badge: 'WEB',
  },
  {
    id: 'plex',
    label: 'Plex',
    sublabel: 'Media Player',
    emoji: '🟡',
    type: 'external',
    url: 'https://app.plex.tv',
    color: 'yellow',
    badge: 'MEDIA',
  },
  {
    id: 'twitch',
    label: 'Twitch',
    sublabel: 'Streaming en vivo',
    emoji: '🎮',
    type: 'external',
    url: 'https://www.twitch.tv',
    color: 'purple',
    badge: 'LIVE',
  },
  {
    id: 'settings',
    label: 'Configuración',
    sublabel: 'Sistema',
    emoji: '⚙️',
    type: 'internal',
    screen: 'settings',
    color: 'blue',
  },
];

/* ── STATE ───────────────────────────────────────────────────── */
const state = {
  apps: [],
  currentScreen: 'home',
  focusIndex: 0,
  soundEnabled: true,
  glassEnabled: true,
  systemName: 'MyTV OS',
  wallpaper: 'default',
  radioPlaying: false,
  currentRadioStation: 0,
  radioAudio: null,
};

/* ── LOAD STATE FROM localStorage ───────────────────────────── */
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem('mytv-os-state') || '{}');
    state.systemName  = saved.systemName  || 'MyTV OS';
    state.soundEnabled= saved.soundEnabled !== undefined ? saved.soundEnabled : true;
    state.glassEnabled= saved.glassEnabled !== undefined ? saved.glassEnabled : true;
    state.wallpaper   = saved.wallpaper   || 'default';
    // Merge saved app URLs into DEFAULT_APPS
    state.apps = DEFAULT_APPS.map(app => ({
      ...app,
      url: (saved.appUrls && saved.appUrls[app.id]) || app.url,
    }));
  } catch {
    state.apps = [...DEFAULT_APPS];
  }
}

function saveState() {
  const appUrls = {};
  state.apps.forEach(a => { if (a.url) appUrls[a.id] = a.url; });
  localStorage.setItem('mytv-os-state', JSON.stringify({
    systemName:   state.systemName,
    soundEnabled: state.soundEnabled,
    glassEnabled: state.glassEnabled,
    wallpaper:    state.wallpaper,
    appUrls,
  }));
}

/* ══════════════════════════════════════════════════════════════
   BOOT SEQUENCE
   ══════════════════════════════════════════════════════════════ */
const BOOT_MESSAGES = [
  'Iniciando MyTV OS…',
  'Cargando módulos del sistema…',
  'Preparando launcher…',
  'Configurando apps…',
  'Listo para usar',
];

async function boot() {
  loadState();

  const fill    = document.getElementById('boot-bar-fill');
  const status  = document.getElementById('boot-status');
  const bootEl  = document.getElementById('boot-screen');
  const appEl   = document.getElementById('app');

  // Progress animation
  for (let i = 0; i < BOOT_MESSAGES.length; i++) {
    await delay(340 + Math.random() * 160);
    const pct = Math.round(((i + 1) / BOOT_MESSAGES.length) * 100);
    fill.style.width   = pct + '%';
    status.textContent = BOOT_MESSAGES[i];
  }

  await delay(400);

  // Show app shell
  appEl.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      appEl.classList.add('visible');
    });
  });

  // Init UI before removing boot
  initUI();

  await delay(100);
  bootEl.classList.add('fade-out');

  await delay(650);
  bootEl.style.display = 'none';
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

  // Default focus on first tile
  focusTile(0);
}

/* ── Clock ───────────────────────────────────────────────────── */
function initClock() {
  function tick() {
    const now = new Date();
    const hh  = String(now.getHours()).padStart(2, '0');
    const mm  = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('topbar-time').textContent = `${hh}:${mm}`;

    const days  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
    const month = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    document.getElementById('topbar-date').textContent =
      `${days[now.getDay()]} ${now.getDate()} ${month[now.getMonth()]}`;

    // Greeting
    const h = now.getHours();
    const greeting = h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    const greetEl = document.getElementById('home-greeting');
    if (greetEl) greetEl.textContent = greeting;
  }
  tick();
  setInterval(tick, 30000);
}

/* ── Apply Settings ──────────────────────────────────────────── */
function applySettings(animate = true) {
  // Wallpaper
  document.body.className = '';
  if (state.wallpaper && state.wallpaper !== 'default') {
    document.body.classList.add(`wallpaper-${state.wallpaper}`);
  }
  // Glass
  document.body.classList.toggle('no-glass', !state.glassEnabled);
  // System name in topbar title
  document.title = state.systemName;
}

/* ══════════════════════════════════════════════════════════════
   APP GRID RENDERER
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
    tile.addEventListener('mouseenter', () => {
      state.focusIndex = i;
      updateTileFocus();
    });

    grid.appendChild(tile);
  });
}

/* ── Focus Management ────────────────────────────────────────── */
function getTiles() {
  return [...document.querySelectorAll('.app-tile')];
}

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
  const focused = tiles[state.focusIndex];
  if (focused) {
    focused.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
}

/* ══════════════════════════════════════════════════════════════
   REMOTE CONTROL / KEYBOARD NAVIGATION
   ══════════════════════════════════════════════════════════════ */
function initRemoteNav() {
  document.addEventListener('keydown', handleKey);
}

function handleKey(e) {
  const key = e.key;

  // Prevent default for navigation keys
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Backspace','Escape'].includes(key)) {
    e.preventDefault();
  }

  if (state.currentScreen === 'home') {
    handleHomeKey(key);
  } else if (state.currentScreen === 'settings') {
    handleSettingsKey(key);
  } else {
    handleAppKey(key);
  }
}

function handleHomeKey(key) {
  const tiles = getTiles();
  if (!tiles.length) return;

  // Compute columns from grid layout
  const grid = document.getElementById('app-grid');
  const gridWidth = grid.offsetWidth;
  const tileWidth = tiles[0].offsetWidth + parseInt(getComputedStyle(grid).gap || '24');
  const cols = Math.max(1, Math.floor(gridWidth / tileWidth));

  switch (key) {
    case 'ArrowRight':
      playSnd('nav');
      focusTile((state.focusIndex + 1) % tiles.length);
      break;
    case 'ArrowLeft':
      playSnd('nav');
      focusTile((state.focusIndex - 1 + tiles.length) % tiles.length);
      break;
    case 'ArrowDown':
      playSnd('nav');
      focusTile(Math.min(state.focusIndex + cols, tiles.length - 1));
      break;
    case 'ArrowUp':
      playSnd('nav');
      focusTile(Math.max(state.focusIndex - cols, 0));
      break;
    case 'Enter': {
      playSnd('enter');
      const app = state.apps[state.focusIndex];
      if (app) launchApp(app);
      break;
    }
  }
}

function handleSettingsKey(key) {
  if (key === 'Backspace' || key === 'Escape') {
    playSnd('nav');
    navigateTo('home');
  }
}

function handleAppKey(key) {
  if (key === 'Backspace' || key === 'Escape') {
    playSnd('nav');
    navigateTo('home');
  }
}

/* ══════════════════════════════════════════════════════════════
   ROUTER / NAVIGATION
   ══════════════════════════════════════════════════════════════ */
function navigateTo(screenId, title, renderFn) {
  const current = document.querySelector('.screen.active');
  const next    = document.getElementById(`screen-${screenId === 'home' ? 'home' : (screenId === 'settings' ? 'settings' : 'app')}`);

  if (!next || next === current) return;

  // Exit current
  if (current) {
    current.classList.add('exit-left');
    setTimeout(() => {
      current.classList.remove('active', 'exit-left');
    }, 300);
  }

  // Enter next
  next.classList.add('enter-right');
  setTimeout(() => {
    next.classList.add('active');
    next.classList.remove('enter-right');
  }, 30);

  state.currentScreen = screenId;

  // Update topbar title
  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle) {
    topbarTitle.textContent = title || 'Inicio';
  }

  // Run render callback
  if (renderFn) renderFn();

  // Re-init grid focus if going home
  if (screenId === 'home') {
    setTimeout(() => focusTile(state.focusIndex), 350);
  }
}

/* ══════════════════════════════════════════════════════════════
   APP LAUNCHER
   ══════════════════════════════════════════════════════════════ */
function launchApp(app) {
  if (app.type === 'external') {
    showLinkModal(app);
    return;
  }

  switch (app.screen) {
    case 'settings': openSettings(); break;
    case 'iptv':    openIPTV();     break;
    case 'radio':   openRadio();    break;
    case 'videos':  openVideos();   break;
    default:        openGenericApp(app); break;
  }
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
      <div class="modal-desc" id="modal-desc">¿Deseas abrir esta app?</div>
      <div class="modal-url" id="modal-url">—</div>
      <div class="modal-buttons">
        <button class="modal-btn modal-btn-cancel" id="modal-cancel">Cancelar</button>
        <button class="modal-btn modal-btn-confirm" id="modal-confirm">Abrir ahora</button>
      </div>
    </div>
  `;
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

  const confirmBtn = document.getElementById('modal-confirm');
  confirmBtn.onclick = () => {
    if (_modalApp && _modalApp.url) {
      window.open(_modalApp.url, '_blank');
    }
    closeModal();
  };

  document.getElementById('link-modal').classList.add('active');

  // Keyboard for modal
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

/* ── Settings Screen ────────────────────────────────────────── */
function openSettings() {
  navigateTo('settings', 'Configuración', () => {
    renderSettingsAppList();
    syncSettingsUI();
    initSettingsListeners();
  });
}

function syncSettingsUI() {
  document.getElementById('setting-system-name').value = state.systemName;
  document.getElementById('setting-wallpaper').value   = state.wallpaper;
  document.getElementById('setting-glass').checked     = state.glassEnabled;
  document.getElementById('setting-sound').checked     = state.soundEnabled;
}

function renderSettingsAppList() {
  const list = document.getElementById('settings-apps-list');
  list.innerHTML = '';
  state.apps.filter(a => a.type === 'external').forEach(app => {
    const item = document.createElement('div');
    item.className = 'settings-app-item';
    item.innerHTML = `
      <div class="settings-app-name">
        <span class="app-emoji">${app.emoji}</span>
        ${app.label}
      </div>
      <div class="settings-app-url-row">
        <input type="url" class="settings-url-input" data-app-id="${app.id}"
          placeholder="https://..." value="${app.url || ''}" />
      </div>
    `;
    list.appendChild(item);
  });
}

function initSettingsListeners() {
  // Avoid duplicate listeners
  const backBtn  = document.getElementById('settings-back');
  const saveBtn  = document.getElementById('settings-save');
  if (backBtn._init) return;
  backBtn._init = true;

  backBtn.addEventListener('click', () => navigateTo('home', 'Inicio'));

  saveBtn.addEventListener('click', () => {
    // Read system settings
    state.systemName  = document.getElementById('setting-system-name').value.trim() || 'MyTV OS';
    state.wallpaper   = document.getElementById('setting-wallpaper').value;
    state.glassEnabled= document.getElementById('setting-glass').checked;
    state.soundEnabled= document.getElementById('setting-sound').checked;

    // Read app URLs
    document.querySelectorAll('.settings-url-input').forEach(inp => {
      const id = inp.dataset.appId;
      const app = state.apps.find(a => a.id === id);
      if (app) app.url = inp.value.trim();
    });

    saveState();
    applySettings();
    showToast('✅ Configuración guardada');
    setTimeout(() => navigateTo('home', 'Inicio'), 800);
  });
}

/* ── IPTV Screen ─────────────────────────────────────────────── */
const IPTV_CHANNELS = [
  { name: 'Teletica',    cat: 'Nacional',     emoji: '📺', url: '' },
  { name: 'Repretel',   cat: 'Nacional',     emoji: '📡', url: '' },
  { name: 'Canal 15',   cat: 'Nacional',     emoji: '🎙️', url: '' },
  { name: 'CNN en Español', cat: 'Noticias', emoji: '🌐', url: '' },
  { name: 'ESPN',        cat: 'Deportes',    emoji: '⚽', url: '' },
  { name: 'Fox Sports',  cat: 'Deportes',    emoji: '🏆', url: '' },
  { name: 'HBO Max',     cat: 'Entretenimiento', emoji: '🎭', url: '' },
  { name: 'Netflix TV',  cat: 'Entretenimiento', emoji: '🍿', url: 'https://www.netflix.com/browse' },
  { name: 'Disney+',     cat: 'Familia',     emoji: '🏰', url: '' },
  { name: 'Animal Planet', cat: 'Naturaleza', emoji: '🦁', url: '' },
  { name: 'Discovery',   cat: 'Documental',  emoji: '🔭', url: '' },
  { name: 'MTV',         cat: 'Música',      emoji: '🎸', url: '' },
];

function openIPTV() {
  navigateTo('app', 'IPTV · TV en Vivo', () => {
    const title = document.getElementById('app-screen-title');
    const body  = document.getElementById('app-screen-body');
    const back  = document.getElementById('app-back');
    title.textContent = 'IPTV · TV en Vivo';

    back.onclick = () => navigateTo('home', 'Inicio');

    body.innerHTML = `
      <div style="width:100%;padding:10px 0 20px;display:flex;align-items:center;gap:12px;">
        <span style="font-size:0.8rem;color:var(--text-muted);">Configura las URLs m3u de tus canales en Configuración</span>
        <span style="background:rgba(239,68,68,0.15);color:#ef4444;padding:3px 10px;border-radius:20px;font-size:0.7rem;font-weight:700;letter-spacing:0.06em;">● LIVE</span>
      </div>
      <div class="iptv-grid">
        ${IPTV_CHANNELS.map((ch, i) => `
          <a class="iptv-channel" href="${ch.url || '#'}" ${ch.url ? 'target="_blank"' : ''} role="button" tabindex="${i === 0 ? 0 : -1}">
            <div class="iptv-channel-logo">${ch.emoji}</div>
            <div class="iptv-channel-name">${ch.name}</div>
            <div class="iptv-channel-cat">${ch.cat}</div>
          </a>
        `).join('')}
      </div>
    `;

    // Arrow nav for iptv channels
    initGridNavigation('.iptv-channel', 4);
  });
}

/* ── Radio Screen ────────────────────────────────────────────── */
const RADIO_STATIONS = [
  { name: 'RadioActiva',     genre: 'Top 40',     emoji: '🎵', url: 'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIOACTIVACOSTARICA.mp3' },
  { name: 'Bésame',          genre: 'Romántica',  emoji: '❤️',  url: '' },
  { name: 'Rock FM',         genre: 'Rock',       emoji: '🎸', url: '' },
  { name: 'Jazz CR',         genre: 'Jazz',       emoji: '🎷', url: '' },
  { name: 'Radio Nacional',  genre: 'Clásica',    emoji: '🎻', url: '' },
  { name: 'La Nueva',        genre: 'Tropical',   emoji: '🌴', url: '' },
];

function openRadio() {
  navigateTo('app', 'Radio', () => {
    const title = document.getElementById('app-screen-title');
    const body  = document.getElementById('app-screen-body');
    const back  = document.getElementById('app-back');
    title.textContent = 'Radio';
    back.onclick = () => {
      stopRadio();
      navigateTo('home', 'Inicio');
    };

    body.style.cssText = 'align-items:flex-start;padding:0;';
    body.innerHTML = `
      <div class="radio-player" style="width:100%;max-width:100%;display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">
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
          ${RADIO_STATIONS.map((s, i) => `
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

    // Bind radio controls
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
  state.currentRadioStation = i;
  const s = RADIO_STATIONS[i];

  document.getElementById('radio-station-name').textContent  = s.name;
  document.getElementById('radio-station-freq').textContent  = s.genre;
  document.getElementById('radio-disc-emoji').textContent    = s.emoji;

  document.querySelectorAll('.radio-station-item').forEach((el, j) => {
    el.classList.toggle('active', j === i);
  });

  if (state.radioPlaying) startRadioStream(s.url);
}

function toggleRadioPlay() {
  if (state.radioPlaying) {
    stopRadio();
  } else {
    const s = RADIO_STATIONS[state.currentRadioStation];
    startRadioStream(s.url);
  }
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
  } else {
    showToast('ℹ️ URL de stream no configurada');
  }
}

function stopRadio() {
  state.radioPlaying = false;
  if (state.radioAudio) {
    state.radioAudio.pause();
  }
  const playBtn = document.getElementById('radio-play');
  const disc    = document.getElementById('radio-disc');
  if (playBtn) playBtn.textContent = '▶';
  if (disc)    disc.classList.remove('playing');
}

function changeStation(dir) {
  const next = (state.currentRadioStation + dir + RADIO_STATIONS.length) % RADIO_STATIONS.length;
  selectStation(next);
}

/* ── Videos Screen ───────────────────────────────────────────── */
const SAMPLE_VIDEOS = [
  { title: 'Agrega tus videos',    meta: 'Configura tu ruta local',   emoji: '📁' },
  { title: 'Stream externo',       meta: 'Via URL de red',             emoji: '📡' },
  { title: 'Jellyfin integrado',   meta: 'Configura Jellyfin URL',     emoji: '🎬' },
  { title: 'YouTube TV',           meta: 'youtube.com/tv',             emoji: '▶️' },
  { title: 'Plex Media',           meta: 'app.plex.tv',                emoji: '🟡' },
  { title: 'Kodi Link',            meta: 'HTTP local',                 emoji: '🔵' },
];

function openVideos() {
  navigateTo('app', 'Videos', () => {
    const title = document.getElementById('app-screen-title');
    const body  = document.getElementById('app-screen-body');
    const back  = document.getElementById('app-back');
    title.textContent = 'Videos';
    back.onclick = () => navigateTo('home', 'Inicio');

    body.style.cssText = 'align-items:flex-start;padding:0;';
    body.innerHTML = `
      <p style="color:var(--text-muted);font-size:0.8rem;margin-bottom:20px;margin-top:10px;">
        Conecta tu servidor de medios favorito o agrega URLs personalizadas en Configuración.
      </p>
      <div class="video-grid" style="width:100%;">
        ${SAMPLE_VIDEOS.map((v, i) => `
          <div class="video-card" tabindex="${i===0?0:-1}">
            <div class="video-thumb">
              <span style="font-size:3rem;">${v.emoji}</span>
            </div>
            <div class="video-info">
              <div class="video-title">${v.title}</div>
              <div class="video-meta">${v.meta}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    initGridNavigation('.video-card', 3);
  });
}

/* ── Generic App Screen ─────────────────────────────────────── */
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
      <div class="app-placeholder-desc">
        Esta app está lista para conectarse.<br/>
        Configura la URL en <strong>Configuración → Apps &amp; Links</strong>.
      </div>
      ${app.url
        ? `<a class="app-launch-btn" href="${app.url}" target="_blank">
             <span>🚀</span> Abrir ${app.label}
           </a>`
        : `<div style="color:var(--text-muted);font-size:0.82rem;padding:14px 24px;border:1.5px solid var(--border-subtle);border-radius:10px;">
             URL no configurada
           </div>`
      }
    `;
  });
}

/* ══════════════════════════════════════════════════════════════
   GRID NAV (for IPTV, Videos, etc.)
   ══════════════════════════════════════════════════════════════ */
function initGridNavigation(selector, cols) {
  let idx = 0;

  function getItems() { return [...document.querySelectorAll(selector)]; }

  function focus(i) {
    const items = getItems();
    if (!items.length) return;
    idx = Math.max(0, Math.min(i, items.length - 1));
    items.forEach((el, j) => {
      el.classList.toggle('focused', j === idx);
      el.setAttribute('tabindex', j === idx ? '0' : '-1');
    });
    items[idx].scrollIntoView({ block: 'nearest' });
  }

  function handler(e) {
    const items = getItems();
    if (!items.length) return;

    if (e.key === 'ArrowRight')  { e.preventDefault(); focus(idx + 1); }
    if (e.key === 'ArrowLeft')   { e.preventDefault(); focus(idx - 1); }
    if (e.key === 'ArrowDown')   { e.preventDefault(); focus(idx + cols); }
    if (e.key === 'ArrowUp')     { e.preventDefault(); focus(idx - cols); }
    if (e.key === 'Enter')       { items[idx]?.click(); }
    if (e.key === 'Escape' || e.key === 'Backspace') {
      e.preventDefault();
      document.removeEventListener('keydown', handler);
      navigateTo('home', 'Inicio');
    }
  }

  // Remove generic listener temporarily — this one takes over
  document.removeEventListener('keydown', handleKey);
  document.addEventListener('keydown', handler);

  focus(0);
}

/* ══════════════════════════════════════════════════════════════
   FOCUS GLOW (decorative mouse follow)
   ══════════════════════════════════════════════════════════════ */
function initFocusGlow() {
  const glow = document.getElementById('focus-glow');
  document.addEventListener('mousemove', e => {
    const x = (e.clientX / window.innerWidth * 100).toFixed(1) + '%';
    const y = (e.clientY / window.innerHeight * 100).toFixed(1) + '%';
    glow.style.setProperty('--gx', x);
    glow.style.setProperty('--gy', y);
  });
}

/* ══════════════════════════════════════════════════════════════
   AUDIO ENGINE
   ══════════════════════════════════════════════════════════════ */
let _audioCtx = null;

function initAudio() {
  // Lazy init AudioContext on first interaction
  document.addEventListener('click', initAudioCtx, { once: true });
  document.addEventListener('keydown', initAudioCtx, { once: true });
}

function initAudioCtx() {
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { /* silent */ }
}

function playSnd(type) {
  if (!state.soundEnabled || !_audioCtx) return;
  try {
    const osc  = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);

    if (type === 'nav') {
      osc.frequency.value = 660;
      gain.gain.setValueAtTime(0.04, _audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.08);
      osc.start(_audioCtx.currentTime);
      osc.stop(_audioCtx.currentTime + 0.08);
    } else if (type === 'enter') {
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.06, _audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.14);
      osc.start(_audioCtx.currentTime);
      osc.stop(_audioCtx.currentTime + 0.14);
    }
  } catch { /* silent */ }
}

/* ══════════════════════════════════════════════════════════════
   TOAST NOTIFICATION
   ══════════════════════════════════════════════════════════════ */
let _toastTimer = null;

function showToast(msg, duration = 2500) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

/* ══════════════════════════════════════════════════════════════
   SERVICE WORKER REGISTRATION
   ══════════════════════════════════════════════════════════════ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then(reg => console.log('[MyTV OS] SW registrado:', reg.scope))
      .catch(err => console.warn('[MyTV OS] SW error:', err));
  });
}

/* ══════════════════════════════════════════════════════════════
   BACK BUTTON — top-level (settings-back already handled above)
   ══════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Init after DOM ready
  document.getElementById('app-back').addEventListener('click', () => {
    stopRadio();
    navigateTo('home', 'Inicio');
    // Restore main keydown listener
    document.addEventListener('keydown', handleKey);
  });
});

/* ══════════════════════════════════════════════════════════════
   KICK OFF
   ══════════════════════════════════════════════════════════════ */
boot();
