import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { StorageCoordinatorService } from "../storage/storage-coordinator.service";
import { AdminService } from "./admin.service";
import { DriveCheckpoint, uploadResumeState } from "./upload-checkpoint";

function driveHarness() {
  const calls = { upload: 0, share: 0, link: 0, short: 0, inspect: 0 };
  let failShare = true;
  let linked: any;
  let short: any;
  const tx = {
    storageLink: { findFirst: async () => linked, create: async ({ data }: any) => { calls.link++; linked = { id: "link", ...data }; return linked; } },
    shortLink: { findFirst: async () => short, create: async () => { calls.short++; short = { id: "short" }; return short; } },
  };
  const service = Object.assign(Object.create(StorageCoordinatorService.prototype), {
    prisma: { $transaction: async (run: any) => run(tx) },
    accounts: { getAccountForProvider: async (provider: string) => provider === "baidu" ? { id: "account" } : null },
    baidu: { uploadPath: () => "/apps/bdpan/fixture.mp4", upload: async () => { calls.upload++; return "/apps/bdpan/fixture.mp4"; },
      share: async () => { calls.share++; if (failShare) throw new Error("share failed"); return { url: "https://example.com/share" }; },
      list: async () => { calls.inspect++; return { items: [] }; },
    },
  }) as StorageCoordinatorService;
  return { service, calls, shareSucceeds: () => { failShare = false; } };
}

test("share failure preserves uploaded path; retry only shares and records links once", async () => {
  const h = driveHarness();
  const drives: Partial<Record<"baidu" | "quark", DriveCheckpoint>> = {};
  const phases: string[] = [];
  const save = async () => { phases.push(drives.baidu!.phase); };
  await assert.rejects(h.service.syncWallpaperResumable("w", "fixture.mp4", "fixture", "live", [], undefined, drives, save), /share failed/);
  assert.equal(drives.baidu?.phase, "sharing");
  assert.equal(drives.baidu?.remotePath, "/apps/bdpan/fixture.mp4");
  h.shareSucceeds();
  await h.service.syncWallpaperResumable("w", "fixture.mp4", "fixture", "live", [], undefined, drives, save);
  await h.service.syncWallpaperResumable("w", "fixture.mp4", "fixture", "live", [], undefined, drives, save);
  assert.deepEqual(h.calls, { upload: 1, share: 2, link: 1, short: 1, inspect: 0 });
  assert.ok(phases.indexOf("uploading") < phases.indexOf("uploaded"));
});

test("ambiguous upload is inspected, never blindly uploaded again", async () => {
  const root = resolve(process.cwd(), "storage", "public");
  await mkdir(root, { recursive: true });
  const temp = await mkdtemp(join(root, ".upload-resume-test-"));
  const file = join(temp, "fixture.mp4");
  await writeFile(file, "fixture");
  try {
    const h = driveHarness();
    const drives = { baidu: { accountId: "account", phase: "uploading", remotePath: "/apps/bdpan/fixture.mp4" } } as const;
    await assert.rejects(h.service.syncWallpaperResumable("w", file, "fixture", "live", [], undefined, drives, async () => undefined), /无法确认上传结果/);
    assert.equal(h.calls.upload, 0);
    assert.equal(h.calls.inspect, 1);
    assert.equal(h.calls.share, 0);
  } finally { assert.ok(resolve(temp).startsWith(root + sep)); await rm(temp, { recursive: true }); }
});

test("uploads resume at storage without repeating AI or an already completed channel post", async () => {
  const root = resolve(process.cwd(), "storage", "public");
  await mkdir(root, { recursive: true });
  const temp = await mkdtemp(join(root, ".upload-pipeline-test-"));
  const file = join(temp, "fixture.mp4");
  await writeFile(file, "fixture");
  try {
    const task: any = { payload: { wallpaperId: "w" } };
    const calls = { ai: 0, storage: 0, publish: 0 };
    const w: any = { id: "w", title: "fixture", originalName: "fixture.mp4", mimeType: "video/mp4", assetPath: relative(root, file), status: "pending_review", autoPublish: true, type: "live", tags: [] };
    const service = Object.assign(Object.create(AdminService.prototype), {
      prisma: { task: { findUnique: async () => task, update: async ({ data }: any) => Object.assign(task, data) },
        wallpaper: { findUnique: async () => w, update: async ({ data }: any) => Object.assign(w, data) }, storageLink: { findMany: async () => [] } },
      tasks: { update: async (_id: string, data: object) => Object.assign(task, data) },
      analyzeNow: async () => { calls.ai++; return { title: "fixture", type: "live", tags: [], sensitiveFlags: [], safe: true }; },
      storage: { syncWallpaperResumable: async () => { if (++calls.storage === 1) throw new Error("fixture upload failed"); return [{ ok: true }]; } },
      assertWallpapersCanPublish: async () => undefined,
      publishWallpaperToChannel: async () => { calls.publish++; return { ok: true }; },
      removeUploadedFile: async () => undefined,
    }) as AdminService;
    await assert.rejects(service.runProcessWallpaper("w", "t"), /fixture upload failed/);
    assert.equal(task.payload.uploadCheckpoints.w.stage, "storage");
    await service.runProcessWallpaper("w", "t");
    await service.runProcessWallpaper("w", "t");
    assert.deepEqual(calls, { ai: 1, storage: 2, publish: 1 });
    assert.equal(task.status, "success");
  } finally { assert.ok(resolve(temp).startsWith(root + sep)); await rm(temp, { recursive: true }); }
});

test("legacy 38 percent upload requires explicit confirmation before queueing", async () => {
  const root = resolve(process.cwd(), "storage", "public");
  await mkdir(root, { recursive: true });
  const temp = await mkdtemp(join(root, ".legacy-upload-test-"));
  const file = join(temp, "fixture.mp4");
  await writeFile(file, "fixture");
  try {
    const task: any = { id: "t", type: "upload_asset", status: "failed", progress: 38, updatedAt: new Date(), payload: { wallpaperId: "w" } };
    let queued = 0;
    const w = { id: "w", title: "fixture", type: "live", status: "pending_review", assetPath: relative(root, file), aiAnalysis: { safe: true, tags: [], sensitiveFlags: [] } };
    const service = Object.assign(Object.create(AdminService.prototype), {
      prisma: { task: { findUnique: async () => task, updateMany: async ({ data }: any) => { Object.assign(task, data); return { count: 1 }; } },
        wallpaper: { findUnique: async () => w }, storageLink: { count: async () => 0 } },
      wallpaperQueue: { add: async () => { queued++; } },
    }) as AdminService;
    await assert.rejects(service.resumeUploadTask("t"), /没有安全检查点/);
    assert.equal(queued, 0);
    await service.resumeUploadTask("t", false, true);
    assert.equal(queued, 1);
    assert.equal(task.payload.uploadCheckpoints.w.stage, "storage");
    await assert.rejects(service.resumeUploadTask("t", false, true), /状态已变化/);
    assert.equal(queued, 1);
  } finally { assert.ok(resolve(temp).startsWith(root + sep)); await rm(temp, { recursive: true }); }
});

test("batch receipts and ambiguous external stages prevent repeated publishing", () => {
  const item = { version: 1, stage: "done", analysis: { safe: true }, drives: {} };
  assert.equal(uploadResumeState({ uploadCheckpoints: { w: item }, uploadGroups: { w: { status: "done" } } }).resumable, true);
  assert.equal(uploadResumeState({ uploadCheckpoints: { w: item }, uploadGroups: { w: { status: "inflight" } } }).resumable, false);
  assert.equal(uploadResumeState({ uploadCheckpoints: { w: { ...item, stage: "resource_inflight" } } }).resumable, false);
});
