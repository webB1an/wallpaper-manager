import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WallMuseAiService } from "./wallmuse-ai.service";
import { WallMuseWorker } from "./wallmuse.worker";
import { cleanupDecision, referencedByRevision, unlinkWallMuseFile, WallMuseCleanupService } from "./wallmuse-cleanup.service";

const images = ["forest", "city", "sea"].map((id) => ({ id, title: id, tags: [], summary: id }));

test("anchor stays first and different subjects are retained without a filtering call", async () => {
  let requests = 0;
  const ai = new WallMuseAiService({ generateJson: async (_: string, data: any) => {
    requests++; assert.equal(data.anchor.id, "city");
    return { subject: "都市夜色", selectedIds: ["sea", "forest", "city"], templateId: "film-gallery" };
  } } as any, { assertIdle: async () => {} } as any);
  const plan = await ai.plan(images, 3, "", "city");
  assert.deepEqual(plan.selectedIds, ["city", "sea", "forest"]);
  assert.equal(requests, 1);
});

test("planning rejects omitted, repeated or foreign images and obeys idle policy", async () => {
  for (const selectedIds of [["forest", "city"], ["city", "city", "sea"], ["foreign", "city", "sea"]]) {
    const ai = new WallMuseAiService({ generateJson: async () => ({ subject: "测试", selectedIds, templateId: "film-gallery" }) } as any, { assertIdle: async () => {} } as any);
    await assert.rejects(ai.plan(images, 3, "", "city"));
  }
  const ai = new WallMuseAiService({ generateJson: async () => assert.fail("no AI outside idle") } as any, { assertIdle: async () => { throw new Error("wait idle"); } } as any);
  await assert.rejects(ai.plan(images, 3, "", "city"), /wait idle/);
});

test("exact requested count moves straight to planning without downloading extra candidates", async () => {
  const updates: any[] = [];
  const worker: any = Object.assign(Object.create(WallMuseWorker.prototype), {
    candidates: async () => images,
    restoreCandidates: async () => assert.fail("already enough"),
    intake: { obtain: async () => assert.fail("no extra download") },
  });
  await worker.collect({ articleId: "a" }, { targetCount: 3, candidateBudget: 12 }, { attempts: 3 }, async (data: any) => updates.push(data), {});
  assert.equal(updates[0].stage, "plan");
});

test("random anchor and exact batch are saved before AI and remain stable across retries", async () => {
  let calls = 0;
  let stored: any;
  const anchors: string[] = [];
  const worker: any = Object.assign(Object.create(WallMuseWorker.prototype), {
    policy: { assertIdle: async () => {} },
    prisma: { wallMuseJob: { update: async ({ data }: any) => { if (data.checkpoint) stored = structuredClone(data.checkpoint); } } },
    candidates: async () => [...images, { id: "extra", title: "extra", tags: [], summary: "" }],
    ai: { plan: async (batch: any[], count: number, _: string, anchor: string) => {
      assert.deepEqual(batch.map((x) => x.id), images.map((x) => x.id));
      assert.equal(count, 3); assert.equal(stored.themeAnchorId, anchor);
      anchors.push(anchor);
      if (++calls === 1) throw new Error("temporary AI error");
      return { subject: "测试", selectedIds: [anchor, ...batch.map((x) => x.id).filter((id) => id !== anchor)], templateId: "film-gallery" };
    } },
  });
  const job: any = { id: "job", articleId: "article", stage: "plan", input: { targetCount: 3 }, checkpoint: { version: 1, attempts: 3 } };
  const fence = { assert: async () => {} };
  await worker.step(job, fence);
  await worker.step({ ...job, checkpoint: stored }, fence);
  assert.equal(anchors.length, 2); assert.equal(anchors[0], anchors[1]);
  assert.equal(stored.plan.selectedIds[0], anchors[0]);
});

test("legacy theme-rejected images are resumed even after the collection budget is exhausted", async () => {
  const worker: any = Object.assign(Object.create(WallMuseWorker.prototype), {
    candidates: async () => [],
    prisma: { wallMuseAsset: { findFirst: async () => ({ id: "saved", state: "off_theme", analysis: { safe: true } }) } },
    intake: { obtain: async () => assert.fail("must reuse saved image") },
  });
  const cp: any = { attempts: 12 };
  const writes: any[] = [];
  await worker.collect({ articleId: "a" }, { targetCount: 3, candidateBudget: 12 }, cp, async (data: any) => writes.push(data), {});
  assert.equal(cp.candidateId, "saved"); assert.equal(writes[0].stage, "analyze");
});

test("near duplicates are removed before AI recognition", async () => {
  const writes: any[] = [];
  const tx: any = { wallMuseAsset: { update: async ({ data }: any) => writes.push(data) } };
  const worker: any = Object.assign(Object.create(WallMuseWorker.prototype), {
    activeAsset: async () => ({ id: "new", wallpaperId: "w", perceptualHash: "0000000000000000" }),
    prisma: { wallpaper: { findUniqueOrThrow: async () => ({ status: "draft" }) },
      wallMuseAsset: { findMany: async () => [{ id: "prior", perceptualHash: "0000000000000001", analysis: { safe: true } }] },
      $transaction: async (fn: any) => fn(tx) },
    ai: { analyze: async () => assert.fail("duplicate must not consume AI") },
  });
  await worker.analyze({ articleId: "a" }, { candidateId: "new" }, async (data: any) => writes.push(data), { assert: async () => {} });
  assert.equal(writes[0].state, "near_duplicate"); assert.equal(writes[1].stage, "collect");
});

test("restored off-theme image reuses its analysis without another AI call", async () => {
  const writes: any[] = [];
  const tx: any = { aiAnalysis: { upsert: async () => {} }, wallpaper: { update: async () => {} }, wallMuseAsset: { update: async ({ data }: any) => writes.push(data) } };
  const worker: any = Object.assign(Object.create(WallMuseWorker.prototype), {
    activeAsset: async () => ({ id: "old", wallpaperId: "w", state: "off_theme", analysis: { safe: true, title: "城市", tags: [], summary: "夜景" } }),
    prisma: { wallpaper: { findUniqueOrThrow: async () => ({ status: "pending_review" }) }, $transaction: async (fn: any) => fn(tx) },
    ai: { analyze: async () => assert.fail("existing analysis must be reused") },
  });
  await worker.analyze({ articleId: "a" }, { candidateId: "old" }, async (data: any) => writes.push(data), { assert: async () => {} });
  assert.equal(writes[0].state, "storage"); assert.equal(writes[1].stage, "storage");
});

const now = Date.parse("2026-09-14T00:00:00Z");
function assetFixture() {
  return { id: "a", state: "ready", createdAt: "2026-09-01T00:00:00Z",
    drives: { baidu: { phase: "shared", accountId: "account", url: "https://pan.baidu.com/s/backup", remotePath: "/archive/wm-abcd.jpg" } },
    wallpaper: { id: "w", collectionOnly: true, status: "pending_review", assetPath: "originals/wm-abcd.jpg", fileSize: 4n, articleAssets: [{ id: "a" }], storageLinks: [{ isActive: true, provider: "baidu", storageAccountId: "account", url: "https://pan.baidu.com/s/backup" }] },
    article: { jobs: [{ status: "done", updatedAt: "2026-09-02T00:00:00Z" }], revisions: [{ payload: { assets: [{ id: "a" }] } }] } };
}

test("retention protects historical versions, recent work, failed jobs and shared/user assets", () => {
  const a: any = assetFixture();
  assert.equal(cleanupDecision(a, now), "original");
  a.state = "off_theme";
  assert.equal(cleanupDecision(a, now), null, "historical reference must retain all images");
  a.article.revisions = [];
  assert.equal(cleanupDecision(a, now), "discard");
  for (const status of ["running", "waiting", "queued", "failed"]) { a.article.jobs[0].status = status; assert.equal(cleanupDecision(a, now), null); }
  a.article.jobs[0].status = "done"; a.article.jobs[0].updatedAt = "2026-09-13T00:00:00Z";
  assert.equal(cleanupDecision(a, now), null);
  a.article.jobs[0].updatedAt = "2026-09-02T00:00:00Z";
  a.wallpaper.collectionOnly = false;
  assert.equal(cleanupDecision(a, now), "discard");
  a.wallpaper.assetPath = "originals/user-upload.jpg";
  assert.equal(cleanupDecision(a, now), null);
  a.wallpaper.assetPath = "originals/wm-abcd.jpg";
  a.wallpaper.collectionOnly = true; a.wallpaper.articleAssets.push({ id: "another" });
  assert.equal(cleanupDecision(a, now), null);
  assert.equal(referencedByRevision([{ payload: {} }], "a"), true);
});

test("backup verification requires original account, exact remote file size and recorded share", async () => {
  const a: any = assetFixture();
  let size = 4;
  const cleanup = new WallMuseCleanupService({} as any, {} as any, { getAccountForProvider: async () => ({ id: "account" }) } as any, { list: async () => ({ items: [{ path: "/archive/wm-abcd.jpg", name: "wm-abcd.jpg", size, isDir: false }] }) } as any, {} as any);
  assert.equal(await cleanup.backupVerified(a), true);
  size = 5;
  assert.equal(await cleanup.backupVerified(a), false);
  size = 4; a.drives.baidu.phase = "sharing";
  assert.equal(await cleanup.backupVerified(a), false);
  a.drives.baidu.phase = "shared"; a.wallpaper.storageLinks[0].isActive = false;
  assert.equal(await cleanup.backupVerified(a), false);
});

test("filesystem cleanup deletes only owned generated files and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "wallmuse-cleanup-test-"));
  try {
    await mkdir(join(root, "public", "originals"), { recursive: true });
    await writeFile(join(root, "public", "originals", "wm-abcd.jpg"), "test");
    await writeFile(join(root, "public", "originals", "user.jpg"), "keep");
    assert.equal(await unlinkWallMuseFile(root, "public/originals/wm-abcd.jpg"), 4);
    assert.equal(await unlinkWallMuseFile(root, "public/originals/wm-abcd.jpg"), 0);
    await assert.rejects(unlinkWallMuseFile(root, "public/originals/user.jpg"), /拒绝/);
    await assert.rejects(unlinkWallMuseFile(root, "../wm-abcd.jpg"), /拒绝/);
    assert.equal(await readFile(join(root, "public", "originals", "user.jpg"), "utf8"), "keep");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("scheduled cleanup retains originals when backup is unverified and preserves article images after verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "wallmuse-cleanup-sweep-test-"));
  try {
    for (const dir of ["public/originals", "public/covers", "wallmuse/article-images"]) await mkdir(join(root, dir), { recursive: true });
    for (const file of ["public/originals/wm-abcd.jpg", "public/covers/wm-abcd.jpg", "wallmuse/article-images/abcd.jpg"]) await writeFile(join(root, file), "test");
    const a: any = assetFixture();
    a.wallpaperId = "w";
    a.article.jobs[0].updatedAt = a.createdAt = "2020-01-01T00:00:00Z";
    let verified = false;
    const prisma: any = { wallMuseAsset: { findMany: async () => [a], findUnique: async () => a }, wallpaper: { update: async ({ where, data }: any) => { assert.equal(where.id, "w"); Object.assign(a.wallpaper, data); } } };
    prisma.$transaction = async (fn: any) => fn(prisma);
    const leases: any = { run: async (_: string, fn: any) => fn({ assert: async () => {} }) };
    const cleanup = new WallMuseCleanupService(prisma, leases, {} as any, {} as any, {} as any);
    Object.assign(cleanup, { storageRoot: root, backupVerified: async () => verified, logger: { log: () => {}, warn: (message: string) => assert.fail(message) } });
    assert.equal((await cleanup.sweep())?.removed, 0);
    assert.equal(await readFile(join(root, "public/originals/wm-abcd.jpg"), "utf8"), "test");
    verified = true;
    assert.equal((await cleanup.sweep())?.removed, 1);
    assert.equal(a.wallpaper.assetPath, null);
    assert.equal(await readFile(join(root, "public/covers/wm-abcd.jpg"), "utf8"), "test");
    assert.equal(await readFile(join(root, "wallmuse/article-images/abcd.jpg"), "utf8"), "test");
  } finally { await rm(root, { recursive: true, force: true }); }
});
