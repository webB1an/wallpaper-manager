import { Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin/auth.guard";
import { OldCoverImportService } from "./old-cover-import.service";

@UseGuards(AdminAuthGuard)
@Controller("admin/imports/old-covers")
export class ImportController {
  constructor(private readonly importer: OldCoverImportService) {}

  @Get("preview")
  async preview(@Query() query: { limit?: number }) {
    return { code: 200, data: await this.importer.preview(Number(query.limit || 50)) };
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
    return { code: 200, data: await this.importer.run(Number(query.limit || 0)) };
  }

  @Post("classify")
  async classify(@Query() query: { limit?: number }) {
    return { code: 200, data: await this.importer.classifyImported(Number(query.limit || 50)) };
  }
}
