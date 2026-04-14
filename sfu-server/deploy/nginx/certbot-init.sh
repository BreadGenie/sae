#!/usr/bin/env bash
# ==============================================================================
# Certbot Initialization Script
# ==============================================================================
# Provisions the initial SSL certificate from Let's Encrypt.
# Run this ONCE after first deployment:
#
#   ./deploy.sh ssl-init
#
# After that, the certbot container handles renewals automatically.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Use the same fixed project name as deploy.sh so Docker volume names are
# consistent regardless of the installation directory.
COMPOSE_PROJECT="meet-sfu"
COMPOSE_CMD="docker compose -f $DEPLOY_DIR/docker-compose.yml -p $COMPOSE_PROJECT --env-file $DEPLOY_DIR/.env"

# Load environment
if [ ! -f "$DEPLOY_DIR/.env" ]; then
    echo "[-] .env file not found. Run: cp .env.example .env && edit .env"
    exit 1
fi

set -a
source "$DEPLOY_DIR/.env"
set +a

if [ -z "${DOMAIN:-}" ]; then
    echo "[-] DOMAIN is not set in .env"
    exit 1
fi

if [ -z "${SSL_EMAIL:-}" ]; then
    echo "[-] SSL_EMAIL is not set in .env"
    exit 1
fi

echo "[*] Provisioning SSL certificate for: $DOMAIN"
echo "[*] Registration email: $SSL_EMAIL"
echo ""

TEMPLATES_DIR="$DEPLOY_DIR/nginx/templates"
REAL_CONF="$TEMPLATES_DIR/default.conf.template"
BACKUP_CONF="$TEMPLATES_DIR/default.conf.template.bak"
ACME_CONF="$TEMPLATES_DIR/default.conf.template"

cleanup() {
    # Restore original config if backup exists
    if [ -f "$BACKUP_CONF" ]; then
        mv "$BACKUP_CONF" "$REAL_CONF"
    fi
}
trap cleanup EXIT

# Step 1: Move the real nginx config out of the way so only the ACME-only
#         config is loaded (nginx:alpine processes ALL *.template files)
echo "▶ Preparing nginx for ACME challenge..."
cp "$REAL_CONF" "$BACKUP_CONF"

cat > "$ACME_CONF" << 'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'SFU SSL provisioning in progress...';
        add_header Content-Type text/plain;
    }
}
NGINX

# Step 2: Start nginx with the ACME-only config
echo "▶ Starting nginx for ACME challenge..."
$COMPOSE_CMD up -d nginx
sleep 3

# Verify nginx is actually running
if ! docker ps --filter "name=meet-sfu-nginx" --filter "status=running" -q | grep -q .; then
    echo "[!] Nginx didn't start cleanly, checking logs..."
    docker logs meet-sfu-nginx --tail=20 2>&1 || true
fi

# Step 3: Request the certificate
echo "▶ Requesting certificate from Let's Encrypt..."
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

CERT_EXIT=$?

# Step 4: Restore the real nginx config (trap handles this, but be explicit)
if [ -f "$BACKUP_CONF" ]; then
    mv "$BACKUP_CONF" "$REAL_CONF"
fi

if [ $CERT_EXIT -eq 0 ]; then
    echo ""
    echo "[+] SSL certificate provisioned successfully!"
    echo "[>] Restarting nginx with full SSL configuration..."
    $COMPOSE_CMD up -d --force-recreate nginx
    echo "[+] Done! Your SFU is now available at https://$DOMAIN"
else
    echo ""
    echo "[-] Certificate provisioning failed."
    echo "   Make sure:"
    echo "   1. DNS for $DOMAIN points to this server's IP"
    echo "   2. Port 80 is open and reachable from the internet"
    echo "   3. The domain is not behind a proxy that blocks ACME challenges"
    exit 1
fi
