import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../admin/auth.guard";
import { TasksService } from "./tasks.service";

@UseGuards(AdminAuthGuard)
@Controller("admin/tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get("summary")
  async summary() {
    return { code: 200, data: await this.tasks.summary() };
  }

  @Get()
  async list(@Query() query: { page?: number; pageSize?: number }) {
    return { code: 200, data: await this.tasks.list(Number(query.page || 1), Number(query.pageSize || 50)) };
  }
}
