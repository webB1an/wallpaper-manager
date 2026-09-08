import { Injectable } from "@nestjs/common";
import { Prisma, TaskStatus, TaskType } from "@prisma/client";
import { positiveInt } from "../../common/query-values";
import { PrismaService } from "../prisma/prisma.service";
import { uploadResumeState } from "../admin/upload-checkpoint";

type TaskListFilters = {
  status?: TaskStatus;
  type?: TaskType;
};

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  create(type: TaskType, payload?: unknown, message?: string) {
    return this.prisma.task.create({
      data: {
        type,
        payload: payload as never,
        message,
      },
    });
  }

  update(id: string, data: { status?: TaskStatus; progress?: number; message?: string; result?: unknown; error?: string }) {
    return this.prisma.task.update({
      where: { id },
      data: {
        status: data.status,
        progress: data.progress,
        message: data.message,
        result: data.result as never,
        error: data.error,
      },
    });
  }

  async list(page = 1, pageSize = 50, filters: TaskListFilters = {}) {
    const safePage = positiveInt(page, 1, "页码");
    const safePageSize = positiveInt(pageSize, 50, "每页数量", 100);
    const where: Prisma.TaskWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.type ? { type: filters.type } : {}),
    };
    const [list, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.task.count({ where }),
    ]);
    const decorated = list.map((task) => {
      if (task.type !== "upload_asset" || task.status !== "failed") return task;
      const payload = (task.payload || {}) as Record<string, any>;
      const legacyConfirmation = !payload.batch && !!payload.wallpaperId && !payload.uploadCheckpoints && task.progress === 38;
      return { ...task, result: { ...(task.result as object || {}), ...uploadResumeState(payload), legacyConfirmation } };
    });
    return { list: decorated, total, page: safePage, pageSize: safePageSize };
  }

  async summary() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const todayWhere = { createdAt: { gte: todayStart, lt: tomorrowStart } };
    const [todayTotal, active, successToday, failedToday] = await Promise.all([
      this.prisma.task.count({ where: todayWhere }),
      this.prisma.task.count({ where: { status: { in: [TaskStatus.queued, TaskStatus.running] } } }),
      this.prisma.task.count({ where: { ...todayWhere, status: TaskStatus.success } }),
      this.prisma.task.count({ where: { ...todayWhere, status: TaskStatus.failed } }),
    ]);

    return { todayTotal, active, successToday, failedToday };
  }
}
