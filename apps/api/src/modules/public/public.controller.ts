import { Body, Controller, Get, Headers, Param, Post, Query, Redirect, Res } from "@nestjs/common";
import type { Response } from "express";
import { PublicService } from "./public.service";

@Controller()
export class PublicController {
  constructor(private readonly service: PublicService) {}

  @Get("wallpapers")
  async list(@Query() query: { page?: number; pageSize?: number; keyword?: string; tag?: string; type?: string; orientation?: string; sort?: string }) {
    return { code: 200, data: await this.service.list(query) };
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

  @Get("/r/:code")
  @Redirect()
  async short(@Param("code") code: string) {
    return { url: await this.service.redirect(code), statusCode: 302 };
  }
}
