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
DEPS_MARKER=".deploy-api-deps.sha"
DEPS_HASH="$(sha256sum package-lock.json package.json apps/api/package.json packages/shared/package.json 2>/dev/null | sha256sum | awk '{print $1}')"

runtime_deps_available() {
  node <<'NODE'
const fs = require("node:fs");
const paths = [require("node:path").join(process.cwd(), "apps", "api")];
for (const dependency of ["@nestjs/core", "@prisma/client", "sharp"]) {
  require.resolve(dependency, { paths });
}
if (!fs.existsSync("apps/api/node_modules/.bin/prisma")) {
  throw new Error("Prisma CLI is missing");
}
NODE
}

if [ -n "$DEPS_HASH" ] && [ -f "$DEPS_MARKER" ] && [ "$(cat "$DEPS_MARKER")" = "$DEPS_HASH" ] && runtime_deps_available; then
  echo "Runtime dependencies unchanged; skipping npm ci."
elif [ -n "$DEPS_HASH" ] && [ ! -f "$DEPS_MARKER" ] && runtime_deps_available; then
  echo "Runtime dependencies already present; recording dependency fingerprint."
  printf '%s\n' "$DEPS_HASH" > "$DEPS_MARKER"
else
  npm ci --omit=dev --workspace apps/api --include-workspace-root=false --no-audit --no-fund
  printf '%s\n' "$DEPS_HASH" > "$DEPS_MARKER"
fi
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
