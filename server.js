/* ═══════════════════════════════════════════════════════════════
   MythOS TV — server.js
   Backend Express: sirve config global, protege admin, proxy M3U
   Puerto: 3000 (Nginx hace proxy desde /api/)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

require('dotenv').config();

const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');
const https    = require('https');
const http     = require('http');
const dns      = require('dns');
const net      = require('net');

const TMDB_KEY = process.env.TMDB_API_KEY || '';

const app  = express();
const PORT = 3000;

// ── Config files stored next to server.js ───────────────────────
const DATA_DIR  = path.join(__dirname, 'data');
const CFG_FILE  = path.join(DATA_DIR, 'config.json');
const AUTH_FILE  = path.join(DATA_DIR, 'auth.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');

// ── Ensure data dir exists ───────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Default config ───────────────────────────────────────────────
const DEFAULT_CONFIG = {
  systemName:   'MythOS TV',
  wallpaper:    'default',
  glassEnabled: true,
  soundEnabled: true,
  timeFormat:   '24h',
  timezone:     'America/Costa_Rica',
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
    if (fs.existsSync(CFG_FILE)) return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) };
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
    proto.get(url, { headers: { 'User-Agent': 'MythOS-TV/1.0' } }, (upstream) => {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      upstream.pipe(res);
    }).on('error', e => res.status(500).json({ error: e.message }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUBLIC: Proxy de stream (resuelve CORS para .mp4/.m3u8 externos) ──
// NOTA: NO usa checkAuth — lo llama el player de cualquier TV/dispositivo,
// no solo el panel admin. No hay whitelist de hosts (jala cualquier URL
// pública de tus listas M3U); la única protección es bloquear IPs
// privadas/internas para que el proxy no se pueda usar contra tu propia
// red interna o el endpoint de metadata de la nube (169.254.169.254, etc).
function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local + metadata cloud
    if (p[0] === 0) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1') return true;
    if (l.startsWith('fc') || l.startsWith('fd')) return true; // unique local
    if (l.startsWith('fe80')) return true; // link-local
    return false;
  }
  return true; // si no se puede determinar, bloquear por precaución
}

function hostAllowed(hostname, cb) {
  if (net.isIP(hostname)) return cb(!isPrivateIP(hostname));
  dns.lookup(hostname, (err, address) => {
    if (err) return cb(false);
    cb(!isPrivateIP(address));
  });
}

function proxyStream(targetUrl, req, res, redirectsLeft) {
  let parsed;
  try { parsed = new URL(targetUrl); }
  catch { return res.status(400).json({ error: 'url inválida' }); }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'protocolo no soportado' });
  }

  hostAllowed(parsed.hostname, (ok) => {
    if (!ok) return res.status(403).json({ error: 'host bloqueado (IP privada/interna)' });

    const proto = parsed.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive',
    };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const upstreamReq = proto.get(targetUrl, { headers, timeout: 15000 }, (upstream) => {
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

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy();
      if (!res.headersSent) res.status(504).json({ error: 'timeout conectando al stream' });
    });

    upstreamReq.on('error', (e) => {
      if (!res.headersSent) res.status(502).json({ error: e.message });
    });

    req.on('close', () => upstreamReq.destroy());
  });
}

app.get('/api/proxy-stream', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url requerida' });
  proxyStream(url, req, res, 3);
});

// ── PUBLIC: Proxy reescritor de manifiestos M3U8 ────────────────
// Resuelve el problema de CORS en streams HLS de servidores externos:
// descarga el manifiesto .m3u8, reescribe todas las URLs de segmentos
// .ts y sub-manifiestos para que pasen por /api/proxy-stream, y
// devuelve el manifiesto modificado al browser. Así hls.js nunca
// contacta el origen directamente y CORS deja de ser un problema.
//
// Uso: /api/proxy-m3u8?url=<url_del_manifiesto>
// No toca el flujo existente de proxy-stream ni el player directo.
app.get('/api/proxy-m3u8', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url requerida' });

  let parsed;
  try { parsed = new URL(url); }
  catch { return res.status(400).json({ error: 'url inválida' }); }

  hostAllowed(parsed.hostname, (ok) => {
    if (!ok) return res.status(403).json({ error: 'host bloqueado' });

    const proto = parsed.protocol === 'https:' ? https : http;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Connection': 'keep-alive',
    };

    const upstreamReq = proto.get(url, { headers, timeout: 15000 }, (upstream) => {
      // Seguir redirecciones
      if ([301,302,303,307,308].includes(upstream.statusCode) && upstream.headers.location) {
        upstream.resume();
        const next = new URL(upstream.headers.location, url).toString();
        return res.redirect(`/api/proxy-m3u8?url=${encodeURIComponent(next)}`);
      }

      if (upstream.statusCode !== 200) {
        upstream.resume();
        return res.status(upstream.statusCode).json({ error: `upstream ${upstream.statusCode}` });
      }

      let body = '';
      upstream.setEncoding('utf8');
      upstream.on('data', chunk => { body += chunk; });
      upstream.on('end', () => {
        // Base URL para resolver rutas relativas dentro del manifiesto
        const base = url.substring(0, url.lastIndexOf('/') + 1);

        const rewritten = body.split('\n').map(line => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line; // comentario/tag → intacto

          // Resolver URL absoluta o relativa
          let segUrl;
          try { segUrl = new URL(trimmed, base).toString(); }
          catch { return line; } // si no parsea, dejarlo tal cual

          // Sub-manifiesto (.m3u8) → pasar por proxy-m3u8 para que también reescriba
          if (/\.m3u8(\?|#|$)/i.test(segUrl)) {
            return `/api/proxy-m3u8?url=${encodeURIComponent(segUrl)}`;
          }
          // Segmento .ts u otro recurso → pasar por proxy-stream
          return `/api/proxy-stream?url=${encodeURIComponent(segUrl)}`;
        }).join('\n');

        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(rewritten);
      });
    });

    upstreamReq.on('timeout', () => {
      upstreamReq.destroy();
      if (!res.headersSent) res.status(504).json({ error: 'timeout' });
    });
    upstreamReq.on('error', (e) => {
      if (!res.headersSent) res.status(502).json({ error: e.message });
    });
  });
});

// ── PUBLIC: Transcodificación en tiempo real (MPEG4/DivX → H.264) ──
// Úsalo cuando proxy-stream da solo audio (codec incompatible con el navegador)
// Endpoint: /api/transcode?url=...
const { spawn } = require('child_process');

app.get('/api/transcode', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url requerida' });

  let parsed;
  try { parsed = new URL(url); }
  catch { return res.status(400).json({ error: 'url inválida' }); }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'protocolo no soportado' });
  }

  hostAllowed(parsed.hostname, (ok) => {
    if (!ok) return res.status(403).json({ error: 'host bloqueado' });

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    // FFmpeg: leer URL → transcodificar → pipe a response
    const ff = spawn('ffmpeg', [
      '-loglevel', 'error',
      '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      '-i', url,
      '-c:v', 'libx264',     // H.264 — compatible con todos los navegadores
      '-preset', 'ultrafast', // Mínima latencia de inicio
      '-crf', '28',           // Calidad razonable con poco CPU
      '-c:a', 'aac',          // Audio AAC
      '-b:a', '128k',
      '-movflags', 'frag_keyframe+empty_moov+faststart', // MP4 streameable
      '-f', 'mp4',
      'pipe:1',               // Output a stdout
    ]);

    ff.stdout.pipe(res);

    ff.stderr.on('data', d => console.error('[transcode]', d.toString()));

    ff.on('close', (code) => {
      if (code !== 0 && !res.headersSent) res.status(502).end();
    });

    // Matar FFmpeg cuando el cliente se desconecta
    function killFF() {
      try {
        ff.stdout.unpipe(res);
        ff.kill('SIGTERM');
        setTimeout(() => { try { ff.kill('SIGKILL'); } catch {} }, 2000);
      } catch {}
    }

    req.on('close', killFF);
    res.on('close', killFF);
  });
});

// ── Start ────────────────────────────────────────────────────────

// ── PROTECTED: verificar si un stream está activo ───────────────
app.get('/api/admin/check-stream', (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url requerida' });

  let parsed;
  try { parsed = new URL(url); } catch { return res.json({ ok: false, reason: 'url inválida' }); }

  const proto = parsed.protocol === 'https:' ? https : http;
  const reqOpts = { method: 'GET', headers: { 'User-Agent': 'MythOS-TV/1.0' }, timeout: 5000 };

  const upReq = proto.request(url, reqOpts, (upRes) => {
    upRes.destroy();
    const ok = upRes.statusCode < 400;
    res.json({ ok, status: upRes.statusCode });
  });
  upReq.on('error', (e) => res.json({ ok: false, reason: e.message }));
  upReq.on('timeout', () => { upReq.destroy(); res.json({ ok: false, reason: 'timeout' }); });
  upReq.end();
});

/* ══════════════════════════════════════════════════════════════
   USERS — registro con PIN, aprobación por admin
   ══════════════════════════════════════════════════════════════ */

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {}
  return [];
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin) + 'mytv-pin-salt').digest('hex');
}

/* ══════════════════════════════════════════════════════════════
   PROGRESS — "Continuar viendo", por usuario
   Forma: { [username]: { [movieName]: {movieName,url,position,duration,timestamp} } }
   ══════════════════════════════════════════════════════════════ */

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveProgress(data) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// PUBLIC: progreso de un usuario, ordenado del más reciente al más viejo
app.get('/api/progress/:username', (req, res) => {
  const username = String(req.params.username || '').toLowerCase();
  if (!username) return res.status(400).json({ error: 'Usuario requerido' });
  const all     = loadProgress();
  const entries = Object.values(all[username] || {});
  entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  res.json({ ok: true, progress: entries });
});

// PUBLIC: guardar/actualizar progreso de una película para un usuario
// Al llegar a 95% se considera vista y se elimina de "Continuar viendo"
app.post('/api/progress', (req, res) => {
  const { username, movieName, url, position, duration } = req.body || {};
  if (!username || !movieName) return res.status(400).json({ error: 'Usuario y película requeridos' });
  const uname = String(username).toLowerCase();

  const all = loadProgress();
  if (!all[uname]) all[uname] = {};

  const dur   = Number(duration) || 0;
  const pos   = Number(position) || 0;
  const ratio = dur > 0 ? pos / dur : 0;

  if (ratio >= 0.95) {
    delete all[uname][movieName];
  } else {
    all[uname][movieName] = { movieName, url: url || '', position: pos, duration: dur, timestamp: Date.now() };
  }

  saveProgress(all);
  res.json({ ok: true });
});

// PUBLIC: registro de nuevo usuario (queda pendiente)
app.post('/api/users/register', (req, res) => {
  const { username, pin, emoji } = req.body;
  if (!username || !pin) return res.status(400).json({ error: 'Nombre y PIN requeridos' });
  if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'PIN debe ser 4 dígitos' });

  const users = loadUsers();
  const nameTaken = users.some(u => u.username.toLowerCase() === username.toLowerCase());
  if (nameTaken) return res.status(409).json({ error: 'Ese nombre ya está en uso' });

  const user = {
    id:        crypto.randomBytes(8).toString('hex'),
    username:  username.trim(),
    emoji:     emoji || '🎬',
    pinHash:   hashPin(pin),
    status:    'pending',   // pending | active | blocked
    createdAt: new Date().toISOString(),
    prefs: {
      wallpaper:   'default',
      timeFormat:  '24h',
      timezone:    'America/Costa_Rica',
      greeting:    'auto',
    },
  };
  users.push(user);
  saveUsers(users);
  res.json({ ok: true, id: user.id });
});

// PUBLIC: login con nombre + PIN
app.post('/api/users/login', (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) return res.status(400).json({ error: 'Nombre y PIN requeridos' });

  const users = loadUsers();
  const user  = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });
  if (user.pinHash !== hashPin(pin)) return res.status(401).json({ error: 'PIN incorrecto' });
  if (user.status === 'pending')  return res.status(403).json({ error: 'pending' });
  if (user.status === 'blocked')  return res.status(403).json({ error: 'blocked' });

  // Devolver perfil sin el hash
  const { pinHash: _, ...safe } = user;
  res.json({ ok: true, user: safe });
});

// PUBLIC: guardar prefs de un usuario (autenticado con su PIN)
app.post('/api/users/prefs', (req, res) => {
  const { username, pin, prefs } = req.body;
  if (!username || !pin) return res.status(400).json({ error: 'Credenciales requeridas' });

  const users = loadUsers();
  const idx   = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase());
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (users[idx].pinHash !== hashPin(pin)) return res.status(401).json({ error: 'PIN incorrecto' });
  if (users[idx].status !== 'active') return res.status(403).json({ error: 'Cuenta no activa' });

  users[idx].prefs = { ...users[idx].prefs, ...prefs };
  saveUsers(users);
  res.json({ ok: true, prefs: users[idx].prefs });
});

// PROTECTED: listar todos los usuarios (admin)
app.get('/api/admin/users', (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  const users = loadUsers().map(({ pinHash: _, ...u }) => u);
  res.json(users);
});

// PROTECTED: aprobar usuario
app.post('/api/admin/users/:id/approve', (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  const users = loadUsers();
  const user  = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  user.status = 'active';
  saveUsers(users);
  res.json({ ok: true });
});

// PROTECTED: bloquear usuario
app.post('/api/admin/users/:id/block', (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  const users = loadUsers();
  const user  = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  user.status = 'blocked';
  saveUsers(users);
  res.json({ ok: true });
});

// PROTECTED: eliminar usuario
app.delete('/api/admin/users/:id', (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  let users = loadUsers();
  const before = users.length;
  users = users.filter(u => u.id !== req.params.id);
  if (users.length === before) return res.status(404).json({ error: 'Usuario no encontrado' });
  saveUsers(users);
  res.json({ ok: true });
});

// PROTECTED: reset PIN (admin genera PIN temporal de 4 dígitos)
app.post('/api/admin/users/:id/reset-pin', (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  const users = loadUsers();
  const user  = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  const tempPin = String(Math.floor(1000 + Math.random() * 9000));
  user.pinHash  = hashPin(tempPin);
  saveUsers(users);
  res.json({ ok: true, tempPin });
});

/* ══════════════════════════════════════════════════════════════
   METADATA — TMDB (películas) + radio-browser.info + iptv-org logos
   ══════════════════════════════════════════════════════════════ */

/* Helper: fetch JSON externo con timeout */
function fetchJSON(url, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const proto  = parsed.protocol === 'https:' ? https : http;
    const opts   = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers:  { 'User-Agent': 'MythOS-TV/1.0', ...headers },
      timeout:  timeoutMs,
    };
    const req = proto.get(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON inválido')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}

/* ── PROTECTED: buscar metadata de película en TMDB ─────────── */
// GET /api/admin/fetch-metadata?title=Inception&year=2010
app.get('/api/admin/fetch-metadata', async (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  const { title, year } = req.query;
  if (!title) return res.status(400).json({ error: 'title requerido' });
  if (!TMDB_KEY) return res.status(500).json({ error: 'TMDB_API_KEY no configurada en .env' });

  try {
    // Limpiar título: quitar año entre paréntesis, calificadores de calidad/release y ruido
    // "John Wick 4 (2023)" → "John Wick 4", "Skyfall (SD)" → "Skyfall"
    let cleanTitle = title.trim()
      .replace(/\s*\(\d{4}\)\s*/g, ' ')
      .replace(/\s*\[[^\]]*\]\s*/g, ' ')
      .replace(/\s*\b(SD|HD|4K|720p|1080p|1080i|2160p|UHD|FHD|CAM|TS|TC|HDTS|HDCAM|HDRip|BRRip|BluRay|BDRip|WEB[- ]?DL|WEBRip|DVDRip|x264|x265|HEVC|AC3|DTS|DUAL(?:[- ]?AUDIO)?|LATINO|SUBTITULADA?|SUB(?:S|TITULOS)?|CASTELLANO|ESPAÑOL|MULTI)\b\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Extraer año del título original si no fue pasado como parámetro
    let autoYear = year || '';
    if (!autoYear) {
      const yearMatch = title.match(/\((\d{4})\)/);
      if (yearMatch) autoYear = yearMatch[1];
    }

    // Generar variantes del título para reintentar en cascada si la búsqueda exacta falla.
    // No "adivinamos" el contenido, solo probamos formas alternativas de escribir lo mismo.
    const romanMap = { i:1, ii:2, iii:3, iv:4, v:5, vi:6, vii:7, viii:8, ix:9, x:10 };
    const variants = [cleanTitle];

    // Variante sin un número/dígito suelto al final ("365 Dias 1" → "365 Dias")
    const noTrailingNum = cleanTitle.replace(/\s+\d{1,2}$/, '').trim();
    if (noTrailingNum && noTrailingNum !== cleanTitle) variants.push(noTrailingNum);

    // Variante sin palabras tipo "Parte/Capitulo/Vol" + número
    const noPartWord = cleanTitle.replace(/\s+\b(parte|capitulo|cap|vol(?:umen)?)\b\.?\s*\d*\s*$/i, '').trim();
    if (noPartWord && noPartWord !== cleanTitle && !variants.includes(noPartWord)) variants.push(noPartWord);

    // Variante con número romano suelto al final convertido a dígito ("Rocky IV" → "Rocky 4")
    const romanMatch = cleanTitle.match(/^(.*)\s+\b([ivx]{1,4})\b$/i);
    if (romanMatch && romanMap[romanMatch[2].toLowerCase()]) {
      const conv = `${romanMatch[1]} ${romanMap[romanMatch[2].toLowerCase()]}`.trim();
      if (!variants.includes(conv)) variants.push(conv);
    }

    // Variante con solo las primeras 4 palabras (para títulos largos con basura pegada)
    const words = cleanTitle.split(' ');
    if (words.length > 4) {
      const shortened = words.slice(0, 4).join(' ');
      if (!variants.includes(shortened)) variants.push(shortened);
    }

    let searchData = null;
    let matchedVariant = cleanTitle;
    for (const v of variants) {
      const query = encodeURIComponent(v);
      const yearParam = autoYear ? `&year=${autoYear}` : '';
      const searchUrl = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${query}${yearParam}&language=es-MX&page=1`;
      const attempt = await fetchJSON(searchUrl);
      if (attempt.results && attempt.results.length) {
        searchData = attempt;
        matchedVariant = v;
        break;
      }
    }

    if (!searchData) {
      return res.json({ ok: false, error: 'Sin resultados', triedVariants: variants });
    }

    // Devolver los primeros 5 resultados para que el admin elija
    const results = searchData.results.slice(0, 5).map(m => ({
      tmdb_id:     m.id,
      title:       m.title,
      original:    m.original_title,
      year:        m.release_date ? m.release_date.slice(0, 4) : '',
      description: m.overview || '',
      poster:      m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : '',
      backdrop:    m.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}` : '',
      rating:      m.vote_average ? m.vote_average.toFixed(1) : '',
      popularity:  m.popularity,
    }));

    res.json({ ok: true, results, matchedVariant: matchedVariant !== cleanTitle ? matchedVariant : undefined });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── PROTECTED: detalle completo de película TMDB por ID ──────── */
// GET /api/admin/fetch-metadata-detail?tmdb_id=27205
app.get('/api/admin/fetch-metadata-detail', async (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  const { tmdb_id } = req.query;
  if (!tmdb_id) return res.status(400).json({ error: 'tmdb_id requerido' });
  if (!TMDB_KEY) return res.status(500).json({ error: 'TMDB_API_KEY no configurada en .env' });

  try {
    const detailUrl = `https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${TMDB_KEY}&language=es-MX`;
    const m = await fetchJSON(detailUrl);

    res.json({
      ok: true,
      result: {
        tmdb_id:     m.id,
        title:       m.title,
        original:    m.original_title,
        year:        m.release_date ? m.release_date.slice(0, 4) : '',
        description: m.overview || '',
        poster:      m.poster_path  ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : '',
        backdrop:    m.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}` : '',
        rating:      m.vote_average ? m.vote_average.toFixed(1) : '',
        genre:       m.genres ? m.genres.map(g => g.name).join(', ') : '',
        duration:    m.runtime ? `${m.runtime} min` : '',
        tagline:     m.tagline || '',
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── PROTECTED: buscar estaciones de radio en radio-browser.info ─ */
// GET /api/admin/fetch-radio?name=rock&limit=20
app.get('/api/admin/fetch-radio', async (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  const { name, limit = 20 } = req.query;
  if (!name) return res.status(400).json({ error: 'name requerido' });

  try {
    const query = encodeURIComponent(name.trim());
    const url   = `https://de1.api.radio-browser.info/json/stations/byname/${query}?limit=${limit}&hidebroken=true&order=votes&reverse=true`;
    const data  = await fetchJSON(url);

    const results = (Array.isArray(data) ? data : []).map(s => ({
      name:    s.name,
      url:     s.url_resolved || s.url,
      logo:    s.favicon || '',
      genre:   s.tags ? s.tags.split(',').slice(0, 3).map(t => t.trim()).filter(Boolean).join(', ') : '',
      country: s.country || '',
      votes:   s.votes || 0,
    }));

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ── PROTECTED: buscar logo de canal TV en iptv-org ─────────── */
// GET /api/admin/fetch-channel-logo?name=CNN
app.get('/api/admin/fetch-channel-logo', async (req, res) => {
  if (!checkAuth(req)) return res.status(403).json({ error: 'No autorizado' });
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name requerido' });

  try {
    const url  = 'https://iptv-org.github.io/api/channels.json';
    const data = await fetchJSON(url, {}, 12000);

    const q = name.trim().toLowerCase();
    const matches = data
      .filter(ch => ch.name && ch.logo && ch.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map(ch => ({
        name:    ch.name,
        logo:    ch.logo,
        country: ch.country || '',
        id:      ch.id || '',
      }));

    res.json({ ok: true, results: matches });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[MythOS TV] API server running on http://127.0.0.1:${PORT}`);
  // Init config if not exists
  if (!fs.existsSync(CFG_FILE)) {
    saveConfig(DEFAULT_CONFIG);
    console.log('[MythOS TV] Default config created at', CFG_FILE);
  }
  if (!fs.existsSync(AUTH_FILE)) {
    const auth = { user: 'admin', passHash: hashPass('admin123'), token: crypto.randomBytes(32).toString('hex') };
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
    console.log('[MythOS TV] Auth created — user: admin / pass: admin123 — CAMBIA ESTO');
  }
});
