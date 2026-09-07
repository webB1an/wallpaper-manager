import assert from "node:assert/strict";
import { test } from "node:test";
import { bridgeTransferPath, downloadBridgeFile, downloadBridgeFileToDisk, removeBridgeTransfer, transferTaskUpdate, TransferProgress } from "./bridge-transfer";
import { bridgeTransferTimeoutMs, fetchAutoSource } from "./auto-publish-sources";
import type { ConfigService } from "@nestjs/config";
import { readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

const base = { headers: {}, timeoutMs: 2000, maxBytes: 100 };

test("static transfers allow 15 minutes while live transfers retain their 60 minute budget", () => {
  assert.equal(bridgeTransferTimeoutMs("static"), 900_000);
  assert.equal(bridgeTransferTimeoutMs("live"), 3_600_000);
});

test("a fresh transfer invocation resumes a persisted partial file and reuses completed files", async () => {
  const transferKey = randomUUID();
  try {
    await assert.rejects(downloadBridgeFileToDisk("http://fixture/persistent", { ...base, transferKey, retainPartial: true,
      fetcher: async () => new Response("ab", { headers: { "content-length": "5", etag: '"stable"' } }),
    }), /不完整/);
    assert.equal(await readFile(bridgeTransferPath(transferKey), "utf8"), "ab");
    const path = await downloadBridgeFileToDisk("http://fixture/persistent", { ...base, transferKey, expectedBytes: 5,
      fetcher: async (_url, init) => {
        assert.equal(new Headers(init?.headers).get("range"), "bytes=2-");
        return new Response("cde", { status: 206, headers: { "content-length": "3", "content-range": "bytes 2-4/5", etag: '"stable"' } });
      },
    });
    assert.equal(await readFile(path, "utf8"), "abcde");
    const reused = await downloadBridgeFileToDisk("http://fixture/persistent", { ...base, transferKey, fetcher: async () => { throw new Error("must not fetch completed file"); } });
    assert.equal(reused, path);
  } finally { await removeBridgeTransfer(transferKey); }
});

test("fatal range mismatch deletes both partial file and metadata even with retention enabled", async () => {
  const transferKey = randomUUID();
  try {
    await assert.rejects(downloadBridgeFileToDisk("http://fixture", { ...base, transferKey, retainPartial: true, maxRetries: 1,
      fetcher: async () => new Response("ab", { headers: { "content-length": "5", etag: '"stable"' } }),
    }), /续传范围/);
    assert.equal(existsSync(bridgeTransferPath(transferKey)), false);
    assert.equal(existsSync(`${bridgeTransferPath(transferKey)}.json`), false);
  } finally { await removeBridgeTransfer(transferKey); }
});
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

test("interrupted download resumes at the exact offset without losing bytes", async () => {
  let calls = 0;
  const updates: TransferProgress[] = [];
  const bytes = await downloadBridgeFile("http://fixture", { ...base, maxRetries: 3,
    onProgress: async (p) => { updates.push(p); },
    fetcher: async (_url, init) => {
      if (calls++ === 0) {
        let pulls = 0;
        return new Response(new ReadableStream({ pull(c) { if (pulls++ === 0) c.enqueue(new Uint8Array([1, 2])); else c.error(new Error("connection reset")); } }, { highWaterMark: 0 }), { headers: { "content-length": "5", etag: '"same-file"' } });
      }
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("range"), "bytes=2-");
      assert.equal(headers.get("if-range"), '"same-file"');
      return new Response(new Uint8Array([3, 4, 5]), { status: 206, headers: { "content-length": "3", "content-range": "bytes 2-4/5", etag: '"same-file"' } });
    },
  });
  assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
  assert.equal(calls, 2);
  assert.ok(updates.some((p) => p.retry === 1 && p.received === 2));
});

test("a server ignoring Range cannot silently corrupt the resumed file", async () => {
  let calls = 0;
  await assert.rejects(downloadBridgeFile("http://fixture", { ...base, maxRetries: 3, fetcher: async () => {
    calls++;
    return new Response(new Uint8Array([1, 2]), { headers: { "content-length": "5", etag: '"same-file"' } });
  } }), /续传范围或文件标识不一致/);
  assert.equal(calls, 2);
});

test("retry count is bounded and terminal HTTP errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(downloadBridgeFile("http://fixture", { ...base, maxRetries: 3, fetcher: async () => { calls++; throw new Error("offline"); } }), /offline/);
  assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(downloadBridgeFile("http://fixture", { ...base, maxRetries: 3, fetcher: async () => { calls++; return new Response(null, { status: 404 }); } }), /404/);
  assert.equal(calls, 1);
});

test("remote cleanup is requested after success and after final transfer failure", async () => {
  const previous = globalThis.fetch;
  try {
    for (const succeed of [true, false]) {
      let cleaned = 0;
      globalThis.fetch = async (url) => {
        const path = String(url);
        if (path.endsWith("/next-wallpaper")) return Response.json({ data: { id: "fixture", token: "dl-fixture", fileSize: 3, downloadUrl: "/api/bridge/download/dl-fixture" } });
        if (path.endsWith("/complete")) { cleaned++; return Response.json({ data: { ok: true } }); }
        return new Response(succeed ? "abc" : "a", { headers: { "content-length": "3" } });
      };
      const configService = { get: (key: string) => key === "WALLPOST_BASE_URL" ? "http://fixture" : key === "WALLPOST_BRIDGE_KEY" ? "fixture-key" : undefined } as unknown as ConfigService;
      const run = fetchAutoSource("wallpost", { exclude: [], config: {}, configService });
      if (succeed) {
        const item = await run;
        assert.equal(await readFile(item.filePath, "utf8"), "abc");
        await unlink(item.filePath);
        await unlink(`${item.filePath}.json`);
      }
      else await assert.rejects(run, /传输不完整/);
      assert.equal(cleaned, 1);
    }
  } finally { globalThis.fetch = previous; }
});
