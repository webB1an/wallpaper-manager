import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { VirtualPaymentOrderStatus } from "@prisma/client";
import { PaymentService } from "./payment.service";

type PrismaStub = Record<string, any>;

function makeService(prisma: PrismaStub) {
  return new PaymentService(prisma as any, { get: () => undefined } as any);
}

test("downloadAccess 权益优先级：永久 > 限时无限 > 剩余单次 > 无权益", async () => {
  const svc = makeService({});
  const cases: Array<{ status: any; expected: any; unlimited?: boolean }> = [
    { status: { permanent: true, unlimitedUntil: null, singleRemaining: 3 }, expected: { allowed: true, type: "paid_permanent" } },
    { status: { permanent: false, unlimitedUntil: new Date(Date.now() + 60_000).toISOString(), singleRemaining: 3 }, expected: { allowed: true, type: "paid_unlimited" }, unlimited: true },
    { status: { permanent: false, unlimitedUntil: null, singleRemaining: 2 }, expected: { allowed: true, type: "paid_single", remaining: 2 } },
    { status: { permanent: false, unlimitedUntil: null, singleRemaining: 0 }, expected: { allowed: false, type: null } },
  ];
  for (const item of cases) {
    const scoped = Object.assign(svc, { entitlementStatus: async () => item.status });
    const access = await scoped.downloadAccess("openid-a");
    assert.equal(access.allowed, item.expected.allowed);
    assert.equal(access.type, item.expected.type);
    if (item.unlimited) assert.equal((access as any).expiresAt, item.status.unlimitedUntil);
    else assert.equal((access as any).expiresAt, undefined);
    if (item.expected.remaining !== undefined) assert.equal((access as any).remaining, item.expected.remaining);
  }
});

test("downloadAccess 限时无限权益过期后按无权益处理", async () => {
  const svc = makeService({});
  const scoped = Object.assign(svc, { entitlementStatus: async () => ({ permanent: false, unlimitedUntil: new Date(Date.now() - 60_000).toISOString(), singleRemaining: 0 }) });
  assert.equal((await scoped.downloadAccess("openid-a")).allowed, false);
});

test("consumeDownloadAccess：无限/永久权益直接放行，不触碰数据库", async () => {
  let txCalled = 0;
  const prisma: PrismaStub = { $transaction: async () => { txCalled++; } };
  const svc = makeService(prisma);
  await svc.consumeDownloadAccess("openid-a", { type: "paid_unlimited" });
  await svc.consumeDownloadAccess("openid-a", { type: "paid_permanent" });
  assert.equal(txCalled, 0);
});

test("consumeDownloadAccess：单次权益按最早创建的可用记录扣减", async () => {
  const updates: any[] = [];
  const rows = [{ id: "ent-1", remaining: 2 }, { id: "ent-2", remaining: 1 }];
  const prisma: PrismaStub = {
    $transaction: async (fn: (tx: any) => Promise<void>) => fn({
      virtualPaymentEntitlement: {
        findFirst: async () => rows[0],
        update: async (args: any) => { updates.push(args); },
      },
    }),
  };
  const svc = makeService(prisma);
  await svc.consumeDownloadAccess("openid-a", { type: "paid_single" });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, "ent-1");
  assert.deepEqual(updates[0].data, { remaining: { decrement: 1 } });
});

test("consumeDownloadAccess：没有可用单次权益时报错且不扣减", async () => {
  const prisma: PrismaStub = {
    $transaction: async (fn: (tx: any) => Promise<void>) => fn({
      virtualPaymentEntitlement: { findFirst: async () => null, update: async () => assert.fail("不应扣减") },
    }),
  };
  const svc = makeService(prisma);
  await assert.rejects(svc.consumeDownloadAccess("openid-a", { type: "paid_single" }), /次数已用完/);
});

test("orderStatus：订单不存在报 404，他人订单拒绝查询", async () => {
  let findUniqueCalls = 0;
  const prisma: PrismaStub = {
    virtualPaymentOrder: {
      findUnique: async () => { findUniqueCalls++; return null; },
    },
  };
  const svc = makeService(prisma);
  await assert.rejects(svc.orderStatus("openid-a", "nope"), (error: any) => {
    assert.ok(error instanceof NotFoundException);
    return true;
  });
  assert.equal(findUniqueCalls, 1);

  const scoped = Object.assign(makeService({
    virtualPaymentOrder: { findUnique: async () => ({ outTradeNo: "t1", openid: "openid-b", status: VirtualPaymentOrderStatus.pending }) },
  }), { syncOrder: async () => assert.fail("不匹配的订单不应触发微信侧同步") } as any) as PaymentService;
  await assert.rejects(scoped.orderStatus("openid-a", "t1"), (error: any) => {
    assert.ok(error instanceof BadRequestException);
    assert.match(error.message, /不匹配/);
    return true;
  });
});

test("orderStatus：已发货订单直接返回，不再查询微信侧", async () => {
  const scoped = Object.assign(makeService({
    virtualPaymentOrder: {
      findUnique: async () => ({ outTradeNo: "t1", openid: "openid-a", status: VirtualPaymentOrderStatus.delivered }),
      findUniqueOrThrow: async () => assert.fail("已发货不应二次查询"),
    },
  }), { syncOrder: async () => assert.fail("已发货不应同步") } as any) as PaymentService;
  const result = await scoped.orderStatus("openid-a", "t1");
  assert.equal(result.delivered, true);
  assert.equal(result.status, VirtualPaymentOrderStatus.delivered);
});
