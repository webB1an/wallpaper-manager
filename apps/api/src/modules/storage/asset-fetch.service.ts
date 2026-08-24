import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageLink, StorageProvider, TaskStatus, Wallpaper } from "@prisma/client";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import { extname, join } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { TasksService } from "../tasks/tasks.service";
import { BaiduStorageService } from "./baidu-storage.service";
import { QuarkStorageService } from "./quark-storage.service";
import { ManagedStorageAccount, StorageAccountService } from "./storage-account.service";

export interface AssetEnsureResult {
  ready: boolean;
  fetching: boolean;
  message?: string;
}

const MEDIA_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".mov", ".webm"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];
const FAILED_RETRY_COOLDOWN_MS = 10 * 60_000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60_000;

@Injectable()
export class AssetFetchService implements OnModuleInit {
  private readonly logger = new Logger(AssetFetchService.name);
  // 回源走外部 CLI，进程很重：模块级串行队列，同一时刻只跑一个。
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly quark: QuarkStorageService,
    private readonly baidu: BaiduStorageService,
    private readonly accounts: StorageAccountService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    void this.cleanupFetchedAssets();
    const timer = setInterval(() => void this.cleanupFetchedAssets(), CLEANUP_INTERVAL_MS);
    timer.unref();
  }

  /** 确保壁纸源文件在服务器上；缺失时触发一次网盘回源（异步）。 */
  async ensureAsset(wallpaperId: string): Promise<AssetEnsureResult> {
    const wallpaper = await this.prisma.wallpaper.findUnique({
      where: { id: wallpaperId },
      include: { storageLinks: { where: { isActive: true } } },
    });
    if (!wallpaper) return { ready: false, fetching: false, message: "壁纸不存在" };
    if (wallpaper.assetPath && existsSync(this.assetAbsolutePath(wallpaper.assetPath))) {
      return { ready: true, fetching: false };
    }

    const recentTasks = await this.prisma.task.findMany({
      where: { type: "asset_fetch", status: { in: [TaskStatus.queued, TaskStatus.running] } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    if (recentTasks.some((task) => taskWallpaperId(task.payload) === wallpaperId)) {
      return { ready: false, fetching: true };
    }

    const failedTasks = await this.prisma.task.findMany({
      where: { type: "asset_fetch", status: TaskStatus.failed, updatedAt: { gte: new Date(Date.now() - FAILED_RETRY_COOLDOWN_MS) } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const recentFailure = failedTasks.find((task) => taskWallpaperId(task.payload) === wallpaperId);
    if (recentFailure) {
      return { ready: false, fetching: false, message: recentFailure.error || "网盘回源失败，请稍后再试" };
    }

    const links = [...wallpaper.storageLinks].sort((a, b) => (a.provider === StorageProvider.quark ? -1 : 1) - (b.provider === StorageProvider.quark ? -1 : 1));
    if (!links.length) {
      return { ready: false, fetching: false, message: "该壁纸暂无源文件" };
    }

    const task = await this.tasks.create("asset_fetch", { wallpaperId }, "开始从网盘回源");
    this.enqueue(task.id, wallpaperId);
    return { ready: false, fetching: true };
  }

  private enqueue(taskId: string, wallpaperId: string) {
    this.queue = this.queue
      .catch(() => undefined)
      .then(() => this.runFetch(taskId, wallpaperId))
      .catch((error) => this.logger.error(`asset_fetch ${taskId} 异常：${(error as Error).message}`));
  }

  private async runFetch(taskId: string, wallpaperId: string) {
    const wallpaper = await this.prisma.wallpaper.findUnique({
      where: { id: wallpaperId },
      include: { storageLinks: { where: { isActive: true } } },
    });
    if (!wallpaper) {
      await this.tasks.update(taskId, { status: "failed", error: "壁纸不存在", message: "回源失败" });
      return;
    }
    await this.tasks.update(taskId, { status: "running", progress: 10, message: "正在从网盘拉取源文件" });

    const tmpDir = join(process.cwd(), "storage", "private", "fetch-tmp", taskId);
    const errors: string[] = [];
    let localPath = "";
    const links = [...wallpaper.storageLinks].sort((a, b) => (a.provider === StorageProvider.quark ? -1 : 1) - (b.provider === StorageProvider.quark ? -1 : 1));

    for (const link of links) {
      try {
        const account = await this.resolveAccount(link);
        localPath = link.provider === StorageProvider.quark
          ? await this.fetchFromQuark(link, wallpaper, account)
          : await this.fetchFromBaidu(link, tmpDir, account);
        if (localPath) break;
      } catch (error) {
        errors.push(`${link.provider}: ${(error as Error).message}`);
      }
    }

    if (!localPath) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      await this.tasks.update(taskId, {
        status: "failed",
        error: errors.join("; ") || "网盘回源失败",
        message: "回源失败",
      });
      return;
    }

    try {
      const saved = await this.persistFetchedAsset(wallpaper, localPath);
      await this.tasks.update(taskId, {
        status: "success",
        progress: 100,
        message: "回源完成",
        result: saved,
      });
    } catch (error) {
      await this.tasks.update(taskId, { status: "failed", error: (error as Error).message, message: "回源失败" });
    } finally {
      // 已复制进 fetched/ 的本地原件（夸克链路在 quark-runtime 下）一并清掉，避免堆积
      if (localPath) await unlink(localPath).catch(() => undefined);
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async fetchFromQuark(link: StorageLink, wallpaper: Wallpaper, account?: ManagedStorageAccount): Promise<string> {
    const passcode = link.passcode || undefined;
    const files = await this.quark.shareDetail(link.url, passcode, account);
    const target = pickShareFile(files, wallpaper.type === "live");
    if (!target) throw new Error("分享链接里没有可下载的文件");
    // 转存副本集中到固定目录，CLI 无删除命令，便于定期在夸克网盘里手动清空
    const saveDir = this.config.get<string>("QUARK_FETCH_SAVE_DIR")?.trim() || "/wallpaper-fetch-tmp";
    await this.quark.saveas(link.url, [target.fid], passcode, account, saveDir);
    const fid = await this.quark.searchFileFid(target.fileName, account);
    return this.quark.readFileToLocal(fid, account);
  }

  private async fetchFromBaidu(link: StorageLink, tmpDir: string, account?: ManagedStorageAccount): Promise<string> {
    const dir = join(tmpDir, "baidu");
    // 转存副本集中到固定目录（相对 /apps/bdpan），CLI 无删除命令，便于定期手动清空
    const transferDir = this.config.get<string>("BAIDU_FETCH_TRANSFER_DIR")?.trim() || "wallpaper-fetch-tmp";
    await this.baidu.downloadShare(link.url, dir, link.passcode || undefined, account, transferDir);
    const localPath = await pickLargestMediaFile(dir);
    if (!localPath) throw new Error("百度网盘下载完成但未找到媒体文件");
    return localPath;
  }

  private async resolveAccount(link: StorageLink): Promise<ManagedStorageAccount | undefined> {
    const account = await this.accounts.getAccountForProvider(link.provider, link.storageAccountId || undefined);
    return account ?? undefined;
  }

  private async persistFetchedAsset(wallpaper: Wallpaper, localPath: string) {
    const ext = extname(localPath).toLowerCase() || (wallpaper.type === "live" ? ".mp4" : ".jpg");
    const dir = this.fetchedDir();
    await mkdir(dir, { recursive: true });
    const relative = `fetched/${wallpaper.id}${ext}`;
    const destination = join(dir, `${wallpaper.id}${ext}`);
    await copyFile(localPath, destination);
    const size = (await stat(destination)).size;
    await this.prisma.wallpaper.update({
      where: { id: wallpaper.id },
      data: { assetPath: relative, fileSize: BigInt(size), mimeType: mimeTypeOf(ext) },
    });
    return { assetPath: relative, fileSize: size };
  }

  /** 定期清理过期的回源缓存文件；只碰 fetched/ 目录，绝不动 admin 上传的原始资源。 */
  async cleanupFetchedAssets() {
    try {
      const dir = this.fetchedDir();
      if (!existsSync(dir)) return;
      const ttlMs = this.ttlDays() * 24 * 60 * 60_000;
      const now = Date.now();
      const removed: string[] = [];
      for (const name of await readdir(dir)) {
        const full = join(dir, name);
        const info = await stat(full).catch(() => null);
        if (!info?.isFile()) continue;
        if (now - info.mtimeMs > ttlMs) {
          await unlink(full).catch(() => undefined);
          removed.push(`fetched/${name}`);
        }
      }
      const holders = await this.prisma.wallpaper.findMany({
        where: { assetPath: { startsWith: "fetched/" } },
        select: { id: true, assetPath: true },
      });
      for (const holder of holders) {
        if (!holder.assetPath) continue;
        const missing = removed.includes(holder.assetPath) || !existsSync(this.assetAbsolutePath(holder.assetPath));
        if (missing) {
          await this.prisma.wallpaper.update({ where: { id: holder.id }, data: { assetPath: null } });
        }
      }
      if (removed.length) this.logger.log(`回源缓存清理：删除 ${removed.length} 个过期文件`);
    } catch (error) {
      this.logger.warn(`回源缓存清理失败：${(error as Error).message}`);
    }
  }

  private fetchedDir() {
    return join(process.cwd(), "storage", "public", "fetched");
  }

  private assetAbsolutePath(assetPath: string) {
    return join(process.cwd(), "storage", "public", assetPath);
  }

  private ttlDays() {
    const value = Number(this.config.get<string>("FETCHED_ASSET_TTL_DAYS") || 7);
    return Number.isFinite(value) && value > 0 ? value : 7;
  }
}

function taskWallpaperId(payload: unknown) {
  return String((payload as { wallpaperId?: string } | null)?.wallpaperId || "");
}

function pickShareFile(files: Array<{ fid: string; fileName: string; size: number; isDir: boolean }>, preferVideo: boolean) {
  const candidates = files.filter((file) => !file.isDir && file.fileName);
  if (!candidates.length) return null;
  const preferredExts = preferVideo ? VIDEO_EXTENSIONS : MEDIA_EXTENSIONS.filter((ext) => !VIDEO_EXTENSIONS.includes(ext));
  const preferred = candidates.filter((file) => preferredExts.includes(extname(file.fileName).toLowerCase()));
  const pool = preferred.length ? preferred : candidates;
  return pool.sort((a, b) => b.size - a.size)[0];
}

async function pickLargestMediaFile(dir: string): Promise<string> {
  let best = "";
  let bestSize = -1;
  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!MEDIA_EXTENSIONS.includes(extname(entry.name).toLowerCase())) continue;
      const size = (await stat(full)).size;
      if (size > bestSize) {
        best = full;
        bestSize = size;
      }
    }
  }
  await walk(dir);
  return best;
}

function mimeTypeOf(ext: string) {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
  };
  return map[ext] || "application/octet-stream";
}
