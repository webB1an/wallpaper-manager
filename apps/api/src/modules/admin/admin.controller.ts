import { BadRequestException, Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { StorageProvider, WallpaperStatus, WallpaperType } from "@prisma/client";
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
  async upload(@UploadedFiles() files: Express.Multer.File[], @Body() body: { autoProcess?: string; autoPublish?: string }) {
    const autoProcess = body.autoProcess === undefined ? undefined : body.autoProcess === "true";
    const autoPublish = body.autoPublish === undefined ? undefined : body.autoPublish === "true";
    const data = await this.admin.createUpload(files || [], { autoProcess, autoPublish });
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
  @Get("overview")
  async overview() {
    return { code: 200, data: await this.admin.overview() };
  }

  @UseGuards(AdminAuthGuard)
  @Patch("settings")
  async updateSettings(@Body() body: { defaultAutoProcess?: boolean; defaultAutoPublish?: boolean }) {
    return { code: 200, data: await this.admin.updateSettings(body) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/:id/analyze")
  async analyze(@Param("id") id: string) {
    return { code: 200, data: await this.admin.analyzeNow(id) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/:id/process")
  async process(@Param("id") id: string) {
    return { code: 200, data: await this.admin.enqueueProcessWallpaper(id) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/:id/publish-channel")
  async publishChannel(@Param("id") id: string) {
    return { code: 200, data: await this.admin.publishWallpaperToChannel(id) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("channels/publish")
  async publishChannelBatch(@Body() body: { ids: string[]; accountId?: string }) {
    return { code: 200, data: await this.admin.publishWallpapersToChannel(body.ids || [], body.accountId) };
  }

  @UseGuards(AdminAuthGuard)
  @Get("wallpapers")
  async list(@Query() query: { page?: number; pageSize?: number; keyword?: string; status?: WallpaperStatus; aiReview?: "unreviewed" | "safe" | "blocked" }) {
    return { code: 200, data: await this.admin.listWallpapers(query) };
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
    return { code: 200, data: await this.admin.updateWallpaper(id, body) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/:id/storage-links")
  async addStorageLink(@Param("id") id: string, @Body() body: {
    provider: StorageProvider;
    url: string;
    passcode?: string;
    isPrimary?: boolean;
  }) {
    return { code: 200, data: await this.admin.addStorageLink(id, body) };
  }

  @UseGuards(AdminAuthGuard)
  @Patch("storage-links/:id")
  async updateStorageLink(@Param("id") id: string, @Body() body: { isActive?: boolean; isPrimary?: boolean }) {
    return { code: 200, data: await this.admin.updateStorageLink(id, body) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/bulk")
  async bulk(@Body() body: { ids: string[]; status?: WallpaperStatus; tags?: string[] }) {
    return { code: 200, data: await this.admin.bulkUpdate(body.ids, body) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("wallpapers/bulk/process")
  async bulkProcess(@Body() body: { ids: string[] }) {
    return { code: 200, data: await this.admin.enqueueProcessWallpapers(body.ids || []) };
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
  }) {
    return { code: 200, data: await this.admin.saveChannelAccount(body) };
  }

  @UseGuards(AdminAuthGuard)
  @Post("channels/:id/default")
  async defaultChannel(@Param("id") id: string) {
    return { code: 200, data: await this.admin.setDefaultChannel(id) };
  }

  @UseGuards(AdminAuthGuard)
  @Delete("channels/:id")
  async deleteChannel(@Param("id") id: string) {
    return { code: 200, data: await this.admin.deleteChannel(id) };
  }
}

function uploadMaxBytes() {
  const value = Number(process.env.UPLOAD_MAX_FILE_MB || DEFAULT_UPLOAD_MAX_FILE_MB);
  return Math.max(1, value) * 1024 * 1024;
}
