#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/wallpaper-manager}"
NODE_ENV=production

cd "$APP_DIR"

if [ ! -f "apps/api/.env" ]; then
  echo "Missing apps/api/.env. Copy .env.example and fill production secrets first." >&2
  exit 1
fi

npm run preflight:env

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

# 同步项目 Nginx 配置到线上：确保上传大小限制（client_max_body_size）与仓库一致（1024m）。
# 管理端上传走 wall-admin，小程序上传走 wall-api，两个域名都要同步。
for domain in wall-api.wdbzk.com wall-admin.wdbzk.com; do
  NGINX_CONF=""
  for candidate in \
    "/www/server/panel/vhost/nginx/${domain}.conf" \
    "/www/server/nginx/conf/vhost/${domain}.conf" \
    "/etc/nginx/conf.d/${domain}.conf"; do
    if [ -f "$candidate" ]; then NGINX_CONF="$candidate"; break; fi
  done
  if [ -n "$NGINX_CONF" ]; then
    BACKUP="${NGINX_CONF}.bak.$(date +%Y%m%d%H%M%S)"
    if cp "$NGINX_CONF" "$BACKUP" 2>/dev/null; then
      if grep -q "client_max_body_size" "$NGINX_CONF" 2>/dev/null; then
        sed -i 's/client_max_body_size[[:space:]][^;]*;/client_max_body_size 1024m;/g' "$NGINX_CONF" 2>/dev/null || cp "$BACKUP" "$NGINX_CONF" 2>/dev/null || true
      else
        sed -i '0,/^[[:space:]]*server[[:space:]]*{/s//server {\n    client_max_body_size 1024m;/' "$NGINX_CONF" 2>/dev/null || cp "$BACKUP" "$NGINX_CONF" 2>/dev/null || true
      fi
      NGINX_BIN=""
      for bin in /www/server/nginx/sbin/nginx /usr/sbin/nginx /usr/local/nginx/sbin/nginx; do
        if [ -x "$bin" ]; then NGINX_BIN="$bin"; break; fi
      done
      if [ -z "$NGINX_BIN" ] && command -v nginx >/dev/null 2>&1; then NGINX_BIN="$(command -v nginx)"; fi
      if [ -n "$NGINX_BIN" ] && "$NGINX_BIN" -t >/dev/null 2>&1; then
        "$NGINX_BIN" -s reload >/dev/null 2>&1 || true
        echo "Nginx 上传限制已同步为 1024m（$NGINX_CONF）"
      else
        cp "$BACKUP" "$NGINX_CONF" 2>/dev/null || true
        echo "Nginx 配置校验失败，已恢复备份，跳过重载" >&2
      fi
    else
      echo "无权限备份线上 Nginx 配置（$NGINX_CONF），跳过上传大小同步" >&2
    fi
  else
    echo "未找到线上 Nginx 配置文件（${domain}），跳过上传大小同步" >&2
  fi
done

if command -v pm2 >/dev/null 2>&1; then
  pm2 startOrReload ecosystem.config.cjs --update-env
  pm2 save
else
  echo "PM2 is not installed. Install it with: npm i -g pm2" >&2
  exit 1
fi

echo "Wallpaper Manager deployed."
