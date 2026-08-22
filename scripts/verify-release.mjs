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

requireContains("apps/miniprogram/utils/api.ts", 'const API_BASE = "https://wall-api.wdbzk.com/api"');
requireContains("apps/miniprogram/pages/detail/detail.wxml", "primary-download");
requireContains("apps/miniprogram/pages/detail/detail.wxml", "download-passcode");
requireContains("apps/miniprogram/pages/mine/mine.ts", "openDetail");
requireContains("apps/miniprogram/pages/index/index.wxml", "hero-stack");
requireContains("apps/api/src/modules/admin/admin.service.ts", "checkPublicOrigins");
requireContains("apps/api/src/modules/admin/admin.service.ts", "公开域名配置");
requireContains("apps/api/src/modules/admin/admin.service.ts", "checkQuarkStorage");
requireContains("apps/api/src/modules/admin/admin.service.ts", "checkBaiduStorage");
requireContains("apps/api/src/modules/storage/storage-coordinator.service.ts", "primaryProvider");
requireContains("apps/api/src/modules/storage/quark-storage.service.ts", "quarkAgentEnv");
requireContains("apps/api/src/modules/storage/quark-storage.service.ts", 'CODEX_ENV: "1"');
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
requireContains("apps/api/src/modules/admin/admin.service.ts", "未配置默认腾讯频道账号，不能开启默认自动发帖");
requireContains("apps/api/src/modules/admin/admin.service.ts", "未配置默认腾讯频道账号，不能开启上传后自动发帖");
requireContains("apps/api/src/modules/admin/admin.service.ts", "assertDefaultChannelReady");
requireContains("apps/api/src/modules/admin/admin.service.ts", "updateSettings({ defaultAutoPublish: false })");
requireContains("apps/admin/src/main.tsx", "先配置默认腾讯频道账号，再开启默认自动发帖");
requireContains("apps/api/src/modules/public/public.service.ts", "optionalWallpaperType");
requireContains("apps/api/src/modules/public/public.service.ts", "positiveInt");
requireContains("apps/api/src/modules/public/public.service.ts", "assertRedirectUrl");
requireContains("apps/api/src/modules/public/public.service.ts", "resolvePasscode");
requireContains("apps/api/src/modules/public/public.service.ts", 'searchParams.get("pwd")');

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
requireContains("docs/deployment.md", "https://wall-api.wdbzk.com");
requireContains("docs/deployment.md", "r.wdbzk.com");

if (failures.length) {
  console.error("Release verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Release verification passed");
