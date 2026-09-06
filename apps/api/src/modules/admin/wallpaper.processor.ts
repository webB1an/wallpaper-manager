import { Processor, WorkerHost } from "@nestjs/bullmq";
import { DelayedError, Job } from "bullmq";
import { AdminService } from "./admin.service";
import { WALLPAPER_QUEUE } from "./admin.queue";
import { PrismaService } from "../prisma/prisma.service";

@Processor(WALLPAPER_QUEUE, { concurrency: 2 })
export class WallpaperProcessor extends WorkerHost {
  constructor(private readonly admin: AdminService, private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ taskId: string; wallpaperId?: string; wallpaperIds?: string[]; storageSelection?: { quarkAccountId?: string; baiduAccountId?: string }; channelAccountId?: string }>, token?: string) {
    if (!["process-wallpaper", "process-wallpaper-batch"].includes(job.name)) throw new Error("未知上传任务类型");
    const task = await this.prisma.task.findUnique({ where: { id: job.data.taskId }, select: { status: true, progress: true } });
    if (!task || task.status !== "queued" || task.progress !== 0) return { skipped: true, reason: "任务已执行或已结束" };
    const ids = job.data.wallpaperIds || (job.data.wallpaperId ? [job.data.wallpaperId] : []);
    const delay = await this.admin.uploadProcessingDelayMs(ids);
    if (delay > 0) {
      await this.prisma.task.updateMany({ where: { id: job.data.taskId, status: "queued" }, data: { message: "等待空闲时段处理" } });
      await job.moveToDelayed(Date.now() + delay, token);
      throw new DelayedError();
    }
    // Redis loss / stalled delivery must not start the same external side effects twice.
    const claimed = await this.prisma.task.updateMany({
      where: { id: job.data.taskId, status: "queued", progress: 0 },
      data: { status: "running", progress: 1, message: "开始执行上传任务" },
    });
    if (!claimed.count) return { skipped: true, reason: "任务已执行或已结束，禁止重复执行" };
    if (job.name === "process-wallpaper") {
      return this.admin.runProcessWallpaper(job.data.wallpaperId || "", job.data.taskId, job.data.storageSelection, job.data.channelAccountId);
    }
    if (job.name === "process-wallpaper-batch") {
      return this.admin.runProcessWallpaperBatch(job.data.wallpaperIds || [], job.data.taskId, job.data.storageSelection, job.data.channelAccountId);
    }
    return undefined;
  }
}
