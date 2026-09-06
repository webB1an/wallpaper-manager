import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadBridgeFile, transferTaskUpdate, TransferProgress } from "./bridge-transfer";

const base = { headers: {}, timeoutMs: 2000, maxBytes: 100 };
test("streamed transfer reports bytes and validates complete file", async () => {
  const updates: TransferProgress[] = [];
  const data = await downloadBridgeFile("http://fixture", { ...base, expectedBytes: 5, progressIntervalMs: 0,
    fetcher: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3, 4, 5])); c.close(); } }), { headers: { "content-length": "5" } }),
    onProgress: async (progress) => { updates.push(progress); },
  });
  assert.equal(data.length, 5);
  assert.equal(updates[0].received, 0);
  assert.equal(updates.at(-1)?.received, 5);
  assert.ok(updates.some((x) => x.received === 2));
});

test("missing length still reports downloaded bytes", async () => {
  const data = await downloadBridgeFile("http://fixture", { ...base, fetcher: async () => new Response(new Uint8Array([1])) });
  assert.equal(data.length, 1);
  const update = transferTaskUpdate({ received: 1048576, bytesPerSecond: 27000, elapsedSeconds: 60 });
  assert.match(update.message, /1.0.*26.4 KB\/s.*偏慢/);
  assert.equal(update.progress, 10);
});

test("truncated, oversized and HTTP error responses fail explicitly", async () => {
  for (const response of [new Response("a", { headers: { "content-length": "5" } }), new Response("a", { headers: { "content-length": "101" } }), new Response("failed", { status: 404 })]) {
    await assert.rejects(downloadBridgeFile("http://fixture", { ...base, fetcher: async () => response }), /已接收/);
  }
  await assert.rejects(downloadBridgeFile("http://fixture", { ...base, maxBytes: 1, fetcher: async () => new Response("ab") }), /超过/);
});

test("idle stream aborts instead of waiting through the full total timeout", async () => {
  await assert.rejects(downloadBridgeFile("http://fixture", { ...base, idleTimeoutMs: 20,
    fetcher: async (_url, init) => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); init?.signal?.addEventListener("abort", () => c.error(new Error("aborted")), { once: true }); } })),
  }), /连续无数据.*已接收/);
});

test("total timeout also bounds waiting for response headers", async () => {
  await assert.rejects(downloadBridgeFile("http://fixture", { ...base, timeoutMs: 20,
    fetcher: async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })),
  }), /超过总时限/);
});

test("transfer progress stays below later processing stages", () => {
  const update = transferTaskUpdate({ received: 100, total: 100, bytesPerSecond: 100, elapsedSeconds: 1 });
  assert.equal(update.progress, 29);
  assert.match(update.message, /100.0%/);
});
