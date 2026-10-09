import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageProvider } from "@prisma/client";
import { lstat, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { LeaseBusyError, WorkLeaseService } from "../sources/work-lease.service";

const DAY = 86_400_000;
const SWEEP_LIMIT = 200;

/** 只删 originals/ 一层下的普通上传文件；WallMuse 素材（wm- 前缀）归 WallMuseCleanupService 管。 */
export async function unlinkOriginalFile(publicRoot: string, relative: string): Promise<number> {
  if (!/^originals\/(?!wm-)[^/\\]+\.[A-Za-z0-9]+$/.test(relative)) throw new Error("拒绝清理 originals 之外的文件");
  const root = await realpath(publicRoot);
  const target = resolve(publicRoot, relative);
  let info;
  try { info = await lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("拒绝清理非普通文件");
  const parent = await realpath(dirname(target));
  if (!parent.startsWith(root + sep)) throw new Error("清理路径超出资源目录");
  await unlink(target);
  return info.size;
}

/**
 * 非 WallMuse 原图（管理端上传 originals/<ts>-<id>.* 与来源下载 originals/auto-*.jpg）的周期清理。
 * 上架成功路径早已即时删除，这里兜底回收异常路径残留：
 * 只有网盘已有有效备份（活跃 baidu/quark 链接）且文件超过保留期才删，没有备份的原图绝不清理。
 */
@Injectable()
export class OriginalsCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OriginalsCleanupService.name);
  private readonly publicRoot = join(process.cwd(), "storage", "public");
  private timer?: NodeJS.Timeout;
  private busy = false;
  private cursor?: string;
  constructor(private readonly prisma: PrismaService, private readonly leases: WorkLeaseService, private readonly config: ConfigService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), 60 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private retentionMs() {
    const value = Number(this.config.get<string>("ORIGINALS_RETENTION_DAYS") || 7);
    return Number.isFinite(value) && value > 0 ? value * DAY : 7 * DAY;
  }

  /** 从未成功备份的死资源（任务失败后被放弃、草稿未处理）的绝对保留上限。 */
  private unbackedRetentionMs() {
    const value = Number(this.config.get<string>("ORIGINALS_UNBACKED_RETENTION_DAYS") || 30);
    return Number.isFinite(value) && value > 0 ? value * DAY : 30 * DAY;
  }

  async sweep() {
    if (this.busy) return;
    this.busy = true;
    const retention = this.retentionMs();
    const cutoff = new Date(Date.now() - retention);
    const unbackedRetention = this.unbackedRetentionMs();
    const unbackedCutoff = new Date(Date.now() - unbackedRetention);
    let removed = 0, bytes = 0, held = 0;
    try {
      await this.leases.run("originals-cleanup", async () => {
        removed += await this.sweepBacked(cutoff, retention, (delta) => { bytes += delta.bytes; held += delta.held; });
        removed += await this.sweepUnbacked(unbackedCutoff, unbackedRetention, (delta) => { bytes += delta.bytes; held += delta.held; });
      });
    } catch (error) {
      if (!(error instanceof LeaseBusyError)) this.logger.warn(`原图周期清理失败，将于下次重试：${(error as Error).message}`);
    } finally {
      this.busy = false;
      if (removed || held) this.logger.log(`原图周期清理完成：删除 ${removed} 项，释放 ${bytes} 字节，保留 ${held} 项`);
    }
    return { removed, bytes, held };
  }

  /** 有活跃网盘备份的原图：超过保留期即回收（正常路径已即时删除，这里只兜异常残留）。 */
  private async sweepBacked(cutoff: Date, retention: number, tally: (delta: { bytes: number; held: number }) => void) {
    let removed = 0;
    const rows = await this.prisma.wallpaper.findMany({
      where: {
        assetPath: { startsWith: "originals/", not: { startsWith: "originals/wm-" } },
        articleAssets: { none: {} },
        // 网盘备份是删除前提：没有有效备份记录的原图走无备份上限，不在这里删。
        storageLinks: { some: { isActive: true, provider: { in: [StorageProvider.baidu, StorageProvider.quark] } } },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, assetPath: true },
      orderBy: { id: "asc" },
      take: SWEEP_LIMIT,
      ...(this.cursor ? { cursor: { id: this.cursor }, skip: 1 } : {}),
    });
    this.cursor = rows.length === SWEEP_LIMIT ? rows.at(-1)!.id : undefined;
    for (const row of rows) {
      if (!row.assetPath) continue;
      try {
        const freed = await this.deleteOriginal(row, retention);
        if (freed.ok) { removed++; tally({ bytes: freed.size, held: 0 }); } else tally({ bytes: 0, held: 1 });
      } catch (error) {
        tally({ bytes: 0, held: 1 });
        if (!(error instanceof LeaseBusyError)) this.logger.warn(`原图 ${row.assetPath} 清理未完成，保留待下次核对：${(error as Error).message}`);
      }
    }
    return removed;
  }

  /** 从未成功备份的原图是唯一副本：只按绝对上限回收，删除前写告警日志留痕。 */
  private async sweepUnbacked(cutoff: Date, retention: number, tally: (delta: { bytes: number; held: number }) => void) {
    let removed = 0;
    const rows = await this.prisma.wallpaper.findMany({
      where: {
        assetPath: { startsWith: "originals/", not: { startsWith: "originals/wm-" } },
        articleAssets: { none: {} },
        storageLinks: { none: { isActive: true, provider: { in: [StorageProvider.baidu, StorageProvider.quark] } } },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, assetPath: true },
      orderBy: { id: "asc" },
      take: SWEEP_LIMIT,
    });
    const days = Math.round(retention / DAY);
    for (const row of rows) {
      if (!row.assetPath) continue;
      try {
        const freed = await this.deleteOriginal(row, retention);
        if (freed.ok) {
          removed++;
          tally({ bytes: freed.size, held: 0 });
          this.logger.warn(`原图 ${row.assetPath} 超过 ${days} 天没有任何网盘备份，已按保留上限回收（资源 ID ${row.id}）`);
        } else tally({ bytes: 0, held: 1 });
      } catch (error) {
        tally({ bytes: 0, held: 1 });
        if (!(error instanceof LeaseBusyError)) this.logger.warn(`无备份原图 ${row.assetPath} 清理未完成：${(error as Error).message}`);
      }
    }
    return removed;
  }

  /** 共享删除动作：复核指针一致 → mtime 冷却检查 → 删文件 → 清指针。 */
  private async deleteOriginal(row: { id: string; assetPath: string | null }, retention: number): Promise<{ ok: boolean; size: number }> {
    if (!row.assetPath) return { ok: false, size: 0 };
    // 删除前复核，避免与进行中的处理任务竞态。
    const fresh = await this.prisma.wallpaper.findUnique({ where: { id: row.id }, select: { assetPath: true, articleAssets: { select: { id: true } } } });
    if (!fresh || fresh.assetPath !== row.assetPath || fresh.articleAssets.length) return { ok: false, size: 0 };
    const absolute = resolve(this.publicRoot, row.assetPath);
    let info;
    try { info = await lstat(absolute); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // 文件早已不存在，只回收数据库指针。
        await this.prisma.wallpaper.update({ where: { id: row.id }, data: { assetPath: null } });
        return { ok: true, size: 0 };
      }
      throw error;
    }
    // 文件 mtime 兜底：最近被写过的文件（含进行中的任务）本轮不动。
    if (!info.isFile() || info.isSymbolicLink() || info.mtimeMs >= Date.now() - retention) return { ok: false, size: 0 };
    const freed = await unlinkOriginalFile(this.publicRoot, row.assetPath);
    await this.prisma.wallpaper.update({ where: { id: row.id }, data: { assetPath: null } });
    return { ok: true, size: freed };
  }
}
