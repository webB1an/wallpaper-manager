import { Body, Controller, ForbiddenException, Get, Headers, Param, Post, Query, Redirect, Res, UploadedFiles, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
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

  @Get("wallpapers/facets")
  async facets() {
    return { code: 200, data: await this.service.facets() };
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

  @Post("wallpapers/:id/offline")
  async offlineWallpaper(@Headers("x-openid") openid: string, @Param("id") id: string) {
    return { code: 200, data: await this.service.offlineWallpaper(openid || "", id) };
  }

  @UseInterceptors(FilesInterceptor("file"))
  @Post("wallpapers/upload")
  async uploadFromMini(@UploadedFiles() files: Express.Multer.File[], @Headers("x-openid") openid: string, @Body() body: { autoPublish?: string }) {
    if (!(await this.service.isMiniAdmin(openid || ""))) throw new ForbiddenException("无上传权限");
    const autoPublish = body.autoPublish === "true";
    return { code: 200, data: await this.admin.createUpload(files || [], { autoProcess: true, autoPublish }) };
  }

  @Get("/r/:code")
  @Redirect()
  async short(@Param("code") code: string) {
    return { url: await this.service.redirect(code), statusCode: 302 };
  }
}
