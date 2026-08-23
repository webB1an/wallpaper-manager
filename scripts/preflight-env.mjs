import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const envPath = join(root, "apps/api/.env");
const examplePath = join(root, "deploy/production.env.example");

if (!existsSync(envPath)) {
  console.error("apps/api/.env 不存在。请先复制 deploy/production.env.example 并填写真实生产配置。");
  process.exit(1);
}

const env = parseEnv(envPath);
const example = parseEnv(examplePath);
const checks = [];
const warnings = [];

checkRequired("PUBLIC_API_ORIGIN", "https://wall-api.wdbzk.com");
checkRequired("ADMIN_ORIGIN", "https://wall-admin.wdbzk.com");
checkRequired("SHORT_LINK_ORIGIN", "https://r.wdbzk.com");
checkRequired("DATABASE_URL");
checkRequired("ADMIN_PASSWORD");
checkRequired("JWT_SECRET");

validateStrongSecret("ADMIN_PASSWORD", 12);
validateStrongSecret("JWT_SECRET", 32);
validateDatabaseUrl();

for (const key of [
  "ADMIN_USERNAME",
  "REDIS_HOST",
  "REDIS_PORT",
  "PANAPI_BASE_URL",
  "PANAPI_TOKEN",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "QUARK_SKILL_DIR",
  "BDPAN_PATH",
  "BAIDU_REMOTE_BASE",
  "STORAGE_ACCOUNT_ROOT",
  "FFMPEG_PATH",
  "UPLOAD_MAX_FILE_MB",
  "TENCENT_CHANNEL_RUN_ROOT",
]) {
  if (!env[key]?.trim()) warnings.push(`${key} 未配置，可能影响对应功能`);
}

if (!env.MINIPROGRAM_APPID?.trim()) {
  warnings.push("MINIPROGRAM_APPID 未配置；小程序发布前需要填写");
}

const missingFromExample = Object.keys(example).filter((key) => !(key in env));
if (missingFromExample.length) {
  warnings.push(`deploy/production.env.example 中有 ${missingFromExample.length} 个键未出现在 .env：${missingFromExample.join(", ")}`);
}

printReport();

if (checks.length) process.exit(1);
if (warnings.length) {
  console.log("Preflight passed with warnings. Fix warnings before enabling the affected features.");
  process.exit(0);
}
console.log("Preflight passed. apps/api/.env 已满足生产启动硬性要求。");

function checkRequired(key, expected) {
  const value = env[key]?.trim() || "";
  if (!value) {
    checks.push(`${key} 未配置`);
    return;
  }
  if (expected && value.replace(/\/$/, "") !== expected) {
    checks.push(`${key} 应为 ${expected}，当前为 <已隐藏>`);
  }
}

function validateStrongSecret(key, minLength) {
  const value = env[key]?.trim() || "";
  if (!value) return;
  const placeholders = [
    "change-this-password",
    "change-this-to-a-random-secret-at-least-32-characters",
    "development-secret-change-me-please",
    "CHANGE_ME",
    "CHANGE_ME_TO_AT_LEAST_32_RANDOM_CHARS",
  ];
  if (value.length < minLength || placeholders.includes(value)) {
    checks.push(`${key} 至少需要 ${minLength} 位，且不能使用示例值`);
  }
}

function validateDatabaseUrl() {
  const value = env.DATABASE_URL?.trim() || "";
  if (!value) return;
  if (["CHANGE_ME", "YOUR_PASSWORD", ":password@", ":change-this-password@"].some((item) => value.includes(item))) {
    checks.push("DATABASE_URL 不能使用示例数据库地址或弱密码");
  }
}

function parseEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return index === -1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1).trim()];
      }),
  );
}

function printReport() {
  console.log("Production environment preflight");
  console.log(`Env: ${envPath}`);
  console.log(`Hard failures: ${checks.length}`);
  console.log(`Warnings: ${warnings.length}`);
  for (const item of checks) console.log(`- [FAIL] ${item}`);
  for (const item of warnings) console.log(`- [WARN] ${item}`);
}
