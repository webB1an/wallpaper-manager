import { BadRequestException, Injectable, Logger, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import sharp from "sharp";
import { nanoid } from "nanoid";
import { Prisma, RewardDownloadType, StorageProvider, WallpaperOrientation, WallpaperStatus, WallpaperType } from "@prisma/client";
import { runCli } from "../../common/cli";
import { publicAssetUrl, shortUrl } from "../../common/public-url";
import { positiveInt } from "../../common/query-values";
import { AiService } from "../ai/ai.service";
import { ChannelService } from "../channel/channel.service";
import { PrismaService } from "../prisma/prisma.service";
import { BaiduStorageService } from "../storage/baidu-storage.service";
import { QuarkStorageService } from "../storage/quark-storage.service";
import { StorageAccountService } from "../storage/storage-account.service";
import { StorageCoordinatorService } from "../storage/storage-coordinator.service";
import { TasksService } from "../tasks/tasks.service";
import { WdbzkService } from "../wdbzk/wdbzk.service";
import { autoSourceIds, autoSourceMeta, fetchAutoSource } from "./auto-publish-sources";
import { WALLPAPER_QUEUE } from "./admin.queue";

type SystemSettings = {
  defaultAutoProcess: boolean;
  defaultAutoPublish: boolean;
  rewardDownloadType: RewardDownloadType;
  autoSourceEnabled?: Record<string, boolean>;
};

type DiagnosticItem = {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail";
  message: string;
  command?: string;
};

type ReadinessAction = DiagnosticItem & {
  nextStep: string;
};

type AiReviewFilter = "unreviewed" | "safe" | "blocked";
type StorageFilter = "has_quark" | "has_baidu" | "missing_quark" | "missing_baidu" | "missing_active" | "missing_short" | "unpublished_active_short";
type StorageSelection = { quarkAccountId?: string; baiduAccountId?: string };

const DEFAULT_SETTINGS: SystemSettings = {
  defaultAutoProcess: true,
  defaultAutoPublish: false,
  rewardDownloadType: "daily10",
};
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
const DEFAULT_UPLOAD_MAX_FILE_MB = 300;

const loginAttempts = new Map<string, { count: number; lockedUntil?: number; lastFailedAt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_LOCK_MS = 10 * 60_000;

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);
  private autoDownloadRunning = false;
  private autoScheduleTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly channel: ChannelService,
    private readonly quarkStorage: QuarkStorageService,
    private readonly baiduStorage: BaiduStorageService,
    private readonly storageAccounts: StorageAccountService,
    private readonly storage: StorageCoordinatorService,
    private readonly wdbzk: WdbzkService,
    private readonly tasks: TasksService,
    @InjectQueue(WALLPAPER_QUEUE) private readonly wallpaperQueue: Queue,
  ) {}

  onModuleInit() {
    void this.startAutoPublishLoop();
  }

  private startAutoPublishLoop() {
    const tick = () => {
      void this.runDueAutoPublishBoards().catch((error) => {
        this.logger.warn(`自动发帖调度出错：${(error as Error).message}`);
      });
    };
    setTimeout(tick, 60_000).unref?.();
    this.autoScheduleTimer = setInterval(tick, 5 * 60_000);
    this.autoScheduleTimer.unref?.();
  }

  /** 调度：每个启用板块按各自的周期运行，超期即触发一次。 */
  private async runDueAutoPublishBoards() {
    const boards = await this.prisma.autoPublishBoard.findMany({ where: { enabled: true } });
    const now = Date.now();
    for (const board of boards) {
      if (this.autoDownloadRunning) break;
      const due = !board.lastRunAt || now - board.lastRunAt.getTime() >= board.intervalHours * 60 * 60 * 1000;
      if (!due) continue;
      await this.runAutoPublishBoard(board).catch((error) => {
        this.logger.warn(`板块「${board.guildName || board.guildId}/${board.channelName || board.channelId}」自动发帖失败：${(error as Error).message}`);
      });
    }
  }

  /** 运行一个板块的自动发帖：按来源拉图 → 入库 → AI 分类 → 上传网盘 → 发到该板块账号 → 全局去重。 */
  async runAutoPublishBoard(board: { id: string; source: string; sourceConfig: unknown; guildId: string; guildName?: string | null; channelId: string; channelName?: string | null }): Promise<{ ok: boolean; message: string }> {
    if (this.autoDownloadRunning) return { ok: false, message: "自动发帖任务正在运行" };
    this.autoDownloadRunning = true;
    const boardLabel = `${board.guildName || board.guildId}/${board.channelName || board.channelId}`;
    const task = await this.tasks.create("auto_publish", { boardId: board.id }, `正在从 ${board.source} 拉取壁纸发到 ${boardLabel}`);
    try {
      const settings = await this.getSettings();
      if ((settings.autoSourceEnabled || {})[board.source] === false) {
        const message = `数据源 ${board.source} 已停用，跳过发帖`;
        await this.tasks.update(task.id, { status: "skipped", progress: 100, message });
        await this.prisma.autoPublishBoard.update({ where: { id: board.id }, data: { lastMessage: message } }).catch(() => undefined);
        return { ok: true, message };
      }
      const exclude = (await this.prisma.wallpaperSource.findMany({ select: { sourceId: true } })).map((row) => row.sourceId);
      await this.tasks.update(task.id, { status: "running", progress: 8, message: "正在从数据源拉取壁纸" });
      const item = await fetchAutoSource(board.source, {
        exclude,
        config: (board.sourceConfig as Record<string, unknown>) || {},
        configService: this.config,
      });
      await this.tasks.update(task.id, { progress: 30, message: "正在保存原图并生成封面" });
      const persisted = await this.persistWallpaperBytes(item.bytes, item.fileName, item.fileType);
      const cover = await this.createCover(persisted.path, persisted.mimeType);
      const type = item.type === "live" ? WallpaperType.live : WallpaperType.static;
      const record = await this.prisma.wallpaper.create({
        data: {
          title: `${item.fileName || item.sourceId}`,
          originalName: item.fileName,
          coverPath: cover.relativePath,
          coverUrl: publicAssetUrl(this.config, cover.relativePath),
          assetPath: persisted.relativePath,
          mimeType: persisted.mimeType,
          type,
          orientation: orientationFromDimensions(item.width, item.height),
          status: WallpaperStatus.draft,
        },
      });
      await this.prisma.wallpaperSource.upsert({
        where: { source_sourceId: { source: board.source, sourceId: item.sourceId } },
        update: {},
        create: { source: board.source, sourceId: item.sourceId, wallpaperId: record.id },
      });

      await this.tasks.update(task.id, { progress: 45, message: "正在 AI 识别分类" });
      const analysis = await this.analyzeNow(record.id);
      if (!analysis.safe) {
        // 清理：删除本地原图与封面，释放磁盘；保留库记录并清空路径以维持去重（WallpaperSource）。
        await Promise.all([
          this.removeUploadedFile(persisted.path),
          this.removeUploadedFile(cover.path),
        ]);
        const message = `AI 审核未通过，已清理并跳过（${analysis.sensitiveFlags.join("、") || "疑似违规"}）`;
        await this.prisma.wallpaper.update({
          where: { id: record.id },
          data: { assetPath: null, coverPath: null, coverUrl: null, title: `[已清理] ${record.title}` },
        }).catch(() => undefined);
        await this.tasks.update(task.id, { status: "skipped", progress: 100, message, result: { ok: true, skipped: true, cleaned: true } });
        await this.prisma.autoPublishBoard.update({ where: { id: board.id }, data: { lastMessage: message } }).catch(() => undefined);
        return { ok: true, message };
      }

      const localAsset = join(process.cwd(), "storage", "public", record.assetPath || "");
      await this.tasks.update(task.id, { progress: 62, message: "正在上传网盘" });
      const storageResults = await this.storage.syncWallpaper(record.id, localAsset, analysis.title || record.title, type, analysis.tags);
      const storageWarnings = storageResults.filter((row) => !row.ok).map((row) => `${row.provider} 同步失败：${row.error}`);

      const account = await this.pickAutoPublishAccount(board);
      if (!account) throw new Error(`没有【${boardLabel}】开启自动发帖的频道账号`);
      const isVideo = type === WallpaperType.live;
      await this.prisma.wallpaper.update({ where: { id: record.id }, data: { title: analysis.title || record.title, type, status: WallpaperStatus.pending_review } });
      await this.tasks.update(task.id, { progress: 82, message: "正在发布到腾讯频道" });
      await this.channel.publish({
        accountId: account.id,
        content: analysis.title || record.title,
        imagePaths: !isVideo && existsSync(localAsset) ? [localAsset] : [],
        videoPaths: isVideo && existsSync(localAsset) ? [localAsset] : [],
        topicNames: analysis.tags.slice(0, 6),
      });
      await this.prisma.channelAccount.update({ where: { id: account.id }, data: { lastAutoPublishAt: new Date() } });
      await this.prisma.wallpaper.update({ where: { id: record.id }, data: { status: WallpaperStatus.published } });
      const message = `已发布「${analysis.title || record.title}」到 ${boardLabel}${storageWarnings.length ? `（${storageWarnings.join("；")}）` : ""}`;
      await this.tasks.update(task.id, { status: "success", progress: 100, message, result: { ok: true } });
      await this.prisma.autoPublishBoard.update({ where: { id: board.id }, data: { lastRunAt: new Date(), lastMessage: message } });
      return { ok: true, message };
    } catch (error) {
      const message = (error as Error).message || "自动发帖失败";
      await this.tasks.update(task.id, { status: "failed", error: message, message: "自动发帖失败" }).catch(() => undefined);
      await this.prisma.autoPublishBoard.update({ where: { id: board.id }, data: { lastMessage: message } }).catch(() => undefined);
      return { ok: false, message };
    } finally {
      this.autoDownloadRunning = false;
    }
  }

  async runAutoPublishBoardById(id: string) {
    const board = await this.prisma.autoPublishBoard.findUnique({ where: { id } });
    if (!board) throw new BadRequestException("自动发帖板块配置不存在");
    void this.runAutoPublishBoard(board)
      .catch((error) => this.logger.warn(`手动触发板块失败：${(error as Error).message}`));
    return { ok: true, message: "已触发，正在后台运行（稍后刷新查看结果）" };
  }

  listAutoPublishBoards() {
    return this.prisma.autoPublishBoard.findMany({ orderBy: { createdAt: "desc" } });
  }

  async listAutoPublishSources() {
    const settings = await this.getSettings();
    return autoSourceMeta(settings.autoSourceEnabled || {});
  }

  async setAutoPublishSourceEnabled(source: string, enabled: boolean) {
    if (!autoSourceIds().includes(source)) throw new BadRequestException(`未知数据来源：${source}`);
    const settings = await this.getSettings();
    const map = { ...(settings.autoSourceEnabled || {}) };
    map[source] = enabled;
    await this.updateSettings({ autoSourceEnabled: map });
    return { ok: true, enabled };
  }

  async saveAutoPublishBoard(input: {
    guildId: string;
    guildName?: string;
    channelId: string;
    channelName?: string;
    source?: string;
    sourceConfig?: Record<string, unknown>;
    enabled?: boolean;
    intervalHours?: number;
  }) {
    const source = input.source || "wallpost";
    if (!autoSourceIds().includes(source)) throw new BadRequestException(`未知数据来源：${source}`);
    return this.prisma.autoPublishBoard.create({
      data: {
        guildId: input.guildId,
        guildName: input.guildName,
        channelId: input.channelId,
        channelName: input.channelName,
        source,
        sourceConfig: (input.sourceConfig ?? undefined) as Prisma.InputJsonValue | undefined,
        enabled: Boolean(input.enabled),
        intervalHours: clampAutoInterval(input.intervalHours),
      },
    });
  }

  async updateAutoPublishBoard(id: string, data: { guildName?: string; channelName?: string; source?: string; sourceConfig?: Record<string, unknown>; enabled?: boolean; intervalHours?: number }) {
    const board = await this.prisma.autoPublishBoard.findUnique({ where: { id } });
    if (!board) throw new BadRequestException("自动发帖板块配置不存在");
    if (data.source && !autoSourceIds().includes(data.source)) throw new BadRequestException(`未知数据来源：${data.source}`);
    return this.prisma.autoPublishBoard.update({
      where: { id },
      data: {
        ...(typeof data.guildName === "string" ? { guildName: data.guildName } : {}),
        ...(typeof data.channelName === "string" ? { channelName: data.channelName } : {}),
        ...(typeof data.source === "string" ? { source: data.source } : {}),
        ...(data.sourceConfig !== undefined ? { sourceConfig: data.sourceConfig as Prisma.InputJsonValue } : {}),
        ...(typeof data.enabled === "boolean" ? { enabled: data.enabled } : {}),
        ...(typeof data.intervalHours === "number" ? { intervalHours: clampAutoInterval(data.intervalHours) } : {}),
      },
    });
  }

  async deleteAutoPublishBoard(id: string) {
    const board = await this.prisma.autoPublishBoard.findUnique({ where: { id } });
    if (!board) throw new BadRequestException("自动发帖板块配置不存在");
    await this.prisma.autoPublishBoard.delete({ where: { id } });
    return { deleted: true };
  }

  private async persistWallpaperBytes(bytes: Buffer, originalName: string, mimeType: string) {
    const dir = join(process.cwd(), "storage", "public", "originals");
    await mkdir(dir, { recursive: true });
    const extension = safeExtension(originalName);
    const fileName = `${Date.now()}-${nanoid(10)}${extension}`;
    const path = join(dir, fileName);
    await writeFile(path, bytes);
    return { path, relativePath: `originals/${fileName}`, mimeType, originalName };
  }

  private async pickAutoPublishAccount(board: { guildId: string; channelId: string }) {
    const accounts = await this.prisma.channelAccount.findMany({
      where: { autoPublish: true, guildId: board.guildId, channelId: board.channelId },
      orderBy: [{ lastAutoPublishAt: "asc" }, { createdAt: "asc" }],
      take: 1,
    });
    return accounts[0] || null;
  }

  async setChannelAccountAutoPublish(id: string, autoPublish: boolean) {
    const account = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!account) throw new BadRequestException("频道账号不存在");
    return this.prisma.channelAccount.update({ where: { id }, data: { autoPublish } });
  }
  login(username: string, password: string, clientIp = "unknown") {
    const key = `${clientIp}:${username}`;
    this.assertLoginAllowed(key);
    const expectedUser = this.config.get<string>("ADMIN_USERNAME") || "admin";
    const expectedPassword = this.config.get<string>("ADMIN_PASSWORD") || "change-this-password";
    if (username !== expectedUser || password !== expectedPassword) {
      this.recordLoginFailure(key);
      throw new UnauthorizedException("账号或密码错误");
    }
    loginAttempts.delete(key);
    return { token: this.jwt.sign({ sub: username, role: "admin" }) };
  }

  async createUpload(files: Express.Multer.File[], options?: { autoProcess?: boolean; autoPublish?: boolean; storageSelection?: StorageSelection; channelAccountId?: string }) {
    if (!files.length) throw new BadRequestException("请选择要上传的壁纸文件");
    const settings = await this.getSettings();
    const autoProcess = options?.autoProcess ?? settings.defaultAutoProcess;
    const autoPublish = options?.autoPublish ?? settings.defaultAutoPublish;
    if (autoPublish) {
      await this.assertChannelReady("未配置可用腾讯频道账号，不能开启上传后自动发帖", options?.channelAccountId);
    }
    if (autoProcess) {
      await this.assertStorageReady(options?.storageSelection);
    }
    const created = [];
    for (const file of files) {
      this.assertUploadFile(file);
      const saved = await this.persistFile(file);
      let cover: { path: string; relativePath: string };
      try {
        cover = await this.createCover(saved.path, saved.mimeType);
      } catch {
        await this.removeUploadedFile(saved.path);
        throw new BadRequestException(`无法生成封面：${saved.originalName}，请检查文件是否损坏或格式是否受支持`);
      }
      let wallpaper;
      try {
        const orientation = await detectOrientation(cover.path).catch(() => "unknown" as WallpaperOrientation);
        wallpaper = await this.prisma.wallpaper.create({
          data: {
            title: saved.originalName.replace(/\.[^.]+$/, ""),
            originalName: saved.originalName,
            mimeType: saved.mimeType,
            fileSize: BigInt(file.size),
            assetPath: saved.relativePath,
            coverPath: cover.relativePath,
            coverUrl: publicAssetUrl(this.config, cover.relativePath),
            status: autoProcess ? WallpaperStatus.processing : WallpaperStatus.draft,
            type: detectType(saved.mimeType, saved.originalName),
            orientation,
            autoPublish,
          },
        });
      } catch (error) {
        await Promise.all([
          this.removeUploadedFile(saved.path),
          this.removeUploadedFile(cover.path),
        ]);
        throw error;
      }
      const queued = autoProcess ? await this.enqueueProcessWallpaper(wallpaper.id, options?.storageSelection, autoPublish ? options?.channelAccountId : undefined) : undefined;
      created.push({ ...wallpaper, queued });
    }
    return created;
  }

  async getSettings(): Promise<SystemSettings> {
    const row = await this.prisma.setting.findUnique({ where: { key: "system" } });
    return { ...DEFAULT_SETTINGS, ...(row?.value as Partial<SystemSettings> | undefined) };
  }

  async updateSettings(input: Partial<SystemSettings>) {
    const current = await this.getSettings();
    if (input.defaultAutoPublish === true) {
      await this.assertChannelReady("未配置默认腾讯频道账号，不能开启默认自动发帖");
    }
    const value: SystemSettings = {
      ...current,
      ...(typeof input.defaultAutoProcess === "boolean" ? { defaultAutoProcess: input.defaultAutoProcess } : {}),
      ...(typeof input.defaultAutoPublish === "boolean" ? { defaultAutoPublish: input.defaultAutoPublish } : {}),
      ...(input.rewardDownloadType === "daily10" || input.rewardDownloadType === "unlimited"
        ? { rewardDownloadType: input.rewardDownloadType }
        : {}),
      ...(input.autoSourceEnabled ? { autoSourceEnabled: input.autoSourceEnabled } : {}),
    };
    await this.prisma.setting.upsert({
      where: { key: "system" },
      update: { value },
      create: { key: "system", value },
    });
    return value;
  }

  async diagnostics(): Promise<DiagnosticItem[]> {
    const checks: DiagnosticItem[] = [];

    checks.push(await this.checkDatabase());
    checks.push(await this.checkRedis());
    checks.push(await this.checkWritableStorage());
    checks.push(this.checkPublicOrigins());
    checks.push(this.checkMiniprogramReleaseConfig());
    checks.push(await this.checkCommand("ffmpeg", "ffmpeg 视频封面", this.config.get<string>("FFMPEG_PATH")?.trim() || "ffmpeg", ["-version"]));
    checks.push(await this.checkBaiduStorage());
    checks.push(await this.checkQuarkStorage());
    checks.push(this.checkOldCoverSource());
    checks.push(await this.checkPanapi());
    checks.push(await this.checkWallhaven());
    checks.push(this.checkDeepSeekConfig());
    checks.push(await this.checkTencentCli());
    checks.push(await this.checkChannelAccounts());
    checks.push(await this.checkUnpublishedActiveShortLinks());

    return checks;
  }

  async readiness() {
    const [overview, diagnostics, settings] = await Promise.all([
      this.overview(),
      this.diagnostics(),
      this.getSettings(),
    ]);
    const counts = diagnostics.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, { ok: 0, warn: 0, fail: 0 } as Record<DiagnosticItem["status"], number>);
    const actions = diagnostics
      .filter((item) => item.status === "fail" || item.status === "warn")
      .map(readinessAction);
    return {
      ok: counts.fail === 0,
      diagnostics: counts,
      wallpapers: {
        total: overview.wallpapers.total,
        published: overview.wallpapers.published,
        pendingReview: overview.wallpapers.pendingReview,
      },
      storage: {
        activeQuark: overview.storage.activeQuark,
        activeBaidu: overview.storage.activeBaidu,
        missingActiveLinks: overview.storage.missingActiveLinks,
        unpublishedActiveShortLinks: overview.storage.unpublishedActiveShortLinks,
      },
      settings,
      actions,
      report: formatReadinessReport({
        diagnostics: counts,
        wallpapers: overview.wallpapers,
        storage: overview.storage,
        settings,
        actions,
      }),
    };
  }

  async overview() {
    const [
      statusGroups,
      typeGroups,
      aiUnreviewed,
      aiSafe,
      aiBlocked,
      activeQuark,
      activeBaidu,
      missingQuark,
      missingBaidu,
      missingActiveLinks,
      missingShortLinks,
      unpublishedActiveShortLinks,
      channelAccounts,
      defaultChannelAccounts,
      storageAccounts,
      defaultBaiduStorageAccounts,
      defaultQuarkStorageAccounts,
      tagTotal,
      tasks,
    ] = await Promise.all([
      this.prisma.wallpaper.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.wallpaper.groupBy({
        by: ["type"],
        where: { status: WallpaperStatus.published },
        _count: { _all: true },
      }),
      this.prisma.wallpaper.count({ where: { aiAnalysis: null } }),
      this.prisma.aiAnalysis.count({ where: { safe: true } }),
      this.prisma.aiAnalysis.count({ where: { safe: false } }),
      this.prisma.storageLink.count({ where: { provider: StorageProvider.quark, isActive: true } }),
      this.prisma.storageLink.count({ where: { provider: StorageProvider.baidu, isActive: true } }),
      this.prisma.wallpaper.count({ where: { storageLinks: { none: { provider: StorageProvider.quark, isActive: true } } } }),
      this.prisma.wallpaper.count({ where: { storageLinks: { none: { provider: StorageProvider.baidu, isActive: true } } } }),
      this.prisma.wallpaper.count({
        where: {
          status: WallpaperStatus.published,
          storageLinks: { none: { isActive: true } },
        },
      }),
      this.prisma.wallpaper.count({
        where: {
          status: WallpaperStatus.published,
          shortLinks: { none: {} },
        },
      }),
      this.prisma.wallpaper.count({
        where: {
          status: { not: WallpaperStatus.published },
          shortLinks: { some: { storageLink: { isActive: true } } },
        },
      }),
      this.prisma.channelAccount.count(),
      this.prisma.channelAccount.count({ where: { isDefault: true } }),
      this.prisma.storageAccount.count({ where: { isActive: true } }),
      this.prisma.storageAccount.count({ where: { provider: StorageProvider.baidu, isActive: true, isDefault: true } }),
      this.prisma.storageAccount.count({ where: { provider: StorageProvider.quark, isActive: true, isDefault: true } }),
      this.prisma.tag.count(),
      this.tasks.summary(),
    ]);

    const byStatus = Object.fromEntries(
      Object.values(WallpaperStatus).map((status) => [status, 0]),
    ) as Record<WallpaperStatus, number>;
    for (const group of statusGroups) {
      byStatus[group.status] = group._count._all;
    }

    const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0);

    return {
      wallpapers: {
        total,
        byStatus,
        draft: byStatus.draft,
        processing: byStatus.processing,
        pendingReview: byStatus.pending_review,
        published: byStatus.published,
        rejected: byStatus.rejected,
        archived: byStatus.archived,
        byType: typeGroups
          .map((group) => ({ type: group.type, count: group._count._all }))
          .sort((left, right) => right.count - left.count),
      },
      ai: {
        unreviewed: aiUnreviewed,
        safe: aiSafe,
        blocked: aiBlocked,
      },
      storage: {
        activeQuark,
        activeBaidu,
        missingQuark,
        missingBaidu,
        missingActiveLinks,
        missingShortLinks,
        unpublishedActiveShortLinks,
      },
      channelAccounts: {
        total: channelAccounts,
        defaultConfigured: defaultChannelAccounts > 0,
      },
      storageAccounts: {
        total: storageAccounts,
        defaultBaidu: defaultBaiduStorageAccounts > 0,
        defaultQuark: defaultQuarkStorageAccounts > 0,
      },
      tags: {
        total: tagTotal,
      },
      tasks,
    };
  }

  async analyzeNow(wallpaperId: string) {
    const wallpaper = await this.prisma.wallpaper.findUnique({ where: { id: wallpaperId } });
    if (!wallpaper?.coverPath) throw new Error("壁纸或封面不存在");
    const coverPath = join(process.cwd(), "storage", "public", wallpaper.coverPath);
    const analysis = await this.ai.analyzeImage(coverPath, wallpaper.originalName);
    const detectedType = detectType(wallpaper.mimeType || "", wallpaper.originalName);
    const tags = await Promise.all(analysis.tags.map((name) => this.prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name },
    })));
    await this.prisma.aiAnalysis.upsert({
      where: { wallpaperId },
      update: {
        title: analysis.title,
        type: detectedType,
        tags: analysis.tags,
        sensitiveFlags: analysis.sensitiveFlags,
        safe: analysis.safe,
        summary: analysis.summary,
      },
      create: {
        wallpaperId,
        title: analysis.title,
        type: detectedType,
        tags: analysis.tags,
        sensitiveFlags: analysis.sensitiveFlags,
        safe: analysis.safe,
        summary: analysis.summary,
      },
    });
    await this.prisma.wallpaper.update({
      where: { id: wallpaperId },
      data: {
        title: analysis.title,
        type: detectedType,
        status: analysis.safe ? WallpaperStatus.pending_review : WallpaperStatus.rejected,
        tags: {
          deleteMany: {},
          create: tags.map((tag) => ({ tagId: tag.id })),
        },
      },
    });
    return analysis;
  }

  async listWallpapers(query: { page?: number; pageSize?: number; keyword?: string; status?: WallpaperStatus; type?: WallpaperType; orientation?: WallpaperOrientation; aiReview?: AiReviewFilter; storage?: StorageFilter }) {
    const page = positiveInt(query.page, 1, "页码");
    const pageSize = positiveInt(query.pageSize, 20, "每页数量", 100);
    const where: Prisma.WallpaperWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.orientation ? { orientation: query.orientation } : {}),
      ...(query.keyword ? { title: { contains: query.keyword } } : {}),
      ...aiReviewWhere(query.aiReview),
      ...storageWhere(query.storage),
    };
    const [list, total] = await Promise.all([
      this.prisma.wallpaper.findMany({
        where,
        include: { tags: { include: { tag: true } }, storageLinks: true, shortLinks: true, aiAnalysis: true },
        orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.wallpaper.count({ where }),
    ]);
    return {
      list: list.map((item) => ({
        ...item,
        shortLinks: item.shortLinks.map((link) => ({
          ...link,
          url: shortUrl(this.config, link.code),
        })),
      })),
      total,
      page,
      pageSize,
    };
  }

  async updateWallpaper(id: string, data: {
    title?: string;
    type?: WallpaperType;
    status?: WallpaperStatus;
    sortOrder?: number;
    tags?: string[];
  }) {
    if (data.status === WallpaperStatus.published) {
      await this.assertWallpapersCanPublish([id]);
    }
    const tags = data.tags
      ? await Promise.all(data.tags.map((name) => this.prisma.tag.upsert({ where: { name }, update: {}, create: { name } })))
      : undefined;
    return this.prisma.wallpaper.update({
      where: { id },
      data: {
        title: data.title,
        type: data.type,
        status: data.status,
        sortOrder: data.sortOrder,
        ...(tags ? { tags: { deleteMany: {}, create: tags.map((tag) => ({ tagId: tag.id })) } } : {}),
      },
    });
  }

  async addStorageLink(id: string, data: { provider: StorageProvider; url: string; passcode?: string; isPrimary?: boolean }) {
    const wallpaper = await this.prisma.wallpaper.findUnique({ where: { id } });
    if (!wallpaper) throw new BadRequestException("壁纸不存在");
    const url = assertHttpUrl(data.url, "网盘链接");
    const passcode = data.passcode?.trim() || undefined;
    if (data.isPrimary) {
      await this.prisma.storageLink.updateMany({
        where: { wallpaperId: id },
        data: { isPrimary: false },
      });
    }
    const storageLink = await this.prisma.storageLink.create({
      data: {
        wallpaperId: id,
        provider: data.provider,
        url,
        passcode,
        isPrimary: Boolean(data.isPrimary),
      },
    });
    const shortLink = await this.prisma.shortLink.create({
      data: {
        code: nanoid(8),
        wallpaperId: id,
        storageLinkId: storageLink.id,
        provider: data.provider,
      },
    });
    return { storageLink, shortLink };
  }

  async updateStorageLink(linkId: string, data: { isActive?: boolean; isPrimary?: boolean }) {
    const link = await this.prisma.storageLink.findUnique({ where: { id: linkId } });
    if (!link) throw new Error("网盘链接不存在");
    if (data.isPrimary) {
      await this.prisma.storageLink.updateMany({
        where: { wallpaperId: link.wallpaperId },
        data: { isPrimary: false },
      });
    }
    return this.prisma.storageLink.update({
      where: { id: linkId },
      data: {
        isActive: data.isActive,
        isPrimary: data.isPrimary,
      },
    });
  }

  async deactivateUnpublishedStorageLinks(ids: string[] | undefined) {
    const wallpaperIds = requiredWallpaperIds(ids);
    const links = await this.prisma.storageLink.findMany({
      where: {
        wallpaperId: { in: wallpaperIds },
        isActive: true,
        wallpaper: { status: { not: WallpaperStatus.published } },
      },
      select: { id: true, wallpaperId: true },
    });
    if (!links.length) {
      return { affectedLinks: 0, affectedWallpapers: 0 };
    }
    const result = await this.prisma.storageLink.updateMany({
      where: { id: { in: links.map((link) => link.id) } },
      data: { isActive: false, isPrimary: false },
    });
    return {
      affectedLinks: result.count,
      affectedWallpapers: new Set(links.map((link) => link.wallpaperId)).size,
    };
  }

  async bulkUpdate(ids: string[] | undefined, data: { status?: WallpaperStatus; tags?: string[] }) {
    const wallpaperIds = requiredWallpaperIds(ids);
    if (data.status === WallpaperStatus.published) {
      await this.assertWallpapersCanPublish(wallpaperIds);
    }
    if (data.status) {
      await this.prisma.wallpaper.updateMany({ where: { id: { in: wallpaperIds } }, data: { status: data.status } });
    }
    if (data.tags) {
      const tags = await Promise.all(data.tags.map((name) => this.prisma.tag.upsert({ where: { name }, update: {}, create: { name } })));
      for (const id of wallpaperIds) {
        await this.prisma.wallpaper.update({
          where: { id },
          data: { tags: { deleteMany: {}, create: tags.map((tag) => ({ tagId: tag.id })) } },
        });
      }
    }
    return { updated: wallpaperIds.length };
  }

  async enqueueProcessWallpaper(id: string, storageSelection?: StorageSelection, channelAccountId?: string) {
    await this.assertStorageReady(storageSelection);
    const payload = { wallpaperId: id, ...(storageSelection ? { storageSelection } : {}), ...(channelAccountId ? { channelAccountId } : {}) };
    const task = await this.tasks.create("upload_asset", payload, "开始处理壁纸");
    await this.wallpaperQueue.add(
      "process-wallpaper",
      { wallpaperId: id, taskId: task.id, storageSelection, channelAccountId },
      { attempts: 1, removeOnComplete: 200, removeOnFail: 500 },
    );
    return { queued: true, taskId: task.id };
  }

  async enqueueProcessWallpapers(ids: string[] | undefined, storageSelection?: StorageSelection) {
    const wallpaperIds = requiredWallpaperIds(ids);
    const queued = [];
    for (const id of wallpaperIds) {
      queued.push(await this.enqueueProcessWallpaper(id, storageSelection));
    }
    return { queued: queued.length, tasks: queued };
  }

  async processWallpaper(id: string) {
    const task = await this.tasks.create("upload_asset", { wallpaperId: id }, "开始处理壁纸");
    return this.runProcessWallpaper(id, task.id);
  }

  async runProcessWallpaper(id: string, taskId: string, storageSelection?: StorageSelection, channelAccountId?: string) {
    const warnings: string[] = [];
    const taskResult: Record<string, unknown> = {};
    try {
      await this.tasks.update(taskId, { status: "running", progress: 10, message: "正在 AI 识别" });
      const analysis = await this.analyzeNow(id);
      taskResult.ai = { safe: analysis.safe, sensitiveFlags: analysis.sensitiveFlags, tags: analysis.tags };
      if (!analysis.safe) {
        await this.tasks.update(taskId, { status: "skipped", progress: 100, message: "AI 审核未通过，已禁止上架", result: taskResult });
        return { skipped: true, reason: "AI 审核未通过" };
      }

      const wallpaper = await this.prisma.wallpaper.findUnique({
        where: { id },
        include: { storageLinks: true, tags: { include: { tag: true } } },
      });
      if (!wallpaper) throw new Error("壁纸不存在");

      if (wallpaper.assetPath) {
        await this.tasks.update(taskId, { progress: 38, message: "正在同步夸克/百度网盘" });
        const storageResults = await this.storage.syncWallpaper(id, join(process.cwd(), "storage", "public", wallpaper.assetPath), wallpaper.title, wallpaper.type, analysis.tags, storageSelection);
        taskResult.storage = storageResults;
        warnings.push(...storageResults
          .filter((item) => !item.ok)
          .map((item) => `${item.provider} 同步失败：${item.error || "未知错误"}`));
      }

      await this.tasks.update(taskId, { progress: 68, message: "正在同步 wdbzk 资源库" });
      const links = await this.prisma.storageLink.findMany({ where: { wallpaperId: id, isActive: true } });
      for (const link of links.filter((item) => !item.wdbzkResourceId)) {
        const fullLink = link.passcode && link.provider === "baidu" && !link.url.includes("pwd=")
          ? `${link.url}${link.url.includes("?") ? "&" : "?"}pwd=${link.passcode}`
          : link.url;
        const result = await this.wdbzk.createResource(wallpaper.title, fullLink, analysis.summary || "");
        if (result.id) {
          await this.prisma.storageLink.update({ where: { id: link.id }, data: { wdbzkResourceId: result.id } });
        }
      }
      taskResult.wdbzk = { synced: links.filter((item) => !item.wdbzkResourceId).length };

      await this.assertWallpapersCanPublish([id]);

      if (wallpaper.autoPublish) {
        await this.tasks.update(taskId, { progress: 84, message: "正在发布到腾讯频道" });
        try {
          taskResult.channel = await this.publishWallpaperToChannel(id, channelAccountId);
        } catch (error) {
          const message = `腾讯频道发帖失败：${shortError(error)}`;
          warnings.push(message);
          taskResult.channel = { ok: false, error: message };
        }
      }

      await this.prisma.wallpaper.update({ where: { id }, data: { status: WallpaperStatus.published } });
      taskResult.warnings = warnings;
      await this.tasks.update(taskId, {
        status: "success",
        progress: 100,
        message: warnings.length ? `处理完成并已上架，存在 ${warnings.length} 条提醒` : "处理完成并已上架",
        result: taskResult,
      });
      return { ok: true, warnings };
    } catch (error) {
      await this.tasks.update(taskId, { status: "failed", error: (error as Error).message, message: "处理失败" });
      throw error;
    }
  }

  async publishWallpaperToChannel(id: string, accountId?: string) {
    const account = await this.getChannelAccountForPublish(accountId);
    if (!account) throw new BadRequestException("未配置腾讯频道账号");
    const wallpaper = await this.prisma.wallpaper.findUnique({
      where: { id },
      include: { tags: { include: { tag: true } } },
    });
    if (!wallpaper) throw new BadRequestException("壁纸不存在");
    await this.assertWallpapersCanPublish([id]);
    const content = buildChannelContent(wallpaper.title);
    const absoluteAsset = wallpaper.assetPath ? join(process.cwd(), "storage", "public", wallpaper.assetPath) : undefined;
    const absoluteCover = wallpaper.coverPath ? join(process.cwd(), "storage", "public", wallpaper.coverPath) : undefined;
    const isVideo = wallpaper.mimeType?.startsWith("video/") || wallpaper.type === WallpaperType.live;
    assertChannelMediaReady([{
      title: wallpaper.title,
      isVideo,
      coverPath: absoluteCover,
      assetPath: absoluteAsset,
    }]);
    return this.channel.publish({
      accountId: account.id,
      content,
      imagePaths: isVideo ? [] : absoluteAsset ? [absoluteAsset] : absoluteCover ? [absoluteCover] : [],
      videoPaths: isVideo && absoluteAsset ? [absoluteAsset] : [],
      topicNames: wallpaper.tags.map(({ tag }) => tag.name).slice(0, 6),
    });
  }

  async publishWallpapersToChannel(ids: string[] | undefined, accountId?: string) {
    const uniqueIds = requiredWallpaperIds(ids);
    const account = await this.getChannelAccountForPublish(accountId);
    if (!account) throw new BadRequestException("未配置腾讯频道账号");
    const wallpapers = await this.prisma.wallpaper.findMany({
      where: { id: { in: uniqueIds } },
      include: { tags: { include: { tag: true } } },
      orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
    });
    if (!wallpapers.length) throw new BadRequestException("没有可发布的壁纸");
    if (wallpapers.length !== uniqueIds.length) throw new BadRequestException("存在未找到的壁纸，无法发布到频道");
    await this.assertWallpapersCanPublish(wallpapers.map((item) => item.id));
    const liveItems = wallpapers.filter((item) => item.mimeType?.startsWith("video/") || item.type === WallpaperType.live);
    if (liveItems.length > 1 || (liveItems.length === 1 && wallpapers.length > 1)) {
      throw new BadRequestException("动态壁纸一次只能发布 1 个，不能和静态图混发");
    }
    if (!liveItems.length && wallpapers.length > 18) {
      throw new BadRequestException("静态壁纸一次最多发布 18 张图");
    }
    assertChannelMediaReady(wallpapers.map((item) => ({
      title: item.title,
      isVideo: item.mimeType?.startsWith("video/") || item.type === WallpaperType.live,
      coverPath: item.coverPath ? join(process.cwd(), "storage", "public", item.coverPath) : undefined,
      assetPath: item.assetPath ? join(process.cwd(), "storage", "public", item.assetPath) : undefined,
    })));

    const tags = unique(wallpapers.flatMap((item) => item.tags.map(({ tag }) => tag.name))).slice(0, 8);
    const content = buildChannelContent(wallpapers.length === 1 ? wallpapers[0].title : `${wallpapers[0].title} 等 ${wallpapers.length} 张壁纸`);
    const imagePaths = liveItems.length
      ? []
      : wallpapers
        .map((item) => item.assetPath
          ? join(process.cwd(), "storage", "public", item.assetPath)
          : item.coverPath ? join(process.cwd(), "storage", "public", item.coverPath) : undefined)
        .filter((item): item is string => Boolean(item));
    const videoPaths = liveItems.length && liveItems[0].assetPath
      ? [join(process.cwd(), "storage", "public", liveItems[0].assetPath)]
      : [];
    return this.channel.publish({
      accountId: account.id,
      content,
      imagePaths,
      videoPaths,
      topicNames: tags,
    });
  }

  listChannels() {
    return this.channel.listAccounts();
  }

  discoverChannelGuilds(token: string) {
    return this.channel.discoverGuilds(token);
  }

  discoverChannelChannels(token: string, guildId: string) {
    return this.channel.discoverChannels(token, guildId);
  }

  saveChannelAccount(input: Parameters<ChannelService["saveAccount"]>[0]) {
    return this.channel.saveAccount(input);
  }

  updateChannelLabel(id: string, label: string) {
    return this.channel.updateLabel(id, label);
  }

  setDefaultChannel(id: string) {
    return this.channel.setDefaultAccount(id);
  }

  async deleteChannel(id: string) {
    const result = await this.channel.deleteAccount(id);
    const defaultAccount = await this.channel.getDefaultAccount();
    if (!defaultAccount) {
      await this.updateSettings({ defaultAutoPublish: false });
    }
    return result;
  }

  listStorageAccounts() {
    return this.storageAccounts.listAccounts();
  }

  saveStorageAccount(input: Parameters<StorageAccountService["createAccount"]>[0]) {
    return this.storageAccounts.createAccount(input);
  }

  updateStorageAccountLabel(id: string, label: string) {
    return this.storageAccounts.updateLabel(id, label);
  }

  setDefaultStorageAccount(id: string) {
    return this.storageAccounts.setDefaultAccount(id);
  }

  deleteStorageAccount(id: string) {
    return this.storageAccounts.deleteAccount(id);
  }

  startStorageAuth(id: string) {
    return this.storageAccountAction(id, "start-auth");
  }

  finishStorageAuth(id: string, code: string) {
    return this.storageAccountAction(id, "finish-auth", code);
  }

  probeStorageAccount(id: string) {
    return this.storageAccounts.probeAccount(id);
  }

  async backfillOrientation() {
    const wallpapers = await this.prisma.wallpaper.findMany({
      where: { coverPath: { not: null } },
      select: { id: true, coverPath: true },
    });
    let updated = 0;
    let skipped = 0;
    for (const wallpaper of wallpapers) {
      if (!wallpaper.coverPath) {
        skipped += 1;
        continue;
      }
      const absolute = join(process.cwd(), "storage", "public", wallpaper.coverPath);
      if (!existsSync(absolute)) {
        skipped += 1;
        continue;
      }
      const orientation = await detectOrientation(absolute).catch(() => "unknown" as WallpaperOrientation);
      await this.prisma.wallpaper.update({ where: { id: wallpaper.id }, data: { orientation } });
      updated += 1;
    }
    return { total: wallpapers.length, updated, skipped };
  }

  private async persistFile(file: Express.Multer.File) {
    const dir = join(process.cwd(), "storage", "public", "originals");
    await mkdir(dir, { recursive: true });
    const extension = safeExtension(file.originalname);
    const fileName = `${Date.now()}-${nanoid(10)}${extension}`;
    const path = join(dir, fileName);
    await writeFile(path, file.buffer);
    return {
      path,
      relativePath: `originals/${fileName}`,
      originalName: file.originalname,
      mimeType: file.mimetype,
    };
  }

  private assertUploadFile(file: Express.Multer.File) {
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(`不支持的文件格式：${file.originalname}`);
    }
    const maxBytes = Math.max(1, Number(this.config.get("UPLOAD_MAX_FILE_MB") || DEFAULT_UPLOAD_MAX_FILE_MB)) * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new BadRequestException(`文件超过大小限制：${file.originalname}，当前限制 ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
  }

  private async createCover(filePath: string, mimeType: string) {
    const dir = join(process.cwd(), "storage", "public", "covers");
    await mkdir(dir, { recursive: true });
    const fileName = `${Date.now()}-${nanoid(10)}.jpg`;
    const output = join(dir, fileName);
    if (mimeType.startsWith("image/") && existsSync(filePath)) {
      await sharp(filePath).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(output);
    } else if (mimeType.startsWith("video/") && existsSync(filePath) && await this.createVideoCover(filePath, output)) {
      // ffmpeg extracted the first frame into output.
    } else {
      await sharp({
        create: {
          width: 900,
          height: 506,
          channels: 3,
          background: "#101827",
        },
      }).jpeg({ quality: 82 }).toFile(output);
    }
    return { path: output, relativePath: `covers/${fileName}` };
  }

  private async removeUploadedFile(filePath?: string) {
    if (!filePath) return;
    await unlink(filePath).catch(() => undefined);
  }

  private async createVideoCover(filePath: string, output: string): Promise<boolean> {
    const ffmpeg = this.config.get<string>("FFMPEG_PATH")?.trim() || "ffmpeg";
    const result = await runCli(ffmpeg, [
      "-y",
      "-ss",
      "00:00:01",
      "-i",
      filePath,
      "-frames:v",
      "1",
      "-vf",
      "scale='min(900,iw)':-2",
      "-q:v",
      "3",
      output,
    ], { timeoutMs: 60_000 });
    return result.ok && existsSync(output);
  }

  private async assertWallpapersCanPublish(ids: string[]) {
    const uniqueIds = unique(ids);
    if (!uniqueIds.length) throw new BadRequestException("请选择壁纸");
    const blocked = await this.prisma.wallpaper.findMany({
      where: {
        id: { in: uniqueIds },
        OR: [
          { aiAnalysis: null },
          { aiAnalysis: { safe: false } },
          { status: WallpaperStatus.rejected },
        ],
      },
      select: {
        title: true,
        aiAnalysis: { select: { safe: true, sensitiveFlags: true } },
        status: true,
      },
      take: 5,
    });
    if (blocked.length) {
      const names = blocked.map((item) => item.title).join("、");
      throw new BadRequestException(`存在未通过 AI 审核的壁纸，禁止上架或发帖：${names}`);
    }
    const missingDownloads = await this.prisma.wallpaper.findMany({
      where: {
        id: { in: uniqueIds },
        OR: [
          { storageLinks: { none: { isActive: true } } },
          { shortLinks: { none: { storageLink: { isActive: true } } } },
        ],
      },
      select: { title: true },
      take: 5,
    });
    if (missingDownloads.length) {
      const names = missingDownloads.map((item) => item.title).join("、");
      throw new BadRequestException(`存在没有可用网盘短链的壁纸，禁止上架或发帖：${names}`);
    }
  }

  private async assertChannelReady(message: string, accountId?: string) {
    const account = await this.getChannelAccountForPublish(accountId);
    if (!account) throw new BadRequestException(message);
  }

  private async assertStorageReady(storageSelection?: StorageSelection) {
    const [quark, baidu] = await Promise.allSettled([
      this.storageAccounts.getAccountForProvider(StorageProvider.quark, storageSelection?.quarkAccountId),
      this.storageAccounts.getAccountForProvider(StorageProvider.baidu, storageSelection?.baiduAccountId),
    ]);
    const selectedError = [quark, baidu].find((result) => result.status === "rejected" && storageSelection);
    if (selectedError?.status === "rejected") throw selectedError.reason;
    const hasAccount = (quark.status === "fulfilled" && quark.value) || (baidu.status === "fulfilled" && baidu.value);
    if (!hasAccount) {
      throw new BadRequestException("未配置可用网盘账号，不能开启自动处理。请先在管理端“网盘账号”新增、授权并至少设置一个默认账号");
    }
  }

  private async getChannelAccountForPublish(accountId?: string) {
    const id = accountId?.trim();
    if (id) return this.prisma.channelAccount.findUnique({ where: { id } });
    return this.channel.getDefaultAccount();
  }

  private async checkDatabase(): Promise<DiagnosticItem> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return ok("database", "数据库", "MySQL 连接正常");
    } catch (error) {
      return fail("database", "数据库", `MySQL 连接失败：${shortError(error)}`);
    }
  }

  private async checkRedis(): Promise<DiagnosticItem> {
    const redis = new Redis({
      host: this.config.get<string>("REDIS_HOST") || "127.0.0.1",
      port: Number(this.config.get("REDIS_PORT") || 6379),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    try {
      await redis.connect();
      const pong = await redis.ping();
      return pong === "PONG" ? ok("redis", "Redis 队列", "Redis 连接正常") : warn("redis", "Redis 队列", `Redis 返回异常：${pong}`);
    } catch (error) {
      return fail("redis", "Redis 队列", `Redis 连接失败：${shortError(error)}`);
    } finally {
      redis.disconnect();
    }
  }

  private async checkWritableStorage(): Promise<DiagnosticItem> {
    try {
      const dir = resolve(process.cwd(), "storage", "public", "diagnostics");
      await mkdir(dir, { recursive: true });
      const filePath = join(dir, `.write-${Date.now()}.txt`);
      await writeFile(filePath, "ok");
      await unlink(filePath).catch(() => undefined);
      return ok("storage", "本地缩略图存储", "storage/public 可写");
    } catch (error) {
      return fail("storage", "本地缩略图存储", `storage/public 不可写：${shortError(error)}`);
    }
  }

  private checkPublicOrigins(): DiagnosticItem {
    const expected = {
      PUBLIC_API_ORIGIN: "https://wall-api.wdbzk.com",
      ADMIN_ORIGIN: "https://wall-admin.wdbzk.com",
      SHORT_LINK_ORIGIN: "https://r.wdbzk.com",
    };
    const mismatches = Object.entries(expected).flatMap(([key, expectedValue]) => {
      const value = (this.config.get<string>(key) || "").replace(/\/$/, "");
      if (!value) return [`${key} 未配置`];
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:") return [`${key} 必须使用 HTTPS`];
      } catch {
        return [`${key} 不是合法 URL`];
      }
      return value === expectedValue ? [] : [`${key} 当前为 ${value}`];
    });
    if (mismatches.length) {
      return fail("public_origins", "公开域名配置", mismatches.join("；"));
    }
    return ok("public_origins", "公开域名配置", "API、后台和短链域名配置正确");
  }

  private checkMiniprogramReleaseConfig(): DiagnosticItem {
    try {
      const project = readJsonFile<{ appid?: string; setting?: { urlCheck?: boolean } }>("apps/miniprogram/project.config.json");
      const domains = readJsonFile<{ request?: string[]; downloadFile?: string[]; businessDomain?: string[] }>("deploy/wechat-miniprogram-domains.json");
      const apiText = readFileSync(resolve(process.cwd(), "apps/miniprogram/utils/api.ts"), "utf8");
      const issues: string[] = [];
      const warnings: string[] = [];
      const appid = project.appid?.trim() || this.config.get<string>("MINIPROGRAM_APPID")?.trim() || this.config.get<string>("WECHAT_MINIPROGRAM_APPID")?.trim();
      if (!appid) warnings.push("AppID 未填写");
      else if (!/^wx[a-zA-Z0-9]{16,24}$/.test(appid)) issues.push("AppID 格式不正确");
      if (project.setting?.urlCheck !== true) issues.push("urlCheck 未开启");
      if (!apiText.includes('const API_BASE = "https://wall-api.wdbzk.com/api"')) issues.push("API 地址不是 https://wall-api.wdbzk.com/api");
      if (!domains.request?.includes("https://wall-api.wdbzk.com")) issues.push("request 合法域名缺少 wall-api.wdbzk.com");
      if (!domains.downloadFile?.includes("https://wall-api.wdbzk.com")) issues.push("downloadFile 合法域名缺少 wall-api.wdbzk.com");
      const shortDomainConfigured = [...(domains.request || []), ...(domains.downloadFile || []), ...(domains.businessDomain || [])].includes("https://r.wdbzk.com");
      if (shortDomainConfigured) issues.push("r.wdbzk.com 应只作为复制文本，不应配置为小程序请求域名");
      if (issues.length) return fail("miniprogram_release", "微信小程序发布", issues.join("；"));
      if (warnings.length) return warn("miniprogram_release", "微信小程序发布", `${warnings.join("；")}。其余页面、API 和合法域名策略已通过静态检查`);
      return ok("miniprogram_release", "微信小程序发布", "AppID、API 地址和合法域名策略已就绪");
    } catch (error) {
      return warn("miniprogram_release", "微信小程序发布", `小程序发布配置检查失败：${shortError(error)}`);
    }
  }

  private async checkCommand(key: string, label: string, command: string, args: string[]): Promise<DiagnosticItem> {
    const result = await runCli(command, args, { timeoutMs: 15_000 });
    if (result.ok) return ok(key, label, "命令可执行");
    return fail(key, label, `命令不可用：${shortError(result.stderr || result.stdout || `exit ${result.code}`)}`);
  }

  private async checkBaiduStorage(): Promise<DiagnosticItem> {
    try {
      const result = await this.storageAccounts.probeDefault(StorageProvider.baidu);
      const label = "account" in result ? result.account?.label || "" : "";
      return result.ok
        ? ok("bdpan", "百度网盘账号", `默认账号 ${label} 已登录且可用`)
        : fail("bdpan", "百度网盘账号", `百度网盘不可用：${shortError(result.message)}。请在管理端“网盘账号”中新增或重新授权百度账号`);
    } catch (error) {
      const result = await this.baiduStorage.probe().catch((legacyError) => ({ ok: false, message: (legacyError as Error).message }));
      return result.ok
        ? warn("bdpan", "百度网盘账号", "服务器级 bdpan 已登录，但尚未迁移到管理端多账号配置")
        : fail("bdpan", "百度网盘账号", `百度网盘探测失败：${shortError(error)}。请在管理端“网盘账号”中配置默认百度账号`);
    }
  }

  private async checkQuarkStorage(): Promise<DiagnosticItem> {
    try {
      const result = await this.storageAccounts.probeDefault(StorageProvider.quark);
      const label = "account" in result ? result.account?.label || "" : "";
      return result.ok
        ? ok("quark_skill", "夸克网盘账号", `默认账号 ${label} 已登录且可用`)
        : fail("quark_skill", "夸克网盘账号", `夸克网盘不可用：${shortError(result.message)}。请在管理端“网盘账号”中新增或重新授权夸克账号`);
    } catch (error) {
      const result = await this.quarkStorage.probe().catch((legacyError) => ({ ok: false, message: (legacyError as Error).message }));
      return result.ok
        ? warn("quark_skill", "夸克网盘账号", "服务器级夸克 skill 已登录，但尚未迁移到管理端多账号配置")
        : fail("quark_skill", "夸克网盘账号", `夸克网盘探测失败：${shortError(error)}。请在管理端“网盘账号”中配置默认夸克账号`);
    }
  }

  private checkOldCoverSource(): DiagnosticItem {
    const explicitDir = this.config.get<string>("OLD_COVER_SOURCE_DIR")?.trim();
    const root = this.config.get<string>("OLD_WALLPAPER_ROOT")?.trim();
    const dir = explicitDir || (root ? join(root, "covers") : "");
    if (!dir) return warn("old_covers", "旧站封面目录", "未配置 OLD_WALLPAPER_ROOT/OLD_COVER_SOURCE_DIR，将从旧站公网下载封面");
    if (!existsSync(dir)) return warn("old_covers", "旧站封面目录", `未找到 ${dir}，迁移时会回退公网下载`);
    return ok("old_covers", "旧站封面目录", `本地旧封面目录可用：${dir}`);
  }

  private async checkPanapi(): Promise<DiagnosticItem> {
    if (!this.config.get<string>("PANAPI_TOKEN")?.trim()) {
      return fail("panapi", "wdbzk 资源库", "未配置 PANAPI_TOKEN");
    }
    try {
      await this.wdbzk.listResources(1, 1);
      return ok("panapi", "wdbzk 资源库", "panapi 可访问");
    } catch (error) {
      return fail("panapi", "wdbzk 资源库", `panapi 调用失败：${shortError(error)}`);
    }
  }

  private async checkWallhaven(): Promise<DiagnosticItem> {
    const base = this.config.get<string>("WALLHAVEN_API_BASE")?.trim() || "https://wallhaven.cc/api/v1";
    try {
      const response = await fetch(`${base}/search?q=cat&atleast=1920x1080&sorting=random&page=1`, {
        signal: AbortSignal.timeout(12_000),
        headers: { "User-Agent": "wallpaper-manager/1.0" },
      });
      if (!response.ok) return fail("wallhaven", "Wallhaven API", `HTTP ${response.status}，无法访问`);
      const body = (await response.json()) as { meta?: { total?: number } };
      const total = body.meta?.total ?? 0;
      return ok("wallhaven", "Wallhaven API", `可访问，检索返回 ${total} 张`);
    } catch (error) {
      return fail("wallhaven", "Wallhaven API", `连通失败：${shortError(error)}`);
    }
  }

  private checkDeepSeekConfig(): DiagnosticItem {
    if (!this.config.get<string>("DEEPSEEK_API_KEY")?.trim()) {
      return fail("deepseek", "DeepSeek 识图", "未配置 DEEPSEEK_API_KEY");
    }
    return ok("deepseek", "DeepSeek 识图", `已配置模型 ${this.config.get<string>("DEEPSEEK_MODEL") || "deepseek-v4-flash-vision-exp"}`);
  }

  private async checkTencentCli(): Promise<DiagnosticItem> {
    const configured = this.config.get<string>("TENCENT_CHANNEL_CLI")?.trim();
    if (configured) return this.checkCommand("tencent_cli", "腾讯频道 CLI", configured, ["--help"]);
    const wrapper = resolve(process.cwd(), "node_modules", "tencent-channel-cli", "bin", "tencent-channel-cli");
    if (existsSync(wrapper)) {
      return this.checkCommand("tencent_cli", "腾讯频道 CLI", process.execPath, [wrapper, "--help"]);
    }
    const runner = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npx";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", "npx -y tencent-channel-cli --help"] : ["-y", "tencent-channel-cli", "--help"];
    const result = await runCli(runner, args, { timeoutMs: 30_000 });
    if (result.ok) return ok("tencent_cli", "腾讯频道 CLI", "tencent-channel-cli 可通过 npx 调用");
    return warn("tencent_cli", "腾讯频道 CLI", `tencent-channel-cli 不可用：${shortError(result.stderr || result.stdout)}`);
  }

  private async checkChannelAccounts(): Promise<DiagnosticItem> {
    const [count, defaultCount] = await Promise.all([
      this.prisma.channelAccount.count(),
      this.prisma.channelAccount.count({ where: { isDefault: true } }),
    ]);
    if (count > 0 && defaultCount > 0) return ok("channel_accounts", "腾讯频道账号", `已配置 ${count} 个频道账号，默认账号已设置`);
    if (count > 0) return warn("channel_accounts", "腾讯频道账号", `已配置 ${count} 个频道账号，但未设置默认账号`);
    return warn("channel_accounts", "腾讯频道账号", "尚未在后台配置频道账号");
  }

  private async checkUnpublishedActiveShortLinks(): Promise<DiagnosticItem> {
    const count = await this.prisma.wallpaper.count({
      where: {
        status: { not: WallpaperStatus.published },
        shortLinks: { some: { storageLink: { isActive: true } } },
      },
    });
    if (!count) {
      return ok("unpublished_active_short_links", "下架短链", "非上架资源没有活跃短链遗留");
    }
    return warn("unpublished_active_short_links", "下架短链", `存在 ${count} 个非上架资源仍有关联活跃短链，公开跳转已拦截，可在资源库筛选后清理链接状态`);
  }

  private async storageAccountAction(id: string, action: "start-auth" | "finish-auth", code?: string) {
    const account = await this.prisma.storageAccount.findUnique({ where: { id } });
    if (!account) throw new BadRequestException("网盘账号不存在");
    if (account.provider === StorageProvider.baidu) {
      return action === "start-auth"
        ? this.storageAccounts.startBaiduAuth(id)
        : this.storageAccounts.finishBaiduAuth(id, code || "");
    }
    return action === "start-auth"
      ? this.storageAccounts.startQuarkAuth(id)
      : this.storageAccounts.finishQuarkAuth(id, code || "");
  }

  private assertLoginAllowed(key: string) {
    const attempt = loginAttempts.get(key);
    if (!attempt) return;
    const now = Date.now();
    if (attempt.lockedUntil && attempt.lockedUntil > now) {
      const minutes = Math.ceil((attempt.lockedUntil - now) / 60_000);
      throw new UnauthorizedException(`登录失败次数过多，请 ${minutes} 分钟后再试`);
    }
    if (now - attempt.lastFailedAt > LOGIN_WINDOW_MS) {
      loginAttempts.delete(key);
    }
  }

  private recordLoginFailure(key: string) {
    const now = Date.now();
    const previous = loginAttempts.get(key);
    const count = previous && now - previous.lastFailedAt <= LOGIN_WINDOW_MS ? previous.count + 1 : 1;
    loginAttempts.set(key, {
      count,
      lastFailedAt: now,
      lockedUntil: count >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCK_MS : undefined,
    });
  }
}

async function detectOrientation(path: string): Promise<WallpaperOrientation> {
  const meta = await sharp(path).metadata();
  const width = meta.width || 0;
  const height = meta.height || 0;
  if (!width || !height) return "unknown";
  const ratio = width / height;
  if (ratio > 1.2) return "landscape";
  if (ratio < 0.833) return "portrait";
  return "square";
}

function safeExtension(name: string): string {
  const extension = extname(name).toLowerCase();
  return extension && extension.length <= 8 ? extension : ".bin";
}

function detectType(mimeType: string, name: string): WallpaperType {
  if (mimeType.startsWith("video/")) return WallpaperType.live;
  if (mimeType.startsWith("image/")) return WallpaperType.static;
  return /\b(mp4|mov|webm|live|动态)\b/i.test(name) ? WallpaperType.live : WallpaperType.static;
}

function orientationFromDimensions(width: number, height: number): WallpaperOrientation {
  if (!width || !height) return WallpaperOrientation.unknown;
  if (height > width) return WallpaperOrientation.portrait;
  if (width > height) return WallpaperOrientation.landscape;
  return WallpaperOrientation.square;
}

function clampAutoInterval(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 4;
  return Math.min(72, Math.max(1, Math.round(value)));
}


function buildChannelContent(title: string): string {
  return title.trim().slice(0, 1000);
}

function assertChannelMediaReady(items: Array<{ title: string; isVideo: boolean; coverPath?: string; assetPath?: string }>) {
  const missing = items.flatMap((item) => {
    if (item.isVideo) {
      return item.assetPath && existsSync(item.assetPath) ? [] : [`${item.title} 缺少动态原文件`];
    }
    if (item.assetPath && existsSync(item.assetPath)) return [];
    return item.coverPath && existsSync(item.coverPath) ? [] : [`${item.title} 缺少源文件或封面图`];
  });
  if (missing.length) {
    throw new BadRequestException(`频道发帖素材不完整：${missing.slice(0, 5).join("、")}`);
  }
}

function assertHttpUrl(value: string | undefined, label: string) {
  const url = String(value || "").trim();
  if (!url) throw new BadRequestException(`${label}不能为空`);
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    // Fall through to a consistent business error.
  }
  throw new BadRequestException(`${label}必须是 http 或 https 地址`);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function requiredWallpaperIds(ids: string[] | undefined): string[] {
  if (!Array.isArray(ids)) throw new BadRequestException("请先选择资源");
  const wallpaperIds = unique(ids.map((id) => String(id).trim()));
  if (!wallpaperIds.length) throw new BadRequestException("请先选择资源");
  return wallpaperIds;
}

function aiReviewWhere(value?: AiReviewFilter): Prisma.WallpaperWhereInput {
  if (value === "unreviewed") return { aiAnalysis: null };
  if (value === "safe") return { aiAnalysis: { safe: true } };
  if (value === "blocked") return { aiAnalysis: { safe: false } };
  return {};
}

function storageWhere(value?: StorageFilter): Prisma.WallpaperWhereInput {
  if (value === "has_quark") return { storageLinks: { some: { provider: StorageProvider.quark, isActive: true } } };
  if (value === "has_baidu") return { storageLinks: { some: { provider: StorageProvider.baidu, isActive: true } } };
  if (value === "missing_quark") return { storageLinks: { none: { provider: StorageProvider.quark, isActive: true } } };
  if (value === "missing_baidu") return { storageLinks: { none: { provider: StorageProvider.baidu, isActive: true } } };
  if (value === "missing_active") return { storageLinks: { none: { isActive: true } } };
  if (value === "missing_short") return { shortLinks: { none: {} } };
  if (value === "unpublished_active_short") {
    return {
      status: { not: WallpaperStatus.published },
      shortLinks: { some: { storageLink: { isActive: true } } },
    };
  }
  return {};
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8")) as T;
}

function ok(key: string, label: string, message: string): DiagnosticItem {
  return { key, label, status: "ok", message };
}

function warn(key: string, label: string, message: string): DiagnosticItem {
  return { key, label, status: "warn", message };
}

function fail(key: string, label: string, message: string, command?: string): DiagnosticItem {
  return { key, label, status: "fail", message, command };
}

function readinessAction(item: DiagnosticItem): ReadinessAction {
  const base: ReadinessAction = {
    ...item,
    nextStep: item.command ? "复制命令到宝塔终端执行，完成后重新运行本检查。" : "按诊断信息处理后重新运行本检查。",
  };
  if (item.key === "bdpan") {
    return {
      ...base,
      nextStep: "打开管理端“网盘账号”，新增或选择百度账号，点击授权，打开链接后把授权码粘贴回后台并设为默认账号。",
    };
  }
  if (item.key === "quark_skill") {
    return {
      ...base,
      nextStep: "打开管理端“网盘账号”，新增或选择夸克账号，点击授权，打开链接后把 code 授权码粘贴回后台并设为默认账号。",
    };
  }
  if (item.key === "channel_accounts") {
    return {
      ...base,
      nextStep: "打开管理端的腾讯频道账号配置，新增账号 token，选择频道/版块，并设置一个默认账号。",
    };
  }
  if (item.key === "miniprogram_release") {
    return {
      ...base,
      nextStep: "按 docs/deployment.md 的“微信小程序发布”章节处理：填写 AppID，确认 wall-api.wdbzk.com 合法域名，保持 r.wdbzk.com 只作为复制短链文本。",
    };
  }
  if (item.key === "unpublished_active_short_links") {
    return {
      ...base,
      nextStep: "在管理端资源库筛选“下架活跃短链”，确认后点击批量清理。公开跳转当前已经被后端拦截。",
    };
  }
  return base;
}

function formatReadinessReport(data: {
  diagnostics: Record<DiagnosticItem["status"], number>;
  wallpapers: { total: number; published: number; pendingReview: number };
  storage: { activeQuark: number; activeBaidu: number; missingActiveLinks: number; unpublishedActiveShortLinks: number };
  settings: SystemSettings;
  actions: ReadinessAction[];
}): string {
  const lines = [
    "Wallpaper Manager readiness",
    `Diagnostics: ok ${data.diagnostics.ok}, warn ${data.diagnostics.warn}, fail ${data.diagnostics.fail}`,
    `Wallpapers: total ${data.wallpapers.total}, published ${data.wallpapers.published}, pendingReview ${data.wallpapers.pendingReview}`,
    `Storage: quark ${data.storage.activeQuark}, baidu ${data.storage.activeBaidu}, missingActive ${data.storage.missingActiveLinks}, unpublishedActiveShort ${data.storage.unpublishedActiveShortLinks}`,
    `Defaults: autoProcess ${data.settings.defaultAutoProcess}, autoPublish ${data.settings.defaultAutoPublish}`,
    "",
  ];
  if (!data.actions.length) {
    lines.push("Ready: no failed or warning diagnostics.");
    return lines.join("\n");
  }
  lines.push("Action required:");
  for (const action of data.actions) {
    lines.push(`- [${action.status}] ${action.label} (${action.key})`);
    lines.push(`  ${action.message}`);
    if (action.command) lines.push(`  Command: ${action.command}`);
    lines.push(`  Next: ${action.nextStep}`);
  }
  return lines.join("\n");
}

function shortError(error: unknown): string {
  return String(error instanceof Error ? error.message : error).replace(/\s+/g, " ").slice(0, 240);
}
