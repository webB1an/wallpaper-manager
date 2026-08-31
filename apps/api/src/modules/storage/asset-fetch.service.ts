import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageLink, StorageProvider, TaskStatus, Wallpaper } from "@prisma/client";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm, stat, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { runCli } from "../../common/cli";
import { buildWallpaperRemoteDir } from "../../common/wallpaper-path";
import { PrismaService } from "../prisma/prisma.service";
import { TasksService } from "../tasks/tasks.service";
import { BaiduStorageService, baiduApiPath } from "./baidu-storage.service";
import { QuarkStorageService } from "./quark-storage.service";
import { ManagedStorageAccount, StorageAccountService } from "./storage-account.service";

export interface AssetEnsureResult {
  ready: boolean;
  fetching: boolean;
  message?: string;
}

const MEDIA_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".heic", ".mp4", ".mov", ".webm", ".m4v"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v"];
const ARCHIVE_EXTENSIONS = [".zip", ".rar", ".7z", ".tar", ".gz", ".tgz"];
// 回源失败后允许快速重试（原 10 分钟太久，用户下载会一直吃到缓存错误）。
const FAILED_RETRY_COOLDOWN_MS = 3 * 60_000;
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
    void this.failStaleFetchTasks();
    void this.cleanupFetchedAssets();
    const timer = setInterval(() => void this.cleanupFetchedAssets(), CLEANUP_INTERVAL_MS);
    timer.unref();
  }

  /** 服务重启后内存队列清空，把残留的 running/queued 回源任务标记为失败，避免 ensureAsset 永远返回 preparing。 */
  private async failStaleFetchTasks() {
    try {
      const stale = await this.prisma.task.updateMany({
        where: { type: "asset_fetch", status: { in: [TaskStatus.queued, TaskStatus.running] } },
        data: { status: TaskStatus.failed, error: "服务重启，回源任务中断，请稍后重试", message: "回源失败" },
      });
      if (stale.count) this.logger.warn(`清理 ${stale.count} 个未完成的回源任务`);
    } catch (error) {
      this.logger.warn(`清理未完成回源任务失败：${(error as Error).message}`);
    }
  }

  /** 确保壁纸源文件在服务器上；缺失时触发一次网盘回源（异步）。 */
  async ensureAsset(wallpaperId: string): Promise<AssetEnsureResult> {
    const wallpaper = await this.prisma.wallpaper.findUnique({
      where: { id: wallpaperId },
      include: { storageLinks: { where: { isActive: true } }, tags: { include: { tag: true } } },
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

    const links = [...wallpaper.storageLinks].sort((a, b) => (a.provider === StorageProvider.baidu ? -1 : 1) - (b.provider === StorageProvider.baidu ? -1 : 1));
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
      include: { storageLinks: { where: { isActive: true } }, tags: { include: { tag: true } } },
    });
    if (!wallpaper) {
      await this.tasks.update(taskId, { status: "failed", error: "壁纸不存在", message: "回源失败" });
      return;
    }
    await this.tasks.update(taskId, { status: "running", progress: 10, message: "正在从网盘拉取源文件" });

    const tmpDir = join(process.cwd(), "storage", "private", "fetch-tmp", taskId);
    const errors: string[] = [];
    let localPath = "";
    const links = [...wallpaper.storageLinks].sort((a, b) => (a.provider === StorageProvider.baidu ? -1 : 1) - (b.provider === StorageProvider.baidu ? -1 : 1));

    for (const link of links) {
      try {
        const account = await this.resolveAccount(link);
        localPath = link.provider === StorageProvider.quark
          ? await this.fetchFromQuark(link, wallpaper, account)
          : await this.fetchFromBaidu(link, tmpDir, account, wallpaper);
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

  private async fetchFromBaidu(link: StorageLink, tmpDir: string, account: ManagedStorageAccount | undefined, wallpaper: Wallpaper): Promise<string> {
    const dir = join(tmpDir, "baidu");
    const steps: string[] = [];
    const cliOutputs: string[] = [];
    const downloadedPaths: string[] = [];

    if (link.remotePath) {
      // 本账号自己上传的文件：直接用网盘路径下载，避免走分享链接触发“自己的分享链接” errno=13045，导致本地目录为空。
      try {
        const result = await this.baidu.downloadByPath(link.remotePath, dir, account);
        cliOutputs.push(result.stdout);
        downloadedPaths.push(result.localPath);
        steps.push(`按路径下载 ${link.remotePath}`);
      } catch (error) {
        steps.push(`按路径下载失败：${(error as Error).message}`);
        // 网盘路径异常时退回分享链接方式，避免单一路径导致整条回源失败。
        try {
          const result = await this.downloadFromShare(link, dir, account);
          cliOutputs.push(result.stdout);
          downloadedPaths.push(result.localPath);
          steps.push("退回分享链接");
        } catch (shareError) {
          steps.push(`分享链接失败：${(shareError as Error).message}`);
        }
      }
    } else {
      // 第三方分享链接：先转存到固定网盘目录（相对 /apps/bdpan），再下载到本地。
      try {
        const result = await this.downloadFromShare(link, dir, account);
        cliOutputs.push(result.stdout);
        downloadedPaths.push(result.localPath);
        steps.push("分享链接下载");
      } catch (error) {
        steps.push(`分享链接失败：${(error as Error).message}`);
      }
    }

    let localPath = await this.pickDownloadMedia(downloadedPaths, dir);
    let searchDiag = "";
    if (!localPath) {
      // 分享下载为空目录，大概率是同账号分享（errno=13045）。按壁纸文件名在网盘搜到实际路径，再按路径下载。
      const resolved = await this.resolveBaiduBySearch(dir, account, wallpaper).catch((error) => ({ ok: false, detail: `搜索异常：${(error as Error).message}`, localPath: "" }));
      searchDiag = resolved.detail;
      if (resolved.ok) localPath = resolved.localPath || (await this.pickDownloadMedia([...downloadedPaths, resolved.localPath], dir));
    }
    if (!localPath) {
      // search 不可用时，按上传规则重建路径（并在所在目录 ls）快速定位。
      const lsResolved = await this.resolveBaiduByPath(dir, account, wallpaper).catch((error) => ({ ok: false, detail: `路径重建异常：${(error as Error).message}`, localPath: "" }));
      searchDiag = searchDiag ? `${searchDiag}；${lsResolved.detail}` : lsResolved.detail;
      if (lsResolved.ok) localPath = lsResolved.localPath || (await this.pickDownloadMedia([...downloadedPaths, lsResolved.localPath], dir));
    }
    if (!localPath) {
      // 百度分享内容本身可能就是压缩包：能解包时继续找媒体文件，不能解包时保留诊断信息。
      localPath = await pickLargestMediaFileInArchives(dir);
    }
    if (!localPath) {
      // 诊断：把目录里实际下到的内容写进错误，方便在任务队列里定位（比如分享的是压缩包）
      const found = await listFiles(dir, 5);
      const cli = cliOutputs.join("\n").slice(0, 1000);
      throw new Error(
        `百度网盘下载完成但未找到媒体文件${found.length ? `（下载内容：${found.join("、")}）` : "（下载目录为空）"}` +
        `；回源步骤：${steps.join("；") || "无"}` +
        (searchDiag ? `；搜索：${searchDiag}` : "") +
        (cli ? `；bdpan输出：${cli}` : ""),
      );
    }
    return localPath;
  }

  private async downloadFromShare(link: StorageLink, dir: string, account?: ManagedStorageAccount): Promise<{ stdout: string; localPath: string }> {
    const transferDir = this.config.get<string>("BAIDU_FETCH_TRANSFER_DIR")?.trim() || "wallpaper-fetch-tmp";
    return this.baidu.downloadShare(link.url, dir, link.passcode || undefined, account, transferDir);
  }

  private async pickDownloadMedia(paths: string[], dir: string): Promise<string> {
    const scanDirs = new Set<string>();
    for (const p of paths) {
      if (!p) continue;
      if (!existsSync(p)) continue;
      const info = await stat(p).catch(() => null);
      if (!info) continue;
      if (info.isFile()) {
        if (MEDIA_EXTENSIONS.includes(extname(p).toLowerCase())) return p;
        continue;
      }
      if (info.isDirectory()) scanDirs.add(p);
    }
    scanDirs.add(dir);
    for (const d of scanDirs) {
      const found = await pickLargestMediaFile(d);
      if (found) return found;
    }
    return "";
  }

  private async resolveBaiduBySearch(dir: string, account: ManagedStorageAccount | undefined, wallpaper: Wallpaper): Promise<{ ok: boolean; detail: string; localPath: string }> {
    const keyword = baiduSearchKeyword(wallpaper);
    if (!keyword) return { ok: false, detail: "无搜索关键字", localPath: "" };
    let matches: Array<{ path: string; name: string; size: number; isDir: boolean }> = [];
    let raw = "";
    try {
      const result = await this.baidu.search(keyword, account);
      matches = result.items;
      raw = result.raw;
    } catch (error) {
      return { ok: false, detail: `search拨打异常：${(error as Error).message}`, localPath: "" };
    }
    if (!matches.length) return { ok: false, detail: `search("${keyword}") 无匹配${raw ? `（原始输出：${raw.slice(0, 300)}）` : ""}`, localPath: "" };
    const preferVideo = wallpaper.type === "live";
    const preferredExts = preferVideo ? VIDEO_EXTENSIONS : MEDIA_EXTENSIONS.filter((ext) => !VIDEO_EXTENSIONS.includes(ext));
    const pool = matches.filter((item) => !item.isDir && preferredExts.includes(extname(item.name).toLowerCase()));
    // 优先 /apps/bdpan 授权目录内的文件，再按大小排序，逐个尝试下载。
    const candidates = (pool.length ? pool : matches.filter((item) => !item.isDir)).sort((a, b) => {
      const aUnder = a.path.startsWith("/apps/bdpan") ? 1 : 0;
      const bUnder = b.path.startsWith("/apps/bdpan") ? 1 : 0;
      if (aUnder !== bUnder) return bUnder - aUnder;
      return b.size - a.size;
    });
    const tried: string[] = [];
    const errors: string[] = [];
    for (const candidate of candidates) {
      const remotePath = baiduApiPath(candidate.path);
      if (!remotePath) continue;
      tried.push(`${candidate.name}(${remotePath})`);
      const variants = [remotePath];
      // bdpan download 提示“路径应为相对路径”，对授权目录下的文件同时尝试相对形式。
      if (remotePath.startsWith("/apps/bdpan/")) variants.push(remotePath.slice("/apps/bdpan/".length));
      for (const variant of variants) {
        try {
          const result = await this.baidu.downloadByPath(variant, dir, account);
          this.logger.log(`百度回源：搜索命中 ${candidate.name} -> ${variant}`);
          return { ok: true, detail: `按路径下载 ${variant}`, localPath: result.localPath };
        } catch (error) {
          errors.push(`${variant}：${(error as Error).message}`);
        }
      }
    }
    return { ok: false, detail: `候选：${tried.join("；")}；错误：${errors.join(" | ")}`, localPath: "" };
  }

  private async resolveBaiduByPath(dir: string, account: ManagedStorageAccount | undefined, wallpaper: Wallpaper): Promise<{ ok: boolean; detail: string; localPath: string }> {
    const reconstructed = reconstructBaiduRemotePath(wallpaper);
    if (!reconstructed) return { ok: false, detail: "无法重建网盘路径", localPath: "" };
    // 1) 直接尝试按上传规则重建的路径下载。
    try {
      const result = await this.baidu.downloadByPath(reconstructed, dir, account);
      return { ok: true, detail: `重建路径下载 ${reconstructed}`, localPath: result.localPath };
    } catch (error) {
      // 2) 重建失败则列出该文件所在目录，按文件名找一个最接近的。
      const parent = reconstructed.slice(0, reconstructed.lastIndexOf("/"));
      const token = baiduSearchKeyword(wallpaper);
      let items: Array<{ path: string; name: string; size: number; isDir: boolean }> = [];
      try {
        items = (await this.baidu.list(parent, account)).items;
      } catch (listError) {
        return { ok: false, detail: `重建路径下载失败：${(error as Error).message}；ls(${parent}) 失败：${(listError as Error).message}`, localPath: "" };
      }
      const preferVideo = wallpaper.type === "live";
      const preferredExts = preferVideo ? VIDEO_EXTENSIONS : MEDIA_EXTENSIONS.filter((ext) => !VIDEO_EXTENSIONS.includes(ext));
      const byName = items.filter((m) => !m.isDir && token && (m.name.includes(token) || token.includes(m.name.replace(/\.[^.]+$/, ""))));
      const media = byName.filter((m) => preferredExts.includes(extname(m.name).toLowerCase()));
      const pool = media.length ? media : byName;
      const best = pool.length ? pool.sort((a, b) => b.size - a.size)[0] : null;
      if (!best) {
        const listed = items.slice(0, 5).map((m) => `${m.name}${m.isDir ? "/" : ""}`).join(" | ");
        return { ok: false, detail: `重建路径下载失败：${(error as Error).message}；目录 ${parent} 无匹配文件${listed ? `（内容：${listed}）` : ""}`, localPath: "" };
      }
      const remotePath = baiduApiPath(best.path);
      this.logger.log(`百度回源：目录匹配 ${best.name} -> ${remotePath}`);
      try {
        const result = await this.baidu.downloadByPath(remotePath, dir, account);
        return { ok: true, detail: `目录匹配下载 ${remotePath}`, localPath: result.localPath };
      } catch (downloadError) {
        return { ok: false, detail: `downloadByPath("${remotePath}") 失败：${(downloadError as Error).message}`, localPath: "" };
      }
    }
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

async function pickLargestMediaFileInArchives(dir: string): Promise<string> {
  const archives = await findArchives(dir);
  for (const archive of archives) {
    const extractDir = join(dir, `.extract-${basename(archive)}`);
    try {
      await extractArchive(archive, extractDir);
      const localPath = await pickLargestMediaFile(extractDir);
      if (localPath) return localPath;
      await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    } catch {
      // 当前工具不支持该压缩格式或解压失败时，尝试下一个压缩包。
      await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  return "";
}

async function findArchives(dir: string): Promise<string[]> {
  const archives: string[] = [];
  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (ARCHIVE_EXTENSIONS.includes(extname(entry.name).toLowerCase())) {
        archives.push(full);
      }
    }
  }
  await walk(dir);
  return archives;
}

async function extractArchive(filePath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const attempts = archiveExtractors(filePath, destDir);
  if (!attempts.length) throw new Error(`不支持的压缩包格式：${extname(filePath)}`);
  const errors: string[] = [];
  for (const [command, args] of attempts) {
    const result = await runCli(command, args, { timeoutMs: 60 * 60_000 });
    if (result.ok) return;
    errors.push(`${command}: ${result.stderr || result.stdout || "解压失败"}`);
  }
  throw new Error(errors.join("; "));
}

function archiveExtractors(filePath: string, destDir: string): Array<[string, string[]]> {
  const lower = filePath.toLowerCase();
  const ext = extname(filePath).toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return [["tar", ["-xzf", filePath, "-C", destDir]]];
  }
  if (ext === ".zip") {
    return [
      ["unzip", ["-o", "-q", filePath, "-d", destDir]],
      ["7z", ["x", "-y", `-o${destDir}`, filePath]],
    ];
  }
  if (ext === ".rar") {
    return [
      ["7z", ["x", "-y", `-o${destDir}`, filePath]],
      ["unrar", ["x", "-y", filePath, `${destDir}/`]],
    ];
  }
  if (ext === ".7z") {
    return [["7z", ["x", "-y", `-o${destDir}`, filePath]]];
  }
  if (ext === ".tar") {
    return [["tar", ["-xf", filePath, "-C", destDir]]];
  }
  if (ext === ".gz") {
    return [["tar", ["-xzf", filePath, "-C", destDir]]];
  }
  return [];
}

async function listFiles(dir: string, limit: number): Promise<string[]> {
  const found: string[] = [];
  async function walk(current: string, prefix = "") {
    if (found.length >= limit) return;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (found.length >= limit) return;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        found.push(`${relative}/`);
        await walk(join(current, entry.name), relative);
      } else {
        found.push(relative);
      }
    }
  }
  await walk(dir);
  return found.slice(0, limit);
}

function baiduSearchKeyword(wallpaper: Wallpaper): string {
  const name = (wallpaper.originalName || "").replace(/\.[^.]+$/, "").trim();
  if (name) return name.slice(0, 24);
  return (wallpaper.title || "").trim().slice(0, 24);
}

function reconstructBaiduRemotePath(wallpaper: Wallpaper): string {
  const tags = (wallpaper as unknown as { tags?: Array<{ tag?: { name?: string } }> }).tags || [];
  const tagNames = tags
    .map((item) => item.tag?.name || "")
    .filter(Boolean);
  const dir = buildWallpaperRemoteDir(String(wallpaper.type || ""), tagNames).baiduRelativeDir;
  const file = sanitizeBaiduName(wallpaper.originalName || "");
  if (!file) return "";
  return `/apps/bdpan/wallpapers/${dir}/${file}`.replace(/\/+/g, "/");
}

function sanitizeBaiduName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}

function mimeTypeOf(ext: string) {
  const map: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
    ".heic": "image/heic",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".m4v": "video/x-m4v",
  };
  return map[ext] || "application/octet-stream";
}
