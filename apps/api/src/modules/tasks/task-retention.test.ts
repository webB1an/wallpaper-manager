import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskRetentionService } from "./task-retention.service";

const DAY = 86_400_000;
const HOUR = 3_600_000;

type DeleteArgs = { where: { createdAt: { lt: Date }; status: { notIn: string[] } } };
type UpdateArgs = { where: { status: { in: string[] }; updatedAt: { lt: Date } }; data: { status: string; error?: string } };

function harness(retention?: string, counts = { released: 2, removed: 4 }) {
  const calls: string[] = [];
  let deleted: DeleteArgs | undefined;
  let released: UpdateArgs | undefined;
  const service = new TaskRetentionService(
    {
      task: {
        updateMany: async (args: UpdateArgs) => {
          calls.push("updateMany");
          released = args;
          return { count: counts.released };
        },
        deleteMany: async (args: DeleteArgs) => {
          calls.push("deleteMany");
          deleted = args;
          return { count: counts.removed };
        },
      },
    } as never,
    { get: (key: string) => (key === "TASK_RETENTION_DAYS" ? retention : undefined) } as never,
  );
  return { service, calls, deleted: () => deleted, released: () => released };
}

test("默认保留最近 7 天，且排队中/执行中的任务永不清理", async () => {
  const h = harness();
  const result = await h.service.prune();
  assert.equal(result.days, 7);
  assert.equal(result.removed, 4);
  const where = h.deleted()!.where;
  assert.deepEqual(where.status.notIn, ["queued", "running"]);
  const age = Date.now() - where.createdAt.lt.getTime();
  assert.ok(Math.abs(age - 7 * DAY) < 60_000, `cutoff 应约为 7 天前，实际 ${Math.round(age / DAY)} 天`);
});

test("清理前先把超过 24 小时无进展的活跃任务标记为失败，避免其永久无法清理", async () => {
  const h = harness();
  const result = await h.service.prune();
  assert.equal(result.released, 2);
  // 先释放、后删除，否则老任务会一直被 queued/running 挡住。
  assert.deepEqual(h.calls, ["updateMany", "deleteMany"]);
  const update = h.released()!;
  assert.deepEqual(update.where.status.in, ["queued", "running"]);
  assert.equal(update.data.status, "failed");
  assert.match(update.data.error || "", /24 小时/);
  const staleAge = Date.now() - update.where.updatedAt.lt.getTime();
  assert.ok(Math.abs(staleAge - DAY) < 60_000, `失效阈值应约为 24 小时，实际 ${Math.round(staleAge / HOUR)} 小时`);
});

test("返回的 cutoff 精确等于保留期起点，可用于向运维解释边界", async () => {
  const h = harness();
  const result = await h.service.prune();
  assert.ok(Math.abs(result.cutoff.getTime() - h.deleted()!.where.createdAt.lt.getTime()) < 1_000);
  assert.ok(Math.abs(result.cutoff.getTime() - (Date.now() - 7 * DAY)) < 60_000);
});

test("TASK_RETENTION_DAYS 可覆盖保留期", async () => {
  const h = harness("3");
  const result = await h.service.prune();
  assert.equal(result.days, 3);
  const age = Date.now() - h.deleted()!.where.createdAt.lt.getTime();
  assert.ok(Math.abs(age - 3 * DAY) < 60_000);
});

test("非法保留天数回落到 7 天，过大的值封顶 90 天", async () => {
  assert.equal(harness("0").service.retentionDays(), 7);
  assert.equal(harness("-5").service.retentionDays(), 7);
  assert.equal(harness("abc").service.retentionDays(), 7);
  assert.equal(harness("365").service.retentionDays(), 90);
  assert.equal(harness("2.7").service.retentionDays(), 2);
});
