import test from "node:test";
import assert from "node:assert/strict";
import { SourceIntakeService, SourceFetchError } from "../sources/source-intake.service";
import { WallMuseWorker } from "./wallmuse.worker";


function setup(error: Error, overrides: any = {}) {
  const job: any = { id: "job", articleId: "article", stage: "collect", checkpoint: { version: 1, attempts: 0 }, input: { sources: ["openverse", "nekos_best"], candidateBudget: 6, targetCount: 3 }, ...overrides };
  const sources: string[] = [];
  const worker: any = Object.assign(Object.create(WallMuseWorker.prototype), {
    prisma: { wallMuseJob: { update: async ({ data }: any) => Object.assign(job, data) } },
    policy: { assertIdle: async () => {} },
    service: { capabilities: async () => ({ sources: job.input.sources.map((id: string) => ({ id, enabled: true })) }) },
    candidates: async () => [],
    intake: { obtain: async (source: string) => { sources.push(source); throw error; } },
    logger: { warn: () => {} },
  });
  return { job, worker, sources, step: () => worker.step(job, { assert: async () => {} }) };
}

test("403 switches source on the next step and stops when all selected sources fail", async () => {
  const ctx = setup(new SourceFetchError("Openverse 访问失败（403）"));
  await ctx.step();
  assert.equal(ctx.job.status, "queued");
  assert.equal(ctx.job.error, null);
  assert.match(ctx.job.message, /切换/);
  assert.deepEqual(ctx.job.checkpoint.unavailableSources, ["openverse"]);
  await ctx.step();
  assert.deepEqual(ctx.sources, ["openverse", "nekos_best"]);
  assert.equal(ctx.job.status, "failed");
  assert.equal(ctx.job.checkpoint.attempts, 2);
  assert.equal(ctx.job.checkpoint.failures.length, 2);
});

test("budget exhaustion and single-source failures stop without looping", async () => {
  for (const input of [{ sources: ["openverse"], candidateBudget: 6, targetCount: 3 }, { sources: ["openverse", "nekos_best"], candidateBudget: 1, targetCount: 1 }]) {
    const ctx = setup(new SourceFetchError("403"), { input });
    await ctx.step(); assert.equal(ctx.job.status, "failed");
  }
});

test("resume of an old failed source clears stale transfer state and retains completed progress", async () => {
  const ctx = setup(new SourceFetchError("403"), { checkpoint: { version: 1, attempts: 2, activeSource: "openverse", bridge: { token: "old" }, transferKey: "old", candidateId: "saved-image" } });
  await ctx.step();
  assert.equal(ctx.job.status, "queued");
  assert.equal(ctx.job.checkpoint.bridge, undefined);
  assert.equal(ctx.job.checkpoint.transferKey, undefined);
  assert.equal(ctx.job.checkpoint.candidateId, "saved-image");
  await ctx.step();
  assert.deepEqual(ctx.sources, ["openverse", "nekos_best"]);
});

test("database errors and storage errors do not switch sources", async () => {
  const db = setup(new Error("database unavailable"));
  await db.step();
  assert.equal(db.job.status, "failed");
  assert.equal(db.job.checkpoint.activeSource, "openverse");
  assert.equal(db.job.checkpoint.unavailableSources, undefined);
  const storage = setup(new SourceFetchError("ambiguous upload"), { stage: "storage" });
  storage.worker.syncStorage = async () => { throw new SourceFetchError("ambiguous upload"); };
  await storage.step();
  assert.equal(storage.job.status, "failed");
  assert.equal(storage.job.checkpoint.unavailableSources, undefined);
});

test("intake classifies upstream failures but preserves checkpoint callback errors", async () => {
  const intake: any = new SourceIntakeService({ wallpaperSource: { findMany: async () => [] } } as any, { run: async (_: string, action: any) => action({ assert: async () => {} }) } as any);
  intake.fetchSource = async () => { throw new Error("403"); };
  await assert.rejects(intake.obtain("openverse", { classifySourceFailures: true }, () => {}, () => {}), SourceFetchError);
  const failure = new Error("checkpoint write failed");
  intake.fetchSource = async (_: string, context: any) => { await context.onBridgeReady({}); };
  await assert.rejects(intake.obtain("openverse", { classifySourceFailures: true, onBridgeReady: async () => { throw failure; } }, () => {}, () => {}), (error) => error === failure);
});
