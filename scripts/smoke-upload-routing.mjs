import { existsSync, readFileSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const env = {
  ...readDotenv("apps/api/.env"),
  ...process.env,
};
const adminOrigin = (env.ADMIN_ORIGIN || "https://wall-admin.wdbzk.com").replace(/\/$/, "");
const username = env.ADMIN_USERNAME || "admin";
const password = env.ADMIN_PASSWORD;

if (!password) {
  throw new Error("ADMIN_PASSWORD is required. Run this on the server or provide ADMIN_PASSWORD in the environment.");
}
if (!env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required so the upload routing smoke can clean temporary wallpapers and files.");
}

const requireFromApi = createRequire(join(process.cwd(), "apps/api/package.json"));
const { PrismaClient } = requireFromApi("@prisma/client");
const sharp = requireFromApi("sharp");
const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

async function request(path, init = {}) {
  const response = await fetch(`${adminOrigin}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 200) {
    throw new Error(`${path} failed with ${response.status}: ${body.message || body.error || "invalid response"}`);
  }
  return body.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const login = await request("/api/admin/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
assert(typeof login.token === "string" && login.token.length > 20, "admin login must return a token");

const jsonHeaders = { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" };
const uploadHeaders = { Authorization: `Bearer ${login.token}` };
const runId = `codex-smoke-upload-routing-${Date.now()}`;
const createdAccounts = [];
const createdWallpaperIds = [];
let uploadedWallpaper;

await cleanupSmokeData();
await assertCorruptUploadIsClean();
await assertInvalidChannelAccountIsClean();
await assertInvalidStorageAccountIsClean();

try {
  for (const index of [1, 2]) {
    const token = `${runId}-token-${index}`;
    const account = await request("/api/admin/channels", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        label: `${runId}-channel-${index}`,
        token,
        guildId: `${runId}-guild-${index}`,
        guildName: `Upload Routing Guild ${index}`,
        channelId: `${runId}-channel-id-${index}`,
        channelName: `Upload Routing Channel ${index}`,
        isDefault: false,
      }),
    });
    assert(account.id, "temporary channel account must be created");
    createdAccounts.push(account);
  }

  const selectedAccount = createdAccounts.at(-1);
  const fileName = `${runId}.jpg`;
  const form = new FormData();
  form.set("autoProcess", "false");
  form.set("autoPublish", "true");
  form.set("channelAccountId", selectedAccount.id);
  form.append("files", new Blob([await smokeJpeg()], { type: "image/jpeg" }), fileName);

  const uploaded = await request("/api/admin/uploads", {
    method: "POST",
    headers: uploadHeaders,
    body: form,
  });
  assert(Array.isArray(uploaded) && uploaded.length === 1, "upload must create one wallpaper");
  uploadedWallpaper = uploaded[0];
  createdWallpaperIds.push(uploadedWallpaper.id);
  assert(uploadedWallpaper.status === "draft", "autoProcess=false upload must stay draft");
  assert(uploadedWallpaper.autoPublish === true, "autoPublish=true must be persisted on uploaded wallpaper");
  assert(uploadedWallpaper.originalName === fileName, "uploaded wallpaper must keep the smoke file name");

  const stored = await prisma.wallpaper.findUnique({ where: { id: uploadedWallpaper.id } });
  assert(stored?.autoPublish === true, "database wallpaper must persist autoPublish=true");
  assert(stored?.status === "draft", "database wallpaper must remain draft");
  assert(stored?.assetPath && stored.coverPath, "upload must persist asset and cover paths for cleanup verification");

  const relatedTasks = await prisma.task.count({
    where: {
      payload: {
        path: "$.wallpaperId",
        equals: uploadedWallpaper.id,
      },
    },
  });
  assert(relatedTasks === 0, "autoProcess=false upload must not enqueue processing tasks");
} finally {
  await cleanupSmokeData(createdWallpaperIds);
  for (const account of createdAccounts) {
    await request(`/api/admin/channels/${account.id}`, { method: "DELETE", headers: jsonHeaders }).catch((error) => {
      console.error(`failed to delete temporary channel account ${account.id}: ${error.message}`);
    });
  }
  await cleanupSmokeData();
  await cleanupSmokeAccounts();
  await prisma.$disconnect();
}

console.log(JSON.stringify({
  ok: true,
  adminOrigin,
  selectedChannelAccount: createdAccounts.at(-1)?.id,
  uploadedWallpaper: uploadedWallpaper ? {
    id: uploadedWallpaper.id,
    status: uploadedWallpaper.status,
    autoPublish: uploadedWallpaper.autoPublish,
    originalName: uploadedWallpaper.originalName,
  } : null,
}, null, 2));

async function cleanupSmokeAccounts() {
  const accounts = await request("/api/admin/channels", { headers: jsonHeaders });
  const stale = accounts.filter((account) => String(account.label || "").startsWith("codex-smoke-upload-routing-"));
  for (const account of stale) {
    await request(`/api/admin/channels/${account.id}`, { method: "DELETE", headers: jsonHeaders });
  }
}

async function assertCorruptUploadIsClean() {
  const fileName = `${runId}-broken.jpg`;
  const before = await publicFileSnapshot();
  const form = new FormData();
  form.set("autoProcess", "false");
  form.set("autoPublish", "false");
  form.append("files", new Blob([Buffer.from("not-a-real-jpeg")], { type: "image/jpeg" }), fileName);

  const response = await fetch(`${adminOrigin}/api/admin/uploads`, {
    method: "POST",
    headers: uploadHeaders,
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  assert(response.status === 400, `corrupt upload must return 400, got ${response.status}: ${body.message || body.error || "invalid response"}`);
  assert(String(body.message || body.error || "").includes("无法生成封面"), "corrupt upload must explain cover generation failure");

  const after = await publicFileSnapshot();
  assert(sameSet(before, after), "corrupt upload must not leave original or cover files");
  const leaked = await prisma.wallpaper.count({ where: { originalName: fileName } });
  assert(leaked === 0, "corrupt upload must not create wallpaper rows");
}

async function assertInvalidChannelAccountIsClean() {
  const fileName = `${runId}-invalid-channel.jpg`;
  const before = await publicFileSnapshot();
  const form = new FormData();
  form.set("autoProcess", "false");
  form.set("autoPublish", "true");
  form.set("channelAccountId", `${runId}-missing-channel-account`);
  form.append("files", new Blob([await smokeJpeg()], { type: "image/jpeg" }), fileName);

  const response = await fetch(`${adminOrigin}/api/admin/uploads`, {
    method: "POST",
    headers: uploadHeaders,
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  assert(response.status === 400, `invalid channel upload must return 400, got ${response.status}: ${body.message || body.error || "invalid response"}`);
  assert(String(body.message || body.error || "").includes("未配置可用腾讯频道账号"), "invalid channel upload must explain missing channel account");

  const after = await publicFileSnapshot();
  assert(sameSet(before, after), "invalid channel upload must reject before writing original or cover files");
  const leaked = await prisma.wallpaper.count({ where: { originalName: fileName } });
  assert(leaked === 0, "invalid channel upload must not create wallpaper rows");
}

async function assertInvalidStorageAccountIsClean() {
  const fileName = `${runId}-invalid-storage.jpg`;
  const before = await publicFileSnapshot();
  const form = new FormData();
  form.set("autoProcess", "true");
  form.set("autoPublish", "false");
  form.set("quarkAccountId", `${runId}-missing-storage-account`);
  form.append("files", new Blob([await smokeJpeg()], { type: "image/jpeg" }), fileName);

  const response = await fetch(`${adminOrigin}/api/admin/uploads`, {
    method: "POST",
    headers: uploadHeaders,
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  assert(response.status === 400, `invalid storage upload must return 400, got ${response.status}: ${body.message || body.error || "invalid response"}`);
  assert(String(body.message || body.error || "").includes("网盘账号不存在"), "invalid storage upload must explain missing storage account");

  const after = await publicFileSnapshot();
  assert(sameSet(before, after), "invalid storage upload must reject before writing original or cover files");
  const leaked = await prisma.wallpaper.count({ where: { originalName: fileName } });
  assert(leaked === 0, "invalid storage upload must not create wallpaper rows");
}

async function cleanupSmokeData(ids = []) {
  const wallpapers = await prisma.wallpaper.findMany({
    where: {
      OR: [
        ids.length ? { id: { in: ids } } : undefined,
        { originalName: { startsWith: "codex-smoke-upload-routing-" } },
      ].filter(Boolean),
    },
    select: { id: true, assetPath: true, coverPath: true },
  });
  if (!wallpapers.length) return;
  await prisma.wallpaper.deleteMany({ where: { id: { in: wallpapers.map((item) => item.id) } } });
  for (const item of wallpapers) {
    await removePublicFile(item.assetPath);
    await removePublicFile(item.coverPath);
  }
}

async function publicFileSnapshot() {
  const root = resolve(process.cwd(), "storage", "public");
  const result = new Set();
  for (const dir of ["originals", "covers"]) {
    const names = await readdir(resolve(root, dir)).catch(() => []);
    for (const name of names) result.add(`${dir}/${name}`);
  }
  return result;
}

function sameSet(left, right) {
  if (left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}

async function removePublicFile(relativePath) {
  if (!relativePath) return;
  const root = resolve(process.cwd(), "storage", "public");
  const target = resolve(root, relativePath);
  if (target === root || !target.startsWith(`${root}${process.platform === "win32" ? "\\" : "/"}`)) return;
  await rm(target, { force: true }).catch(() => undefined);
}

function smokeJpeg() {
  return sharp({
    create: {
      width: 16,
      height: 16,
      channels: 3,
      background: "#f8faf5",
    },
  }).jpeg({ quality: 90 }).toBuffer();
}

function readDotenv(path) {
  const fullPath = join(process.cwd(), path);
  if (!existsSync(fullPath)) return {};
  return Object.fromEntries(
    readFileSync(fullPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return index === -1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}
