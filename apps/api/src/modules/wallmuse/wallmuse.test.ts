import test from "node:test";
import assert from "node:assert/strict";
import { idleDecision, WaitForIdleError } from "./idle-policy";
import { createInputSchema, digest, assertSelection, perceptualDistance } from "./wallmuse.schemas";
import { privateAssetPath } from "./article-files";
import { WallMuseAiService } from "./wallmuse-ai.service";
import { WallMuseService } from "./wallmuse.service";
import { AdminService } from "../admin/admin.service";
import { CollectionsController } from "./collections.controller";
import { WallMuseWorker } from "./wallmuse.worker";

test("系统设置持久化开关，默认关闭，保存后服务与公开接口立即采用新值", async () => {
  let value: any;
  const admin = Object.assign(Object.create(AdminService.prototype), { prisma: { setting: {
    findUnique: async () => value ? { value } : null,
    upsert: async (args: any) => { value = args.update.value; },
  } } });
  const service = new WallMuseService({} as any, { get: () => "true" } as any, admin, {} as any, {} as any, {} as any);
  assert.equal(await service.enabled(), false, "环境变量不再决定开关");
  await assert.rejects(service.create({}, "test-key"), /尚未启用/);
  const controller = new CollectionsController({ wallMuseCollection: {
    findMany: async () => [], count: async () => 2,
  } } as any, service);
  assert.equal((await controller.list()).data.total, 0);
  await assert.rejects(controller.detail("existing"), /暂不可用/);
  await admin.updateSettings({ wallMuseEnabled: true });
  assert.equal(await service.enabled(), true);
  assert.equal((await controller.list()).data.total, 2);
  await admin.updateSettings({ processIdleEnabled: false });
  assert.equal(await service.enabled(), true, "保存其他设置不应重置开关");
  await admin.updateSettings({ wallMuseEnabled: false });
  assert.equal(await service.enabled(), false);
});

test("调度等待异步开关，关闭不领取任务，重新开启继续调度", async () => {
  let enabled = false;
  let calls = 0;
  const worker = Object.assign(Object.create(WallMuseWorker.prototype), {
    service: { enabled: async () => enabled },
    leases: { run: async () => { calls++; } },
    logger: { error: (message: string) => assert.fail(message) },
  });
  await worker.tick();
  assert.equal(calls, 0);
  enabled = true;
  await worker.tick();
  assert.equal(calls, 1);
  enabled = false;
  await worker.tick();
  assert.equal(calls, 1);
  assert.equal(worker.busy, false);
});

test("空闲判断固定上海时区，跨午夜窗口开始包含、结束不包含", () => {
  const windows = [{ start: "18:00", end: "09:00" }];
  assert.equal(idleDecision(windows, new Date("2026-09-12T10:00:00Z")).allowed, true);
  assert.equal(idleDecision(windows, new Date("2026-09-12T00:59:59Z")).allowed, true);
  const result = idleDecision(windows, new Date("2026-09-12T01:00:00Z"));
  assert.equal(result.allowed, false);
  assert.equal(result.nextEligibleAt, "2026-09-12T10:00:00.000Z");
});
test("没有有效空闲时段时阻止AI，不退化成全天可用", () => {
  for (const windows of [[], [{ start: "00:00", end: "00:00" }], [{ start: "29:99", end: "10:00" }]]) {
    const result = idleDecision(windows); assert.equal(result.allowed, false); assert.equal(result.nextEligibleAt, null);
  }
});
test("多窗口选择最近开始时刻，移除当前秒数", () => {
  const result = idleDecision([{ start: "12:00", end: "14:00" }, { start: "18:00", end: "00:00" }], new Date("2026-09-12T02:30:59.500Z"));
  assert.equal(result.nextEligibleAt, "2026-09-12T04:00:00.000Z");
});
test("新建请求不能绕过空闲限制，也不能隐含小程序自动同步", () => {
  assert.ok(createInputSchema.safeParse({ targetCount: 18 }).success);
  for (const input of [{ targetCount: 19 }, { targetCount: 0 }, { targetCount: 18, scheduleMode: "immediate" }, { targetCount: 18, syncMiniProgram: true }]) assert.equal(createInputSchema.safeParse(input).success, false);
});
test("AI策划严格引用真实图片且满足数量，不能重复凑数", () => {
  assert.doesNotThrow(() => assertSelection(["b", "a"], ["a", "b", "c"], 2));
  for (const ids of [["a", "a"], ["a", "invented"], ["a"]]) assert.throws(() => assertSelection(ids, ["a", "b"], 2));
});
test("语义哈希不受对象字段顺序影响", () => {
  assert.equal(digest({ a: 1, b: { y: 2, x: 1 } }), digest({ b: { x: 1, y: 2 }, a: 1 }));
  assert.notEqual(digest({ assets: ["a", "b"] }), digest({ assets: ["b", "a"] }));
});
test("感知去重只用于选图，距离计算不把非法值当成相同图", () => {
  assert.equal(perceptualDistance("0000000000000000", "0000000000000003"), 2);
  assert.equal(perceptualDistance("0000000000000000", "ffffffffffffffff"), 64);
  assert.equal(perceptualDistance("invalid", "invalid"), 64);
});
test("私有文章图片不能读取其他目录", () => {
  assert.ok(privateAssetPath("article-images/1234-abcd.jpg").includes("article-images"));
  for (const path of ["../secrets", "article-images/../../secret.jpg", "originals/a.jpg", "C:/secret.jpg"]) assert.throws(() => privateAssetPath(path));
});
test("识图、策划与文案每一次都在调用供应商前检查空闲时段", async () => {
  let calls = 0;
  const ai = new WallMuseAiService({ isConfigured: () => true, analyzeImage: async () => { calls++; }, generateJson: async () => { calls++; } } as any,
    { assertIdle: async () => { throw new WaitForIdleError(idleDecision([])); } } as any);
  await assert.rejects(ai.analyze("local.jpg", "test"), WaitForIdleError);
  await assert.rejects(ai.plan([], 1, ""), WaitForIdleError);
  await assert.rejects(ai.copy({ subject: "测试", selectedIds: ["a"], templateId: "editorial-journal" }, [], "medium", false), WaitForIdleError);
  await assert.rejects(ai.titles({ subject: "测试", selectedIds: ["a"], templateId: "editorial-journal" }, []), WaitForIdleError);
  assert.equal(calls, 0);
});
test("同步已有合集返回同一个结果，不再改动壁纸，不接受换版本", async () => {
  const collection = { id: "c1", revisionId: "r1", wallpaperIds: ["w1"] };
  const tx = { wallMuseArticle: { findUnique: async () => ({ id: "a1", lifecycle: "synced", collection }) } };
  const service = new WallMuseService({ $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx) } as any,
    { get: () => "true" } as any, { getSettings: async () => ({ wallMuseEnabled: true }) } as any, {} as any, {} as any, {} as any);
  assert.deepEqual(await service.sync("a1", { revisionId: "r1" }), { status: "synced", collectionId: "c1", wallpaperIds: ["w1"] });
  await assert.rejects(service.sync("a1", { revisionId: "r2" }), /固定合集/);
});
test("未复制文章不能同步小程序", async () => {
  const tx = { wallMuseArticle: { findUnique: async () => ({ id: "a1", lifecycle: "pending", collection: null, copiedRevisionId: null }) } };
  const service = new WallMuseService({ $transaction: async (fn: (client: unknown) => Promise<unknown>) => fn(tx) } as any,
    { get: () => "true" } as any, { getSettings: async () => ({ wallMuseEnabled: true }) } as any, {} as any, {} as any, {} as any);
  await assert.rejects(service.sync("a1", { revisionId: "r1" }), /成功复制/);
});
