#!/usr/bin/env bash
# ==============================================================================
# Certbot Initialization — Provision SSL for DOMAIN
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

COMPOSE_PROJECT="frappe-meet"
COMPOSE_CMD="docker compose -f $DEPLOY_DIR/docker-compose.yml -p $COMPOSE_PROJECT --env-file $DEPLOY_DIR/.env"

# Load environment
if [ ! -f "$DEPLOY_DIR/.env" ]; then
    echo "[-] .env file not found."
    exit 1
fi

set -a
source "$DEPLOY_DIR/.env"
set +a

if [ -z "${DOMAIN:-}" ]; then
    echo "[-] DOMAIN must be set in .env"
    exit 1
fi

if [ -z "${SSL_EMAIL:-}" ]; then
    echo "[-] SSL_EMAIL must be set in .env"
    exit 1
fi

echo "[*] Provisioning SSL certificate for: $DOMAIN"
echo "[*] Registration email: $SSL_EMAIL"
echo ""

TEMPLATES_DIR="$DEPLOY_DIR/nginx/templates"
REAL_CONF="$TEMPLATES_DIR/default.conf.template"
BACKUP_CONF="$TEMPLATES_DIR/default.conf.template.bak"

cleanup() {
    if [ -f "$BACKUP_CONF" ]; then
        mv "$BACKUP_CONF" "$REAL_CONF"
    fi
}
trap cleanup EXIT

# Step 1: Swap in ACME-only nginx config
echo "▶ Preparing nginx for ACME challenge..."
cp "$REAL_CONF" "$BACKUP_CONF"

cat > "$REAL_CONF" << 'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'SSL provisioning in progress...';
        add_header Content-Type text/plain;
    }
}
NGINX

# Step 2: Start nginx with ACME config
echo "▶ Starting nginx for ACME challenge..."
$COMPOSE_CMD up -d nginx
sleep 3

# Step 3: Request certificate
echo "▶ Requesting certificate for $DOMAIN..."
$COMPOSE_CMD \
    run --rm --entrypoint certbot certbot \
    certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email "$SSL_EMAIL" \
    --agree-tos \
    --no-eff-email \
    --force-renewal \
    -d "$DOMAIN"

# Step 4: Restore real nginx config
if [ -f "$BACKUP_CONF" ]; then
    mv "$BACKUP_CONF" "$REAL_CONF"
fi

echo ""
echo "[+] SSL certificates provisioned!"
echo "[>] Restarting nginx with full configuration..."
$COMPOSE_CMD up -d --force-recreate nginx
echo "[+] Done!"
