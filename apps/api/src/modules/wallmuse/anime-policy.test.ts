import test from "node:test";
import assert from "node:assert/strict";
import { animeSources, isAnimeSource } from "./anime-policy";
import { WallMuseWorker } from "./wallmuse.worker";
import { WallMuseService } from "./wallmuse.service";

test("only dedicated anime sources are exposed, without enabling disabled providers", async () => {
  assert.equal(isAnimeSource("wallpost"), false);
  assert.equal(isAnimeSource("openverse"), false);
  assert.equal(new Set(animeSources).size, animeSources.length);
  const service: any = Object.assign(Object.create(WallMuseService.prototype), {
    admin: { getSettings: async () => ({ wallMuseEnabled: true, autoSourceEnabled: { nekos_best: false } }) },
    policy: { schedule: async () => ({}) }, ai: { configured: () => true }, miniProgram: () => ({}),
  });
  const result = await service.capabilities();
  assert.ok(result.sources.every((source: any) => isAnimeSource(source.id)));
  assert.equal(result.sources.find((source: any) => source.id === "nekos_best").enabled, false);
});

test("anime policy accepts safe anime, rejects photography, and preserves safety checks", async () => {
  for (const [safe, animeStyle, expected] of [[true, true, "storage"], [true, false, "not_anime"], [false, true, "rejected"]] as const) {
    const writes: any[] = [];
    const tx: any = { aiAnalysis: { upsert: async () => {} }, wallpaper: { update: async () => {} }, wallMuseAsset: { update: async ({ data }: any) => writes.push(data) } };
    const worker: any = Object.assign(Object.create(WallMuseWorker.prototype), {
      activeAsset: async () => ({ id: "a", wallpaperId: "w", analysis: { safe, animeStyle, title: "测试", tags: [], summary: "测试" } }),
      prisma: { wallpaper: { findUniqueOrThrow: async () => ({ status: "pending_review" }) }, $transaction: async (fn: any) => fn(tx) },
      ai: { analyze: async () => assert.fail("reuse classification, no extra AI call") },
    });
    await worker.analyze({ articleId: "article", input: { animeOnly: true } }, { candidateId: "a" }, async (data: any) => writes.push(data), { assert: async () => {} });
    assert.equal(writes[0].state, expected);
    assert.equal(writes[1].stage, expected === "storage" ? "storage" : "collect");
  }
});
