import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { readdir, lstat, unlink } from "node:fs/promises";
import { join } from "node:path";

export const activeTempFiles = new Set<string>();
export const TEMP_TTL_MS = 24 * 60 * 60_000;

/** Only flat, application-owned temporary directories; never follows symlinks. */
export async function cleanExpiredTempFiles(dir: string, now = Date.now()) {
  const names = await readdir(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const name of names) {
    const path = join(dir, name);
    if (activeTempFiles.has(path)) continue;
    const info = await lstat(path).catch(() => null);
    if (info?.isFile() && info.mtimeMs < now - TEMP_TTL_MS && !activeTempFiles.has(path)) await unlink(path).catch(() => undefined);
  }
}

@Injectable()
export class TempCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly logger = new Logger(TempCleanupService.name);
  onModuleInit() {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), 10 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  private async sweep() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const name of ["tmp-uploads", "tmp-bridge"]) {
        await cleanExpiredTempFiles(join(process.cwd(), "storage", name));
      }
    } catch (error) { this.logger.warn(`临时文件清理失败：${(error as Error).message}`); }
    finally { this.busy = false; }
  }
}
