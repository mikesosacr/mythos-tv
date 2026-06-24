# 📺 MyTV OS

**PWA tipo Sistema Operativo de TV personal**  
Cinematic UI · WebOS/HarmonyOS-style · Navegación con control remoto · Offline-ready

---

## 🗂️ Estructura del proyecto

```
mytv-os/
├── index.html          ← Shell principal del OS
├── styles.css          ← UI completa (OS cinematic dark)
├── app.js              ← Runtime: boot, router, apps, remote nav
├── manifest.json       ← PWA manifest (fullscreen, landscape)
├── service-worker.js   ← Cache-first, offline support
├── nginx.conf          ← Config Nginx lista para producción
├── deploy.sh           ← Script de instalación automática
└── assets/
    └── icons/
        ├── icon-192.png
        └── icon-512.png
```

---

## 🚀 Instalación en VPS (Ubuntu 22.04+)

### Opción A — Script automático

```bash
# 1. Subir archivos al VPS
scp -r ./mytv-os ubuntu@TU_IP_VPS:/home/ubuntu/

# 2. Entrar al VPS
ssh ubuntu@TU_IP_VPS

# 3. Entrar al directorio
cd /home/ubuntu/mytv-os

# 4. Dar permisos y ejecutar
chmod +x deploy.sh
bash deploy.sh tu-dominio.com
```

---

### Opción B — Manual paso a paso

```bash
# ── 1. Actualizar sistema
sudo apt update && sudo apt upgrade -y

# ── 2. Instalar Nginx
sudo apt install nginx -y
sudo systemctl enable nginx
sudo systemctl start nginx

# ── 3. Crear directorio web
sudo mkdir -p /var/www/mytv
sudo chown -R $USER:$USER /var/www/mytv

# ── 4. Copiar archivos del proyecto
cp -r ~/mytv-os/* /var/www/mytv/

# ── 5. Instalar configuración Nginx
sudo cp /var/www/mytv/nginx.conf /etc/nginx/sites-available/mytv-os

# ── 6. Editar el server_name (poner tu IP o dominio)
sudo nano /etc/nginx/sites-available/mytv-os
# Cambiar: server_name tu-dominio.com www.tu-dominio.com;
# Por:     server_name TU_IP_O_DOMINIO;

# ── 7. Activar el sitio
sudo ln -sf /etc/nginx/sites-available/mytv-os /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# ── 8. Validar y reiniciar Nginx
sudo nginx -t
sudo systemctl restart nginx

# ── 9. Firewall
sudo ufw allow 'Nginx Full'
sudo ufw allow OpenSSH
sudo ufw enable
```

---

### HTTPS con Let's Encrypt (recomendado para PWA)

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx -d tu-dominio.com -d www.tu-dominio.com
```

> **⚠️ Nota:** HTTPS es requerido para que el Service Worker funcione en Android TV y para instalar la PWA en la mayoría de navegadores. En red local puede usarse HTTP.

---

## 📺 Acceso desde TV

### Android TV / Google TV
1. Abre el navegador del TV (Chrome, Firefox, o el navegador nativo)
2. Navega a `http://TU_IP_VPS` o `https://tu-dominio.com`
3. Para instalar como PWA: menú → "Añadir a pantalla principal" o "Instalar app"

### LG WebOS
1. Abre el navegador web integrado
2. Navega a la URL de tu VPS
3. La app funcionará en fullscreen automáticamente

### Samsung Tizen
1. Usa el navegador Samsung Internet
2. Navega a la URL
3. Instala como app desde el menú del navegador

### Desde cualquier dispositivo en red local
```bash
# Ver la IP de tu VPS
ip addr show | grep 'inet ' | grep -v 127.0.0.1

# Acceder desde TV en la misma red
http://192.168.X.X
```

---

## ⚙️ Configuración de Apps

### Configurar Jellyfin
1. Abre MyTV OS
2. Ve a **Configuración → Apps & Links**
3. Cambia la URL de Jellyfin: `http://TU_IP:8096`
4. Guarda cambios

### Agregar streams IPTV
Las URLs de canales IPTV se configuran directamente en `app.js`:
```javascript
const IPTV_CHANNELS = [
  { name: 'Mi Canal',  cat: 'Local', emoji: '📺', url: 'http://stream.example.com/channel.m3u8' },
  // ...
];
```

### Agregar estaciones de radio
```javascript
const RADIO_STATIONS = [
  { name: 'Mi Radio', genre: 'Pop', emoji: '🎵', url: 'https://stream.radio.com/live.mp3' },
  // ...
];
```

---

## 🎮 Controles remotos / Teclado

| Tecla            | Acción                    |
|------------------|---------------------------|
| ← → ↑ ↓         | Navegar entre apps        |
| Enter / OK       | Abrir app seleccionada    |
| Escape / Back    | Volver al launcher        |
| Backspace        | Volver (control remoto)   |
| Mouse / touch    | Hover y clic directo      |

---

## 🔧 Personalización

### Wallpapers disponibles
Cambia en Configuración → Sistema → Fondo de pantalla:
- **Cosmos** (default) — gradientes púrpura/cyan
- **Aurora** — tonos verdes y cyan
- **Ciudad nocturna** — tonos naranja/morado
- **Abstracto** — rosa/azul

### Agregar nueva app al launcher
En `app.js`, agrega al array `DEFAULT_APPS`:
```javascript
{
  id: 'mi-app',
  label: 'Mi App',
  sublabel: 'Descripción',
  emoji: '🎯',
  type: 'external',       // 'external' o 'internal'
  url: 'https://mi-app.com',
  color: 'purple',        // purple, cyan, orange, green, pink, blue, red, yellow
  badge: 'CUSTOM',        // opcional
}
```

---

## 🏗️ Comandos útiles de mantenimiento

```bash
# Ver logs en tiempo real
sudo journalctl -u nginx -f

# Ver accesos
sudo tail -f /var/log/nginx/mytv-os.access.log

# Actualizar archivos
cp -r ~/mytv-os/* /var/www/mytv/
sudo systemctl reload nginx

# Estado del servicio
sudo systemctl status nginx

# Reiniciar si hay problemas
sudo systemctl restart nginx

# Verificar config Nginx
sudo nginx -t
```

---

## 🌐 Arquitectura PWA

```
Navegador TV
    │
    ▼
Service Worker (cache-first)
    │
    ├── Cache hit → Respuesta inmediata (offline ready)
    └── Cache miss → Fetch red → Guardar en cache
    
Estrategias:
  - Core app (HTML/CSS/JS): cache-first
  - Fuentes Google: stale-while-revalidate  
  - APIs externas: network-only
```

---

## ⚡ Rendimiento

- **Boot time**: ~1.5s animación + carga inmediata
- **Sin frameworks**: Vanilla JS puro, 0 dependencias npm
- **Gzip**: todos los assets comprimidos en Nginx
- **Cache**: assets estáticos cacheados 1 año
- **Offline**: launcher funciona sin internet tras primera visita

---

## 📝 Licencia

MIT — Úsalo, modifícalo, despliégalo como quieras.
