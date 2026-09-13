import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { WallMuseService } from "./wallmuse.service";
import { revisionDigest, type ArticleRevision } from "./wallmuse.schemas";
import { WallMuseWorker } from "./wallmuse.worker";
import { WaitForIdleError, idleDecision } from "./idle-policy";
import { StorageCoordinatorService } from "../storage/storage-coordinator.service";
import { WorkLeaseService, LeaseBusyError } from "../sources/work-lease.service";

function fixture(id = "revision-1"): ArticleRevision {
  return { schemaVersion: 1, articleId: "article-1", id, revision: 1, createdAt: "2026-09-12T00:00:00.000Z", subject: "远山", title: "Share｜远山壁纸1张", titleMode: "automatic", intro: "开篇", groupCopies: ["山色"], ending: "结束", interaction: "", interactionEnabled: false, assets: [{ id: "asset-1", wallpaperId: "wallpaper-1", title: "远山", src: "/assets/wallmuse/asset-1.jpg", width: 720, height: 1280, kind: "source", storageReady: true }], templateId: "editorial-journal", templateVersion: 1, rendererVersion: 1, density: "medium", provenance: "service", miniProgram: { name: "漫元壁纸", appId: "", pagePath: "pages/collections/collections" } };
}
function harness() {
  const first = fixture();
  const rows = new Map<string, any>([[first.id, { id: first.id, articleId: first.articleId, payload: first, revision: 1, contentHash: revisionDigest(first) }]]);
  const article: any = { id: first.articleId, currentRevisionId: first.id, copiedRevisionId: null, lifecycle: "pending", collection: null };
  const writes: any[] = [];
  const tx: any = {
    wallMuseArticle: { findUnique: async () => ({ ...article }), updateMany: async ({ where, data }: any) => {
      if (where.currentRevisionId && where.currentRevisionId !== article.currentRevisionId) return { count: 0 };
      Object.assign(article, data); writes.push(data); return { count: 1 };
    } },
    wallMuseRevision: {
      findUnique: async ({ where }: any) => rows.get(where.id), findFirst: async ({ where }: any) => rows.get(where.id),
      aggregate: async () => ({ _max: { revision: Math.max(...[...rows.values()].map((row) => row.revision)) } }),
      create: async ({ data }: any) => { rows.set(data.id, data); return data; },
      update: async ({ where, data }: any) => Object.assign(rows.get(where.id), data),
    },
    wallMuseAsset: { findMany: async () => [{ ...first.assets[0], wallpaper: { title: "远山", status: "pending_review" } }] },
  };
  const prisma: any = { $transaction: async (work: any, options: any) => { assert.equal(options.isolationLevel, "Serializable"); return work(tx); } };
  const service = new WallMuseService(prisma, { get: () => "true" } as any, { getSettings: async () => ({ wallMuseEnabled: true }) } as any, {} as any, {} as any, {} as any);
  return { service, article, rows, first, writes, prisma, tx };
}

test("保存编辑稿不进入历史；复制才记录准确版本，重复补记不重复写入", async () => {
  const h = harness();
  const changed = { ...h.first, id: "revision-2", intro: "新的开篇" };
  await h.service.save(h.article.id, { baseRevisionId: h.first.id, revision: changed });
  assert.equal(h.article.lifecycle, "pending");
  assert.equal(h.article.copiedRevisionId, null);
  await h.service.save(h.article.id, { baseRevisionId: h.first.id, revision: changed }, true);
  const writes = h.writes.length;
  await h.service.save(h.article.id, { baseRevisionId: h.first.id, revision: changed }, true);
  assert.equal(h.article.lifecycle, "history");
  assert.equal(h.article.copiedRevisionId, changed.id);
  assert.equal(h.writes.length, writes);
  assert.equal(h.rows.size, 2);
  assert.equal(h.article.collection, null);
  const next = { ...changed, id: "revision-3", ending: "新结束" };
  await h.service.save(h.article.id, { baseRevisionId: changed.id, revision: next }, true);
  await h.service.save(h.article.id, { baseRevisionId: h.first.id, revision: changed }, true);
  assert.equal(h.article.copiedRevisionId, next.id, "旧复制回执不能把历史倒退到旧版本");
});
test("人工保存采用版本比较；复制旧草稿仍能归档，保留服务端并发新稿", async () => {
  const h = harness();
  h.article.currentRevisionId = "concurrent-ai-revision";
  const changed = { ...h.first, id: "offline-edit", ending: "本机修改" };
  await assert.rejects(h.service.save(h.article.id, { baseRevisionId: h.first.id, revision: changed }), /其他窗口更新/);
  const result = await h.service.save(h.article.id, { baseRevisionId: h.first.id, revision: changed }, true);
  assert.equal(h.article.currentRevisionId, "concurrent-ai-revision");
  assert.equal(result.serverRevisionId, "concurrent-ai-revision");
  assert.equal(h.article.copiedRevisionId, changed.id);
  assert.equal(h.rows.get(changed.id).candidate, true);
});
test("同一版本编号不能替换内容或伪造其他素材；同步后拒绝编辑", async () => {
  const h = harness();
  await assert.rejects(h.service.save(h.article.id, { baseRevisionId: h.first.id, revision: { ...h.first, ending: "冒充旧版本" } }), /相同版本编号/);
  await assert.rejects(h.service.save(h.article.id, { baseRevisionId: h.first.id, revision: { ...h.first, id: "revision-2", assets: [{ ...h.first.assets[0], wallpaperId: "another-wallpaper" }] } }), /引用/);
  h.article.lifecycle = "synced";
  await assert.rejects(h.service.save(h.article.id, { baseRevisionId: h.first.id, revision: { ...h.first, id: "revision-2" } }), /固定合集/);
  assert.equal(h.rows.size, 1);
});
test("同步事务发生并发冲突时，重读同一固定合集并返回既有结果", async () => {
  const h = harness();
  let calls = 0;
  h.article.collection = { id: "collection-1", revisionId: h.first.id, wallpaperIds: ["wallpaper-1"] };
  h.prisma.$transaction = async (work: any) => {
    if (++calls === 1) throw new Prisma.PrismaClientKnownRequestError("serialization", { code: "P2034", clientVersion: "test" });
    return work(h.tx);
  };
  const result = await h.service.sync(h.article.id, { revisionId: h.first.id });
  assert.equal(result.collectionId, "collection-1");
  assert.equal(calls, 2);
  assert.equal(h.writes.length, 0);
});
test("取消失败任务会立即变成已取消，无需等待调度再次选中", async () => {
  const job: any = { id: "job-1", status: "failed", cancelRequested: false };
  const service = Object.assign(Object.create(WallMuseService.prototype), {
    prisma: { wallMuseJob: { findUnique: async () => job, updateMany: async ({ where, data }: any) => {
      if (where.status === job.status || where.status?.in?.includes(job.status)) Object.assign(job, data);
      return { count: 1 };
    } } }, job: async () => job,
  }) as WallMuseService;
  await service.cancel(job.id);
  assert.equal(job.status, "cancelled");
  assert.equal(job.cancelRequested, true);
});
test("等待空闲和取消阶段不下载、不识图、不上传；等待时间持久化", async () => {
  const writes: any[] = [];
  const forbidden = () => { throw new Error("不应调用外部服务"); };
  const worker = Object.assign(Object.create(WallMuseWorker.prototype), {
    prisma: { wallMuseJob: { update: async ({ data }: any) => writes.push(data) } },
    policy: { assertIdle: async () => { throw new WaitForIdleError(idleDecision([])); } },
    ai: { analyze: forbidden, plan: forbidden, copy: forbidden }, intake: { obtain: forbidden }, storage: { syncWallpaperResumable: forbidden },
  });
  const job = { id: "job-1", stage: "collect", checkpoint: { version: 1, attempts: 0 }, input: {} };
  await worker.step(job, { assert: async () => undefined });
  assert.equal(writes[0].status, "waiting");
  assert.ok(writes[0].nextRunAt instanceof Date);
  await worker.step({ ...job, cancelRequested: true }, { assert: async () => undefined });
  assert.equal(writes[1].status, "cancelled");
});
test("WallMuse 网盘分享结果未知时不会重发，已完成分享不会重新上传", async () => {
  let externalCalls = 0;
  const forbidden = async () => { externalCalls++; throw new Error("不能重复调用"); };
  const service = Object.assign(Object.create(StorageCoordinatorService.prototype), {
    leases: { run: async (_key: string, work: any) => work({ assert: async () => undefined }) },
    accounts: { getAccountForProvider: async () => ({ id: "pinned-account" }) },
    baidu: { upload: forbidden, share: forbidden },
    prisma: { $transaction: async (work: any) => work({ storageLink: { findFirst: async () => ({ id: "existing-link" }) }, shortLink: { findFirst: async () => ({ id: "existing-short" }) } }) },
  }) as StorageCoordinatorService;
  await assert.rejects(service.syncWallpaperResumable("w", "path", "title", "static", [], { baiduAccountId: "pinned-account" }, { baidu: { accountId: "pinned-account", phase: "sharing", remotePath: "/saved" } }, async () => undefined, ["baidu"]), /分享结果未知/);
  await service.syncWallpaperResumable("w", "path", "title", "static", [], { baiduAccountId: "pinned-account" }, { baidu: { accountId: "pinned-account", phase: "shared", url: "https://example.com/saved" } }, async () => undefined, ["baidu"]);
  assert.equal(externalCalls, 0);
});
test("共享来源租约阻止并发领取，工作结束后释放给下一任务", async () => {
  let row: any;
  const prisma = { workLease: {
    create: async ({ data }: any) => { if (row) throw new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }); row = data; },
    updateMany: async ({ where, data }: any) => {
      const match = row && (!where.owner || row.owner === where.owner) && (!where.expiresAt?.lt || row.expiresAt < where.expiresAt.lt) && (!where.expiresAt?.gt || row.expiresAt > where.expiresAt.gt);
      if (match) Object.assign(row, data);
      return { count: match ? 1 : 0 };
    },
    deleteMany: async ({ where }: any) => { if (row?.owner === where.owner) row = undefined; return { count: 1 }; },
  } };
  const leases = new WorkLeaseService(prisma as any);
  await leases.run("source:test", async (fence) => {
    await fence.assert();
    await assert.rejects(leases.run("source:test", async () => assert.fail("不能并行执行")), LeaseBusyError);
  });
  assert.equal(row, undefined);
  await leases.run("source:test", async (fence) => fence.assert());
});

test("同步仅发布已复制版本引用的图片，按顺序创建一次固定合集", async () => {
  const h = harness();
  h.article.lifecycle = "history"; h.article.copiedRevisionId = h.first.id;
  let publishes = 0; let collections = 0;
  h.tx.wallMuseAsset.findMany = async () => [{ id: "asset-1", drives: { baidu: { accountId: "original-account", phase: "shared", url: "https://pan.baidu.com/s/saved" } }, wallpaper: { id: "wallpaper-1", status: "pending_review", coverUrl: "https://example.com/cover.jpg", aiAnalysis: { safe: true }, storageLinks: [{ provider: "baidu", storageAccountId: "original-account", url: "https://pan.baidu.com/s/saved", isActive: true }] } }];
  h.tx.wallpaper = { updateMany: async ({ where }: any) => { assert.deepEqual(where.id.in, ["wallpaper-1"]); publishes++; return { count: 1 }; } };
  h.tx.wallMuseCollection = { create: async ({ data }: any) => { collections++; assert.deepEqual(data.items.create, [{ wallpaperId: "wallpaper-1", sortOrder: 0 }]); h.article.collection = { id: "fixed-collection", ...data }; return h.article.collection; } };
  await h.service.sync(h.article.id, { revisionId: h.first.id });
  await h.service.sync(h.article.id, { revisionId: h.first.id });
  assert.equal(h.article.lifecycle, "synced"); assert.equal(publishes, 1); assert.equal(collections, 1);
});
test("网盘补记要求人工确认与原账号/阶段一致，记录已有分享后只继续剩余步骤", async () => {
  const h = harness();
  const job: any = { status: "failed", stage: "storage", article: { lifecycle: "pending" }, articleId: "article-1", checkpoint: { candidateId: "asset-1", version: 1, attempts: 2 } };
  const asset: any = { id: "asset-1", drives: { baidu: { accountId: "original-account", phase: "sharing", remotePath: "/original.jpg" } } };
  h.tx.wallMuseJob = { findUnique: async () => job, update: async ({ data }: any) => Object.assign(job, data) };
  h.tx.wallMuseAsset.findFirst = async () => asset;
  h.tx.wallMuseAsset.update = async ({ data }: any) => Object.assign(asset, data);
  (h.service as any).job = async () => job;
  const input = { assetId: "asset-1", provider: "baidu", accountId: "original-account", expectedPhase: "sharing", decision: "share_found", confirmed: true, url: "https://pan.baidu.com/s/saved" };
  await assert.rejects(h.service.reconcile("job-1", { ...input, confirmed: false }));
  await assert.rejects(h.service.reconcile("job-1", { ...input, accountId: "other-account" }), /账号或检查点/);
  await assert.rejects(h.service.reconcile("job-1", { ...input, url: "https://unrelated.example.com/s/file" }), /原网盘/);
  await h.service.reconcile("job-1", input);
  assert.equal(asset.drives.baidu.phase, "shared"); assert.equal(job.status, "queued");
  assert.equal(job.checkpoint.attempts, 2); assert.equal(job.checkpoint.reconciliations.length, 1);
});
