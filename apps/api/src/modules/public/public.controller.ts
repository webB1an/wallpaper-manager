import { Body, Controller, ForbiddenException, Get, Headers, Param, Post, Query, Redirect, Res, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { removeUploadedTempFiles, uploadDiskStorage, uploadFileFilter, uploadMaxBytes } from "../../common/upload";
import { AdminService } from "../admin/admin.service";
import { PublicService } from "./public.service";

@Controller()
export class PublicController {
  constructor(
    private readonly service: PublicService,
    private readonly admin: AdminService,
  ) {}

  @Get("wallpapers")
  async list(@Query() query: { page?: number; pageSize?: number; keyword?: string; tag?: string; type?: string; orientation?: string; sort?: string }, @Headers("x-openid") openid: string) {
    return { code: 200, data: await this.service.list(query, openid) };
  }

  @Get("wallpapers/tags")
  async tags() {
    return { code: 200, data: await this.service.tags() };
  }

  @Get("wallpapers/tags/list")
  async allTags(@Query() query: { page?: number; pageSize?: number; keyword?: string }) {
    return { code: 200, data: await this.service.allTags(query) };
  }

  @Get("wallpapers/facets")
  async facets() {
    return { code: 200, data: await this.service.facets() };
  }

  @Get("wallpapers/hero")
  async hero() {
    return { code: 200, data: await this.service.hero() };
  }

  @Get("wallpapers/:id")
  async detail(@Param("id") id: string) {
    return { code: 200, data: await this.service.detail(id) };
  }

  @Post("wallpapers/:id/click")
  async click(@Param("id") id: string) {
    await this.service.click(id);
    return { code: 200, data: { ok: true } };
  }

  @Post("auth/login")
  async login(@Body() body: { code: string }) {
    return { code: 200, data: await this.service.loginWechat(body.code || "") };
  }

  @Get("reward/status")
  async rewardStatus(@Headers("x-openid") openid: string) {
    return { code: 200, data: await this.service.rewardStatus(openid || "") };
  }

  @Post("reward/watch")
  async rewardWatch(@Headers("x-openid") openid: string) {
    return { code: 200, data: await this.service.watchReward(openid || "") };
  }

  @Post("wallpapers/:id/download")
  async download(@Headers("x-openid") openid: string, @Param("id") id: string) {
    return { code: 200, data: await this.service.createDownload(openid || "", id) };
  }

  @Get("downloads/file/:token")
  async downloadFile(@Param("token") token: string, @Res() response: Response) {
    const wallpaper = await this.service.resolveDownloadToken(token);
    response.setHeader("Content-Type", wallpaper.mimeType);
    return response.sendFile(wallpaper.filePath);
  }

  @Post("downloads/file/:token/complete")
  async downloadComplete(@Param("token") token: string) {
    return { code: 200, data: await this.service.completeDownload(token) };
  }

  @Get("user/favorites/ids")
  async favoriteIds(@Headers("x-openid") openid: string) {
    return { code: 200, data: await this.service.favoriteIds(openid || "") };
  }

  @Get("user/favorites")
  async favorites(@Headers("x-openid") openid: string) {
    return { code: 200, data: await this.service.favorites(openid || "") };
  }

  @Post("user/favorites/:id")
  async setFavorite(@Headers("x-openid") openid: string, @Param("id") id: string, @Body() body: { action?: string }) {
    return { code: 200, data: await this.service.setFavorite(openid || "", id, body.action === "remove" ? "remove" : "add") };
  }

  @Get("user/downloads")
  async downloads(@Headers("x-openid") openid: string) {
    return { code: 200, data: await this.service.downloads(openid || "") };
  }

  @Post("user/downloads/:id")
  async recordDownload(@Headers("x-openid") openid: string, @Param("id") id: string) {
    return { code: 200, data: await this.service.recordDownload(openid || "", id) };
  }

  @Get("user/status")
  async userStatus(@Headers("x-openid") openid: string) {
    return { code: 200, data: await this.service.getUserStatus(openid || "") };
  }

  @Post("user/wallpaper-requests/status")
  async wallpaperRequestStatus(@Body() body: { code?: string }) {
    return { code: 200, data: await this.service.memberRequestStatusByCode(body.code || "") };
  }

  @Post("user/wallpaper-requests/list")
  async wallpaperRequests(@Body() body: { code?: string }) {
    return { code: 200, data: await this.service.memberRequests(body.code || "") };
  }

  @Post("user/wallpaper-requests")
  async createWallpaperRequest(@Body() body: { code?: string; subject?: string; description?: string; wallpaperType?: string; orientation?: string }) {
    return { code: 200, data: await this.service.createMemberRequest(body.code || "", body) };
  }

  @Post("wallpapers/:id/offline")
  async offlineWallpaper(@Headers("x-openid") openid: string, @Param("id") id: string) {
    return { code: 200, data: await this.service.offlineWallpaper(openid || "", id) };
  }

  @UseInterceptors(FilesInterceptor("file", 1, {
    storage: uploadDiskStorage(),
    limits: { fileSize: uploadMaxBytes() },
    fileFilter: uploadFileFilter(),
  }))
  @Post("wallpapers/upload")
  async uploadFromMini(@UploadedFiles() files: Express.Multer.File[], @Headers("x-openid") openid: string, @Body() body: { autoPublish?: string; batchKey?: string; batchTotal?: string; tags?: string; title?: string }) {
    if (!(await this.service.isMiniAdmin(openid || ""))) throw new ForbiddenException("无上传权限");
    const autoPublish = body.autoPublish === "true";
    try {
      return {
        code: 200,
        data: await this.admin.createUpload(files || [], {
          autoProcess: true,
          autoPublish,
          batchKey: body.batchKey?.trim() || undefined,
          batchTotal: Number(body.batchTotal || 0) > 0 ? Number(body.batchTotal) : undefined,
          tags: parseMiniTags(body.tags),
          title: body.title?.trim() || undefined,
        }),
      };
    } catch (error) {
      removeUploadedTempFiles(files);
      throw error;
    }
  }

  @Post("wallpapers/upload/batch/complete")
  async completeMiniBatch(@Body() body: { batchKey?: string }) {
    return { code: 200, data: await this.admin.enqueueMiniBatchPublish((body.batchKey || "").trim()) };
  }

  @Get("/r/:code")
  @Redirect()
  async short(@Param("code") code: string) {
    return { url: await this.service.redirect(code), statusCode: 302 };
  }
}

/** 手动标签支持逗号分隔字符串（"二次元,动漫"）或 JSON 数组字符串（["二次元","动漫"]）。 */
function parseMiniTags(value?: string): string[] {
  if (!value) return [];
  let names: string[] = [];
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) names = parsed.map((item) => String(item));
  } catch {
    names = trimmed.split(/[,，]/);
  }
  return names.map((name) => name.trim()).filter(Boolean);
}
