import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TaskStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const DAY = 86_400_000;
const DEFAULT_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 90;
const SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
const FIRST_SWEEP_DELAY_MS = 10 * 60_000;

/**
 * 任务表只保留最近 N 天（默认 7 天）的记录。
 *
 * 任务队列是操作账本而不是归档：无限增长会让任务列表、失败对账和统计查询越来越慢。
 * 仍在排队/执行中的任务永不清理；失败任务的自动续跑窗口只有 24 小时，远小于保留期，
 * 所以清理不会让可恢复的任务失效。
 */
@Injectable()
export class TaskRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskRetentionService.name);
  private timer?: NodeJS.Timeout;
  private firstTimer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.firstTimer = setTimeout(() => void this.sweep(), FIRST_SWEEP_DELAY_MS);
    this.firstTimer.unref?.();
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
  }

  /** 保留天数，TASK_RETENTION_DAYS 可覆盖（1–90，非法值回落到 7 天）。 */
  retentionDays() {
    const value = Number(this.config.get<string>("TASK_RETENTION_DAYS") || DEFAULT_RETENTION_DAYS);
    if (!Number.isFinite(value) || value < 1) return DEFAULT_RETENTION_DAYS;
    return Math.min(Math.floor(value), MAX_RETENTION_DAYS);
  }

  async prune(): Promise<{ days: number; cutoff: Date; removed: number }> {
    const days = this.retentionDays();
    const cutoff = new Date(Date.now() - days * DAY);
    const { count } = await this.prisma.task.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        status: { notIn: [TaskStatus.queued, TaskStatus.running] },
      },
    });
    return { days, cutoff, removed: count };
  }

  private async sweep() {
    if (this.busy) return;
    this.busy = true;
    try {
      const result = await this.prune();
      if (result.removed) {
        this.logger.log(`任务记录清理完成：删除 ${result.removed} 条早于 ${result.days} 天的任务`);
      }
    } catch (error) {
      this.logger.warn(`任务记录清理失败，将于下次重试：${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
