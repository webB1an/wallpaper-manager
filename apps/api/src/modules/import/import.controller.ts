import { Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { nonNegativeInt, positiveInt } from "../../common/query-values";
import { AdminAuthGuard } from "../admin/auth.guard";
import { OldCoverImportService } from "./old-cover-import.service";

@UseGuards(AdminAuthGuard)
@Controller("admin/imports/old-covers")
export class ImportController {
  constructor(private readonly importer: OldCoverImportService) {}

  @Get("preview")
  async preview(@Query() query: { limit?: number }) {
    return { code: 200, data: await this.importer.preview(positiveInt(query.limit, 50, "预览数量", 200)) };
  }

  @Get("stats")
  async stats() {
    return { code: 200, data: await this.importer.stats() };
  }

  @Get("records")
  async records(@Query() query: { page?: number; pageSize?: number; status?: string; keyword?: string }) {
    return { code: 200, data: await this.importer.records(query) };
  }

  @Post("run")
  async run(@Query() query: { limit?: number }) {
    return { code: 200, data: await this.importer.run(nonNegativeInt(query.limit, 0, "迁移数量", 1000)) };
  }

  @Post("classify")
  async classify(@Query() query: { limit?: number }) {
    return { code: 200, data: await this.importer.classifyImported(positiveInt(query.limit, 50, "识别数量", 200)) };
  }
}
