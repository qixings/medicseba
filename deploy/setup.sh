#!/usr/bin/env bash
# One-time setup of MedicSeba on the Hostinger VPS (test server).
# Everything lives in /opt/medicseba, its own database, its own PM2 process and its own Nginx file.
# Other projects, the system Node 18 and the existing Nginx config are not touched.
#
#   sudo bash deploy/setup.sh medicseba.hookmantra.com
set -euo pipefail

DOMAIN="${1:-medicseba.hookmantra.com}"
APP_DIR=/opt/medicseba
PORT=4100
DB=medicseba

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

[ "$(pwd)" = "$APP_DIR" ] || { echo "Run this from $APP_DIR (git clone the repo there first)"; exit 1; }

say "Checking port $PORT is free"
if ss -ltn | awk '{print $4}' | grep -q ":$PORT\$"; then echo "Port $PORT is in use. Edit PORT in this script."; exit 1; fi

say "Node 22 through nvm (system Node stays as it is)"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] || curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. "$NVM_DIR/nvm.sh"
nvm install 22 >/dev/null
NODE22="$(nvm which 22)"
export PATH="$(dirname "$NODE22"):$PATH"
node -v

say "Database $DB (separate user and database)"
if [ ! -f apps/api/.env ]; then
  DBPASS="$(openssl rand -hex 16)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DB') THEN CREATE ROLE $DB LOGIN PASSWORD '$DBPASS';
  ELSE ALTER ROLE $DB PASSWORD '$DBPASS'; END IF;
END \$\$;
SQL
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -q 1 || sudo -u postgres createdb -O "$DB" "$DB"
  cat > apps/api/.env <<ENV
DATABASE_URL=postgresql://$DB:$DBPASS@127.0.0.1:5432/$DB
JWT_SECRET=$(openssl rand -hex 32)
PORT=$PORT
NODE_ENV=production
DEMO_MODE=1
PAYMENT_PROVIDER=mock
SMS_PROVIDER=log
CORS_ORIGIN=https://$DOMAIN
ENV
  chmod 600 apps/api/.env
  echo "Wrote apps/api/.env"
else
  echo "apps/api/.env already exists, keeping it"
fi

say "Building the API"
cd apps/api
npm ci --no-audit --no-fund
npm run build
npm run db:migrate:prod
[ -f ../../.seeded ] || { npx tsx src/scripts/seed.ts && touch ../../.seeded; }
cd ../..

say "Building the patient app and the counter app"
DOMAIN="$DOMAIN" bash deploy/build-web.sh

say "Starting the API with PM2 as medicseba-api"
pm2 delete medicseba-api >/dev/null 2>&1 || true
pm2 start "$APP_DIR/apps/api/dist/index.js" --name medicseba-api --interpreter "$NODE22" --cwd "$APP_DIR/apps/api"
pm2 save
sleep 2
curl -fsS "http://127.0.0.1:$PORT/health" && echo

say "Nginx site for $DOMAIN (its own file)"
[ -f /etc/ssl/certs/ssl-cert-snakeoil.pem ] || { apt-get install -y ssl-cert >/dev/null && make-ssl-cert generate-default-snakeoil; }
sed "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$PORT/g" deploy/nginx.conf > /etc/nginx/sites-available/medicseba
ln -sf /etc/nginx/sites-available/medicseba /etc/nginx/sites-enabled/medicseba
nginx -t
systemctl reload nginx

say "Done"
echo "Open https://$DOMAIN on your phone (after the Cloudflare DNS record is added)."
echo "Counter app: https://$DOMAIN/agent (sample login citymedicos / demo1234)."
echo "The login code shows on screen because DEMO_MODE=1. Payments are test payments."
