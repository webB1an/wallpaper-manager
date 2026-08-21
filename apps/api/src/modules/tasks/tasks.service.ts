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

  list(page = 1, pageSize = 50) {
    return this.prisma.task.findMany({
      orderBy: { createdAt: "desc" },
      skip: (Math.max(1, page) - 1) * pageSize,
      take: Math.min(100, Math.max(1, pageSize)),
    });
  }
}
