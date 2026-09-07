import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { AdminService } from "./admin.service";
import { AutoPublishCheckpoint, AutoPublishStage, canResumeAutoPublish } from "./auto-publish-checkpoint";
import { ChannelPermissionDeniedError } from "../channel/channel.service";

const analysis = { title: "fixture", safe: true, sensitiveFlags: [], tags: ["fixture"] };
const board = { id: "board", source: "wallpost", sourceConfig: {}, guildId: "guild", channelId: "channel" };

test("checkpoint policy never replays ambiguous external effects or legacy/expired tasks", () => {
  for (const stage of ["download", "asset", "analyze", "storage", "publish", "published"] as AutoPublishStage[]) {
    assert.equal(canResumeAutoPublish({ version: 1, stage, source: "wallpost", wallpaperId: "w", analysis, publication: { accountId: "a" } }), true);
  }
  for (const stage of ["storage_inflight", "publish_inflight", "unknown"]) {
    assert.equal(canResumeAutoPublish({ version: 1, stage, source: "wallpost", wallpaperId: "w", analysis }), false);
  }
  assert.equal(canResumeAutoPublish({ version: 1, stage: "publish", source: "wallpost", wallpaperId: "w", analysis, expired: true }), false);
  assert.equal(canResumeAutoPublish({ version: 1, stage: "published", source: "wallpost", wallpaperId: "w" }), false);
  assert.equal(canResumeAutoPublish({ boardId: "legacy" }), false);
});

async function runFixture(stage: AutoPublishStage, publishError?: Error) {
  const root = resolve(process.cwd(), "storage", "public");
  await mkdir(root, { recursive: true });
  const temp = await mkdtemp(join(root, ".checkpoint-test-"));
  try {
    const file = join(temp, "fixture.png");
    await writeFile(file, "fixture - never sent to an external service");
    const calls = { ai: 0, storage: 0, publish: 0, clean: 0 };
    const stages: string[] = [];
    const updates: Record<string, unknown>[] = [];
    const checkpoint: AutoPublishCheckpoint = { version: 1, stage, source: "wallpost", wallpaperId: "wallpaper", analysis,
      ...(stage === "published" ? { publication: { accountId: "account" } } : {}),
    };
    const service = Object.assign(Object.create(AdminService.prototype), {
      autoDownloadRunning: false,
      logger: { warn: () => undefined },
      getSettings: async () => ({}),
      prisma: {
        task: { update: async ({ data }: { data: { payload: { checkpoint: AutoPublishCheckpoint } } }) => { stages.push(data.payload.checkpoint.stage); } },
        wallpaper: {
          findUnique: async () => ({ id: "wallpaper", title: "fixture", originalName: "fixture.png", mimeType: "image/png", assetPath: stage === "published" ? null : relative(root, file), coverPath: null, status: "draft" }),
          update: async () => ({}),
        },
        channelAccount: { update: async () => ({}) },
        autoPublishBoard: { update: async () => ({}) },
      },
      tasks: { update: async (_id: string, data: Record<string, unknown>) => { updates.push(data); } },
      analyzeNow: async () => { calls.ai++; return analysis; },
      storage: { syncWallpaper: async () => { calls.storage++; return [{ ok: true }]; } },
      pickAutoPublishAccount: async () => ({ id: "account" }),
      channel: { publish: async () => { calls.publish++; if (publishError) throw publishError; return { accountId: "account", switchedAccounts: 0 }; } },
      removeUploadedFile: async () => { calls.clean++; },
    }) as AdminService;
    const result = await service.runAutoPublishBoard(board, { id: randomUUID(), checkpoint });
    return { result, calls, stages, updates };
  } finally {
    assert.ok(resolve(temp).startsWith(root + sep));
    await rm(temp, { recursive: true });
  }
}

test("resuming at publish does not download, classify or upload again", async () => {
  const h = await runFixture("publish");
  assert.equal(h.result.ok, true);
  assert.deepEqual(h.calls, { ai: 0, storage: 0, publish: 1, clean: 1 });
  assert.deepEqual(h.stages, ["publish_inflight", "published"]);
});

test("a saved publication receipt only finalizes local status, even without an original", async () => {
  const h = await runFixture("published");
  assert.equal(h.result.ok, true);
  assert.deepEqual(h.calls, { ai: 0, storage: 0, publish: 0, clean: 0 });
});

test("resuming AI or storage executes only the remaining stages", async () => {
  for (const stage of ["analyze", "storage"] as const) {
    const h = await runFixture(stage);
    assert.equal(h.result.ok, true);
    assert.equal(h.calls.ai, stage === "analyze" ? 1 : 0);
    assert.equal(h.calls.storage, 1);
    assert.equal(h.calls.publish, 1);
    assert.ok(h.stages.indexOf("storage_inflight") < h.stages.indexOf("publish"));
    assert.ok(h.stages.indexOf("publish_inflight") < h.stages.indexOf("published"));
  }
});

test("publish timeout is not resumable; an explicit permission denial is", async () => {
  const timeout = await runFixture("publish", new Error("timeout"));
  assert.equal(timeout.result.ok, false);
  assert.equal((timeout.updates.at(-1)?.result as { resumable: boolean }).resumable, false);
  assert.deepEqual(timeout.stages, ["publish_inflight"]);
  const denied = await runFixture("publish", new ChannelPermissionDeniedError("暂无权限"));
  assert.equal(denied.result.ok, false);
  assert.equal((denied.updates.at(-1)?.result as { resumable: boolean }).resumable, true);
  assert.deepEqual(denied.stages, ["publish_inflight", "publish"]);
});

test("concurrent resume requests are reserved before asynchronous database reads", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started = 0;
  const checkpoint = { version: 1, stage: "download", source: "wallpost" };
  const service = Object.assign(Object.create(AdminService.prototype), {
    autoDownloadRunning: false, autoResumePending: false,
    prisma: {
      task: { findUnique: async () => { await gate; return { id: "t", type: "auto_publish", status: "failed", updatedAt: new Date(), payload: { boardId: "board", checkpoint } }; }, updateMany: async () => ({ count: 1 }) },
      autoPublishBoard: { findUnique: async () => board },
    },
    runAutoPublishBoard: async () => { started++; },
  }) as AdminService;
  const first = service.resumeAutoPublishTask("t");
  assert.equal((await service.resumeAutoPublishTask("t")).ok, false);
  release();
  assert.equal((await first).ok, true);
  assert.equal(started, 1);
});

test("expired originals are removed; failed cleanup remains retryable without reopening resume", async () => {
  const root = resolve(process.cwd(), "storage", "public");
  await mkdir(root, { recursive: true });
  const temp = await mkdtemp(join(root, ".expiry-test-"));
  const file = join(temp, "fixture.png");
  await writeFile(file, "fixture");
  try {
    const task = { id: randomUUID(), status: "failed", type: "auto_publish", updatedAt: new Date(0),
      payload: { boardId: "board", checkpoint: { version: 1, stage: "analyze", source: "wallpost", wallpaperId: "w" } },
      result: { resumable: true },
    };
    const wallpaper = { id: "w", status: "draft", assetPath: "../outside-owned-directory" as string | null };
    const service = Object.assign(Object.create(AdminService.prototype), {
      prisma: {
        task: { findUnique: async () => task,
          updateMany: async ({ data }: { data: object }) => { Object.assign(task, data, { updatedAt: new Date() }); return { count: 1 }; },
          update: async ({ data }: { data: object }) => { Object.assign(task, data); },
        },
        wallpaper: { findUnique: async () => wallpaper, update: async ({ data }: { data: object }) => { Object.assign(wallpaper, data); } },
      },
    }) as AdminService;
    await assert.rejects(service.expireAutoPublishTask(task.id), /目录之外/);
    assert.equal(canResumeAutoPublish(task.payload.checkpoint), false);
    assert.equal((task.result as { cleanupPending?: boolean }).cleanupPending, true);
    wallpaper.assetPath = relative(root, file);
    await service.expireAutoPublishTask(task.id);
    assert.equal(existsSync(file), false);
    assert.equal(wallpaper.assetPath, null);
    assert.deepEqual(task.result, { resumable: false, expired: true });
  } finally {
    assert.ok(resolve(temp).startsWith(root + sep));
    await rm(temp, { recursive: true });
  }
});
