export interface TransferProgress {
  received: number;
  total?: number;
  bytesPerSecond: number;
  elapsedSeconds: number;
}

export async function downloadBridgeFile(url: string, options: {
  headers: Record<string, string>;
  timeoutMs: number;
  maxBytes: number;
  expectedBytes?: number;
  idleTimeoutMs?: number;
  progressIntervalMs?: number;
  onProgress?: (progress: TransferProgress) => Promise<void>;
  fetcher?: typeof fetch;
}): Promise<Buffer> {
  const controller = new AbortController();
  const started = Date.now();
  let received = 0;
  let total = options.expectedBytes;
  let reason = "";
  const abort = (message: string) => { reason = message; controller.abort(new Error(message)); };
  const deadline = setTimeout(() => abort("桥接文件传输超过总时限"), options.timeoutMs);
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
    await report(true);
    resetIdle();
    const response = await (options.fetcher ?? fetch)(url, { headers: { ...options.headers, "Accept-Encoding": "identity" }, signal: controller.signal });
    if (!response.ok) throw new Error(`桥接文件下载失败（HTTP ${response.status}）`);
    if (!response.body) throw new Error("桥接没有返回文件内容");
    reader = response.body.getReader();
    const length = response.headers.get("content-length");
    if (length !== null) {
      const declared = Number(length);
      if (!Number.isSafeInteger(declared) || declared <= 0 || declared > options.maxBytes) throw new Error("桥接文件大小无效或超过上传大小上限");
      if (total !== undefined && declared !== total) throw new Error("桥接文件大小与元信息不一致");
      total = declared;
    }
    await report(true);
    const chunks: Buffer[] = [];
    while (true) {
      controller.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (!value.byteLength) continue;
      received += value.byteLength;
      if (received > options.maxBytes || (total !== undefined && received > total)) throw new Error("桥接文件内容超过预期大小");
      chunks.push(Buffer.from(value));
      resetIdle();
      await report();
    }
    controller.signal.throwIfAborted();
    if (!received || (total !== undefined && received !== total)) throw new Error("桥接文件传输不完整");
    await report(true);
    return Buffer.concat(chunks, received);
  } catch (error) {
    throw new Error(`${reason || (error as Error).message}（已接收 ${(received / 1048576).toFixed(1)} MB${total ? ` / ${(total / 1048576).toFixed(1)} MB` : ""}，耗时 ${Math.round((Date.now() - started) / 1000)} 秒）`);
  } finally {
    clearTimeout(deadline);
    clearTimeout(idle!);
    controller.abort();
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
  }
}

export function transferTaskUpdate(value: TransferProgress): { progress: number; message: string } {
  const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
  const percent = value.total ? Math.min(100, value.received / value.total * 100) : undefined;
  const speed = value.bytesPerSecond >= 1048576 ? `${mb(value.bytesPerSecond)} MB/s` : `${(value.bytesPerSecond / 1024).toFixed(1)} KB/s`;
  return {
    progress: percent === undefined ? 10 : Math.min(29, 10 + Math.floor(percent * 0.19)),
    message: `桥接已下载完成，正在回传：${mb(value.received)}${value.total ? ` / ${mb(value.total)}` : ""} MB${percent === undefined ? "" : `（${percent.toFixed(1)}%）`}，${speed}，已用 ${Math.round(value.elapsedSeconds)} 秒${value.elapsedSeconds >= 30 && value.bytesPerSecond < 64 * 1024 ? "；回传速度偏慢" : ""}`,
  };
}
