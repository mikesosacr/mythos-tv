# 📺 MythOS TV

**Personal TV Operating System PWA**
🎬 Cinematic UI · 📺 Remote Navigation · ⚡ Offline-ready · 🌐 Cross-platform

MythOS TV es un sistema operativo de TV personal desarrollado como una Progressive Web App (PWA), inspirado en las interfaces de WebOS y HarmonyOS. Está diseñado para ofrecer una experiencia multimedia moderna, optimizada para televisores, controles remotos y dispositivos de bajo consumo.

---

## ✨ Características

* 🎬 Interfaz cinematográfica estilo Smart TV.
* 📺 Navegación optimizada para control remoto y teclado.
* ⚡ Instalación como Progressive Web App (PWA).
* 🌐 Funcionamiento offline mediante Service Worker.
* ❤️ Sistema de favoritos.
* 🔍 Búsqueda integrada.
* 📡 Soporte para IPTV y contenido multimedia.
* 🖥️ Panel de administración integrado.
* 👥 Gestión de usuarios y autenticación.
* 📱 Compatible con Smart TV, Android TV, navegadores y dispositivos móviles.
* 🚀 Desarrollado en Vanilla JavaScript y Node.js.

---

## 🗂️ Estructura del proyecto

```text
mythos-tv/
├── .gitignore
├── README.md
├── index.html              ← Shell principal del sistema
├── admin.html              ← Panel de administración
├── app.js                  ← Runtime y lógica principal
├── app1.js                 ← Funcionalidades experimentales
├── styles.css              ← Interfaz y estilos
├── server.js               ← Backend Node.js
├── manifest.json           ← Configuración PWA
├── service-worker.js       ← Cache y soporte offline
├── package.json            ← Dependencias y scripts
├── package-lock.json
├── nginx.conf              ← Configuración de Nginx
├── mytv.service            ← Servicio systemd
├── deploy.sh               ← Instalación automática
├── setup-backend.sh        ← Configuración del backend
├── apps/                   ← Módulos y aplicaciones
├── assets/
│   └── icons/
│       ├── icon.svg
│       ├── icon-192.png
│       └── icon-512.png
└── data/
    ├── auth.json           ← Configuración de autenticación
    ├── config.json         ← Configuración del sistema
    └── users.json          ← Gestión de usuarios
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

## 📂 Despliegue

### Copiar el proyecto

```bash
sudo mkdir -p /var/www/mytv
sudo cp -r . /var/www/mytv/
```

### Instalar dependencias

```bash
cd /var/www/mytv
npm install
```

### Iniciar el backend

```bash
node server.js
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

HTTPS es recomendado para la instalación de la PWA y para el correcto funcionamiento de los Service Workers en algunos dispositivos.

---

## 🖥️ Administración

MythOS TV incluye un panel de administración integrado.

Archivos relacionados:

* `admin.html`
* `data/config.json`
* `data/users.json`
* `data/auth.json`

---

## 📡 Servicios multimedia

### IPTV

Permite integrar listas y servicios de streaming compatibles.

### Radio

Admite estaciones de radio online y streams personalizados.

### Servicios externos

Permite integrar aplicaciones y servicios multimedia mediante enlaces y configuraciones personalizadas.

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

## 🗺️ Roadmap

* [ ] Sistema de plugins.
* [ ] Multiusuario.
* [ ] Sincronización en la nube.
* [ ] Integración con más servicios multimedia.
* [ ] Mejoras para WebOS, Tizen y otras plataformas Smart TV.

---

## 📄 Licencia

MIT — Úsalo, modifícalo y despliégalo libremente.
