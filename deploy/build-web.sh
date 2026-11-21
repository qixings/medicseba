#!/usr/bin/env bash
# Builds both web apps and puts them in /opt/medicseba/web:
#   /        patient app
#   /agent/  chamber counter app
set -euo pipefail
cd /opt/medicseba
DOMAIN="${DOMAIN:-$(grep -oP '^CORS_ORIGIN=https://\K.*' apps/api/.env)}"

for app in patient agent; do
  printf 'EXPO_PUBLIC_API_URL=https://%s\n' "$DOMAIN" > "apps/$app/.env"
  (cd "apps/$app" && npm ci --no-audit --no-fund && npx expo export --platform web)
done

# Swap in the new build in one step, so the site is never half updated.
rm -rf web.new && mkdir -p web.new/agent
cp -r apps/patient/dist/. web.new/
cp -r apps/agent/dist/. web.new/agent/
rm -rf web.old && { [ -d web ] && mv web web.old || true; } && mv web.new web && rm -rf web.old
echo "Web apps ready in /opt/medicseba/web"
