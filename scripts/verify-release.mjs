import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
    return {};
  }
}

function requireFile(path) {
  if (!existsSync(join(root, path))) fail(`${path} is missing`);
}

function requireContains(path, expected) {
  const text = readText(path);
  if (!text.includes(expected)) fail(`${path} must contain ${expected}`);
}

function parseEnvExample(path) {
  return Object.fromEntries(
    readText(path)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return index === -1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

const app = readJson("apps/miniprogram/app.json");
const project = readJson("apps/miniprogram/project.config.json");
const wechatDomains = readJson("deploy/wechat-miniprogram-domains.json");
const rootPackage = readJson("package.json");
const env = parseEnvExample("deploy/production.env.example");

for (const page of app.pages || []) {
  for (const extension of ["json", "ts", "wxml", "wxss"]) {
    requireFile(`apps/miniprogram/${page}.${extension}`);
  }
}

const tabPages = new Set((app.tabBar?.list || []).map((item) => item.pagePath));
for (const page of ["pages/index/index", "pages/category/category", "pages/mine/mine"]) {
  if (!tabPages.has(page)) fail(`app.json tabBar must include ${page}`);
}

if (project.appid !== "") fail("project.config.json appid must stay blank until the real WeChat AppID is assigned");
if (project.setting?.urlCheck !== true) fail("project.config.json setting.urlCheck must stay true for production parity");
if (!wechatDomains.request?.includes("https://wall-api.wdbzk.com")) fail("wechat request domain must include wall-api.wdbzk.com");
if (!wechatDomains.downloadFile?.includes("https://wall-api.wdbzk.com")) fail("wechat downloadFile domain must include wall-api.wdbzk.com");
if (wechatDomains.request?.includes("https://r.wdbzk.com")) fail("r.wdbzk.com should not be configured as a mini program request domain while it is copied as text only");
if (!rootPackage.workspaces?.includes("apps/miniprogram")) fail("root package workspaces must include apps/miniprogram");
if (rootPackage.scripts?.["smoke:admin"] !== "node scripts/smoke-admin.mjs") fail("root package must expose smoke:admin");
if (rootPackage.scripts?.["smoke:public"] !== "node scripts/smoke-public.mjs") fail("root package must expose smoke:public");
if (rootPackage.scripts?.["smoke:production"] !== "npm run smoke:public && npm run smoke:admin") fail("root package must expose smoke:production");
if (rootPackage.scripts?.["smoke:production:strict"] !== "node scripts/smoke-public.mjs && node scripts/smoke-admin.mjs --strict") fail("root package must expose smoke:production:strict");
if (rootPackage.scripts?.["smoke:channel-accounts"] !== "node scripts/smoke-channel-accounts.mjs") fail("root package must expose smoke:channel-accounts");
if (rootPackage.scripts?.["smoke:storage-accounts"] !== "node scripts/smoke-storage-accounts.mjs") fail("root package must expose smoke:storage-accounts");
if (rootPackage.scripts?.["readiness:production"] !== "node scripts/production-readiness.mjs") fail("root package must expose readiness:production");
if (rootPackage.scripts?.["readiness:production:strict"] !== "node scripts/production-readiness.mjs --strict") fail("root package must expose readiness:production:strict");
if (rootPackage.scripts?.["readiness:miniprogram"] !== "node scripts/miniprogram-readiness.mjs") fail("root package must expose readiness:miniprogram");
if (rootPackage.scripts?.["readiness:launch"] !== "node scripts/launch-readiness.mjs") fail("root package must expose readiness:launch");
if (rootPackage.scripts?.["auth:storage"] !== "node scripts/storage-auth.mjs") fail("root package must expose auth:storage");
if (rootPackage.scripts?.["cleanup:unpublished-links"] !== "node scripts/cleanup-unpublished-links.mjs") fail("root package must expose cleanup:unpublished-links");

requireFile("apps/miniprogram/package.json");
requireFile("apps/miniprogram/tsconfig.json");
requireFile("scripts/smoke-admin.mjs");
requireFile("scripts/smoke-public.mjs");
requireFile("scripts/smoke-channel-accounts.mjs");
requireFile("scripts/smoke-storage-accounts.mjs");
requireFile("scripts/miniprogram-readiness.mjs");
requireFile("scripts/launch-readiness.mjs");
requireFile("scripts/production-readiness.mjs");
requireFile("scripts/storage-auth.mjs");
requireFile("scripts/cleanup-unpublished-links.mjs");
requireContains("apps/miniprogram/package.json", "typecheck");
requireContains("apps/miniprogram/tsconfig.json", "miniprogram-api-typings");
requireContains("apps/miniprogram/app.ts", "showShareMenu");
requireContains("apps/miniprogram/app.ts", "shareTimeline");
requireContains("apps/miniprogram/sitemap.json", "pages/detail/detail");
requireContains("apps/miniprogram/sitemap.json", "disallow");
requireContains("apps/miniprogram/pages/category/category.json", "enablePullDownRefresh");
requireContains("apps/miniprogram/pages/category/category.ts", "onPullDownRefresh");
requireContains("apps/miniprogram/app.wxss", "state-card");
requireContains("apps/miniprogram/pages/index/index.wxml", "skeleton-grid");
requireContains("apps/miniprogram/pages/index/index.wxss", "skeletonSweep");
requireContains("apps/miniprogram/pages/category/category.wxml", "category-skeleton-grid");
requireContains("apps/miniprogram/pages/category/category.wxss", "tagSkeletonSweep");
requireContains("apps/miniprogram/pages/detail/detail.wxml", "detail-panel-skeleton");
requireContains("apps/miniprogram/pages/detail/detail.wxss", "detailSkeletonSweep");
requireContains("apps/miniprogram/utils/api.ts", 'const API_BASE = "https://wall-api.wdbzk.com/api"');
requireContains("apps/miniprogram/pages/detail/detail.wxml", "primary-download");
requireContains("apps/miniprogram/pages/detail/detail.wxml", "download-passcode");
requireContains("apps/miniprogram/pages/mine/mine.ts", "openDetail");
requireContains("apps/miniprogram/pages/index/index.wxml", "hero-stack");
requireContains("apps/api/src/modules/admin/admin.service.ts", "checkPublicOrigins");
requireContains("apps/api/src/modules/admin/admin.service.ts", "公开域名配置");
requireContains("apps/api/src/modules/admin/admin.service.ts", "checkMiniprogramReleaseConfig");
requireContains("apps/api/src/modules/admin/admin.service.ts", "微信小程序发布");
requireContains("apps/api/src/modules/admin/admin.service.ts", "formatReadinessReport");
requireContains("apps/api/src/modules/admin/admin.service.ts", "readinessAction");
requireContains("apps/api/src/modules/admin/admin.controller.ts", "readiness");
requireContains("apps/api/src/modules/admin/admin.service.ts", "checkQuarkStorage");
requireContains("apps/api/src/modules/admin/admin.service.ts", "checkBaiduStorage");
requireContains("apps/api/src/modules/admin/admin.controller.ts", "storage-accounts");
requireContains("apps/api/src/modules/storage/storage-account.service.ts", "startBaiduAuth");
requireContains("apps/api/src/modules/storage/storage-account.service.ts", "finishQuarkAuth");
requireContains("apps/api/src/modules/storage/storage-account.service.ts", "where: { isActive: true }");
requireContains("apps/api/src/modules/storage/storage-account.service.ts", "--config-path");
requireContains("apps/api/src/modules/storage/storage-account.service.ts", "XDG_CONFIG_HOME");
requireContains("apps/api/prisma/schema.prisma", "model StorageAccount");
requireContains("apps/api/prisma/schema.prisma", "storageAccountId");
requireContains("apps/admin/src/main.tsx", "function StorageAccounts");
requireContains("apps/admin/src/main.tsx", "网盘账号");
requireContains("apps/admin/src/main.tsx", "/api/admin/readiness");
requireContains("apps/admin/src/main.tsx", "微信小程序 AppID 与域名");
requireContains("apps/admin/src/main.tsx", "复制报告");
requireContains("apps/admin/src/main.tsx", "夸克主源");
requireContains("apps/admin/src/main.tsx", "百度备用源");
requireContains("apps/admin/src/main.tsx", "第一个账号会自动设为默认");
requireContains("apps/admin/src/main.tsx", "本次夸克同步账号");
requireContains("apps/admin/src/main.tsx", "本次百度同步账号");
requireContains("apps/admin/src/main.tsx", "auth/start");
requireContains("apps/admin/src/main.tsx", "auth/finish");
requireContains("apps/api/src/modules/admin/admin.service.ts", "storageSelection");
requireContains("apps/api/src/modules/storage/storage-coordinator.service.ts", "getAccountForProvider");
requireContains("apps/api/src/modules/admin/admin.service.ts", "quarkLoginCommand");
requireContains("apps/api/src/modules/admin/admin.service.ts", "--get-auth-url");
requireContains("apps/api/src/modules/admin/admin.service.ts", "--set-code <授权码>");
requireContains("apps/api/src/modules/admin/admin.service.ts", "command?: string");
requireContains("apps/api/src/modules/admin/admin.service.ts", "CODEX_ENV=1 AI_AGENT=codex");
requireContains("apps/api/src/modules/storage/storage-coordinator.service.ts", "primaryProvider");
requireContains("apps/api/src/modules/storage/quark-storage.service.ts", "quarkAccountEnv");
requireContains("apps/api/src/modules/storage/storage-account.service.ts", 'CODEX_ENV: "1"');
requireContains("apps/api/src/modules/channel/channel.service.ts", "PUBLIC_CHANNEL_ACCOUNT_SELECT");
requireContains("apps/api/src/modules/channel/channel.service.ts", "select: PUBLIC_CHANNEL_ACCOUNT_SELECT");
requireContains("apps/api/src/modules/channel/channel.service.ts", "accountCount === 0");
requireContains("apps/api/src/modules/admin/admin.service.ts", "默认账号已设置");
requireContains("apps/api/src/modules/admin/admin.service.ts", "assertChannelMediaReady");
requireContains("apps/api/src/modules/admin/admin.service.ts", "频道发帖素材不完整");
requireContains("apps/api/src/modules/admin/admin.service.ts", 'BadRequestException("未配置腾讯频道账号")');
requireContains("apps/admin/src/main.tsx", "uploadErrorMessage");
requireContains("apps/api/src/modules/admin/admin.service.ts", "存在没有可用网盘短链");
requireContains("apps/api/src/modules/admin/admin.service.ts", "storageLink: { isActive: true }");
requireContains("apps/api/src/modules/admin/admin.service.ts", "assertHttpUrl");
requireContains("apps/admin/src/main.tsx", "defaultChannelReady");
requireContains("apps/admin/src/main.tsx", "未配置默认频道账号");
requireContains("apps/admin/src/main.tsx", "默认频道账号");
requireContains("apps/admin/src/main.tsx", "静态最多 18 张 · 动态 1 个");
requireContains("apps/admin/src/main.tsx", "发帖内容不带网盘链接");
requireContains("apps/api/src/modules/admin/admin.service.ts", "未配置默认腾讯频道账号，不能开启默认自动发帖");
requireContains("apps/api/src/modules/admin/admin.service.ts", "未配置默认腾讯频道账号，不能开启上传后自动发帖");
requireContains("apps/api/src/modules/admin/admin.service.ts", "assertDefaultChannelReady");
requireContains("apps/api/src/modules/admin/admin.service.ts", "updateSettings({ defaultAutoPublish: false })");
requireContains("apps/api/src/modules/admin/admin.service.ts", "where: { wallpaperId: link.wallpaperId }");
requireContains("apps/admin/src/main.tsx", "先配置默认腾讯频道账号，再开启默认自动发帖");
requireContains("apps/admin/src/main.tsx", "row.command");
requireContains("apps/admin/src/main.tsx", "命令已复制");
requireContains("apps/admin/src/main.tsx", "复制上线报告");
requireContains("apps/admin/src/main.tsx", "微信小程序发布参数");
requireContains("apps/admin/src/main.tsx", "request 合法域名");
requireContains("apps/admin/src/main.tsx", "r.wdbzk.com 只复制文本");
requireContains("apps/admin/src/main.tsx", "function DiagnosticActions");
requireContains("apps/admin/src/main.tsx", "去网盘账号");
requireContains("apps/admin/src/main.tsx", "去腾讯频道");
requireContains("apps/admin/src/main.tsx", "处理短链");
requireContains("apps/admin/src/main.tsx", "miniprogram_release");
requireContains("apps/admin/src/main.tsx", "warnCount");
requireContains("apps/admin/src/main.tsx", "提醒 {warnCount}");
requireContains("apps/admin/src/styles.css", "diagnostic-message");
requireContains("apps/admin/src/styles.css", "storage-readiness");
requireContains("apps/admin/src/styles.css", "channel-readiness");
requireContains("apps/admin/src/styles.css", "release-guide");
requireContains("apps/admin/vite.config.ts", "chunkSizeWarningLimit");
requireContains("apps/api/src/modules/public/public.service.ts", "optionalWallpaperType");
requireContains("apps/api/src/modules/public/public.service.ts", "positiveInt");
requireContains("apps/api/src/modules/public/public.service.ts", "publicCoverUrl");
requireContains("apps/api/src/modules/public/public.service.ts", "FALLBACK_COVER_URL");
requireContains("apps/api/src/modules/public/public.service.ts", "compareShortLinks");
requireContains("apps/api/src/modules/public/public.service.ts", "storageLink.isPrimary");
requireContains("apps/api/src/modules/public/public.service.ts", "assertRedirectUrl");
requireContains("apps/api/src/modules/public/public.service.ts", "link.wallpaper.status !== WallpaperStatus.published");
requireContains("scripts/smoke-admin.mjs", "STRICT_ADMIN_SMOKE");
requireContains("scripts/smoke-admin.mjs", "--strict");
requireContains("scripts/smoke-admin.mjs", "blockingDiagnostics");
requireContains("scripts/smoke-admin.mjs", "item.command");
requireContains("scripts/smoke-admin.mjs", "/api/admin/overview");
requireContains("scripts/smoke-admin.mjs", "/api/admin/storage-accounts");
requireContains("scripts/smoke-admin.mjs", "/api/admin/readiness");
requireContains("scripts/smoke-admin.mjs", "Wallpaper Manager readiness");
requireContains("scripts/smoke-admin.mjs", "overview.storageAccounts.defaultBaidu");
requireContains("scripts/smoke-admin.mjs", "overview.storageAccounts.defaultQuark");
requireContains("scripts/smoke-admin.mjs", "diagnostics");
requireContains("scripts/smoke-channel-accounts.mjs", "codex-smoke-channel-");
requireContains("scripts/smoke-channel-accounts.mjs", "/api/admin/channels");
requireContains("scripts/smoke-channel-accounts.mjs", "tokenTail");
requireContains("scripts/smoke-channel-accounts.mjs", "automatically become default");
requireContains("scripts/smoke-channel-accounts.mjs", "promote another account");
requireContains("scripts/smoke-channel-accounts.mjs", "finally");
requireContains("scripts/smoke-storage-accounts.mjs", "--auth-start");
requireContains("scripts/smoke-storage-accounts.mjs", "codex-smoke-");
requireContains("scripts/smoke-storage-accounts.mjs", "/api/admin/storage-accounts");
requireContains("scripts/smoke-storage-accounts.mjs", "automatically become default");
requireContains("scripts/smoke-storage-accounts.mjs", "promote another account");
requireContains("scripts/smoke-storage-accounts.mjs", "finally");
requireContains("scripts/smoke-public.mjs", "checkedListItems");
requireContains("scripts/smoke-public.mjs", "health endpoint must return ok");
requireContains("scripts/smoke-public.mjs", "short link must be served from");
requireContains("scripts/smoke-public.mjs", "SMOKE_REQUEST_RETRIES");
requireContains("scripts/smoke-public.mjs", "SMOKE_RETRY_DELAY_MS");
requireContains("scripts/production-readiness.mjs", "Action required");
requireContains("scripts/production-readiness.mjs", "bdpan");
requireContains("scripts/production-readiness.mjs", "quark_skill");
requireContains("scripts/production-readiness.mjs", "channel_accounts");
requireContains("scripts/production-readiness.mjs", "unpublished_active_short_links");
requireContains("scripts/production-readiness.mjs", "miniprogram_release");
requireContains("scripts/production-readiness.mjs", "微信小程序发布");
requireContains("scripts/production-readiness.mjs", "网盘账号");
requireContains("scripts/production-readiness.mjs", "--json");
requireContains("scripts/production-readiness.mjs", "--strict");
requireContains("scripts/miniprogram-readiness.mjs", "--allow-empty-appid");
requireContains("scripts/miniprogram-readiness.mjs", "https://wall-api.wdbzk.com");
requireContains("scripts/miniprogram-readiness.mjs", "https://r.wdbzk.com");
requireContains("scripts/launch-readiness.mjs", "scripts/production-readiness.mjs");
requireContains("scripts/launch-readiness.mjs", "scripts/miniprogram-readiness.mjs");
requireContains("scripts/launch-readiness.mjs", "--skip-production");
requireContains("scripts/storage-auth.mjs", "baidu-url");
requireContains("scripts/storage-auth.mjs", "baidu-code");
requireContains("scripts/storage-auth.mjs", "quark-login");
requireContains("scripts/storage-auth.mjs", "CODEX_ENV");
requireContains("scripts/storage-auth.mjs", "AI_AGENT");
requireContains("scripts/cleanup-unpublished-links.mjs", "unpublished_active_short");
requireContains("scripts/cleanup-unpublished-links.mjs", "deactivate-unpublished-links");
requireContains("scripts/cleanup-unpublished-links.mjs", "--apply");
requireContains("scripts/cleanup-unpublished-links.mjs", "dry-run");
requireContains("apps/api/src/modules/admin/admin.service.ts", "checkUnpublishedActiveShortLinks");
requireContains("apps/api/src/modules/admin/admin.service.ts", "unpublished_active_short");
requireContains("apps/api/src/modules/admin/admin.controller.ts", "unpublished_active_short");
requireContains("apps/api/src/modules/admin/admin.controller.ts", "deactivate-unpublished-links");
requireContains("apps/api/src/modules/admin/admin.service.ts", "deactivateUnpublishedStorageLinks");
requireContains("apps/admin/src/main.tsx", "deactivateUnpublishedLinks");
requireContains("apps/admin/src/main.tsx", "unpublishedActiveShortLinks");
requireContains("apps/admin/src/main.tsx", "下架活跃短链");
requireContains("apps/api/src/modules/public/public.service.ts", "resolvePasscode");
requireContains("apps/api/src/modules/public/public.service.ts", 'searchParams.get("pwd")');
requireContains(".github/workflows/deploy.yml", "Smoke production");
requireContains(".github/workflows/deploy.yml", "npm run smoke:production");
requireContains(".github/workflows/deploy.yml", "Launch readiness report");
requireContains(".github/workflows/deploy.yml", "npm run readiness:launch -- --allow-empty-appid || true");

const requiredEnv = [
  "PUBLIC_API_ORIGIN",
  "ADMIN_ORIGIN",
  "SHORT_LINK_ORIGIN",
  "DATABASE_URL",
  "DEEPSEEK_API_KEY",
  "PANAPI_BASE_URL",
  "PANAPI_TOKEN",
  "OLD_WALLPAPER_ROOT",
  "QUARK_SKILL_DIR",
  "BDPAN_PATH",
  "STORAGE_ACCOUNT_ROOT",
  "TENCENT_CHANNEL_RUN_ROOT",
];
for (const key of requiredEnv) {
  if (!(key in env)) fail(`deploy/production.env.example must define ${key}`);
}

if (env.PUBLIC_API_ORIGIN !== "https://wall-api.wdbzk.com") fail("PUBLIC_API_ORIGIN must point to wall-api.wdbzk.com");
if (env.ADMIN_ORIGIN !== "https://wall-admin.wdbzk.com") fail("ADMIN_ORIGIN must point to wall-admin.wdbzk.com");
if (env.SHORT_LINK_ORIGIN !== "https://r.wdbzk.com") fail("SHORT_LINK_ORIGIN must point to r.wdbzk.com");
if (env.PANAPI_BASE_URL !== "https://panapi.wdbzk.com") fail("PANAPI_BASE_URL must point to panapi.wdbzk.com");
if (env.DEEPSEEK_MODEL !== "deepseek-v4-flash-vision-exp") fail("DEEPSEEK_MODEL must default to deepseek-v4-flash-vision-exp");

requireContains("deploy/nginx/wall-api.wdbzk.com.conf", "server_name wall-api.wdbzk.com r.wdbzk.com");
requireContains("deploy/nginx/wall-api.wdbzk.com.conf", "server_name r.wdbzk.com");
requireContains("docs/deployment.md", "微信小程序发布");
requireContains("docs/deployment.md", "deploy/wechat-miniprogram-domains.json");
requireContains("docs/deployment.md", "https://wall-api.wdbzk.com");
requireContains("docs/deployment.md", "r.wdbzk.com");
requireContains("docs/deployment.md", "不要勾选“不校验合法域名”");
requireContains("docs/deployment.md", "网盘授权");
requireContains("docs/deployment.md", "网盘账号");
requireContains("docs/deployment.md", "支持多账号");
requireContains("docs/deployment.md", "腾讯频道配置");
requireContains("docs/deployment.md", "发布前验收清单");
requireContains("docs/deployment.md", "npm run smoke:production");
requireContains("docs/deployment.md", "npm run smoke:production:strict");
requireContains("docs/deployment.md", "npm run readiness:production");
requireContains("docs/deployment.md", "npm run readiness:miniprogram");
requireContains("docs/deployment.md", "npm run readiness:launch");
requireContains("docs/deployment.md", "npm run auth:storage -- baidu-url");
requireContains("docs/deployment.md", "npm run cleanup:unpublished-links");
requireContains("README.md", "npm run readiness:production");
requireContains("README.md", "npm run auth:storage -- quark-login");
requireContains("README.md", "npm run cleanup:unpublished-links");
requireContains("docs/deployment.md", "bdpan' login --accept-disclaimer --get-auth-url");
requireContains("docs/deployment.md", "bdpan' login --accept-disclaimer --set-code <授权码>");
requireContains("docs/deployment.md", "CODEX_ENV=1 AI_AGENT=codex node scripts/quark-drive.cjs login");
requireContains("README.md", "storage authorization commands");

if (failures.length) {
  console.error("Release verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Release verification passed");
