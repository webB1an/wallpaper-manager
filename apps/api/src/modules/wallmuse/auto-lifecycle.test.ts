import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WallMuseAiService } from "./wallmuse-ai.service";
import { WallMuseWorker } from "./wallmuse.worker";
import { cleanupDecision, referencedByRevision, unlinkWallMuseFile, WallMuseCleanupService } from "./wallmuse-cleanup.service";

test("automatic theme is based on samples; later checks cannot rename it or invent asset ids", async () => {
  let answer: any = { theme: "青绿山林", acceptedIds: ["a"] };
  let requests = 0;
  const ai = new WallMuseAiService({ generateJson: async () => { requests++; return answer; } } as any, { assertIdle: async () => {} } as any);
  const candidates = [{ id: "a", title: "树林", tags: ["绿色"], summary: "山林" }];
  assert.equal((await ai.curate(candidates, "")).theme, "青绿山林");
  answer = { theme: "随机精选", acceptedIds: [] };
  assert.deepEqual(await ai.curate(candidates, "", "青绿山林"), { theme: "青绿山林", acceptedIds: [] });
  answer = { theme: "青绿山林", acceptedIds: ["invented"] };
  await assert.rejects(ai.curate(candidates, ""), /无效/);
  answer.acceptedIds = ["a", "a"];
  await assert.rejects(ai.curate(candidates, ""), /重复/);
  assert.equal(requests, 4);
});

test("theme AI obeys idle policy and planner keeps the fixed theme", async () => {
  const ai = new WallMuseAiService({ generateJson: async () => assert.fail("must not call") } as any, { assertIdle: async () => { throw new Error("wait idle"); } } as any);
  await assert.rejects(ai.curate([], ""), /wait idle/);
  const planner = new WallMuseAiService({ generateJson: async () => ({ subject: "随机精选", selectedIds: ["a"], templateId: "film-gallery" }) } as any, { assertIdle: async () => {} } as any);
  const result = await planner.plan([{ id: "a", title: "树林", tags: [], summary: "山林" }], 1, "", "青绿山林");
  assert.equal(result.subject, "青绿山林");
});

function themeHarness() {
  const assets: any[] = ["a", "b", "c"].map((id) => ({ id, state: "theme_pending", analysis: { safe: true, title: id, tags: [], summary: id } }));
  const cp: any = { version: 1, attempts: 3 };
  const input: any = { sources: ["wallpost"], targetCount: 18, candidateBudget: 54, preferredStyle: "" };
  const updates: any[] = [];
  let decisions = 0;
  const tx: any = { wallMuseAsset: { findMany: async () => assets.filter((asset) => ["theme_pending", "ready"].includes(asset.state)), findFirst: async () => assets.find((asset) => asset.state === "storage"), update: async ({ where, data }: any) => Object.assign(assets.find((asset) => asset.id === where.id), data) } };
  const worker: any = Object.assign(Object.create(WallMuseWorker.prototype), {
    prisma: { ...tx, $transaction: async (fn: any) => fn(tx) },
    ai: { curate: async (_: any, __: any, theme: any) => { decisions++; return { theme: theme || "青绿山林", acceptedIds: theme ? [] : ["a", "c"] }; } },
  });
  return { worker, assets, cp, input, updates, decisions: () => decisions,
    run: () => worker.prepareTheme({ articleId: "article" }, input, cp, async (data: any) => { updates.push(data); }, { assert: async () => {} }) };
}

test("sample automatically locks theme, only matching assets enter storage, others are replenished", async () => {
  const h = themeHarness();
  await h.run();
  assert.equal(h.cp.theme, "青绿山林");
  assert.deepEqual(h.assets.map((a) => a.state), ["storage", "off_theme", "storage"]);
  await h.run();
  assert.equal(h.cp.candidateId, "a");
  assert.equal(h.updates.at(-1).stage, "storage");
  h.assets[0].state = "ready"; h.assets[2].state = "ready";
  h.assets.push({ id: "d", state: "theme_pending", analysis: { safe: true, title: "城市", tags: [], summary: "夜景" } });
  await h.run();
  assert.equal(h.assets[3].state, "off_theme");
  assert.equal(h.cp.theme, "青绿山林");
  assert.equal(h.decisions(), 2);
  assert.equal(await h.run(), false, "all reviewed, continue collecting without another AI call");
});

test("small samples wait for more, while old ready candidates are checked before planning", async () => {
  const h = themeHarness();
  h.assets.splice(1);
  assert.equal(await h.run(), false);
  assert.equal(h.decisions(), 0);
  h.input.targetCount = 1; h.assets[0].state = "ready";
  await h.run();
  assert.equal(h.cp.theme, "青绿山林");
  assert.equal(h.assets[0].state, "ready");
});

test("failed theme transaction cannot mark uncommitted candidates reviewed", async () => {
  const h = themeHarness();
  h.worker.prisma.$transaction = async () => { throw new Error("transaction rolled back"); };
  h.worker.prisma.wallMuseJob = { findUnique: async () => ({ checkpoint: { version: 1, attempts: 3 } }) };
  await assert.rejects(h.run(), /rolled back/);
  assert.equal(h.cp.theme, undefined);
  assert.equal(h.cp.themeReviewedIds, undefined);
  assert.ok(h.assets.every((asset) => asset.state === "theme_pending"));
});

test("lost theme commit response reloads the committed checkpoint instead of overwriting it", async () => {
  const h = themeHarness();
  h.worker.prisma.$transaction = async () => { throw new Error("commit response lost"); };
  h.worker.prisma.wallMuseJob = { findUnique: async () => ({ checkpoint: { version: 1, attempts: 3, theme: "青绿山林", themeReviewedIds: ["a", "b", "c"] } }) };
  assert.equal(await h.run(), true);
  assert.equal(h.cp.theme, "青绿山林");
  assert.deepEqual(h.cp.themeReviewedIds, ["a", "b", "c"]);
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
  assert.equal(cleanupDecision(a, now), null);
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
