import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskRetentionService } from "./task-retention.service";

const DAY = 86_400_000;

function harness(retention?: string) {
  let captured: { where: { createdAt: { lt: Date }; status: { notIn: string[] } } } | undefined;
  const service = new TaskRetentionService(
    { task: { deleteMany: async (args: never) => { captured = args; return { count: 4 }; } } } as never,
    { get: (key: string) => (key === "TASK_RETENTION_DAYS" ? retention : undefined) } as never,
  );
  return { service, captured: () => captured };
}

test("默认保留最近 7 天，且排队中/执行中的任务永不清理", async () => {
  const h = harness();
  const result = await h.service.prune();
  assert.equal(result.days, 7);
  assert.equal(result.removed, 4);
  const where = h.captured()!.where;
  assert.deepEqual(where.status.notIn, ["queued", "running"]);
  const age = Date.now() - where.createdAt.lt.getTime();
  assert.ok(Math.abs(age - 7 * DAY) < 60_000, `cutoff 应约为 7 天前，实际 ${Math.round(age / DAY)} 天`);
});

test("TASK_RETENTION_DAYS 可覆盖保留期", async () => {
  const h = harness("3");
  const result = await h.service.prune();
  assert.equal(result.days, 3);
  const age = Date.now() - h.captured()!.where.createdAt.lt.getTime();
  assert.ok(Math.abs(age - 3 * DAY) < 60_000);
});

test("非法保留天数回落到 7 天，过大的值封顶 90 天", async () => {
  assert.equal(harness("0").service.retentionDays(), 7);
  assert.equal(harness("-5").service.retentionDays(), 7);
  assert.equal(harness("abc").service.retentionDays(), 7);
  assert.equal(harness("365").service.retentionDays(), 90);
  assert.equal(harness("2.7").service.retentionDays(), 2);
});
