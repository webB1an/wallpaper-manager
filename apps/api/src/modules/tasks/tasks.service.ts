import { Injectable } from "@nestjs/common";
import { TaskStatus, TaskType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

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

  async list(page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const safePageSize = Math.min(100, Math.max(1, pageSize));
    const [list, total] = await Promise.all([
      this.prisma.task.findMany({
        orderBy: { createdAt: "desc" },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
      this.prisma.task.count(),
    ]);
    return { list, total, page: safePage, pageSize: safePageSize };
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
