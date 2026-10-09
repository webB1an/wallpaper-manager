import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OriginalsCleanupService, unlinkOriginalFile } from "./originals-cleanup.service";

const DAY = 86_400_000;
const oldTime = new Date(Date.now() - 8 * DAY);
const ASSET = "originals/1758000000000-abcd1234.jpg";

function withRoot(publicRoot: string, prisma: any) {
  const leases: any = { run: async (_: string, fn: any) => fn() };
  const config: any = { get: () => undefined };
  const svc = new OriginalsCleanupService(prisma, leases, config) as any;
  return Object.assign(svc, { publicRoot, logger: { log: () => {}, warn: () => {} } }) as OriginalsCleanupService;
}

test("expired originals with an active netdisk backup are deleted and the pointer is cleared", async () => {
  const root = await mkdtemp(join(tmpdir(), "originals-cleanup-test-"));
  try {
    await mkdir(join(root, "public", "originals"), { recursive: true });
    const file = join(root, "public", ASSET);
    await writeFile(file, "test");
    await utimes(file, oldTime, oldTime);
    const wallpaper: any = { id: "w", assetPath: ASSET };
    const prisma: any = { wallpaper: {
      findMany: async () => [{ id: "w", assetPath: ASSET }],
      findUnique: async () => ({ id: "w", assetPath: wallpaper.assetPath, articleAssets: [] }),
      update: async ({ data }: any) => Object.assign(wallpaper, data),
    } };
    const result = (await withRoot(join(root, "public"), prisma).sweep())!;
    assert.equal(result.removed, 1);
    assert.equal(wallpaper.assetPath, null);
    await assert.rejects(readFile(file));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("recent files, changed rows, article assets and missing files are handled safely", async () => {
  const root = await mkdtemp(join(tmpdir(), "originals-cleanup-keep-test-"));
  try {
    await mkdir(join(root, "public", "originals"), { recursive: true });
    const file = join(root, "public", ASSET);
    await writeFile(file, "test");
    const state = { rowAsset: ASSET, freshAsset: ASSET as string | null, freshArticleAssets: [] as Array<{ id: string }>, updates: [] as Array<any> };
    const prisma: any = { wallpaper: {
      // 只有"有备份"的第一轮查询返回行；"无备份"第二轮返回空，避免同一行被两轮重复处理。
      findMany: async (args: any) => (args?.where?.storageLinks?.some ? [{ id: "w", assetPath: state.rowAsset }] : []),
      findUnique: async () => ({ id: "w", assetPath: state.freshAsset, articleAssets: state.freshArticleAssets }),
      update: async ({ data }: any) => { state.updates.push(data); state.freshAsset = data.assetPath; },
    } };
    const svc = withRoot(join(root, "public"), prisma);
    // 文件 mtime 兜底：数据库行已过期但文件最近被写过时必须保留。
    assert.equal((await svc.sweep())!.removed, 0);
    assert.equal(state.updates.length, 0);
    assert.equal(await readFile(file, "utf8"), "test");
    // 竞态复核：扫描到的 assetPath 与最新行不一致时保留。
    await utimes(file, oldTime, oldTime);
    state.rowAsset = "originals/renamed.jpg"; state.freshAsset = ASSET;
    assert.equal((await svc.sweep())!.removed, 0);
    assert.equal(state.updates.length, 0);
    // 复核阶段发现文章素材关联时保留（WallMuse 素材归专属清理器管）。
    state.rowAsset = ASSET; state.freshArticleAssets = [{ id: "a" }];
    assert.equal((await svc.sweep())!.removed, 0);
    assert.equal(state.updates.length, 0);
    state.freshArticleAssets = [];
    // 指针悬空：文件不存在时清数据库指针，计入 removed（与手动清理按钮计数一致）且不释放字节。
    state.rowAsset = "originals/missing-1234.jpg"; state.freshAsset = "originals/missing-1234.jpg";
    const gone = (await svc.sweep())!;
    assert.equal(gone.removed, 1);
    assert.equal(gone.bytes, 0);
    assert.equal(state.updates.length, 1);
    assert.equal(state.updates[0].assetPath, null);
    assert.equal(await readFile(file, "utf8"), "test");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unbacked originals past the absolute limit are reclaimed with a warning log", async () => {
  const root = await mkdtemp(join(tmpdir(), "originals-cleanup-unbacked-test-"));
  try {
    await mkdir(join(root, "public", "originals"), { recursive: true });
    const file = join(root, "public", ASSET);
    await writeFile(file, "test");
    const ancientTime = new Date(Date.now() - 31 * DAY);
    await utimes(file, ancientTime, ancientTime);
    const wallpaper: any = { id: "w", assetPath: ASSET };
    const prisma: any = { wallpaper: {
      // 第一轮查询（storageLinks.some，有备份）返回空；第二轮查询（storageLinks.none，无备份）返回该行。
      findMany: async (args: any) => (args?.where?.storageLinks?.none ? [{ id: "w", assetPath: ASSET }] : []),
      findUnique: async () => ({ id: "w", assetPath: wallpaper.assetPath, articleAssets: [] }),
      update: async ({ data }: any) => Object.assign(wallpaper, data),
    } };
    const warnings: string[] = [];
    const leases: any = { run: async (_: string, fn: any) => fn() };
    const config: any = { get: () => undefined };
    const svc = Object.assign(new OriginalsCleanupService(prisma, leases, config) as any, {
      publicRoot: join(root, "public"),
      logger: { log: () => {}, warn: (m: string) => warnings.push(m) },
    }) as OriginalsCleanupService;
    const result = (await svc.sweep())!;
    assert.equal(result.removed, 1);
    assert.equal(wallpaper.assetPath, null);
    await assert.rejects(readFile(file));
    assert.ok(warnings.some((m) => m.includes("没有任何网盘备份")), "无备份回收必须留痕");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unlinkOriginalFile rejects foreign paths and wallmuse originals", async () => {
  const root = await mkdtemp(join(tmpdir(), "originals-cleanup-guard-test-"));
  try {
    await mkdir(join(root, "originals"), { recursive: true });
    await writeFile(join(root, "originals", "wm-abcd.jpg"), "keep");
    await assert.rejects(unlinkOriginalFile(root, "covers/abc.jpg"), /拒绝/);
    await assert.rejects(unlinkOriginalFile(root, "originals/wm-abcd.jpg"), /拒绝/);
    await assert.rejects(unlinkOriginalFile(root, "originals/sub/x.jpg"), /拒绝/);
    await assert.rejects(unlinkOriginalFile(root, "../secret.jpg"), /拒绝/);
    assert.equal(await readFile(join(root, "originals", "wm-abcd.jpg"), "utf8"), "keep");
  } finally { await rm(root, { recursive: true, force: true }); }
});
