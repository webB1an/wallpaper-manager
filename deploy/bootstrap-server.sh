#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/wallpaper-manager}"
NODE_ENV=production

cd "$APP_DIR"

if [ ! -f "apps/api/.env" ]; then
  echo "Missing apps/api/.env. Copy .env.example and fill production secrets first." >&2
  exit 1
fi

mkdir -p storage/public/originals storage/public/covers storage/public/legacy-covers .runs/tencent-channel

# The GitHub runner already validates and builds all workspaces before rsync.
# On the small production host we only install runtime dependencies for the API.
npm ci --omit=dev --workspace apps/api --include-workspace-root=false
npm run prisma:generate
npm run prisma:deploy

if command -v pm2 >/dev/null 2>&1; then
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save
else
  echo "PM2 is not installed. Install it with: npm i -g pm2" >&2
  exit 1
fi

echo "Wallpaper Manager deployed."
