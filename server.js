/* ═══════════════════════════════════════════════════════════════
   MyTV OS — server.js
   Backend Express: sirve config global, protege admin, proxy M3U
   Puerto: 3000 (Nginx hace proxy desde /api/)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const https    = require('https');
const http     = require('http');

const app  = express();
const PORT = 3000;

// ── Config files stored next to server.js ───────────────────────
const DATA_DIR  = path.join(__dirname, 'data');
const CFG_FILE  = path.join(DATA_DIR, 'config.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

// ── Ensure data dir exists ───────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Default config ───────────────────────────────────────────────
const DEFAULT_CONFIG = {
  systemName:   'MyTV OS',
  wallpaper:    'default',
  glassEnabled: true,
  soundEnabled: true,
  launcher: [
    { id:'jellyfin', label:'Jellyfin',      sublabel:'Media Server',     emoji:'🎬', type:'external', url:'http://localhost:8096', color:'purple', badge:'MEDIA'  },
    { id:'livetv',   label:'Live TV',       sublabel:'Canales en vivo',  emoji:'📺', type:'internal', screen:'livetv',            color:'cyan',   badge:'LIVE'   },
    { id:'movies',   label:'Películas',     sublabel:'VOD',              emoji:'🎬', type:'internal', screen:'movies',            color:'orange', badge:'VOD'    },
    { id:'radio',    label:'Radio',         sublabel:'Estaciones',       emoji:'📻', type:'internal', screen:'radio',             color:'green',  badge:'AUDIO'  },
    { id:'youtube',  label:'YouTube',       sublabel:'Streaming',        emoji:'▶️', type:'external', url:'https://www.youtube.com/tv', color:'red', badge:'WEB' },
    { id:'plex',     label:'Plex',          sublabel:'Media Player',     emoji:'🟡', type:'external', url:'https://app.plex.tv',  color:'yellow', badge:'MEDIA'  },
    { id:'twitch',   label:'Twitch',        sublabel:'En vivo',          emoji:'🎮', type:'external', url:'https://www.twitch.tv',color:'purple', badge:'LIVE'   },
    { id:'settings', label:'Configuración', sublabel:'Sistema',          emoji:'⚙️', type:'internal', screen:'settings',          color:'blue'                   },
  ],
  livetv:  [],
  movies:  [],
  radio:   [
    { name:'Osa Radio Online', genre:'Recuerdos', emoji:'🎸', url:'https://radioscr.digitaltvcr.xyz/listen/osaonline/osaradio' },
    { name:'RadioActiva',      genre:'Top 40',    emoji:'🎵', url:'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIOACTIVACOSTARICA.mp3' },
  ],
};

// ── Load / save config ───────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CFG_FILE)) return JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
  } catch {}
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function saveConfig(cfg) {
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

// ── Auth helpers ─────────────────────────────────────────────────
function loadAuth() {
  try {
    if (fs.existsSync(AUTH_FILE)) return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {}
  // Default credentials — change on first login
  return { user: 'admin', passHash: hashPass('admin123') };
}

function hashPass(p) {
  return crypto.createHash('sha256').update(p + 'mytv-salt-2024').digest('hex');
}

function checkAuth(req) {
  const token = req.headers['x-admin-token'] || req.query.token;
  const auth  = loadAuth();
  return token && token === auth.token;
}

// ── Middleware ───────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// CORS — allow same origin and local network
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, Range');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── PUBLIC: Get full config (all devices read this) ──────────────
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

// ── PUBLIC: Admin login ──────────────────────────────────────────
app.post('/api/admin/login', (req, res) => {
  const { user, pass } = req.body;
  const auth = loadAuth();

  if (user === auth.user && hashPass(pass) === auth.passHash) {
    // Generate session token (valid until server restart — fine for home use)
    if (!auth.token) auth.token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
    return res.json({ ok: true, token: auth.token });
  }
  res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
});

// ── PROTECTED: Change password ───────────────────────────────────
app.post('/api/admin/change-password', (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  const { user, pass } = req.body;
  if (!user || !pass || pass.length < 6) return res.status(400).json({ error: 'Usuario y contraseña requeridos (min 6 chars)' });
  const auth = loadAuth();
  auth.user     = user;
  auth.passHash = hashPass(pass);
  auth.token    = crypto.randomBytes(32).toString('hex'); // invalidate old sessions
  fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
  res.json({ ok: true, token: auth.token });
});

// ── PROTECTED: Save full config ──────────────────────────────────
app.post('/api/admin/config', (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  try {
    const cfg = req.body;
    if (!cfg || typeof cfg !== 'object') return res.status(400).json({ error: 'Config inválida' });
    saveConfig(cfg);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PROTECTED: Proxy M3U (evita CORS desde el browser) ──────────
app.get('/api/admin/fetch-m3u', async (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url param required' });

  try {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { headers: { 'User-Agent': 'MyTV-OS/1.0' } }, (upstream) => {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      upstream.pipe(res);
    }).on('error', e => res.status(500).json({ error: e.message }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUBLIC: Proxy de stream (resuelve CORS para .mp4/.m3u8 externos) ──
// NOTA: NO usa checkAuth — lo llama el player de cualquier TV/dispositivo,
// no solo el panel admin. La seguridad acá es la whitelist de hosts.
const ALLOWED_PROXY_HOSTS = [
  'objectstorage.oracle.com',
  'archive.org',
  'us.archive.org',
  'ia801409.us.archive.org', // ejemplos archive.org — ajustar según tus listas reales
  'ia800504.us.archive.org',
];

function hostAllowed(hostname) {
  return ALLOWED_PROXY_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h));
}

function proxyStream(targetUrl, req, res, redirectsLeft) {
  let parsed;
  try { parsed = new URL(targetUrl); }
  catch { return res.status(400).json({ error: 'url inválida' }); }

  if (!hostAllowed(parsed.hostname)) {
    return res.status(403).json({ error: 'host no permitido: ' + parsed.hostname });
  }

  const proto = parsed.protocol === 'https:' ? https : http;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1',
  };
  if (req.headers.range) headers['Range'] = req.headers.range; // necesario para "seek" en <video>

  const upstreamReq = proto.get(targetUrl, { headers }, (upstream) => {
    // Seguir redirecciones (muy común en object storage / CDN)
    if ([301, 302, 303, 307, 308].includes(upstream.statusCode) && upstream.headers.location && redirectsLeft > 0) {
      upstream.resume(); // descartar body del redirect
      const nextUrl = new URL(upstream.headers.location, targetUrl).toString();
      return proxyStream(nextUrl, req, res, redirectsLeft - 1);
    }

    res.statusCode = upstream.statusCode;
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    if (upstream.headers['content-range'])  res.setHeader('Content-Range', upstream.headers['content-range']);
    if (upstream.headers['accept-ranges'])  res.setHeader('Accept-Ranges', upstream.headers['accept-ranges']);
    upstream.pipe(res);
  });

  upstreamReq.on('error', (e) => {
    if (!res.headersSent) res.status(502).json({ error: e.message });
  });

  req.on('close', () => upstreamReq.destroy());
}

app.get('/api/proxy-stream', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url requerida' });
  proxyStream(url, req, res, 3);
});

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[MyTV OS] API server running on http://127.0.0.1:${PORT}`);
  // Init config if not exists
  if (!fs.existsSync(CFG_FILE)) {
    saveConfig(DEFAULT_CONFIG);
    console.log('[MyTV OS] Default config created at', CFG_FILE);
  }
  if (!fs.existsSync(AUTH_FILE)) {
    const auth = { user: 'admin', passHash: hashPass('admin123'), token: crypto.randomBytes(32).toString('hex') };
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
    console.log('[MyTV OS] Auth created — user: admin / pass: admin123 — CAMBIA ESTO');
  }
});
