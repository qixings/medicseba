#!/usr/bin/env bash
# Pull the latest code, rebuild and restart. Shows what changed first.
#   bash deploy/update.sh
set -euo pipefail
cd /opt/medicseba
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; export PATH="$(dirname "$(nvm which 22)"):$PATH"

git fetch origin main
echo "Changes coming in:"; git --no-pager log --oneline HEAD..origin/main; git --no-pager diff --stat HEAD origin/main
read -r -p "Deploy these? [y/N] " ok; [ "$ok" = "y" ] || exit 0
git merge --ff-only origin/main

(cd apps/api && npm ci --no-audit --no-fund && npm run build && npm run db:migrate:prod && if grep -q '^DEMO_MODE=1' .env; then npx tsx src/scripts/demo-photos.ts; fi)
(cd apps/patient && npm ci --no-audit --no-fund && npx expo export --platform web)
pm2 restart medicseba-api
sleep 2 && curl -fsS http://127.0.0.1:4100/health && echo " API is up"
