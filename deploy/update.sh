#!/usr/bin/env bash
# Pull the latest code, rebuild and restart. Shows what changed first.
#   bash deploy/update.sh
set -euo pipefail
# Run from a copy, because the pull below can change this very file while it runs.
if [ -z "${FROM_COPY:-}" ]; then cp "$0" /tmp/medicseba-update.sh; FROM_COPY=1 exec bash /tmp/medicseba-update.sh "$@"; fi
cd /opt/medicseba
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; export PATH="$(dirname "$(nvm which 22)"):$PATH"

git fetch origin main
echo "Changes coming in:"; git --no-pager log --oneline HEAD..origin/main; git --no-pager diff --stat HEAD origin/main
read -r -p "Deploy these? [y/N] " ok; [ "$ok" = "y" ] || exit 0
git merge --ff-only origin/main

(cd apps/api && npm ci --no-audit --no-fund && npm run build && npm run db:migrate:prod && if grep -q '^DEMO_MODE=1' .env; then npx tsx src/scripts/demo-photos.ts; fi)
bash deploy/build-web.sh

# Nginx file from the repo (its own file only), checked before reload.
DOMAIN="$(grep -oP '^CORS_ORIGIN=https://\K.*' apps/api/.env)"
sed "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/4100/g" deploy/nginx.conf > /tmp/medicseba.nginx
if ! cmp -s /tmp/medicseba.nginx /etc/nginx/sites-available/medicseba; then
  cp /etc/nginx/sites-available/medicseba /etc/nginx/sites-available/medicseba.bak
  cp /tmp/medicseba.nginx /etc/nginx/sites-available/medicseba
  if nginx -t; then systemctl reload nginx; else cp /etc/nginx/sites-available/medicseba.bak /etc/nginx/sites-available/medicseba; echo "Nginx check failed, kept the old config"; exit 1; fi
fi

pm2 restart medicseba-api
sleep 2 && curl -fsS http://127.0.0.1:4100/health && echo " API is up"
