import { BadRequestException, Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { RewardDownloadType, StorageProvider, WallpaperOrientation, WallpaperStatus, WallpaperType } from "@prisma/client";
import { AdminService } from "./admin.service";
import { AdminAuthGuard } from "./auth.guard";

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
const STORAGE_FILTERS = new Set(["has_quark", "has_baidu", "missing_quark", "missing_baidu", "missing_active", "missing_short", "unpublished_active_short"]);
const AI_REVIEW_FILTERS = new Set(["unreviewed", "safe", "blocked"]);
type StorageFilterQuery = "has_quark" | "has_baidu" | "missing_quark" | "missing_baidu" | "missing_active" | "missing_short" | "unpublished_active_short";
type AiReviewQuery = "unreviewed" | "safe" | "blocked";

@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post("auth/login")
  login(@Body() body: { username: string; password: string }, @Ip() ip: string) {
    return { code: 200, data: this.admin.login(body.username, body.password, ip) };
  }

  @UseGuards(AdminAuthGuard)
  @Get("me")
  me() {
    return { code: 200, data: { ok: true } };
  }

  @UseGuards(AdminAuthGuard)
  @Post("uploads")
  @UseInterceptors(FilesInterceptor("files", 50, {
    limits: { fileSize: uploadMaxBytes() },
    fileFilter: (_request, file, callback) => {
      if (ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) return callback(null, true);
      callback(new BadRequestException(`不支持的文件格式：${file.originalname}`), false);
    },
  }))
  async upload(@UploadedFiles() files: Express.Multer.File[], @Body() body: { autoProcess?: string; autoPublish?: string; quarkAccountId?: string; baiduAccountId?: string; channelAccountId?: string }) {
    const autoProcess = body.autoProcess === undefined ? undefined : body.autoProcess === "true";
    const autoPublish = body.autoPublish === undefined ? undefined : body.autoPublish === "true";
    const data = await this.admin.createUpload(files || [], {
      autoProcess,
      autoPublish,
      storageSelection: cleanStorageSelection(body),
      channelAccountId: body.channelAccountId?.trim() || undefined,
    });
    return { code: 200, data };
  }

  @UseGuards(AdminAuthGuard)
  @Get("settings")
  async settings() {
    return { code: 200, data: await this.admin.getSettings() };
  }

  @UseGuards(AdminAuthGuard)
  @Get("diagnostics")
  async diagnostics() {
    return { code: 200, data: await this.admin.diagnostics() };
  }

  @UseGuards(AdminAuthGuard)
  @Get("readiness")
  async readiness() {
    return { code: 200, data: await this.admin.readiness() };
  }

  @UseGuards(AdminAuthGuard)
  @Get("overview")
  async overview() {
    return { code: 200, data: await this.admin.overview() };
  }

  @UseGuards(AdminAuthGuard)
  @Patch("settings")
  async updateSettings(@Body() body: {
    defaultAutoProcess?: boolean;
    defaultAutoPublish?: boolean;
    rewardDownloadType?: RewardDownloadType;
    autoDownloadEnabled?: boolean;
    autoDownloadIntervalHours?: number;
    autoDownloadTargetGuildId?: string;
    autoDownloadTargetChannelId?: string;
  }) {
    return { code: 200, data: await this.admin.updateSettings(body) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("auto-download/run")
  async runAutoDownload() {
    return { code: 200, data: await this.admin.autoDownloadWallpaper() };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/:id/analyze")
  async analyze(@Param("id") id: string) {
    return { code: 200, data: await this.admin.analyzeNow(id) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/bulk/process")
  async bulkProcess(@Body() body?: { ids?: string[]; quarkAccountId?: string; baiduAccountId?: string }) {
    return { code: 200, data: await this.admin.enqueueProcessWallpapers(body?.ids, cleanStorageSelection(body || {})) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/:id/publish-channel")
  async publishChannel(@Param("id") id: string) {
    return { code: 200, data: await this.admin.publishWallpaperToChannel(id) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/:id/process")
  async process(@Param("id") id: string, @Body() body?: { quarkAccountId?: string; baiduAccountId?: string }) {
    return { code: 200, data: await this.admin.enqueueProcessWallpaper(id, cleanStorageSelection(body || {})) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("channels/publish")
  async publishChannelBatch(@Body() body: { ids: string[]; accountId?: string }) {
    return { code: 200, data: await this.admin.publishWallpapersToChannel(body.ids || [], body.accountId) };
  }

  @UseGuards(AdminAuthGuard)
  @Get("wallpapers")
  async list(@Query() query: { page?: number; pageSize?: number; keyword?: string; status?: WallpaperStatus; type?: WallpaperType; orientation?: WallpaperOrientation; aiReview?: "unreviewed" | "safe" | "blocked"; storage?: string }) {
    const status = optionalEnum(query.status, WallpaperStatus, "壁纸状态");
    const type = optionalEnum(query.type, WallpaperType, "壁纸类型");
    const orientation = optionalEnum(query.orientation, WallpaperOrientation, "壁纸方向");
    const aiReview = optionalSet(query.aiReview, AI_REVIEW_FILTERS, "AI 审核筛选") as AiReviewQuery | undefined;
    const storage = optionalSet(query.storage, STORAGE_FILTERS, "网盘筛选") as StorageFilterQuery | undefined;
    return { code: 200, data: await this.admin.listWallpapers({ ...query, status, type, orientation, aiReview, storage }) };
  }

  @UseGuards(AdminAuthGuard)
  @Patch("wallpapers/:id")
  async update(@Param("id") id: string, @Body() body: {
    title?: string;
    type?: WallpaperType;
    status?: WallpaperStatus;
    sortOrder?: number;
    tags?: string[];
  }) {
    const type = optionalEnum(body.type, WallpaperType, "壁纸类型");
    const status = optionalEnum(body.status, WallpaperStatus, "壁纸状态");
    const sortOrder = body.sortOrder === undefined ? undefined : Number(body.sortOrder);
    if (sortOrder !== undefined && !Number.isFinite(sortOrder)) {
      throw new BadRequestException("排序值不正确");
    }
    return { code: 200, data: await this.admin.updateWallpaper(id, { ...body, type, status, sortOrder }) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/:id/storage-links")
  async addStorageLink(@Param("id") id: string, @Body() body: {
    provider: StorageProvider;
    url: string;
    passcode?: string;
    isPrimary?: boolean;
  }) {
    const provider = requiredEnum(body.provider, StorageProvider, "网盘类型");
    return { code: 200, data: await this.admin.addStorageLink(id, { ...body, provider }) };
  }

  @UseGuards(AdminAuthGuard)
  @Patch("storage-links/:id")
  async updateStorageLink(@Param("id") id: string, @Body() body: { isActive?: boolean; isPrimary?: boolean }) {
    return { code: 200, data: await this.admin.updateStorageLink(id, body) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/bulk/deactivate-unpublished-links")
  async deactivateUnpublishedLinks(@Body() body: { ids: string[] }) {
    return { code: 200, data: await this.admin.deactivateUnpublishedStorageLinks(body.ids || []) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/bulk")
  async bulk(@Body() body?: { ids?: string[]; status?: WallpaperStatus; tags?: string[] }) {
    const status = optionalEnum(body?.status, WallpaperStatus, "壁纸状态");
    return { code: 200, data: await this.admin.bulkUpdate(body?.ids, { ...(body || {}), status }) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/backfill-orientation")
  async backfillOrientation() {
    return { code: 200, data: await this.admin.backfillOrientation() };
  }

  @UseGuards(AdminAuthGuard)
  @Get("channels")
  async channels() {
    return { code: 200, data: await this.admin.listChannels() };
  }

  @UseGuards(AdminAuthGuard)
  @Post("channels/discover-guilds")
  async discoverGuilds(@Body() body: { token: string }) {
    return { code: 200, data: await this.admin.discoverChannelGuilds(body.token) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("channels/discover-channels")
  async discoverChannels(@Body() body: { token: string; guildId: string }) {
    return { code: 200, data: await this.admin.discoverChannelChannels(body.token, body.guildId) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("channels")
  async saveChannel(@Body() body: {
    label: string;
    token: string;
    guildId: string;
    guildName?: string;
    channelId: string;
    channelName?: string;
    isDefault?: boolean;
    autoPublish?: boolean;
  }) {
    return { code: 200, data: await this.admin.saveChannelAccount(body) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("channels/:id/default")
  async defaultChannel(@Param("id") id: string) {
    return { code: 200, data: await this.admin.setDefaultChannel(id) };
  }

  @UseGuards(AdminAuthGuard)
  @Patch("channels/:id/auto-publish")
  async autoPublishChannel(@Param("id") id: string, @Body() body: { autoPublish: boolean }) {
    return { code: 200, data: await this.admin.setChannelAccountAutoPublish(id, Boolean(body.autoPublish)) };
  }

  @UseGuards(AdminAuthGuard)
  @Patch("channels/:id")
  async updateChannel(@Param("id") id: string, @Body() body: { label: string }) {
    return { code: 200, data: await this.admin.updateChannelLabel(id, body.label || "") };
  }

  @UseGuards(AdminAuthGuard)
  @Delete("channels/:id")
  async deleteChannel(@Param("id") id: string) {
    return { code: 200, data: await this.admin.deleteChannel(id) };
  }

  @UseGuards(AdminAuthGuard)
  @Get("storage-accounts")
  async storageAccounts() {
    return { code: 200, data: await this.admin.listStorageAccounts() };
  }

  @UseGuards(AdminAuthGuard)
  @Post("storage-accounts")
  async saveStorageAccount(@Body() body: { provider: StorageProvider; label: string; isDefault?: boolean }) {
    const provider = requiredEnum(body.provider, StorageProvider, "网盘类型");
    return { code: 200, data: await this.admin.saveStorageAccount({ ...body, provider }) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("storage-accounts/:id/default")
  async defaultStorageAccount(@Param("id") id: string) {
    return { code: 200, data: await this.admin.setDefaultStorageAccount(id) };
  }

  @UseGuards(AdminAuthGuard)
  @Patch("storage-accounts/:id")
  async updateStorageAccount(@Param("id") id: string, @Body() body: { label: string }) {
    return { code: 200, data: await this.admin.updateStorageAccountLabel(id, body.label || "") };
  }

  @UseGuards(AdminAuthGuard)
  @Post("storage-accounts/:id/auth/start")
  async startStorageAuth(@Param("id") id: string) {
    return { code: 200, data: await this.admin.startStorageAuth(id) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("storage-accounts/:id/auth/finish")
  async finishStorageAuth(@Param("id") id: string, @Body() body: { code: string }) {
    return { code: 200, data: await this.admin.finishStorageAuth(id, body.code || "") };
  }

  @UseGuards(AdminAuthGuard)
  @Post("storage-accounts/:id/probe")
  async probeStorageAccount(@Param("id") id: string) {
    return { code: 200, data: await this.admin.probeStorageAccount(id) };
  }

  @UseGuards(AdminAuthGuard)
  @Delete("storage-accounts/:id")
  async deleteStorageAccount(@Param("id") id: string) {
    return { code: 200, data: await this.admin.deleteStorageAccount(id) };
  }
}

function uploadMaxBytes() {
  const value = Number(process.env.UPLOAD_MAX_FILE_MB || DEFAULT_UPLOAD_MAX_FILE_MB);
  return Math.max(1, value) * 1024 * 1024;
}

function optionalEnum<T extends Record<string, string>>(value: string | undefined, values: T, label: string): T[keyof T] | undefined {
  if (!value) return undefined;
  if (Object.values(values).includes(value)) return value as T[keyof T];
  throw new BadRequestException(`${label}不正确`);
}

function requiredEnum<T extends Record<string, string>>(value: string | undefined, values: T, label: string): T[keyof T] {
  const result = optionalEnum(value, values, label);
  if (result) return result;
  throw new BadRequestException(`${label}不能为空`);
}

function optionalSet(value: string | undefined, values: Set<string>, label: string) {
  if (!value) return undefined;
  if (values.has(value)) return value;
  throw new BadRequestException(`${label}不正确`);
}

function cleanStorageSelection(body: { quarkAccountId?: string; baiduAccountId?: string }) {
  const quarkAccountId = body.quarkAccountId?.trim() || undefined;
  const baiduAccountId = body.baiduAccountId?.trim() || undefined;
  return quarkAccountId || baiduAccountId ? { quarkAccountId, baiduAccountId } : undefined;
}
