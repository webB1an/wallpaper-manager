import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export class LeaseBusyError extends Error {}
export class LeaseLostError extends Error {}
export interface WorkFence {
  assert: (tx?: Prisma.TransactionClient) => Promise<void>;
}

@Injectable()
export class WorkLeaseService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(key: string, work: (fence: WorkFence) => Promise<T>): Promise<T> {
    const owner = randomUUID();
    const ttl = 180_000;
    const expiresAt = () => new Date(Date.now() + ttl);
    try { await this.prisma.workLease.create({ data: { key, owner, expiresAt: expiresAt() } }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const claimed = await this.prisma.workLease.updateMany({ where: { key, expiresAt: { lt: new Date() } }, data: { owner, expiresAt: expiresAt() } });
      if (!claimed.count) throw new LeaseBusyError("同一资源正在处理中，稍后继续");
    }
    let lost = false;
    let heartbeat: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (heartbeat || lost) return;
      heartbeat = this.prisma.workLease.updateMany({ where: { key, owner, expiresAt: { gt: new Date() } }, data: { expiresAt: expiresAt() } })
        .then((result) => { if (!result.count) lost = true; }).catch(() => { lost = true; }).finally(() => { heartbeat = undefined; });
    }, 30_000);
    timer.unref();
    const fence: WorkFence = { assert: async (tx) => {
      if (lost) throw new LeaseLostError("处理租约已失效，已停止后续操作");
      // The conditional write fences the following transaction against takeover.
      const result = await (tx || this.prisma).workLease.updateMany({ where: { key, owner, expiresAt: { gt: new Date() } }, data: { expiresAt: expiresAt() } });
      if (!result.count) { lost = true; throw new LeaseLostError("处理租约已失效，已停止后续操作"); }
    } };
    try { return await work(fence); }
    finally {
      clearInterval(timer);
      await heartbeat;
      await this.prisma.workLease.deleteMany({ where: { key, owner } }).catch(() => undefined);
    }
  }
}
