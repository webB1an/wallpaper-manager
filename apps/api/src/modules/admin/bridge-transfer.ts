import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { activeTempFiles } from "../../common/temp-cleanup.service";

export function bridgeTransferPath(key: string) {
  return join(process.cwd(), "storage", "tmp-bridge", `${createHash("sha256").update(key).digest("hex")}.part`);
}

export async function removeBridgeTransfer(key: string) {
  const path = bridgeTransferPath(key);
  await Promise.all([path, `${path}.json`, `${path}.json.new`].map((file) => unlink(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  })));
}

export interface TransferProgress {
  received: number;
  total?: number;
  bytesPerSecond: number;
  elapsedSeconds: number;
  retry?: number;
}

type TransferOptions = {
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
  expectedBytes?: number;
  idleTimeoutMs?: number;
  progressIntervalMs?: number;
  onProgress?: (progress: TransferProgress) => Promise<void>;
  fetcher?: typeof fetch;
  maxRetries?: number;
  transferKey?: string;
  retainPartial?: boolean;
};

/** Compatibility helper for small callers/tests. Production consumes the disk path directly. */
export async function downloadBridgeFile(url: string, options: TransferOptions): Promise<Buffer> {
  const transferKey = options.transferKey || randomUUID();
  try { return await readFile(await downloadBridgeFileToDisk(url, { ...options, transferKey })); }
  finally { await removeBridgeTransfer(transferKey); }
}

export async function downloadBridgeFileToDisk(url: string, options: TransferOptions): Promise<string> {
  const key = options.transferKey || randomUUID();
  const path = bridgeTransferPath(key);
  const metaPath = `${path}.json`;
  if (activeTempFiles.has(path)) throw new Error("该文件正在传输，请勿重复启动");
  for (const file of [path, metaPath, `${metaPath}.new`]) activeTempFiles.add(file);
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let succeeded = false;
  let controller = new AbortController();
  const started = Date.now();
  let received = 0;
  let total = options.expectedBytes;
  let etag: string | null = null;
  let deadlineExpired = false;
  let fatal = false;
  const invalid = (message: string): never => { fatal = true; throw new Error(message); };
  let reason = "";
  const abort = (message: string) => { reason = message; controller.abort(new Error(message)); };
  const deadline = setTimeout(() => { deadlineExpired = true; abort("桥接文件传输超过总时限"); }, options.timeoutMs);
  let idle: NodeJS.Timeout;
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => abort("桥接文件传输连续无数据，连接可能中断"), options.idleTimeoutMs ?? 60_000);
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let lastReport = 0;
  let lastBytes = 0;
  let lastSample = started;
  const report = async (force = false) => {
    const now = Date.now();
    if (!force && now - lastReport < (options.progressIntervalMs ?? 5000)) return;
    await options.onProgress?.({ received, total, bytesPerSecond: (received - lastBytes) * 1000 / Math.max(1, now - lastSample), elapsedSeconds: (now - started) / 1000 });
    lastReport = now;
    lastSample = now;
    lastBytes = received;
  };
  try {
    if (total !== undefined && (!Number.isSafeInteger(total) || total <= 0 || total > options.maxBytes)) throw new Error("桥接文件大小无效或超过上传大小上限");
    await mkdir(join(process.cwd(), "storage", "tmp-bridge"), { recursive: true });
    const saved = await readFile(metaPath, "utf8").then((text) => JSON.parse(text)).catch(() => null);
    const size = await stat(path).then((info) => info.size).catch(() => 0);
    if (saved?.url === url && Number.isSafeInteger(saved.total) && saved.total > 0 && saved.total <= options.maxBytes && (total === undefined || total === saved.total)) {
      total = saved.total;
      if (saved.complete && size === total) {
        const now = new Date();
        await Promise.all([path, metaPath].map((file) => utimes(file, now, now)));
        received = size; await report(true); succeeded = true; return path;
      }
      if (typeof saved.etag === "string" && saved.etag && !saved.etag.startsWith("W/") && size > 0 && size < total!) {
        received = size;
        etag = saved.etag;
      }
    }
    file = await open(path, received ? "r+" : "w", 0o600);
    const saveMetadata = async (complete: boolean) => {
      await file!.sync();
      await writeFile(`${metaPath}.new`, JSON.stringify({ url, etag, total, complete }), { mode: 0o600 });
      await rename(`${metaPath}.new`, metaPath);
    };
    lastBytes = received;
    await report(true);
    for (let attempt = 0; ; attempt++) {
      if (deadlineExpired) throw new Error("桥接文件传输超过总时限");
      controller = new AbortController();
      reason = "";
      try {
        resetIdle();
        const offset = received;
        const response: Response = await (options.fetcher ?? fetch)(url, { headers: { ...options.headers, "Accept-Encoding": "identity", ...(offset ? { Range: `bytes=${offset}-`, "If-Range": etag! } : {}) }, signal: controller.signal });
        if (response.status >= 400 && response.status < 500) invalid(`桥接文件不可续传（HTTP ${response.status}）`);
        if (!response.ok) throw new Error(`桥接文件下载失败（HTTP ${response.status}）`);
        if (!response.body) throw new Error("桥接没有返回文件内容");
        reader = response.body.getReader();
        if (offset) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") || "");
          if (response.status !== 206 || !range || Number(range[1]) !== offset || Number(range[2]) !== Number(range[3]) - 1 || Number(range[3]) !== total || response.headers.get("etag") !== etag) invalid("桥接续传范围或文件标识不一致，已停止以避免文件损坏");
        } else {
          if (response.status !== 200) invalid("桥接返回了非预期的文件范围");
          etag = response.headers.get("etag");
        }
        const length = response.headers.get("content-length");
        if (length !== null) {
          const declared = Number(length);
          if (!Number.isSafeInteger(declared) || declared <= 0 || declared + offset > options.maxBytes) invalid("桥接文件大小无效或超过上传大小上限");
          if (total !== undefined && declared + offset !== total) invalid("桥接文件大小与元信息不一致");
          total = declared + offset;
        }
        await saveMetadata(false);
        await report(true);
        while (true) {
          controller.signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          if (!value.byteLength) continue;
          if (received + value.byteLength > options.maxBytes || (total !== undefined && received + value.byteLength > total)) invalid("桥接文件内容超过预期大小");
          let written = 0;
          while (written < value.byteLength) {
            const result = await file.write(value, written, value.byteLength - written, received + written);
            if (!result.bytesWritten) invalid("桥接临时文件写入失败");
            written += result.bytesWritten;
          }
          received += written;
          resetIdle();
          await report();
        }
        controller.signal.throwIfAborted();
        if (!received || (total !== undefined && received !== total)) throw new Error("桥接文件传输不完整");
        total = received;
        await saveMetadata(true);
        await report(true);
        succeeded = true;
        return path;
      } catch (error) {
        if (fatal || deadlineExpired || attempt >= (options.maxRetries ?? 0) || (received > 0 && (!etag || etag.startsWith("W/") || !total || received >= total))) throw error;
        await options.onProgress?.({ received, total, bytesPerSecond: 0, elapsedSeconds: (Date.now() - started) / 1000, retry: attempt + 1 });
      } finally {
        clearTimeout(idle!);
        controller.abort();
        await reader?.cancel().catch(() => undefined);
        reader?.releaseLock();
        reader = undefined;
      }
    }
  } catch (error) {
    throw new Error(`${reason || (error as Error).message}（已接收 ${(received / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ""}，耗时 ${Math.round((Date.now() - started) / 1000)} 秒）`);
  } finally {
    clearTimeout(deadline);
    clearTimeout(idle!);
    controller.abort();
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
    await file?.close();
    try {
      if (!succeeded && (fatal || !options.retainPartial)) await removeBridgeTransfer(key);
    } finally {
      for (const file of [path, metaPath, `${metaPath}.new`]) activeTempFiles.delete(file);
    }
  }
}

export function transferTaskUpdate(value: TransferProgress): { progress: number; message: string } {
  const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
  const percent = value.total ? Math.min(100, value.received / value.total * 100) : undefined;
  const speed = value.bytesPerSecond >= 1048576 ? `${mb(value.bytesPerSecond)} MB/s` : `${(value.bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return {
    progress: percent === undefined ? 10 : Math.min(29, 10 + Math.floor(percent * 0.19)),
    message: `${value.retry ? `连接中断，保留已下载数据，准备第 ${value.retry} 次续传` : "桥接已下载完成，正在回传"}：${mb(value.received)}${value.total ? ` / ${mb(value.total)}` : ""} MB${percent === undefined ? "" : `（${percent.toFixed(1)}%）`}，${speed}，已用 ${Math.round(value.elapsedSeconds)} 秒${value.elapsedSeconds >= 30 && value.bytesPerSecond < 64 * 1024 ? "；回传速度偏慢" : ""}`,
  };
}
