import assert from "node:assert/strict";
import { AdminService } from "../modules/admin/admin.service";

async function main() {
  let idleCalls = 0;
  let titles: Array<{ manualTitle: string | null }> = [];
  const scheduling = {
    prisma: { wallpaper: { findMany: async () => titles } },
    idleWindowDelayMs: async () => { idleCalls++; return 60000; },
  } as unknown as AdminService;
  titles = [{ manualTitle: "手动标题" }];
  assert.equal(await AdminService.prototype.uploadProcessingDelayMs.call(scheduling, ["a"]), 0);
  titles = [{ manualTitle: "标题一" }, { manualTitle: "标题二" }];
  assert.equal(await AdminService.prototype.uploadProcessingDelayMs.call(scheduling, ["a", "b"]), 0);
  assert.equal(idleCalls, 0);
  titles = [{ manualTitle: null }];
  assert.equal(await AdminService.prototype.uploadProcessingDelayMs.call(scheduling, ["a"]), 60000);
  titles = [{ manualTitle: "手动标题" }, { manualTitle: null }];
  assert.equal(await AdminService.prototype.uploadProcessingDelayMs.call(scheduling, ["a", "b"]), 60000);
  titles = [{ manualTitle: " " }];
  assert.equal(await AdminService.prototype.uploadProcessingDelayMs.call(scheduling, ["a"]), 60000);

  let captured: { skip: number; take: number; where: unknown; select: Record<string, boolean> } | undefined;
  const records = {
    prisma: { virtualPaymentOrder: {
      findMany: async (query: NonNullable<typeof captured>) => {
        captured = query;
        return [
          { outTradeNo: "one", totalFee: 123, productKey: "p", attach: JSON.stringify({ productName: "购买时名称" }) },
          { outTradeNo: "two", totalFee: 100, productKey: "p", attach: "invalid historical json" },
        ];
      },
      count: async () => 21,
    } },
    getSettings: async () => ({ virtualPaymentProducts: [{ key: "p", name: "当前名称" }] }),
  } as unknown as AdminService;
  const result = await AdminService.prototype.listPaymentOrders.call(records, { page: 2, keyword: " user ", status: "refunded" });
  assert.equal(captured?.skip, 20);
  assert.equal(captured?.take, 20);
  assert.deepEqual(captured?.where, { status: "refunded", OR: [{ outTradeNo: { contains: "user" } }, { openid: { contains: "user" } }] });
  for (const secret of ["signData", "paySig", "signature", "rawPayload"]) assert.equal(captured?.select[secret], undefined);
  assert.equal(result.list[0].productName, "购买时名称");
  assert.equal(result.list[1].productName, "当前名称");
  assert.equal("attach" in result.list[0], false);
  assert.equal(result.total, 21);
  await assert.rejects(AdminService.prototype.listPaymentOrders.call(records, { status: "pending" }));
  await assert.rejects(AdminService.prototype.listPaymentOrders.call(records, { page: -1 }));
  await AdminService.prototype.listPaymentOrders.call(records, {});
  assert.deepEqual(captured?.where, { status: { in: ["paid", "delivered", "refunded"] } });
  console.log("Upload scheduling and admin payment records smoke passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
