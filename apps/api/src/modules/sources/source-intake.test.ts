import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { Prisma } from "@prisma/client";
import { SourceIntakeService, fileSha256 } from "./source-intake.service";

async function setup(run: (file: string) => Promise<void>) {
  const base = resolve(tmpdir());
  const dir = await mkdtemp(join(base, "wallmuse-intake-test-"));
  try { const file = join(dir, "image.jpg"); await writeFile(file, "image-fixture"); await run(file); }
  finally { assert.ok(resolve(dir).startsWith(base + sep)); await rm(dir, { recursive: true }); }
}
test("共享来源排除全站已有ID；相同内容跨来源只补别名，不再创建或上传", async () => setup(async (file) => {
  const hash = await fileSha256(file);
  let aliases = 0;
  const service: any = new SourceIntakeService({ wallpaperSource: {
    findMany: async () => [{ sourceId: "old-id" }], upsert: async () => { aliases++; },
  }, wallpaper: { findFirst: async ({ where }: any) => { assert.equal(where.OR[0].contentHash, hash); return { id: "existing", contentHash: hash }; } } } as any,
  { run: async (key: string, work: any) => { assert.equal(key, "source:wallpost"); return work({ assert: async () => undefined }); } } as any);
  service.fetchSource = async (_source: string, context: any) => { assert.deepEqual(context.exclude, ["old-id"]); return { sourceId: "another-source-id", filePath: file }; };
  const result = await service.obtain("wallpost", {}, async () => assert.fail("重复素材不能生成文件"), async () => assert.fail("重复素材不能新建文章素材"));
  assert.equal(result.created, false); assert.equal(result.wallpaper.id, "existing"); assert.equal(aliases, 1);
}));
test("来源别名冲突回滚新壁纸并清理未引用文件，不留下孤立记录", async () => setup(async (file) => {
  let reads = 0; let cleanup = 0; let rows = 0;
  const existing = { id: "old", assetPath: "originals/old.jpg" };
  const prisma: any = {
    wallpaperSource: { findMany: async () => [], upsert: async () => undefined },
    wallpaper: { findFirst: async () => ++reads === 1 ? null : existing },
    $transaction: async (work: any) => {
      try { return await work({ wallpaper: { create: async () => { rows++; return { id: "new" }; } }, wallpaperSource: { create: async () => { throw new Prisma.PrismaClientKnownRequestError("alias collision", { code: "P2002", clientVersion: "test" }); } } }); }
      catch (error) { rows--; throw error; }
    },
  };
  const service: any = new SourceIntakeService(prisma, { run: async (_key: string, work: any) => work({ assert: async () => undefined }) } as any);
  service.fetchSource = async () => ({ sourceId: "same", filePath: file });
  const result = await service.obtain("wallpost", {}, async () => ({ data: { assetPath: "originals/new.jpg" }, cleanup: async () => { cleanup++; } }), async () => assert.fail("别名冲突不能提交文章素材"));
  assert.equal(result.created, false); assert.equal(result.wallpaper.id, "old"); assert.equal(rows, 0); assert.equal(cleanup, 1);
}));
test("提交响应丢失但数据已提交时，不删除文章引用的文件", async () => setup(async (file) => {
  let committed: any; let cleanup = 0;
  const prisma: any = { wallpaperSource: { findMany: async () => [] }, wallpaper: { findFirst: async () => committed },
    $transaction: async (work: any) => {
      await work({ wallpaper: { create: async ({ data }: any) => (committed = { id: "created", ...data }) }, wallpaperSource: { create: async () => undefined } });
      throw new Error("commit response lost");
    },
  };
  const service: any = new SourceIntakeService(prisma, { run: async (_key: string, work: any) => work({ assert: async () => undefined }) } as any);
  service.fetchSource = async () => ({ sourceId: "same", filePath: file });
  const result = await service.obtain("wallpost", {}, async () => ({ data: { assetPath: "originals/new.jpg" }, cleanup: async () => { cleanup++; } }), async () => undefined);
  assert.equal(result.created, true); assert.equal(cleanup, 0);
}));
