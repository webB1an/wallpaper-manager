import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { AdminService } from "./admin.service";
import { WALLPAPER_QUEUE } from "./admin.queue";
import { recoverUploadPayload, recoveryResourceError } from "./queue-recovery";
import { canResumeAutoPublish } from "./auto-publish-checkpoint";
import { uploadResumeState } from "./upload-checkpoint";
import { deploymentDraining } from "../../common/deployment-drain";

/** MySQL is the durable task ledger; Redis is only its dispatch queue. Single API instance. */
@Injectable()
export class QueueRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueRecoveryService.name);
  private readonly startedAt = new Date();
  private timer?: NodeJS.Timeout;
  private busy = false;
  private cursor?: string;
  private expiryCursor?: string;

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
    if (this.busy || deploymentDraining()) return;
    this.busy = true;
    try {
      // Queue access must succeed before changing any task status. Include legacy numeric job ids.
      const cutoff = new Date(Date.now() - 2 * 60_000);
      const tasks = await this.prisma.task.findMany({
        where: { type: { in: ["upload_asset", "auto_publish"] }, status: { in: ["queued", "running"] }, updatedAt: { lt: cutoff }, ...(this.cursor ? { id: { gt: this.cursor } } : {}) },
        orderBy: { id: "asc" }, take: 100,
      });
      const candidates = new Set(tasks.map((task) => task.id));
      const liveTasks = new Set<string>();
      for (let start = 0; ; start += 100) {
        const jobs = await this.queue.getJobs(["active", "wait", "delayed", "paused", "prioritized", "waiting-children"], start, start + 99);
        for (const job of jobs) if (candidates.has(job.data.taskId)) liveTasks.add(job.data.taskId);
        if (jobs.length < 100) break;
      }
      this.cursor = tasks.length === 100 ? tasks.at(-1)!.id : undefined;
      for (const task of tasks) {
        if (task.status !== "queued" && task.status !== "running") continue;
        if (liveTasks.has(task.id)) continue;
        if (task.type === "upload_asset" && uploadResumeState(task.payload).resumable && (task.status === "queued" || task.createdAt < this.startedAt)) {
          try { await this.admin.resumeUploadTask(task.id, true); }
          catch (error) { await this.fail(task.id, task.status, `上传恢复未启动：${(error as Error).message}`); }
          continue;
        }
        const checkpoint = (task.payload as { checkpoint?: unknown } | null)?.checkpoint;
        if (task.type === "auto_publish" && task.createdAt < this.startedAt && canResumeAutoPublish(checkpoint)) {
          try { await this.admin.resumeAutoPublishTask(task.id, true); }
          catch (error) { await this.fail(task.id, task.status, `恢复未启动：${(error as Error).message}`); }
          continue;
        }
        // Running tasks may already have sent a post. Do not replay interrupted external effects.
        if (task.status === "running" || task.type === "auto_publish") {
          if (task.createdAt < this.startedAt) await this.fail(task.id, task.status, task.type === "upload_asset" && task.progress === 38 ? "网盘同步因重启中断，请核对是否已上传分享，再继续处理" : "服务重启后发现中断任务，需核对处理结果，未自动重复发帖");
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
      const expired = await this.prisma.task.findMany({
        where: { type: "auto_publish", status: "failed", OR: [{ updatedAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } }, { result: { path: "$.cleanupPending", equals: true } }], ...(this.expiryCursor ? { id: { gt: this.expiryCursor } } : {}) },
        orderBy: { id: "asc" }, take: 100, select: { id: true },
      });
      this.expiryCursor = expired.length === 100 ? expired.at(-1)!.id : undefined;
      for (const task of expired) {
        try { await this.admin.expireAutoPublishTask(task.id); }
        catch (error) { this.logger.warn(`过期恢复文件清理失败，将重试：${(error as Error).message}`); }
      }
    } finally { this.busy = false; }
  }

  private async fail(id: string, status: "queued" | "running", message: string) {
    await this.prisma.task.updateMany({ where: { id, status }, data: { status: "failed", message, error: message } });
  }
}
