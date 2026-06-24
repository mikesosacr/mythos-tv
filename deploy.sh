#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  MyTV OS — deploy.sh
#  Script de instalación automática en Ubuntu 22.04+
#  Uso: bash deploy.sh [tu-dominio.com]
# ═══════════════════════════════════════════════════════════════

set -e

DOMAIN="${1:-_}"
WEB_ROOT="/var/www/mytv"
NGINX_CONF="/etc/nginx/sites-available/mytv-os"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       MyTV OS — Instalación VPS      ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 1. Actualizar sistema ─────────────────────────────────────
echo "[1/7] Actualizando sistema..."
sudo apt update -y && sudo apt upgrade -y

# ── 2. Instalar Nginx ─────────────────────────────────────────
echo "[2/7] Instalando Nginx..."
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# ── 3. Crear directorio web ───────────────────────────────────
echo "[3/7] Creando directorio /var/www/mytv..."
sudo mkdir -p "$WEB_ROOT"
sudo chown -R "$USER:$USER" "$WEB_ROOT"

# ── 4. Copiar archivos del proyecto ──────────────────────────
echo "[4/7] Copiando archivos de MyTV OS..."

# Si se ejecuta desde el directorio del proyecto
if [ -f "index.html" ]; then
    cp -r . "$WEB_ROOT/"
    echo "    ✓ Archivos copiados desde directorio actual"
else
    echo "    ⚠ Ejecuta este script desde el directorio del proyecto"
    echo "    O copia manualmente los archivos a $WEB_ROOT"
fi

# ── 5. Configurar Nginx ───────────────────────────────────────
echo "[5/7] Configurando Nginx..."

# Reemplazar server_name si se pasa dominio
NGINX_CONTENT=$(cat nginx.conf)
if [ "$DOMAIN" != "_" ]; then
    NGINX_CONTENT="${NGINX_CONTENT/tu-dominio.com/$DOMAIN}"
    NGINX_CONTENT="${NGINX_CONTENT/www.tu-dominio.com/www.$DOMAIN}"
fi

echo "$NGINX_CONTENT" | sudo tee "$NGINX_CONF" > /dev/null
sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/mytv-os

# Remover default si existe
sudo rm -f /etc/nginx/sites-enabled/default

# Test config
sudo nginx -t && echo "    ✓ Configuración Nginx válida" || {
    echo "    ✗ Error en configuración Nginx"
    exit 1
}

# ── 6. Reiniciar Nginx ────────────────────────────────────────
echo "[6/7] Reiniciando Nginx..."
sudo systemctl restart nginx
echo "    ✓ Nginx activo"

# ── 7. Firewall (UFW) ─────────────────────────────────────────
echo "[7/7] Configurando firewall..."
if command -v ufw &> /dev/null; then
    sudo ufw allow 'Nginx Full' 2>/dev/null || true
    sudo ufw allow OpenSSH 2>/dev/null || true
    echo "    ✓ UFW configurado"
else
    echo "    ℹ UFW no instalado, omitiendo"
fi

# ── HTTPS opcional con Certbot ────────────────────────────────
echo ""
if [ "$DOMAIN" != "_" ]; then
    echo "════════════════════════════════════════"
    echo "  ¿Instalar HTTPS con Let's Encrypt?"
    echo "  Dominio: $DOMAIN"
    echo ""
    read -p "  [s/n] > " SSL_CHOICE
    if [ "$SSL_CHOICE" = "s" ] || [ "$SSL_CHOICE" = "S" ]; then
        sudo apt install -y certbot python3-certbot-nginx
        sudo certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN"
        echo "  ✓ SSL instalado"
    fi
fi

# ── Resultado ─────────────────────────────────────────────────
IP=$(hostname -I | awk '{print $1}')
echo ""
echo "╔══════════════════════════════════════╗"
echo "║        ✅ MyTV OS Instalado!         ║"
echo "╠══════════════════════════════════════╣"
if [ "$DOMAIN" != "_" ]; then
    echo "║  URL: http://$DOMAIN"
    echo "║  URL: https://$DOMAIN (si HTTPS activo)"
fi
echo "║  URL local: http://$IP"
echo "║  Archivos:  $WEB_ROOT"
echo "║  Nginx:     $NGINX_CONF"
echo "╚══════════════════════════════════════╝"
echo ""
echo "  📺 Abre desde tu TV: http://$IP"
echo ""
