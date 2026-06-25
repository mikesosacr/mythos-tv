#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  MyTV OS — setup-backend.sh
#  Instala Node.js, Express, configura systemd y Nginx proxy
#  Ejecutar desde /home/ubuntu/mytvos
#  Uso: bash setup-backend.sh
# ═══════════════════════════════════════════════════════════════
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   MyTV OS — Instalación Backend v2.0    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. Node.js ───────────────────────────────────────────────
echo "[1/5] Verificando Node.js..."
if ! command -v node &> /dev/null; then
  echo "  Instalando Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "  ✓ Node.js $(node -v)"

# ── 2. Dependencias npm ──────────────────────────────────────
echo "[2/5] Instalando dependencias npm..."
cd /home/ubuntu/mytvos
npm install --omit=dev
echo "  ✓ express instalado"

# ── 3. Copiar archivos web al web root ───────────────────────
echo "[3/5] Actualizando web root..."
sudo cp index.html app.js admin.html manifest.json styles.css service-worker.js /var/www/mytv/
echo "  ✓ Archivos copiados a /var/www/mytv/"

# ── 4. Systemd service ───────────────────────────────────────
echo "[4/5] Configurando servicio systemd..."
sudo cp /home/ubuntu/mytvos/mytv.service /etc/systemd/system/mytv-os.service
sudo systemctl daemon-reload
sudo systemctl enable mytv-os
sudo systemctl restart mytv-os
sleep 2
if sudo systemctl is-active --quiet mytv-os; then
  echo "  ✓ Servicio mytv-os activo en puerto 3000"
else
  echo "  ✗ Error iniciando servicio — revisa: sudo journalctl -u mytv-os -n 20"
  exit 1
fi

# ── 5. Nginx: agregar proxy /api/ ────────────────────────────
echo "[5/5] Configurando Nginx proxy para /api/..."

NGINX_CONF="/etc/nginx/sites-available/mytv-os"

# Check if proxy already configured
if grep -q "location /api/" "$NGINX_CONF" 2>/dev/null; then
  echo "  ℹ Proxy ya configurado en Nginx"
else
  # Add proxy block before the last closing brace
  sudo sed -i '/^}$/i\
\
    # MyTV OS API backend\
    location /api/ {\
        proxy_pass http://127.0.0.1:3000;\
        proxy_http_version 1.1;\
        proxy_set_header Host $host;\
        proxy_set_header X-Real-IP $remote_addr;\
        proxy_read_timeout 30s;\
    }' "$NGINX_CONF"

  sudo nginx -t && sudo systemctl reload nginx
  echo "  ✓ Nginx proxy configurado"
fi

# ── Resultado ────────────────────────────────────────────────
IP=$(hostname -I | awk '{print $1}')
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     ✅ Backend instalado correctamente!  ║"
echo "╠══════════════════════════════════════════╣"
echo "║  TV App:  http://$IP"
echo "║  Admin:   http://$IP/admin.html"
echo "║  API:     http://$IP/api/config"
echo "╠══════════════════════════════════════════╣"
echo "║  Credenciales iniciales:"
echo "║  Usuario: admin"
echo "║  Clave:   admin123"
echo "║  ⚠️  CÁMBIA LA CLAVE desde el admin!"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Logs en tiempo real: sudo journalctl -u mytv-os -f"
echo ""
