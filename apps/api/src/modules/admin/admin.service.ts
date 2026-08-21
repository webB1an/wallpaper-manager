import { Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import sharp from "sharp";
import { nanoid } from "nanoid";
import { StorageProvider, WallpaperStatus, WallpaperType } from "@prisma/client";
import { runCli } from "../../common/cli";
import { publicAssetUrl } from "../../common/public-url";
import { AiService } from "../ai/ai.service";
import { ChannelService } from "../channel/channel.service";
import { PrismaService } from "../prisma/prisma.service";
import { StorageCoordinatorService } from "../storage/storage-coordinator.service";
import { TasksService } from "../tasks/tasks.service";
import { WdbzkService } from "../wdbzk/wdbzk.service";
import { WALLPAPER_QUEUE } from "./admin.queue";

type SystemSettings = {
  defaultAutoProcess: boolean;
  defaultAutoPublish: boolean;
};

type DiagnosticItem = {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail";
  message: string;
};

const DEFAULT_SETTINGS: SystemSettings = {
  defaultAutoProcess: true,
  defaultAutoPublish: false,
};

const loginAttempts = new Map<string, { count: number; lockedUntil?: number; lastFailedAt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 10 * 60_000;
const LOGIN_LOCK_MS = 10 * 60_000;

@Injectable()
export class AdminService {
  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly channel: ChannelService,
    private readonly storage: StorageCoordinatorService,
    private readonly wdbzk: WdbzkService,
    private readonly tasks: TasksService,
    @InjectQueue(WALLPAPER_QUEUE) private readonly wallpaperQueue: Queue,
  ) {}

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

  async createUpload(files: Express.Multer.File[], options?: { autoProcess?: boolean; autoPublish?: boolean }) {
    const settings = await this.getSettings();
    const autoProcess = options?.autoProcess ?? settings.defaultAutoProcess;
    const autoPublish = options?.autoPublish ?? settings.defaultAutoPublish;
    const created = [];
    for (const file of files) {
      const saved = await this.persistFile(file);
      const cover = await this.createCover(saved.path, saved.mimeType);
      const wallpaper = await this.prisma.wallpaper.create({
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
          autoPublish,
        },
      });
      const queued = autoProcess ? await this.enqueueProcessWallpaper(wallpaper.id) : undefined;
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
    const value: SystemSettings = {
      ...current,
      ...(typeof input.defaultAutoProcess === "boolean" ? { defaultAutoProcess: input.defaultAutoProcess } : {}),
      ...(typeof input.defaultAutoPublish === "boolean" ? { defaultAutoPublish: input.defaultAutoPublish } : {}),
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
    checks.push(await this.checkCommand("ffmpeg", "ffmpeg 视频封面", this.config.get<string>("FFMPEG_PATH")?.trim() || "ffmpeg", ["-version"]));
    checks.push(await this.checkCommand("bdpan", "百度网盘 bdpan", this.config.get<string>("BDPAN_PATH")?.trim() || "bdpan", ["--version"]));
    checks.push(this.checkQuarkSkill());
    checks.push(this.checkOldCoverSource());
    checks.push(await this.checkPanapi());
    checks.push(this.checkDeepSeekConfig());
    checks.push(await this.checkTencentCli());
    checks.push(await this.checkChannelAccounts());

    return checks;
  }

  async analyzeNow(wallpaperId: string) {
    const wallpaper = await this.prisma.wallpaper.findUnique({ where: { id: wallpaperId } });
    if (!wallpaper?.coverPath) throw new Error("壁纸或封面不存在");
    const coverPath = join(process.cwd(), "storage", "public", wallpaper.coverPath);
    const analysis = await this.ai.analyzeImage(coverPath, wallpaper.originalName);
    const tags = await Promise.all(analysis.tags.map((name) => this.prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name },
    })));
    await this.prisma.aiAnalysis.upsert({
      where: { wallpaperId },
      update: {
        title: analysis.title,
        type: analysis.type,
        tags: analysis.tags,
        sensitiveFlags: analysis.sensitiveFlags,
        safe: analysis.safe,
        summary: analysis.summary,
      },
      create: {
        wallpaperId,
        title: analysis.title,
        type: analysis.type,
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
        type: analysis.type,
        status: analysis.safe ? WallpaperStatus.pending_review : WallpaperStatus.rejected,
        tags: {
          deleteMany: {},
          create: tags.map((tag) => ({ tagId: tag.id })),
        },
      },
    });
    return analysis;
  }

  async listWallpapers(query: { page?: number; pageSize?: number; keyword?: string; status?: WallpaperStatus }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword ? { title: { contains: query.keyword } } : {}),
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
    return { list, total, page, pageSize };
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
    if (!wallpaper) throw new Error("壁纸不存在");
    if (data.isPrimary) {
      await this.prisma.storageLink.updateMany({
        where: { wallpaperId: id, provider: data.provider },
        data: { isPrimary: false },
      });
    }
    const storageLink = await this.prisma.storageLink.create({
      data: {
        wallpaperId: id,
        provider: data.provider,
        url: data.url,
        passcode: data.passcode,
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
        where: { wallpaperId: link.wallpaperId, provider: link.provider },
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

  async bulkUpdate(ids: string[], data: { status?: WallpaperStatus; tags?: string[] }) {
    if (data.status === WallpaperStatus.published) {
      await this.assertWallpapersCanPublish(ids);
    }
    if (data.status) {
      await this.prisma.wallpaper.updateMany({ where: { id: { in: ids } }, data: { status: data.status } });
    }
    if (data.tags) {
      const tags = await Promise.all(data.tags.map((name) => this.prisma.tag.upsert({ where: { name }, update: {}, create: { name } })));
      for (const id of ids) {
        await this.prisma.wallpaper.update({
          where: { id },
          data: { tags: { deleteMany: {}, create: tags.map((tag) => ({ tagId: tag.id })) } },
        });
      }
    }
    return { updated: ids.length };
  }

  async enqueueProcessWallpaper(id: string) {
    const task = await this.tasks.create("upload_asset", { wallpaperId: id }, "开始处理壁纸");
    await this.wallpaperQueue.add(
      "process-wallpaper",
      { wallpaperId: id, taskId: task.id },
      { attempts: 1, removeOnComplete: 200, removeOnFail: 500 },
    );
    return { queued: true, taskId: task.id };
  }

  async enqueueProcessWallpapers(ids: string[]) {
    const queued = [];
    for (const id of ids) {
      queued.push(await this.enqueueProcessWallpaper(id));
    }
    return { queued: queued.length, tasks: queued };
  }

  async processWallpaper(id: string) {
    const task = await this.tasks.create("upload_asset", { wallpaperId: id }, "开始处理壁纸");
    return this.runProcessWallpaper(id, task.id);
  }

  async runProcessWallpaper(id: string, taskId: string) {
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
        const storageResults = await this.storage.syncWallpaper(id, join(process.cwd(), "storage", "public", wallpaper.assetPath), wallpaper.title);
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

      if (wallpaper.autoPublish) {
        await this.tasks.update(taskId, { progress: 84, message: "正在发布到腾讯频道" });
        try {
          taskResult.channel = await this.publishWallpaperToChannel(id);
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

  async publishWallpaperToChannel(id: string) {
    const account = await this.channel.getDefaultAccount();
    if (!account) throw new Error("未配置腾讯频道账号");
    const wallpaper = await this.prisma.wallpaper.findUnique({
      where: { id },
      include: { tags: { include: { tag: true } } },
    });
    if (!wallpaper) throw new Error("壁纸不存在");
    await this.assertWallpapersCanPublish([id]);
    const content = buildChannelContent(wallpaper.title, wallpaper.tags.map(({ tag }) => tag.name));
    const absoluteAsset = wallpaper.assetPath ? join(process.cwd(), "storage", "public", wallpaper.assetPath) : undefined;
    const absoluteCover = wallpaper.coverPath ? join(process.cwd(), "storage", "public", wallpaper.coverPath) : undefined;
    const isVideo = wallpaper.mimeType?.startsWith("video/") || wallpaper.type === WallpaperType.live;
    return this.channel.publish({
      accountId: account.id,
      content,
      imagePaths: isVideo ? [] : absoluteCover ? [absoluteCover] : [],
      videoPaths: isVideo && absoluteAsset ? [absoluteAsset] : [],
      topicNames: wallpaper.tags.map(({ tag }) => tag.name).slice(0, 6),
    });
  }

  async publishWallpapersToChannel(ids: string[], accountId?: string) {
    const account = accountId
      ? await this.prisma.channelAccount.findUnique({ where: { id: accountId } })
      : await this.channel.getDefaultAccount();
    if (!account) throw new Error("未配置腾讯频道账号");
    const wallpapers = await this.prisma.wallpaper.findMany({
      where: { id: { in: ids } },
      include: { tags: { include: { tag: true } } },
      orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
    });
    if (!wallpapers.length) throw new Error("没有可发布的壁纸");
    await this.assertWallpapersCanPublish(wallpapers.map((item) => item.id));
    const liveItems = wallpapers.filter((item) => item.mimeType?.startsWith("video/") || item.type === WallpaperType.live);
    if (liveItems.length > 1 || (liveItems.length === 1 && wallpapers.length > 1)) {
      throw new Error("动态壁纸一次只能发布 1 个，不能和静态图混发");
    }
    if (!liveItems.length && wallpapers.length > 18) {
      throw new Error("静态壁纸一次最多发布 18 张图");
    }

    const tags = unique(wallpapers.flatMap((item) => item.tags.map(({ tag }) => tag.name))).slice(0, 8);
    const content = buildChannelContent(
      wallpapers.length === 1 ? wallpapers[0].title : `${wallpapers[0].title} 等 ${wallpapers.length} 张壁纸`,
      tags,
    );
    const imagePaths = liveItems.length
      ? []
      : wallpapers
        .map((item) => item.coverPath ? join(process.cwd(), "storage", "public", item.coverPath) : undefined)
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

  setDefaultChannel(id: string) {
    return this.channel.setDefaultAccount(id);
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
    if (!uniqueIds.length) throw new Error("请选择壁纸");
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
    if (!blocked.length) return;
    const names = blocked.map((item) => item.title).join("、");
    throw new Error(`存在未通过 AI 审核的壁纸，禁止上架或发帖：${names}`);
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

  private async checkCommand(key: string, label: string, command: string, args: string[]): Promise<DiagnosticItem> {
    const result = await runCli(command, args, { timeoutMs: 15_000 });
    if (result.ok) return ok(key, label, "命令可执行");
    return fail(key, label, `命令不可用：${shortError(result.stderr || result.stdout || `exit ${result.code}`)}`);
  }

  private checkQuarkSkill(): DiagnosticItem {
    const skillDir = this.config.get<string>("QUARK_SKILL_DIR")?.trim();
    if (!skillDir) return fail("quark_skill", "夸克 skill", "未配置 QUARK_SKILL_DIR");
    const scriptPath = join(skillDir, "scripts", "quark-drive.cjs");
    if (!existsSync(scriptPath)) return fail("quark_skill", "夸克 skill", `未找到 ${scriptPath}`);
    return ok("quark_skill", "夸克 skill", "skill 目录和上传脚本存在");
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
    const count = await this.prisma.channelAccount.count();
    if (count > 0) return ok("channel_accounts", "腾讯频道账号", `已配置 ${count} 个频道账号`);
    return warn("channel_accounts", "腾讯频道账号", "尚未在后台配置频道账号");
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

function safeExtension(name: string): string {
  const extension = extname(name).toLowerCase();
  return extension && extension.length <= 8 ? extension : ".bin";
}

function detectType(mimeType: string, name: string): WallpaperType {
  if (mimeType.startsWith("video/")) return WallpaperType.live;
  if (/\b(mobile|phone|竖屏|手机)\b/i.test(name)) return WallpaperType.mobile;
  if (mimeType.startsWith("image/")) return WallpaperType.static;
  return WallpaperType.other;
}

function buildChannelContent(title: string, tags: string[]): string {
  const tagLine = tags.slice(0, 6).map((tag) => `#${tag}`).join(" ");
  return [title, tagLine].filter(Boolean).join("\n").slice(0, 1000);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function ok(key: string, label: string, message: string): DiagnosticItem {
  return { key, label, status: "ok", message };
}

function warn(key: string, label: string, message: string): DiagnosticItem {
  return { key, label, status: "warn", message };
}

function fail(key: string, label: string, message: string): DiagnosticItem {
  return { key, label, status: "fail", message };
}

function shortError(error: unknown): string {
  return String(error instanceof Error ? error.message : error).replace(/\s+/g, " ").slice(0, 240);
}
