import test from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import { StorageProvider } from "@prisma/client";
import { AdminService } from "./admin.service";

type PrismaStub = Record<string, any>;

function makeService(prisma: PrismaStub, extra: Record<string, any> = {}) {
  return Object.assign(Object.create(AdminService.prototype), { prisma, logger: { warn: () => {}, log: () => {} } }, extra);
}

test("cleanupOriginals：只回收有活跃网盘链接的已上架原图，无链接的保留", async () => {
  const updates: any[] = [];
  const prisma: PrismaStub = {
    wallpaper: {
      findMany: async () => [
        { id: "w-netdisk", assetPath: "originals/1-a.jpg", storageLinks: [{ provider: StorageProvider.baidu }] },
        { id: "w-orphan", assetPath: "originals/2-b.jpg", storageLinks: [] },
      ],
      update: async (args: any) => { updates.push(args); },
    },
  };
  const svc = makeService(prisma);
  const result = await svc.cleanupOriginals();
  assert.deepEqual(result, { checked: 2, removed: 1 });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, "w-netdisk");
  assert.deepEqual(updates[0].data, { assetPath: null });
});

test("discardOriginalAfterBackup：无指针/有文章引用/无网盘备份都跳过，有备份才清指针", async () => {
  const updates: any[] = [];
  const basePrisma = (wallpaper: any): PrismaStub => ({
    wallpaper: {
      findUnique: async () => wallpaper,
      update: async (args: any) => { updates.push(args); },
    },
  });
  const svc = makeService(basePrisma(null));
  await (svc as any).discardOriginalAfterBackup("w1");
  assert.equal(updates.length, 0, "壁纸不存在不应写库");

  const withAssets = makeService(basePrisma({ assetPath: "originals/1-a.jpg", articleAssets: [{ id: "a1" }], storageLinks: [{ isActive: true, provider: "baidu" }] }));
  await (withAssets as any).discardOriginalAfterBackup("w1");
  assert.equal(updates.length, 0, "文章排版仍引用的原图不应删除");

  const unbacked = makeService(basePrisma({ assetPath: "originals/1-a.jpg", articleAssets: [], storageLinks: [{ isActive: false, provider: "baidu" }] }));
  await (unbacked as any).discardOriginalAfterBackup("w1");
  assert.equal(updates.length, 0, "没有活跃网盘备份的原图不应删除");

  const backed = makeService(basePrisma({ assetPath: "originals/1-a.jpg", articleAssets: [], storageLinks: [{ isActive: true, provider: "quark" }] }));
  await (backed as any).discardOriginalAfterBackup("w1");
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].data, { assetPath: null });
});

test("login：密码错误计失败并拒绝；连续 5 次后锁定；正确凭据返回 token", async () => {
  const config = { get: (key: string) => (key === "ADMIN_USERNAME" ? "admin" : key === "ADMIN_PASSWORD" ? "secret-pass" : undefined) };
  const jwt = { sign: () => "token-x" };
  const svc = makeService({}, { config, jwt });

  // login 是同步方法：直接断言同步抛出。
  assert.throws(() => svc.login("admin", "wrong", "10.0.0.1"), (error: any) => {
    assert.ok(error instanceof UnauthorizedException);
    assert.match(error.message, /账号或密码错误/);
    return true;
  });
  for (let i = 0; i < 4; i++) assert.throws(() => svc.login("admin", "wrong", "10.0.0.1"), /账号或密码错误/);
  assert.throws(() => svc.login("admin", "secret-pass", "10.0.0.1"), /登录失败次数过多/, "第 6 次即使密码正确也应被锁定");

  assert.equal((await svc.login("admin", "secret-pass", "10.0.0.2")).token, "token-x", "未触限流的其他 IP 正常登录");
});

test("login：未配置 ADMIN_PASSWORD 时拒绝默认弱密码以外的任意输入", async () => {
  const svc = makeService({}, { config: { get: () => undefined }, jwt: { sign: () => "t" } });
  assert.throws(() => svc.login("admin", "not-default", "10.0.1.1"), /账号或密码错误/);
  assert.equal((await svc.login("admin", "change-this-password", "10.0.1.2")).token, "t");
});

test("getAnalytics：趋势行按 MM-DD 归桶，搜索与发布统计走数据库聚合", async () => {
  const today = new Date();
  const label = `${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  let rawSql: any;
  const prisma: PrismaStub = {
    $queryRaw: async (sql: any) => { rawSql = sql; return [
      { label, kind: "views", total: 12n },
      { label: "01-01", kind: "views", total: 99n },
      { label, kind: "downloads", total: 3n },
    ]; },
    wallpaperClick: { groupBy: async () => [] },
    aiAnalysis: { groupBy: async () => [{ safe: true, _count: { _all: 8 } }, { safe: false, _count: { _all: 2 } }] },
    searchLog: {
      groupBy: async (args: any) => {
        if (args.by.includes("hasResult")) return [{ hasResult: true, _count: { _all: 7 } }, { hasResult: false, _count: { _all: 3 } }];
        if (args.where?.hasResult === false) return [{ keyword: "无结果词", _count: { _all: 3 } }];
        return [{ keyword: "热词", _count: { _all: 6 } }];
      },
    },
    task: {
      groupBy: async (args: any) => {
        if (args.by.includes("type")) return [{ type: "upload_asset", _count: { _all: 2 } }];
        return [{ status: "success", _count: { _all: 8 } }, { status: "failed", _count: { _all: 2 } }];
      },
    },
    autoPublishBoard: { findMany: async () => [] },
  };
  const svc = makeService(prisma);
  const result = await svc.getAnalytics({ days: 7 });
  assert.ok(rawSql, "趋势应通过聚合 SQL 查询");
  assert.equal(result.range.days, 7);
  const lastIndex = result.trends.labels.length - 1;
  assert.equal(result.trends.views[lastIndex], 12, "当天点击量落到最后一个桶");
  assert.equal(result.trends.views.reduce((a: number, b: number) => a + b, 0), 12, "范围外的日期不归入任何桶");
  assert.equal(result.trends.downloads[lastIndex], 3);
  assert.equal(result.search.total, 10);
  assert.equal(result.search.hitRate, 70.0);
  assert.deepEqual(result.search.topTerms, [{ keyword: "热词", count: 6 }]);
  assert.deepEqual(result.search.gaps, [{ keyword: "无结果词", count: 3 }]);
  assert.equal(result.publish.ai.blockRate, 20.0);
  assert.equal(result.publish.publishSuccessRate, 80.0);
  assert.deepEqual(result.publish.taskFailures, [{ type: "upload_asset", count: 2 }]);
});
