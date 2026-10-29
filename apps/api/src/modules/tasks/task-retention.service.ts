import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TaskStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const DAY = 86_400_000;
const DEFAULT_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 90;
const SWEEP_INTERVAL_MS = 6 * 60 * 60_000;
const FIRST_SWEEP_DELAY_MS = 10 * 60_000;
/** 排队/执行中但超过该时长无任何进展的任务视为已中断（进程重启、部署打断等）。 */
const STALE_ACTIVE_MS = DAY;

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

  async prune(): Promise<{ days: number; cutoff: Date; removed: number; released: number }> {
    const days = this.retentionDays();
    const cutoff = new Date(Date.now() - days * DAY);
    // 先释放“假执行中”的任务：服务重启、部署打断后任务可能停在 queued/running 再无更新，
    // 既不满足删除条件（永不清理），又无法在界面上重试，会永久占据最老记录的位置。
    const { count: released } = await this.prisma.task.updateMany({
      where: {
        status: { in: [TaskStatus.queued, TaskStatus.running] },
        updatedAt: { lt: new Date(Date.now() - STALE_ACTIVE_MS) },
      },
      data: {
        status: TaskStatus.failed,
        error: "任务超过 24 小时没有任何进展，已判定为中断；如支持断点续跑，可在此重试",
      },
    });
    const { count } = await this.prisma.task.deleteMany({
      where: {
        createdAt: { lt: cutoff },
        // 释放之后仍可能有刚被别的进程领走的任务，保守起见再排除一次活跃状态。
        status: { notIn: [TaskStatus.queued, TaskStatus.running] },
      },
    });
    return { days, cutoff, removed: count, released };
  }

  private async sweep() {
    if (this.busy) return;
    this.busy = true;
    try {
      const result = await this.prune();
      if (result.released) {
        this.logger.warn(`任务清理前释放了 ${result.released} 条长时间无进展的任务（标记为失败，可重试）`);
      }
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
