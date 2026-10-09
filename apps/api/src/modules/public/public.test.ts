import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PublicService } from "./public.service";

type PrismaStub = Record<string, any>;

function makeService(prisma: PrismaStub, extra: Record<string, any> = {}) {
  return Object.assign(new PublicService(prisma as any, { get: () => undefined } as any, {} as any, {} as any), extra);
}

test("favoriteIds：空 openid 直接返回空数组，正常时返回壁纸 ID 列表", async () => {
  let queried = false;
  const svc = makeService({ userFavorite: { findMany: async () => { queried = true; return [{ wallpaperId: "w1" }, { wallpaperId: "w2" }]; } } });
  assert.deepEqual(await svc.favoriteIds(""), []);
  assert.equal(queried, false, "空 openid 不应触发数据库查询");
  assert.deepEqual(await svc.favoriteIds("openid-a"), ["w1", "w2"]);
});

test("setFavorite：未登录拒绝，壁纸不存在报 404，收藏与取消走正确写入", async () => {
  const calls: string[] = [];
  const prisma: PrismaStub = {
    wallpaper: { findUnique: async ({ where }: any) => (where.id === "w1" ? { id: "w1" } : null) },
    userFavorite: {
      upsert: async (args: any) => { calls.push(`upsert:${args.where.userId_wallpaperId.wallpaperId}`); },
      deleteMany: async (args: any) => { calls.push(`delete:${args.where.wallpaperId}`); },
    },
  };
  const svc = makeService(prisma);
  await assert.rejects(svc.setFavorite("", "w1", "add"), (error: any) => {
    assert.ok(error instanceof BadRequestException);
    return true;
  });
  await assert.rejects(svc.setFavorite("openid-a", "missing", "add"), (error: any) => {
    assert.ok(error instanceof NotFoundException);
    return true;
  });
  await svc.setFavorite("openid-a", "w1", "add");
  await svc.setFavorite("openid-a", "w1", "remove");
  assert.deepEqual(calls, ["upsert:w1", "delete:w1"]);
});

test("rewardStatus：未解锁为 0 次，无限类型返回 -1，daily10 按已用次数递减", async () => {
  let reward: any = null;
  const svc = makeService({
    wallpaperReward: { findUnique: async () => reward },
    setting: { findUnique: async () => null },
  });
  assert.deepEqual(await svc.rewardStatus("openid-a"), { rewarded: false, remaining: 0, type: "none", rewardType: "daily10" });
  reward = { type: "unlimited", usedCount: 4 };
  assert.deepEqual(await svc.rewardStatus("openid-a"), { rewarded: true, remaining: -1, type: "unlimited", rewardType: "daily10" });
  reward = { type: "daily10", usedCount: 3 };
  const daily = await svc.rewardStatus("openid-a");
  assert.equal(daily.remaining, 7);
});

test("recordDownload：空 openid 或壁纸缺失时静默跳过，正常时 upsert 下载记录", async () => {
  const upserts: any[] = [];
  const prisma: PrismaStub = {
    wallpaper: { findUnique: async ({ where }: any) => (where.id === "w1" ? { id: "w1" } : null) },
    userDownload: { upsert: async (args: any) => { upserts.push(args.where.userId_wallpaperId); } },
  };
  const svc = makeService(prisma);
  assert.deepEqual(await svc.recordDownload("", "w1"), { ok: true });
  assert.deepEqual(await svc.recordDownload("openid-a", "missing"), { ok: true });
  assert.equal(upserts.length, 0);
  await svc.recordDownload("openid-a", "w1");
  assert.deepEqual(upserts, [{ userId: "openid-a", wallpaperId: "w1" }]);
});

test("resolveDownloadToken：令牌缺失或过期都报 404，不泄漏文件路径", async () => {
  const svc = makeService({ downloadToken: { findUnique: async () => null } });
  await assert.rejects(svc.resolveDownloadToken("nope"), (error: any) => {
    assert.ok(error instanceof NotFoundException);
    return true;
  });
  const expired = Object.assign(makeService({
    downloadToken: { findUnique: async () => ({ token: "t", expiresAt: new Date(Date.now() - 1000), filePath: "x", wallpaperId: "w" }) },
    wallpaper: { findUnique: async () => assert.fail("过期令牌不应继续查壁纸") },
  }));
  await assert.rejects(expired.resolveDownloadToken("t"), /已失效/);
});

test("memberRequestStatus：月度上限取配置（0-100 封顶），默认 3 次，剩余次数正确", async () => {
  const svcFor = (limit: unknown, used: number) => makeService({
    setting: { findUnique: async () => ({ value: limit === undefined ? {} : { memberRequestMonthlyLimit: limit } }) },
    wallpaperRequest: {
      count: async () => used,
      findFirst: async () => null,
    },
  }, { payment: { entitlementStatus: async () => ({ permanent: false }) } });
  assert.equal((await (svcFor(undefined, 1) as any).memberRequestStatus("openid-a")).monthlyLimit, 3);
  assert.equal((await (svcFor(0, 0) as any).memberRequestStatus("openid-a")).monthlyLimit, 0);
  assert.equal((await (svcFor(500, 4) as any).memberRequestStatus("openid-a")).monthlyLimit, 100);
  const status = await (svcFor(5, 4) as any).memberRequestStatus("openid-a") as { monthlyLimit: number; remaining: number; hasActive: boolean };
  assert.equal(status.monthlyLimit, 5);
  assert.equal(status.remaining, 1);
  assert.equal(status.hasActive, false);
});
