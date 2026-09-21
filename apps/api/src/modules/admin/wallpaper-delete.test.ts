import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeOwnedFile, WallpaperDeleteService } from "./wallpaper-delete.service";

test("批量删除串行去重，保留逐项失败，不吞掉其他成功项", async () => {
  const service = new WallpaperDeleteService({} as any, {} as any);
  const order: string[] = [];
  let active = false;
  service.remove = async (id: string) => {
    assert.equal(active, false); active = true;
    await Promise.resolve(); order.push(id); active = false;
    if (id === "bad") throw new Error("internal failure");
    return { deleted: true };
  };
  const result = await service.removeMany(["a", "bad", "a", "b"]);
  assert.deepEqual(order, ["a", "bad", "b"]);
  assert.deepEqual(result.deleted, ["a", "b"]);
  assert.equal(result.failed[0].id, "bad");
  await assert.rejects(service.removeMany([]));
  await assert.rejects(service.removeMany(new Array(101).fill("a")));
  await assert.rejects(service.removeMany([null]));
});

test("删除文件限制在存储目录内，缺失文件允许重试", async () => {
  const root = await mkdtemp(join(tmpdir(), "wallpaper-delete-"));
  try {
    await mkdir(join(root, "covers"));
    await writeFile(join(root, "covers", "a.jpg"), "test");
    await removeOwnedFile(root, "covers/a.jpg");
    await assert.rejects(access(join(root, "covers", "a.jpg")));
    await removeOwnedFile(root, "covers/a.jpg");
    await assert.rejects(removeOwnedFile(root, "../outside.jpg"), /超出/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("任何壁纸状态均可删除，清除限制关联后删除记录，重复删除幂等", async () => {
  for (const status of ["draft", "processing", "pending_review", "published", "rejected", "archived"]) {
    let row: any = { id: "w", status, coverPath: null, assetPath: null, articleAssets: [] };
    const calls: string[] = [];
    const tx = {
      wallpaper: { findUnique: async () => row, delete: async () => { calls.push("wallpaper"); row = null; } },
      wallMuseJob: { updateMany: async () => calls.push("jobs") },
      wallMuseCollectionItem: { deleteMany: async () => calls.push("collections") },
      wallMuseAsset: { deleteMany: async () => calls.push("assets") },
    };
    const service = new WallpaperDeleteService({ $transaction: async (fn: any) => fn(tx) } as any, { run: async (_key: string, fn: any) => fn({ assert: async () => {} }) } as any);
    assert.deepEqual(await service.remove("w"), { deleted: true });
    assert.deepEqual(await service.remove("w"), { deleted: true });
    assert.deepEqual(calls, ["jobs", "collections", "assets", "wallpaper"]);
  }
});
