import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { DelayedError, Job, Queue } from "bullmq";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { QueueRecoveryService } from "./queue-recovery.service";
import { recoverUploadPayload, recoveryResourceError } from "./queue-recovery";
import { WallpaperProcessor } from "./wallpaper.processor";
import { AdminService } from "./admin.service";
import { PrismaService } from "../prisma/prisma.service";

test("recover single tasks and complete batch payloads without losing selected accounts", () => {
  assert.equal(recoverUploadPayload("task", { wallpaperId: "image" })?.wallpaperId, "image");
  const result = recoverUploadPayload("task", { batch: true, queuePayloadVersion: 1, wallpaperIds: ["a", "b"], storageSelection: { quarkAccountId: "q" }, channelAccountId: "c" });
  assert.deepEqual(result?.wallpaperIds, ["a", "b"]);
  assert.equal(result?.storageSelection?.quarkAccountId, "q");
  assert.equal(result?.channelAccountId, "c");
});

test("never guess missing legacy batch parameters or accept malformed payloads", () => {
  for (const payload of [null, {}, [], { wallpaperId: "" }, { batch: true, wallpaperIds: ["a"] }, { batch: true, queuePayloadVersion: 1, wallpaperIds: ["a", "a"] }, { wallpaperId: "a", storageSelection: "wrong" }]) {
    assert.equal(recoverUploadPayload("task", payload), null);
  }
});

test("only untouched resources are eligible for recovery", () => {
  const item = { id: "a", status: "draft", assetPath: "a.jpg", hasStorage: false, hasAnalysis: false };
  assert.equal(recoveryResourceError(["a"], [item]), null);
  // Upload assigns processing before the task has run; this alone is not a side effect.
  assert.equal(recoveryResourceError(["a"], [{ ...item, status: "processing" }]), null);
  assert.ok(recoveryResourceError(["a"], []));
  for (const patch of [{ status: "published" }, { status: "archived" }, { status: "rejected" }, { hasStorage: true }, { hasAnalysis: true }, { assetPath: null }]) {
    assert.ok(recoveryResourceError(["a"], [{ ...item, ...patch }]));
  }
});

function workerHarness(delay: number, claimCount = 1, status = "queued") {
  const calls: string[] = [];
  const admin = { uploadProcessingDelayMs: async () => delay, runProcessWallpaper: async () => { calls.push("execute"); } };
  const prisma = { task: {
    findUnique: async () => ({ status, progress: status === "queued" ? 0 : 1 }),
    updateMany: async ({ data }: { data: { status?: string } }) => { calls.push(data.status === "running" ? "claim" : "message"); return { count: claimCount }; },
  } };
  const worker = new WallpaperProcessor(admin as unknown as AdminService, prisma as unknown as PrismaService);
  const job = { name: "process-wallpaper", data: { taskId: "task", wallpaperId: "a" }, moveToDelayed: async (_time: number, token?: string) => { assert.equal(token, "lock"); calls.push("delay"); } } as unknown as Job;
  return { worker, job, calls };
}

test("execution outside idle window is postponed before claiming", async () => {
  const { worker, job, calls } = workerHarness(60_000);
  await assert.rejects(worker.process(job, "lock"), DelayedError);
  assert.deepEqual(calls, ["message", "delay"]);
});

test("manual title / allowed window executes only after successful claim", async () => {
  const { worker, job, calls } = workerHarness(0);
  await worker.process(job, "lock");
  assert.deepEqual(calls, ["claim", "execute"]);
});

test("duplicate delivery and losing a concurrent claim never execute", async () => {
  for (const args of [[0, 0, "queued"], [0, 1, "running"], [0, 1, "success"]] as const) {
    const { worker, job, calls } = workerHarness(args[0], args[1], args[2]);
    await worker.process(job, "lock");
    assert.ok(!calls.includes("execute"));
  }
});

function recoveryHarness(options: { live?: boolean; unavailable?: boolean; status?: string; current?: boolean; payload?: unknown; assetPath?: string; published?: boolean } = {}) {
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const added: Array<{ name: string; data: unknown; options: Record<string, unknown> }> = [];
  const task = { id: "task", type: "upload_asset", status: options.status || "queued", progress: 0,
    createdAt: new Date(options.current ? Date.now() + 60_000 : 0), updatedAt: new Date(0),
    payload: options.payload || { wallpaperId: "a" } };
  const prisma = {
    task: { findMany: async () => [task], updateMany: async (update: typeof updates[number]) => { updates.push(update); return { count: 1 }; } },
    wallpaper: { findMany: async () => [{ id: "a", status: options.published ? "published" : "draft", assetPath: options.assetPath || "missing.jpg", aiAnalysis: null, _count: { storageLinks: 0 } }] },
  };
  const queue = {
    getJobs: async () => { if (options.unavailable) throw new Error("redis offline"); return options.live ? [{ id: "legacy-numeric-id", data: { taskId: "task" } }] : []; },
    getJob: async () => null,
    add: async (name: string, data: unknown, jobOptions: Record<string, unknown>) => { added.push({ name, data, options: jobOptions }); },
  };
  const admin = { uploadProcessingDelayMs: async () => 12345 };
  return { service: new QueueRecoveryService(prisma as unknown as PrismaService, admin as unknown as AdminService, queue as unknown as Queue), updates, added };
}

test("legacy live jobs and Redis outages never trigger recovery or status changes", async () => {
  const live = recoveryHarness({ live: true });
  await live.service.reconcile();
  assert.deepEqual(live.updates, []);
  assert.deepEqual(live.added, []);
  const offline = recoveryHarness({ unavailable: true });
  await assert.rejects(offline.service.reconcile(), /offline/);
  assert.deepEqual(offline.updates, []);
});

test("interrupted work is marked for review, but current long-running work is untouched", async () => {
  const old = recoveryHarness({ status: "running" });
  await old.service.reconcile();
  assert.equal(old.updates[0].data.status, "failed");
  assert.deepEqual(old.added, []);
  const current = recoveryHarness({ status: "running", current: true });
  await current.service.reconcile();
  assert.deepEqual(current.updates, []);
});

test("unsafe resources and legacy batch parameters are never automatically replayed", async () => {
  for (const options of [{ published: true }, {}, { payload: { batch: true, wallpaperIds: ["a"] } }]) {
    const h = recoveryHarness(options);
    await h.service.reconcile();
    assert.equal(h.updates[0].data.status, "failed");
    assert.deepEqual(h.added, []);
  }
});

test("lost untouched upload is requeued with same task id and idle delay", async () => {
  const root = resolve(process.cwd(), "storage", "public");
  await mkdir(root, { recursive: true });
  const temp = await mkdtemp(join(root, ".queue-recovery-test-"));
  try {
    const file = join(temp, "test.jpg");
    await writeFile(file, "test fixture - never uploaded");
    const h = recoveryHarness({ assetPath: relative(root, file) });
    await h.service.reconcile();
    assert.equal(h.added.length, 1);
    assert.equal(h.added[0].options.jobId, "task");
    assert.equal(h.added[0].options.delay, 12345);
    assert.equal(h.added[0].name, "process-wallpaper");
  } finally {
    assert.ok(resolve(temp).startsWith(root + sep));
    await rm(temp, { recursive: true });
  }
});
