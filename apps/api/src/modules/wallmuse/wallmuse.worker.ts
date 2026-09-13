import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, WallMuseAsset, WallMuseJob } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { deploymentDraining } from "../../common/deployment-drain";
import { publicAssetUrl } from "../../common/public-url";
import { BridgeFileExpiredError, removeBridgeTransfer } from "../admin/bridge-transfer";
import { PrismaService } from "../prisma/prisma.service";
import { SourceIntakeService } from "../sources/source-intake.service";
import { LeaseBusyError, LeaseLostError, WorkLeaseService, type WorkFence } from "../sources/work-lease.service";
import { StorageCoordinatorService } from "../storage/storage-coordinator.service";
import { prepareArticleFiles, privateAssetPath } from "./article-files";
import { WaitForIdleError } from "./idle-policy";
import { WallMuseAiService, type AnalyzedCandidate } from "./wallmuse-ai.service";
import { WallMusePolicyService } from "./wallmuse-policy.service";
import { WallMuseService } from "./wallmuse.service";
import { assertSelection, json, perceptualDistance, revisionDigest, revisionSchema, titleFor, type ArticleRevision, type Checkpoint, type DriveState, type StoredGenerationInput } from "./wallmuse.schemas";
import type { WallpaperAnalysis } from "../ai/ai.service";

function messageOf(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1[redacted]").slice(0, 1600);
}

@Injectable()
export class WallMuseWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WallMuseWorker.name);
  private timer?: NodeJS.Timeout;
  private busy = false;
  private stopping = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly leases: WorkLeaseService,
    private readonly intake: SourceIntakeService,
    private readonly storage: StorageCoordinatorService,
    private readonly ai: WallMuseAiService,
    private readonly policy: WallMusePolicyService,
    private readonly service: WallMuseService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 10_000);
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); }

  async tick() {
    if (this.busy || this.stopping || deploymentDraining()) return;
    this.busy = true;
    try {
      if (!(await this.service.enabled())) return;
      await this.leases.run("wallmuse-worker", async (fence) => {
        const schedule = await this.policy.schedule();
        const job = await this.prisma.wallMuseJob.findFirst({ where: { status: { in: ["queued", "waiting", "running"] }, OR: [{ nextRunAt: { lte: new Date() } }, { cancelRequested: true }, ...(schedule.allowed ? [{ status: "waiting" }] : [])] }, orderBy: { updatedAt: "asc" } });
        if (!job) return;
        await this.step(job, fence);
      });
    } catch (error) { if (!(error instanceof LeaseBusyError)) this.logger.error(`WallMuse 调度失败：${messageOf(error)}`); }
    finally { this.busy = false; }
  }

  private async step(job: WallMuseJob, fence: WorkFence) {
    const cp = job.checkpoint as unknown as Checkpoint;
    const input = job.input as unknown as StoredGenerationInput;
    const update = async (data: Prisma.WallMuseJobUpdateInput, tx?: Prisma.TransactionClient) => {
      await fence.assert(tx);
      await (tx || this.prisma).wallMuseJob.update({ where: { id: job.id }, data: { ...data, checkpoint: json(cp) } });
    };
    try {
      if (job.cancelRequested) {
        await update({ status: "cancelled", message: "任务已取消，已入库和已同步的素材保留", error: null });
        return;
      }
      if (["collect", "analyze", "plan", "copy"].includes(job.stage)) await this.policy.assertIdle();
      await update({ status: "running", error: null });
      if (job.stage === "collect") await this.collect(job, input, cp, update, fence);
      else if (job.stage === "analyze") await this.analyze(job, cp, update, fence);
      else if (job.stage === "storage") await this.syncStorage(job, input, cp, update, fence);
      else if (job.stage === "plan") {
        const candidates = await this.candidates(job.articleId, true);
        cp.plan = await this.ai.plan(candidates, input.targetCount, input.preferredStyle);
        await update({ stage: "copy", status: "queued", message: "选图与主题已完成，等待生成文案", nextRunAt: new Date() });
      } else if (job.stage === "copy") {
        if (!cp.plan) throw new Error("文章策划缺失");
        const candidates = await this.candidates(job.articleId, false);
        assertSelection(cp.plan.selectedIds, candidates.map((item) => item.id), input.targetCount);
        cp.copy = input.scope === "title"
          ? { intro: "", groupCopies: [], ending: "", interaction: "", titleThemes: await this.ai.titles(cp.plan, candidates) }
          : await this.ai.copy(cp.plan, candidates, input.copyDensity, input.includeInteraction);
        await update({ stage: "finish", status: "queued", message: "文案已完成，正在保存文章", nextRunAt: new Date() });
      } else if (job.stage === "finish") await this.finish(job, input, cp, fence);
      else throw new Error(`未知文章任务阶段：${job.stage}`);
    } catch (error) {
      if (error instanceof LeaseLostError) { this.logger.warn(`任务 ${job.id} 租约失效，留待安全恢复`); return; }
      if (error instanceof WaitForIdleError) {
        await update({ status: "waiting", message: error.message, nextRunAt: new Date(error.decision.nextEligibleAt || Date.now() + 60_000) });
        return;
      }
      if (error instanceof LeaseBusyError) {
        await update({ status: "queued", message: "共享来源正在使用，稍后继续", nextRunAt: new Date(Date.now() + 10_000) });
        return;
      }
      if (error instanceof BridgeFileExpiredError && job.stage === "collect") { delete cp.bridge; delete cp.activeSource; delete cp.transferKey; }
      const message = messageOf(error);
      cp.failures = [...(cp.failures || []), { stage: job.stage, message, at: new Date().toISOString() }].slice(-10);
      await update({ status: "failed", error: message, message: "处理暂停，已保留完成步骤，可核对后继续" });
    }
  }

  private async collect(job: WallMuseJob, input: StoredGenerationInput, cp: Checkpoint,
    update: (data: Prisma.WallMuseJobUpdateInput, tx?: Prisma.TransactionClient) => Promise<void>, fence: WorkFence) {
    const candidates = await this.candidates(job.articleId, true);
    const desired = Math.min(input.candidateBudget, input.targetCount + Math.ceil(input.targetCount / 3));
    if (candidates.length >= desired || (cp.attempts >= input.candidateBudget && candidates.length >= input.targetCount)) {
      await update({ stage: "plan", status: "queued", message: "候选壁纸已准备完成，等待 AI 策划", nextRunAt: new Date() });
      return;
    }
    if (cp.attempts >= input.candidateBudget) throw new Error(`候选预算已用完，目前只有 ${candidates.length} 张通过审核且不近似的图片，目标为 ${input.targetCount} 张；未用重复图片凑数`);
    if (!cp.activeSource) {
      cp.activeSource = input.sources[cp.attempts % input.sources.length];
      cp.attempts++;
      cp.transferKey = `wm-${job.id}-${cp.attempts}`;
      await update({ message: `第 ${cp.attempts}/${input.candidateBudget} 次采集，来源 ${cp.activeSource}` });
    }
    const source = cp.activeSource;
    if (!(await this.service.capabilities()).sources.some((item) => item.id === source && item.enabled)) throw new Error("本次选定的来源已被停用，请在素材服务核对来源配置后继续");
    let prepared: Awaited<ReturnType<typeof prepareArticleFiles>> | undefined;
    const result = await this.intake.obtain(source, {
      configService: this.config, config: {}, transferKey: cp.transferKey, resumeBridge: cp.bridge,
      onBridgeReady: async (bridge) => { cp.bridge = bridge; await update({ message: `已取得 ${source} 素材，正在下载` }); },
      onTransferProgress: async () => { await fence.assert(); },
    }, async (item) => {
      await fence.assert();
      prepared = await prepareArticleFiles(item);
      return { cleanup: prepared.cleanup, data: { title: item.fileName.replace(/\.[^.]+$/, "").slice(0, 120), originalName: item.fileName,
        assetPath: prepared.originalRelative, coverPath: prepared.coverRelative, coverUrl: publicAssetUrl(this.config, prepared.coverRelative),
        mimeType: item.fileType, type: "static", status: "draft", autoPublish: false, collectionOnly: true,
        orientation: prepared.width > prepared.height ? "landscape" : prepared.width < prepared.height ? "portrait" : "square" } };
    }, async (tx, wallpaper, item, hash) => {
      await fence.assert(tx);
      const drives: DriveState = {};
      for (const provider of input.requiredProviders) drives[provider] = { accountId: (provider === "baidu" ? input.storageSelection.baiduAccountId : input.storageSelection.quarkAccountId)!, phase: "pending" };
      const asset = await tx.wallMuseAsset.create({ data: { articleId: job.articleId, wallpaperId: wallpaper.id, ordinal: cp.attempts, source, sourceId: item.sourceId, contentHash: hash,
        publishPath: prepared!.publishRelative, perceptualHash: prepared!.perceptualHash, width: prepared!.width, height: prepared!.height, drives: json(drives) } });
      cp.candidateId = asset.id;
      delete cp.activeSource; delete cp.bridge;
      await update({ stage: "analyze", status: "queued", message: "图片已下载，等待 AI 识别", nextRunAt: new Date() }, tx);
    });
    if (!result.created) {
      delete cp.activeSource; delete cp.bridge;
      await update({ status: "queued", message: "跳过已入库的重复图片，继续补采", nextRunAt: new Date() });
    }
    if (cp.transferKey) await removeBridgeTransfer(cp.transferKey).catch(() => undefined);
    delete cp.transferKey;
  }

  private async analyze(job: WallMuseJob, cp: Checkpoint,
    update: (data: Prisma.WallMuseJobUpdateInput, tx?: Prisma.TransactionClient) => Promise<void>, fence: WorkFence) {
    const asset = await this.activeAsset(job.articleId, cp.candidateId);
    const wallpaper = await this.prisma.wallpaper.findUniqueOrThrow({ where: { id: asset.wallpaperId } });
    if (["archived", "rejected"].includes(wallpaper.status) && asset.state !== "rejected") throw new Error("素材已下架或被拒绝");
    const saved = asset.analysis as WallpaperAnalysis | null;
    const analysis = saved || await this.ai.analyze(privateAssetPath(asset.publishPath), wallpaper.originalName);
    await this.prisma.$transaction(async (tx) => {
      await fence.assert(tx);
      const tags = [];
      for (const name of [...new Set(analysis.tags)]) tags.push(await tx.tag.upsert({ where: { name }, update: {}, create: { name } }));
      await tx.aiAnalysis.upsert({ where: { wallpaperId: wallpaper.id }, create: { wallpaperId: wallpaper.id, title: analysis.title, type: "static", tags: analysis.tags, sensitiveFlags: analysis.sensitiveFlags, safe: analysis.safe, summary: analysis.summary },
        update: { title: analysis.title, tags: analysis.tags, sensitiveFlags: analysis.sensitiveFlags, safe: analysis.safe, summary: analysis.summary } });
      await tx.wallpaper.update({ where: { id: wallpaper.id }, data: { title: analysis.title, status: analysis.safe ? "pending_review" : "rejected",
        tags: { deleteMany: {}, create: tags.map((tag, sortOrder) => ({ tagId: tag.id, sortOrder })) } } });
      await tx.wallMuseAsset.update({ where: { id: asset.id }, data: { analysis: json(analysis), state: analysis.safe ? "storage" : "rejected" } });
      if (!analysis.safe) delete cp.candidateId;
      await update({ stage: analysis.safe ? "storage" : "collect", status: "queued", message: analysis.safe ? "识图审核通过，准备同步网盘" : "素材未通过审核，保留去重记录并继续补采", nextRunAt: new Date() }, tx);
    });
  }

  private async syncStorage(job: WallMuseJob, input: StoredGenerationInput, cp: Checkpoint,
    update: (data: Prisma.WallMuseJobUpdateInput, tx?: Prisma.TransactionClient) => Promise<void>, fence: WorkFence) {
    const asset = await this.activeAsset(job.articleId, cp.candidateId);
    const wallpaper = await this.prisma.wallpaper.findUniqueOrThrow({ where: { id: asset.wallpaperId } });
    const analysis = asset.analysis as WallpaperAnalysis | null;
    if (!analysis?.safe || !wallpaper.assetPath || ["archived", "rejected"].includes(wallpaper.status)) throw new Error("素材不可用，已停止网盘同步");
    const drives = asset.drives as DriveState;
    await update({ message: "正在同步原图到本次选定的网盘账号" });
    await this.storage.syncWallpaperResumable(wallpaper.id, join(process.cwd(), "storage", "public", wallpaper.assetPath), analysis.title, "static", analysis.tags, input.storageSelection, drives, async () => {
      await fence.assert();
      await this.prisma.wallMuseAsset.update({ where: { id: asset.id }, data: { drives: json(drives) } });
    }, input.requiredProviders);
    await this.prisma.$transaction(async (tx) => {
      await fence.assert(tx);
      await tx.wallMuseAsset.update({ where: { id: asset.id }, data: { state: "ready", drives: json(drives) } });
      delete cp.candidateId;
      await update({ stage: "collect", status: "queued", message: "原图已入库并同步网盘，继续收集候选", nextRunAt: new Date() }, tx);
    });
  }

  private async activeAsset(articleId: string, id?: string): Promise<WallMuseAsset> {
    if (!id) throw new Error("当前素材检查点缺失");
    const asset = await this.prisma.wallMuseAsset.findFirst({ where: { articleId, id } });
    if (!asset) throw new Error("当前素材不存在");
    return asset;
  }

  private async candidates(articleId: string, removeNearDuplicates: boolean): Promise<AnalyzedCandidate[]> {
    const assets = await this.prisma.wallMuseAsset.findMany({ where: { articleId, state: "ready", wallpaper: { status: { notIn: ["archived", "rejected"] } } }, orderBy: { ordinal: "asc" } });
    const chosen: typeof assets = [];
    for (const asset of assets) {
      if (removeNearDuplicates && asset.perceptualHash && chosen.some((prior) => prior.perceptualHash && perceptualDistance(prior.perceptualHash, asset.perceptualHash!) <= 3)) continue;
      if (!(asset.analysis as WallpaperAnalysis | null)?.safe) continue;
      chosen.push(asset);
    }
    return chosen.map((asset) => { const analysis = asset.analysis as WallpaperAnalysis; return { id: asset.id, title: analysis.title, summary: analysis.summary || "", tags: analysis.tags }; });
  }

  private async finish(job: WallMuseJob, input: StoredGenerationInput, cp: Checkpoint, fence: WorkFence) {
    if (!cp.plan || !cp.copy) throw new Error("文章策划或文案缺失");
    const plan = cp.plan; const copy = cp.copy;
    const assets = await this.prisma.wallMuseAsset.findMany({ where: { articleId: job.articleId, state: "ready", id: { in: plan.selectedIds } }, include: { wallpaper: { select: { title: true, status: true } } } });
    assertSelection(plan.selectedIds, assets.filter((asset) => !["archived", "rejected"].includes(asset.wallpaper.status)).map((asset) => asset.id), input.targetCount);
    await this.prisma.$transaction(async (tx) => {
      await fence.assert(tx);
      const article = await tx.wallMuseArticle.findUniqueOrThrow({ where: { id: job.articleId } });
      if (article.lifecycle === "synced") throw new Error("文章已同步为固定合集，生成结果未覆盖");
      const currentJob = await tx.wallMuseJob.findUniqueOrThrow({ where: { id: job.id } });
      if (currentJob.cancelRequested) { await tx.wallMuseJob.update({ where: { id: job.id }, data: { status: "cancelled", message: "任务已取消，未应用生成结果" } }); return; }
      const latest = await tx.wallMuseRevision.aggregate({ where: { articleId: article.id }, _max: { revision: true } });
      const baseRow = input.baseRevisionId ? await tx.wallMuseRevision.findUnique({ where: { id: input.baseRevisionId } }) : null;
      const base = baseRow ? revisionSchema.parse(baseRow.payload) : null;
      const revision: ArticleRevision = { schemaVersion: 1, articleId: article.id, id: randomUUID(), revision: (latest._max.revision || 0) + 1,
        createdAt: new Date().toISOString(), subject: plan.subject, title: titleFor(plan.subject, assets.length), titleMode: "automatic",
        titleSuggestions: copy.titleThemes.map((theme) => titleFor(theme, assets.length)), intro: copy.intro, groupCopies: copy.groupCopies, ending: copy.ending,
        interaction: copy.interaction, interactionEnabled: Boolean(copy.interaction),
        templateId: plan.templateId, templateVersion: 1, rendererVersion: 1, density: input.copyDensity, provenance: "service", miniProgram: this.service.miniProgram(),
        assets: plan.selectedIds.map((id) => { const asset = assets.find((item) => item.id === id)!; return { id: asset.id, wallpaperId: asset.wallpaperId, title: asset.wallpaper.title, src: `/assets/wallmuse/${asset.id}.jpg`, width: asset.width, height: asset.height, kind: "source", storageReady: true }; }),
      };
      if (base && input.scope === "title") Object.assign(revision, { ...base, id: revision.id, revision: revision.revision, createdAt: revision.createdAt, title: titleFor(copy.titleThemes[0], base.assets.length), titleMode: "manual", titleSuggestions: revision.titleSuggestions });
      else if (base && input.scope === "copy") Object.assign(revision, { title: base.title, titleMode: base.titleMode, titleSuggestions: base.titleSuggestions, miniProgram: base.miniProgram });
      revisionSchema.parse(revision);
      const candidate = Boolean(input.baseRevisionId && article.currentRevisionId !== input.baseRevisionId);
      await tx.wallMuseRevision.create({ data: { id: revision.id, articleId: article.id, revision: revision.revision, payload: json(revision), contentHash: revisionDigest(revision), candidate } });
      if (!candidate) await tx.wallMuseArticle.update({ where: { id: article.id }, data: { currentRevisionId: revision.id, title: revision.title } });
      cp.resultRevisionId = revision.id;
      await tx.wallMuseJob.update({ where: { id: job.id }, data: { status: "done", stage: "done", checkpoint: json(cp), message: candidate ? "生成结果已保存为候选版本，未覆盖你的新编辑" : "文章已生成，可预览、编辑和复制到公众号" } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
