import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { lstat, realpath, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { LeaseBusyError, WorkLeaseService } from "../sources/work-lease.service";
import { BaiduStorageService } from "../storage/baidu-storage.service";
import { QuarkStorageService } from "../storage/quark-storage.service";
import { StorageAccountService } from "../storage/storage-account.service";
import { digest, type DriveState } from "./wallmuse.schemas";

const DAY = 86_400_000;
export const UNUSED_RETENTION_MS = 3 * DAY;
export const ORIGINAL_RETENTION_MS = 7 * DAY;

// Malformed historical revisions block deletion rather than silently losing references.
export function referencedByRevision(revisions: Array<{ payload: unknown }>, assetId: string) {
  return revisions.some(({ payload }) => {
    const assets = (payload as { assets?: unknown } | null)?.assets;
    return !Array.isArray(assets) || assets.some((asset) => !asset || typeof asset.id !== "string" || asset.id === assetId);
  });
}

export function cleanupDecision(asset: any, now = Date.now()): "discard" | "original" | null {
  if (asset.wallpaper.articleAssets.length !== 1 || !/^originals\/wm-[a-f0-9-]+\.[a-z0-9]+$/.test(asset.wallpaper.assetPath || "")) return null;
  if (!asset.article.jobs.length || asset.article.jobs.some((job: any) => !["done", "cancelled"].includes(job.status))) return null;
  const lastUse = Math.max(new Date(asset.createdAt).getTime(), ...asset.article.jobs.map((job: any) => new Date(job.updatedAt).getTime()));
  if (!Number.isFinite(lastUse)) return null;
  const referenced = referencedByRevision(asset.article.revisions, asset.id);
  if (["rejected", "off_theme", "near_duplicate", "not_anime"].includes(asset.state) && !referenced && asset.wallpaper.status !== "published") {
    return now - lastUse >= UNUSED_RETENTION_MS ? "discard" : null;
  }
  if (asset.state === "ready" && now - lastUse >= (referenced ? ORIGINAL_RETENTION_MS : UNUSED_RETENTION_MS)) return "original";
  return null;
}

/** Only generated WallMuse files, never uploaded user files or external paths. */
export async function unlinkWallMuseFile(storageRoot: string, relative: string): Promise<number> {
  if (!/^(?:public\/originals\/wm-[a-f0-9-]+\.[a-z0-9]+|public\/covers\/wm-[a-f0-9-]+\.jpg|wallmuse\/article-images\/[a-f0-9-]+\.jpg)$/.test(relative)) throw new Error("拒绝清理非 WallMuse 文件");
  const root = await realpath(storageRoot);
  const target = resolve(storageRoot, relative);
  let info;
  try { info = await lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("拒绝清理非普通文件");
  const parent = await realpath(dirname(target));
  if (!parent.startsWith(root + sep)) throw new Error("清理路径超出素材目录");
  await unlink(target);
  return info.size;
}

@Injectable()
export class WallMuseCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WallMuseCleanupService.name);
  private readonly storageRoot = join(process.cwd(), "storage");
  private timer?: NodeJS.Timeout;
  private busy = false;
  private cursor?: string;
  constructor(private readonly prisma: PrismaService, private readonly leases: WorkLeaseService,
    private readonly accounts: StorageAccountService, private readonly baidu: BaiduStorageService,
    private readonly quark: QuarkStorageService) {}

  onModuleInit() {
    // Delay the first sweep so deployment and startup work can settle.
    this.timer = setInterval(() => void this.sweep(), 60 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private include = { wallpaper: { include: { storageLinks: true, articleAssets: { select: { id: true } } } },
    article: { include: { jobs: { select: { status: true, updatedAt: true } }, revisions: { select: { payload: true } } } } } as const;

  /** Read-only verification in the original account; never creates uploads or shares. */
  async backupVerified(asset: any): Promise<boolean> {
    const drives = Object.entries(asset.drives as DriveState);
    if (!drives.length || !asset.wallpaper.fileSize || Number(asset.wallpaper.fileSize) > Number.MAX_SAFE_INTEGER) return false;
    for (const [provider, drive] of drives) {
      if (!drive || drive.phase !== "shared" || !drive.url || !["baidu", "quark"].includes(provider)) return false;
      if (!asset.wallpaper.storageLinks.some((link: any) => link.isActive && link.provider === provider && link.storageAccountId === drive.accountId && link.url === drive.url)) return false;
      const account = await this.accounts.getAccountForProvider(provider as "baidu" | "quark", drive.accountId);
      if (!account || account.id !== drive.accountId) return false;
      const size = Number(asset.wallpaper.fileSize);
      if (provider === "baidu") {
        if (!drive.remotePath) return false;
        const listing = await this.baidu.list(drive.remotePath.slice(0, drive.remotePath.lastIndexOf("/")), account);
        if (listing.items.filter((item) => !item.isDir && item.path === drive.remotePath && item.size === size).length !== 1) return false;
      } else {
        const fid = await this.quark.searchFileFid(basename(asset.wallpaper.assetPath), account, size);
        if (!drive.fids?.includes(fid)) return false;
      }
    }
    return true;
  }

  async sweep() {
    if (this.busy) return;
    this.busy = true;
    let removed = 0, bytes = 0, held = 0;
    try {
      await this.leases.run("wallmuse-cleanup", async () => {
        const rows = await this.prisma.wallMuseAsset.findMany({ where: {
          state: { in: ["ready", "rejected", "off_theme", "near_duplicate", "not_anime"] }, createdAt: { lt: new Date(Date.now() - UNUSED_RETENTION_MS) },
          wallpaper: { assetPath: { startsWith: "originals/wm-" } },
          article: { jobs: { none: { status: { notIn: ["done", "cancelled"] } } } },
        }, include: this.include, orderBy: { id: "asc" }, take: 20, ...(this.cursor ? { cursor: { id: this.cursor }, skip: 1 } : {}) });
        this.cursor = rows.length === 20 ? rows.at(-1)!.id : undefined;
        for (const asset of rows) {
          try {
            const decision = cleanupDecision(asset);
            if (!decision || (decision === "original" && !(await this.backupVerified(asset)))) { held++; continue; }
            await this.leases.run("wallmuse-worker", async (fence) => {
              await this.leases.run("storage-transfers", async (storageFence) => {
                const fresh = await this.prisma.wallMuseAsset.findUnique({ where: { id: asset.id }, include: this.include });
                if (!fresh || cleanupDecision(fresh) !== decision || fresh.wallpaper.assetPath !== asset.wallpaper.assetPath || digest(fresh.drives) !== digest(asset.drives) || digest(fresh.wallpaper.storageLinks) !== digest(asset.wallpaper.storageLinks)) { held++; return; }
                await fence.assert(); await storageFence.assert();
                // Keep compact article images and covers for every ready asset, including
                // historical versions and future re-selection. Only rejected images lose them.
                let freed = await unlinkWallMuseFile(this.storageRoot, "public/" + fresh.wallpaper.assetPath);
                if (decision === "discard") {
                  if (fresh.wallpaper.coverPath) freed += await unlinkWallMuseFile(this.storageRoot, "public/" + fresh.wallpaper.coverPath);
                  freed += await unlinkWallMuseFile(this.storageRoot, "wallmuse/" + fresh.publishPath);
                }
                await this.prisma.$transaction(async (tx) => {
                  await fence.assert(tx); await storageFence.assert(tx);
                  await tx.wallpaper.update({ where: { id: fresh.wallpaperId }, data: { assetPath: null, ...(decision === "discard" ? { coverPath: null, coverUrl: null } : {}) } });
                  if (decision === "discard") await tx.wallMuseAsset.update({ where: { id: fresh.id }, data: { state: "cleaned" } });
                });
                removed++; bytes += freed;
                this.logger.log("已清理文章素材 " + fresh.id + "，类型 " + decision + "，释放 " + freed + " 字节");
              });
            });
          } catch (error) {
            held++;
            if (!(error instanceof LeaseBusyError)) this.logger.warn("素材 " + asset.id + " 清理未完成，已保留待下次核对；未删除网盘文件");
          }
        }
      });
    } catch (error) {
      if (!(error instanceof LeaseBusyError)) this.logger.warn("文章原图清理检查失败，将于下次重试");
    } finally {
      this.busy = false;
      this.logger.log("原图清理完成：" + removed + " 项，释放 " + bytes + " 字节，保留 " + held + " 项");
    }
    return { removed, bytes, held };
  }
}
