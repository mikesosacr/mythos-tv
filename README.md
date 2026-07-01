# 📺 MythOS TV

> © 2026 Maikel Solano Salas. Source Available software. Commercial use, redistribution, hosting, and derivative distribution require prior written permission from the author.

**Personal TV Operating System PWA**
🎬 Cinematic UI · 📺 Remote Navigation · ⚡ Offline-ready · 🌐 Cross-platform

MythOS TV es un sistema operativo multimedia tipo Smart TV desarrollado como una Progressive Web App (PWA), inspirado en WebOS, HarmonyOS y las interfaces modernas de Netflix. Está diseñado para ofrecer una experiencia cinematográfica optimizada para televisores, TV Box, navegadores y dispositivos móviles.

---

## ✨ Características

* 🎬 Interfaz cinematográfica estilo Smart TV y Netflix.
* 📺 Navegación optimizada para control remoto, teclado, mouse y touch.
* ⚡ Instalación como Progressive Web App (PWA).
* 🌐 Funcionamiento offline mediante Service Worker.
* ❤️ Sistema de favoritos.
* 🔍 Búsqueda integrada.
* 👥 Sistema multiusuario con autenticación y PIN.
* ▶️ Sistema **Continuar viendo** con reanudación automática.
* 📊 Progreso de reproducción sincronizado por usuario.
* 🎞️ Agrupación automática de películas mediante TMDB.
* 🌐 Proxy automático para streams HLS/M3U8 con problemas de CORS.
* 📥 Exportador de listas M3U.
* 🎨 Sistema de temas dinámicos.
* 📡 Soporte para IPTV, películas, radio y contenido multimedia.
* 🖥️ Panel de administración integrado.
* 📱 Compatible con Smart TV, Android TV, TV Box, navegadores y dispositivos móviles.
* 🚀 Desarrollado en Vanilla JavaScript y Node.js.

---

## 🎬 Funcionalidades multimedia

### Películas

* Modal de detalle estilo Netflix.
* Fila **Mejor valoradas**.
* Fila **Continuar viendo**.
* Reanudación automática de reproducción.
* Múltiples servidores por película.
* Agrupación automática por géneros TMDB.

### 📺 Live TV

* Reproducción HLS.
* Proxy automático para streams incompatibles con CORS.
* Soporte de logos y categorías.
* Navegación optimizada para TV.

### 📻 Radio

* Soporte para streams online.
* Integración con listas personalizadas.
* Navegación mediante control remoto.

---

## 🛠️ Tecnologías

* Vanilla JavaScript
* HTML5
* CSS3
* Node.js
* Express
* HLS.js
* Service Workers
* Progressive Web App (PWA)
* Nginx

---

## 🗂️ Estructura del proyecto

```text
mythos-tv/
├── .gitignore
├── README.md
├── LICENSE
├── TRADEMARKS.md
├── index.html
├── admin.html
├── app.js
├── app1.js
├── styles.css
├── server.js
├── manifest.json
├── service-worker.js
├── package.json
├── package-lock.json
├── nginx.conf
├── mytv.service
├── deploy.sh
├── setup-backend.sh
├── apps/
├── assets/
│   └── icons/
│       ├── icon.svg
│       ├── icon-192.png
│       └── icon-512.png
└── data/
    ├── auth.json
    ├── config.json
    ├── users.json
    └── progress.json
```

> **Nota:** algunas instalaciones antiguas pueden seguir utilizando el directorio `~/mytvos` por compatibilidad. El nombre oficial del proyecto es **MythOS TV**.

---

## 🚀 Instalación rápida

### Clonar el repositorio

```bash
git clone https://github.com/mikesosacr/mythos-tv.git
cd mythos-tv
```

### Instalar dependencias

```bash
npm install
```

### Ejecutar

```bash
npm start
```

o

```bash
node server.js
```

---

## 🚀 Instalación en VPS (Ubuntu 22.04+)

### Actualizar el sistema

```bash
sudo apt update && sudo apt upgrade -y
```

### Instalar Node.js y Nginx

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install nodejs nginx -y
```

Verificar:

```bash
node -v
npm -v
nginx -v
```

---

## ⚙️ Servicio systemd

Instalar:

```bash
sudo cp mytv.service /etc/systemd/system/mytv-os.service
sudo systemctl daemon-reload
sudo systemctl enable mytv-os
sudo systemctl start mytv-os
```

Verificar:

```bash
sudo systemctl status mytv-os
```

---

## 🌐 Configuración de Nginx

```bash
sudo cp nginx.conf /etc/nginx/sites-available/mythos-tv
sudo ln -sf /etc/nginx/sites-available/mythos-tv /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 🔒 HTTPS (Recomendado)

```bash
sudo apt install certbot python3-certbot-nginx -y
sudo certbot --nginx
```

HTTPS es recomendado para la instalación de la PWA y para el correcto funcionamiento de los Service Workers.

---

## 🔌 API

### Configuración

```text
GET  /api/config
POST /api/config
```

### Usuarios

```text
GET  /api/users
POST /api/users
```

### Progreso de reproducción

```text
GET  /api/progress/:username
POST /api/progress
```

### Streaming

```text
GET /api/proxy-stream
GET /api/proxy-m3u8
```

---

## 🖥️ Administración

Archivos relacionados:

* `admin.html`
* `data/config.json`
* `data/users.json`
* `data/auth.json`
* `data/progress.json`

---

## 🎮 Navegación

| Tecla         | Acción             |
| ------------- | ------------------ |
| ← → ↑ ↓       | Navegar            |
| Enter / OK    | Abrir              |
| Escape        | Volver             |
| Backspace     | Retroceder         |
| Mouse / Touch | Navegación directa |

---

## 🏗️ Comandos útiles

### Ver logs del backend

```bash
sudo journalctl -u mytv-os -f
```

### Estado del servicio

```bash
sudo systemctl status mytv-os
```

### Reiniciar

```bash
sudo systemctl restart mytv-os
```

### Verificar sintaxis

```bash
node --check server.js
node --check app.js
```

### Actualizar dependencias

```bash
npm install
```

---

## ⚡ Rendimiento

* Arranque rápido.
* Sin frameworks pesados.
* Compatible con televisores y navegadores modernos.
* Cache offline mediante Service Worker.
* Instalación como aplicación nativa.

---

## 📸 Capturas

Próximamente:

* Home
* Tema Netflix
* Continuar viendo
* Live TV
* Panel administrativo

---

## 🗺️ Roadmap

* [x] Sistema multiusuario con PIN
* [x] Tema Netflix
* [x] Continuar viendo
* [x] Proxy M3U8
* [x] Exportador M3U
* [ ] Sistema de plugins
* [ ] Series
* [ ] Filas Netflix para Live TV
* [ ] Filas Netflix para Radio
* [ ] Editor de apariencia
* [ ] Scraper Archive.org
* [ ] Backups automáticos

---

## 📊 Estado del proyecto

**Versión actual:** 0.9 Beta

Características principales implementadas:

* ✅ PWA
* ✅ Multiusuario
* ✅ Continuar viendo
* ✅ Tema Netflix
* ✅ Proxy M3U8
* ✅ Administración integrada
* ✅ Exportador M3U

---

## 🛡️ Licencia

MythOS TV es un proyecto **Source Available**.

Copyright © 2026 Maikel Solano Salas. Todos los derechos reservados.

El código fuente se proporciona únicamente para:

* Aprendizaje.
* Evaluación.
* Uso personal y no comercial.

No está permitido:

* Redistribuir el software o versiones modificadas.
* Comercializar el software.
* Crear servicios comerciales basados en el proyecto.
* Eliminar los avisos de copyright.
* Reemplazar la autoría original.
* Reutilizar el nombre, logotipos o identidad de MythOS TV sin autorización.
* Distribuir trabajos derivados sin permiso expreso del autor.

Consulte los archivos `LICENSE` y `TRADEMARKS.md` para conocer los términos completos de uso y atribución.

---

## ™ Marca y atribución

**MythOS TV**, sus logotipos, iconos e identidad visual son propiedad intelectual de Maikel Solano Salas.

El uso del nombre, la identidad visual o la marca para productos derivados o redistribuciones no autorizadas está prohibido.

---

## 👨‍💻 Autor

**Maikel Solano Salas**
Creador, diseñador y desarrollador principal de MythOS TV.
