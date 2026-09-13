import { Body, Controller, Get, Header, Headers, Param, Post, Query, StreamableFile, UseGuards } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { AdminAuthGuard } from "../admin/auth.guard";
import { WallMuseService } from "./wallmuse.service";

@Controller("wallmuse/v1")
@UseGuards(AdminAuthGuard)
export class WallMuseController {
  constructor(private readonly service: WallMuseService) {}
  @Get("capabilities")
  async capabilities() { return { code: 200, data: await this.service.capabilities() }; }
  @Post("articles")
  async create(@Body() body: unknown, @Headers("idempotency-key") key: string) { return { code: 200, data: await this.service.create(body, key) }; }
  @Get("articles")
  async list(@Query("lifecycle") lifecycle?: string, @Query("sync") sync?: string, @Query("page") page?: string) { return { code: 200, data: await this.service.list(lifecycle, sync, page) }; }
  @Get("articles/:id")
  async article(@Param("id") id: string, @Query("revisionId") revisionId?: string) { return { code: 200, data: await this.service.article(id, revisionId) }; }
  @Get("articles/:id/assets")
  async articleAssets(@Param("id") id: string) { return { code: 200, data: await this.service.articleAssets(id) }; }
  @Post("articles/:id/revisions")
  async save(@Param("id") id: string, @Body() body: unknown) { return { code: 200, data: await this.service.save(id, body) }; }
  @Post("articles/:id/copied")
  async copied(@Param("id") id: string, @Body() body: unknown) { return { code: 200, data: await this.service.save(id, body, true) }; }
  @Post("articles/:id/publish-miniprogram")
  async sync(@Param("id") id: string, @Body() body: unknown) { return { code: 200, data: await this.service.sync(id, body) }; }
  @Post("articles/:id/regenerate")
  async regenerate(@Param("id") id: string, @Body() body: unknown, @Headers("idempotency-key") key: string) { return { code: 200, data: await this.service.regenerate(id, body, key) }; }
  @Get("tasks/:id")
  async job(@Param("id") id: string) { return { code: 200, data: await this.service.job(id) }; }
  @Post("tasks/:id/cancel")
  async cancel(@Param("id") id: string) { return { code: 200, data: await this.service.cancel(id) }; }
  @Post("tasks/:id/retry")
  async retry(@Param("id") id: string) { return { code: 200, data: await this.service.retry(id) }; }
  @Post("tasks/:id/reconcile")
  async reconcile(@Param("id") id: string, @Body() body: unknown) { return { code: 200, data: await this.service.reconcile(id, body) }; }
  @Get("assets/:id")
  @Header("Content-Type", "image/jpeg")
  @Header("Cache-Control", "private, max-age=300")
  async asset(@Param("id") id: string) { return new StreamableFile(createReadStream(await this.service.asset(id))); }
}
