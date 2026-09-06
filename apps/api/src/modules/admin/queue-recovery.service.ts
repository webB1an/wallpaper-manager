import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { AdminService } from "./admin.service";
import { WALLPAPER_QUEUE } from "./admin.queue";
import { recoverUploadPayload, recoveryResourceError } from "./queue-recovery";

/** MySQL is the durable task ledger; Redis is only its dispatch queue. Single API instance. */
@Injectable()
export class QueueRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueRecoveryService.name);
  private readonly startedAt = new Date();
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: AdminService,
    @InjectQueue(WALLPAPER_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.reconcile().catch((error) => this.logger.warn(`任务对账失败：${(error as Error).message}`)); }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async reconcile() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Queue access must succeed before changing any task status. Include legacy numeric job ids.
      const jobs = await this.queue.getJobs(["active", "wait", "delayed", "paused", "prioritized", "waiting-children"], 0, -1);
      const liveTasks = new Set(jobs.map((job) => job.data.taskId));
      const cutoff = new Date(Date.now() - 2 * 60_000);
      const tasks = await this.prisma.task.findMany({
        where: { type: { in: ["upload_asset", "auto_publish"] }, status: { in: ["queued", "running"] }, updatedAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
      });
      for (const task of tasks) {
        if (task.status !== "queued" && task.status !== "running") continue;
        if (liveTasks.has(task.id)) continue;
        // Running tasks may already have sent a post. Do not replay interrupted external effects.
        if (task.status === "running" || task.type === "auto_publish") {
          if (task.createdAt < this.startedAt) await this.fail(task.id, task.status, "服务重启后发现中断任务，需核对处理结果，未自动重复发帖");
          continue;
        }
        if (task.progress !== 0) { await this.fail(task.id, "queued", "任务已有执行进度，需人工确认，未自动重试"); continue; }
        const data = recoverUploadPayload(task.id, task.payload);
        if (!data) { await this.fail(task.id, "queued", "任务参数不完整（旧批次可能缺少账号选择），请确认后重新处理"); continue; }
        const ids = data.wallpaperIds || [data.wallpaperId!];
        const wallpapers = await this.prisma.wallpaper.findMany({
          where: { id: { in: ids } },
          select: { id: true, status: true, assetPath: true, aiAnalysis: { select: { id: true } }, _count: { select: { storageLinks: true } } },
        });
        const resourceError = recoveryResourceError(ids, wallpapers.map((item) => ({ ...item, hasStorage: item._count.storageLinks > 0, hasAnalysis: !!item.aiAnalysis })));
        if (resourceError) { await this.fail(task.id, "queued", resourceError); continue; }
        const root = resolve(process.cwd(), "storage", "public");
        if (wallpapers.some((item) => {
          const path = resolve(root, item.assetPath!);
          return !path.startsWith(root + sep) || !existsSync(path);
        })) { await this.fail(task.id, "queued", "原文件不存在或路径无效，请重新上传"); continue; }
        // Never reuse terminal jobs: a completed/failed job can represent an external side effect.
        if (await this.queue.getJob(task.id)) { await this.fail(task.id, "queued", "执行队列已有历史结果，需人工核对，未自动重试"); continue; }
        const delay = await this.admin.uploadProcessingDelayMs(ids);
        const updated = await this.prisma.task.updateMany({
          where: { id: task.id, status: "queued", updatedAt: task.updatedAt },
          data: { message: delay > 0 ? "已恢复丢失任务，等待空闲时段处理" : "已恢复丢失任务，等待执行", error: null },
        });
        if (!updated.count) continue;
        await this.queue.add(data.wallpaperIds ? "process-wallpaper-batch" : "process-wallpaper", data, {
          jobId: task.id, delay, attempts: 1, removeOnComplete: 200, removeOnFail: 500,
        });
        this.logger.log(`已恢复上传任务 ${task.id}`);
      }
    } finally { this.busy = false; }
  }

  private async fail(id: string, status: "queued" | "running", message: string) {
    await this.prisma.task.updateMany({ where: { id, status }, data: { status: "failed", message, error: message } });
  }
}
