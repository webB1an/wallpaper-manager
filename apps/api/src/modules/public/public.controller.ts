import { Controller, Get, Param, Post, Query, Redirect } from "@nestjs/common";
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

  @Get("/r/:code")
  @Redirect()
  async short(@Param("code") code: string) {
    return { url: await this.service.redirect(code), statusCode: 302 };
  }
}
