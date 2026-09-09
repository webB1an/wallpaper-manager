import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { runInNewContext } from "node:vm";
import { PublicService } from "../modules/public/public.service";

const card = (id: string, tags: string[], heat = 1) => ({
  id, title: id, type: "static", status: "published", coverUrl: "https://example.com/cover.jpg",
  downloadCount: heat, viewCount: 0, tags: tags.map((name) => ({ tag: { name } })),
});

test("recommendations prioritize matching tags, deduplicate and only then fill by type", async () => {
  const character = card("character", ["角色", "动漫"]);
  const generic = card("generic", ["动漫"], 999);
  const calls: any[] = [];
  const service = new PublicService({ wallpaper: { findMany: async (query: any) => {
    calls.push(query);
    if (query.where.tags) return query.where.tags.some.tag.name === "角色" ? [character] : [generic, character];
    assert.deepEqual(query.where.id.notIn, ["current", "character", "generic"]);
    assert.equal(query.take, 4);
    return [card("fallback", [], 9999)];
  } } } as any, {} as any, {} as any, {} as any);
  const result = await (service as any).relatedWallpapers("current", "static", ["角色", "动漫"]);
  assert.deepEqual(result.map((item: any) => item.id), ["character", "generic", "fallback"]);
  assert.ok(calls.every((query) => query.where.status === "published"));
});

test("tagless recommendations use bounded same-type fallback", async () => {
  let calls = 0;
  const service = new PublicService({ wallpaper: { findMany: async (query: any) => {
    calls++;
    assert.equal(query.where.type, "live");
    assert.equal(query.take, 6);
    return [];
  } } } as any, {} as any, {} as any, {} as any);
  assert.deepEqual(await (service as any).relatedWallpapers("current", "live", []), []);
  assert.equal(calls, 1);
});

test("copy counts and ranking events are transactional; redirects do not add wallpaper heat", async () => {
  let heat = 0;
  let events = 0;
  let redirects = 0;
  const transactions: number[] = [];
  const service = new PublicService({
    wallpaper: { findFirst: async () => ({ id: "current" }), update: () => { heat++; return Promise.resolve({}); } },
    wallpaperClick: { create: () => { events++; return Promise.resolve({}); } },
    shortLink: {
      findUnique: async () => ({ id: "link", wallpaper: { status: "published" }, storageLink: { isActive: true, provider: "baidu", url: "https://pan.baidu.com/s/fixture", passcode: "abcd" } }),
      update: () => { redirects++; return Promise.resolve({}); },
    },
    $transaction: async (operations: Promise<unknown>[]) => { transactions.push(operations.length); return Promise.all(operations); },
  } as any, {} as any, {} as any, {} as any);
  await service.click("current");
  assert.equal(await service.redirect("link"), "https://pan.baidu.com/s/fixture?pwd=abcd");
  assert.equal(heat, 1);
  assert.equal(events, 1);
  assert.equal(redirects, 1);
  assert.equal(transactions[0], 2);
});

test("legacy live detail exposes no preview and never fetches the original", async () => {
  const service = new PublicService({ wallpaper: {
    findFirst: async () => ({ ...card("legacy", []), type: "live", coverPath: null, shortLinks: [] }),
    findMany: async () => [], update: async () => ({}),
  } } as any, {} as any, new Proxy({}, { get() { throw new Error("must not fetch original"); } }) as any, {} as any);
  assert.equal((await service.detail("legacy")).previewVideoUrl, null);
});

function miniPage(name: string, wx: object, dependencies: object = {}) {
  let page: any;
  runInNewContext(readFileSync(join(resolve(__dirname, "../../../.."), `apps/miniprogram/pages/${name}/${name}.js`), "utf8"), {
    exports: {}, Page: (value: unknown) => { page = value; }, wx,
    require: (name: string) => name.endsWith("/ads") ? { AD_UNITS: {} } : dependencies,
  });
  page.setData = (data: object) => Object.assign(page.data, data);
  return page;
}

test("mini preview uses the cover, plays only on tap, and gracefully falls back", () => {
  let image = "";
  const page = miniPage("detail", { previewImage: (options: any) => { image = options.current; }, showToast: () => undefined });
  page.data.item = { coverUrl: "https://example.com/cover.jpg" };
  page.previewImage();
  assert.equal(image, page.data.item.coverUrl);
  page.playPreview();
  assert.equal(page.data.playingPreview, false);
  page.data.item.previewVideoUrl = "https://example.com/preview.mp4";
  page.playPreview();
  assert.equal(page.data.playingPreview, true);
  page.onPreviewError();
  assert.equal(page.data.playingPreview, false);
  assert.equal(page.data.previewFailed, true);
});

test("purchase clipboard preserves the full URL and query without appending a passcode", () => {
  let clipboard = "";
  const page = miniPage("buy", {
    setClipboardData: (options: any) => { clipboard = options.data; options.success(); },
    showToast: () => undefined,
  });
  const url = "https://pan.baidu.com/s/complete-link?pwd=8888&from=share";
  page.data.resources = [{ url, passcode: "8888" }];
  page.copyResource({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(clipboard, url);
  assert.ok(!clipboard.includes("提取码"));
});

for (const name of ["index", "list"]) {
  test(`${name} retries the failed page without clearing items or skipping pages`, async () => {
    const pages: number[] = [];
    let fail = true;
    const page = miniPage(name, { showToast: () => undefined }, {
      request: async (_url: string, query: any) => {
        pages.push(query.page);
        if (fail) throw new Error("offline");
        return { list: [card("next", [])], total: 40 };
      },
    });
    page.data.items = [card("first", [])];
    page.data.total = 40;
    await page.load(true);
    assert.equal(page.data.page, 1);
    assert.equal(page.data.items[0].id, "first");
    page.onReachBottom();
    assert.equal(pages.length, 1);
    fail = false;
    await page.retry();
    assert.deepEqual(pages, [2, 2]);
    assert.equal(page.data.page, 2);
    assert.equal(page.data.items.length, 2);
    assert.equal(page.data.error, "");
  });
}

test("home nested tag consumes taps rather than bubbling to the detail card", () => {
  const markup = readFileSync(join(resolve(__dirname, "../../../.."), "apps/miniprogram/pages/index/index.wxml"), "utf8");
  assert.match(markup, /catchtap="openTag" data-tag="\{\{tagName\}\}"/);
});

test("detail hiding or unloading pauses and unmounts preview without autoplay on return", () => {
  let pauses = 0;
  const page = miniPage("detail", {
    createVideoContext: (id: string) => { assert.equal(id, "wallpaper-preview"); return { pause: () => pauses++ }; },
    setNavigationBarTitle: () => undefined,
  });
  page.data.playingPreview = true;
  page.onHide();
  assert.equal(pauses, 1);
  assert.equal(page.data.playingPreview, false);
  page.onUnload();
  assert.equal(pauses, 1);
});

test("pending payment blocks repurchase, survives refresh, and query only refreshes entitlement", async () => {
  const storage = new Map<string, string>([["openid", "fixture"]]);
  let payments = 0;
  let delivered = false;
  const page = miniPage("buy", {
    getStorageSync: (key: string) => storage.get(key) || "",
    setStorageSync: (key: string, value: string) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    showToast: () => undefined, showLoading: () => undefined, hideLoading: () => undefined,
  }, {
    ensureOpenid: async () => "fixture", canUseVirtualPayment: () => true, checkIosVersion: () => true,
    payProduct: async () => { payments++; return { outTradeNo: "order" }; },
    waitForPaymentDelivery: async () => false,
    getPaymentOrderStatus: async () => ({ delivered, status: delivered ? "delivered" : "paid" }),
    getPaymentCatalog: async () => ({ products: [], entitlement: {} }),
    getPaymentDelivery: async () => ({ purchased: delivered, resources: [] }),
  });
  page.data.products = [{ key: "permanent" }];
  const event = { currentTarget: { dataset: { key: "permanent" } } };
  await page.buyAll(event);
  assert.equal(page.data.pendingOrder, "order");
  await page.buyAll(event);
  assert.equal(payments, 1);
  page.data.pendingOrder = "";
  await page.onShow();
  assert.equal(page.data.pendingOrder, "order");
  await page.checkPendingOrder();
  assert.equal(page.data.pendingOrder, "order");
  delivered = true;
  await page.checkPendingOrder();
  assert.equal(page.data.pendingOrder, "");
  assert.equal(page.data.purchased, true);
  assert.equal(payments, 1);
});

test("purchase resource page offers member requests only after purchase", () => {
  let destination = "";
  const page = miniPage("buy", { navigateTo: (options: any) => { destination = options.url; } });
  page.goMemberRequest();
  assert.equal(destination, "");
  page.data.purchased = true;
  page.goMemberRequest();
  assert.equal(destination, "/pages/request/request");
});
