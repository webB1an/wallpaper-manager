import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { TaskStatus, TaskType } from "@prisma/client";
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
  async list(@Query() query: { page?: number; pageSize?: number; status?: TaskStatus; type?: TaskType }) {
    const status = optionalEnum(query.status, TaskStatus, "任务状态");
    const type = optionalEnum(query.type, TaskType, "任务类型");
    return { code: 200, data: await this.tasks.list(Number(query.page || 1), Number(query.pageSize || 50), { status, type }) };
  }
}

function optionalEnum<T extends Record<string, string>>(value: string | undefined, values: T, label: string): T[keyof T] | undefined {
  if (!value) return undefined;
  if (Object.values(values).includes(value)) return value as T[keyof T];
  throw new BadRequestException(`${label}不正确`);
}
