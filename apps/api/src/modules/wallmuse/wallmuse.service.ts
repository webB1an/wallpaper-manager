import { deleteWallpaperInTransaction } from "../admin/wallpaper-delete.service";
import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, StorageProvider } from "@prisma/client";
import { existsSync } from "node:fs";
import { z } from "zod";
import { AdminService } from "../admin/admin.service";
import { autoSourceMeta } from "../admin/auto-publish-sources";
import { animeSources, isAnimeSource } from "./anime-policy";
import { PrismaService } from "../prisma/prisma.service";
import { StorageAccountService } from "../storage/storage-account.service";
import { WallMuseAiService } from "./wallmuse-ai.service";
import { WallMusePolicyService } from "./wallmuse-policy.service";
import { privateAssetPath } from "./article-files";
import { createInputSchema, digest, json, regenerationSchema, revisionDigest, revisionSchema, revisionWriteSchema, titleFor, type ArticleRevision, type Checkpoint, type DriveState, type StoredGenerationInput } from "./wallmuse.schemas";

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；"));
  return parsed.data;
}
const jobSelect = { id: true, articleId: true, status: true, stage: true, message: true, error: true, nextRunAt: true, createdAt: true, updatedAt: true, cancelRequested: true } as const;
const activeStatuses = ["queued", "running", "waiting"];

@Injectable()
export class WallMuseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly admin: AdminService,
    private readonly accounts: StorageAccountService,
    private readonly ai: WallMuseAiService,
    private readonly policy: WallMusePolicyService,
  ) {}

  async enabled() { return (await this.admin.getSettings()).wallMuseEnabled === true; }
  private async assertEnabled() { if (!(await this.enabled())) throw new ServiceUnavailableException("WallMuse 服务尚未启用"); }
  private async serial<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2034", "P2002"].includes(error.code)) throw error;
        if (attempt >= 2) throw new ConflictException("文章正在被其他请求更新，请刷新核对后重试");
      }
    }
  }
  miniProgram() { return { name: "漫元壁纸", appId: this.config.get<string>("MINIPROGRAM_APPID")?.trim() || this.config.get<string>("WECHAT_APPID")?.trim() || "", pagePath: "pages/index/index" }; }

  async capabilities() {
    const [settings, schedule] = await Promise.all([this.admin.getSettings(), this.policy.schedule()]);
    const sources = autoSourceMeta(settings.autoSourceEnabled).filter((source) => isAnimeSource(source.id));
    return { apiVersion: "1.0", features: settings.wallMuseEnabled === true ? ["articles", "generate", "regenerate", "manual-collections"] : [],
      aiConfigured: this.ai.configured(), sources, miniProgram: this.miniProgram(),
      schedule: { windowEnabled: true, ...schedule }, enabled: settings.wallMuseEnabled === true };
  }

  async create(value: unknown, keyValue: unknown) {
    await this.assertEnabled();
    const request = parseInput(createInputSchema, value);
    const key = parseInput(z.string().regex(/^[A-Za-z0-9_-]{8,100}$/), keyValue);
    const requestHash = digest(request);
    const existing = await this.prisma.wallMuseArticle.findUnique({ where: { requestKey: key } });
    if (existing) { if (existing.requestHash !== requestHash) throw new ConflictException("同一请求编号不能创建不同文章"); return this.latestJob(existing.id); }
    if (!this.ai.configured()) throw new BadRequestException("请先在 wallpaper-manager 配置 DeepSeek，当前不能生成真实文章");
    const capabilities = await this.capabilities();
    if (!capabilities.schedule.windows.length) throw new BadRequestException("请先配置有效空闲时段");
    const enabled = capabilities.sources.filter((source) => source.enabled).map((source) => source.id);
    const preferred = animeSources.filter((id) => enabled.includes(id));
    const sources = request.sourceMode === "manual" ? [...new Set(request.sources || [])] : preferred.slice(0, 3);
    if (!sources.length || sources.some((id) => !enabled.includes(id))) throw new BadRequestException("请选择至少一个已启用的二次元壁纸来源");
    const [baidu, quark] = await Promise.all([this.accounts.getDefaultAccount(StorageProvider.baidu), this.accounts.getDefaultAccount(StorageProvider.quark)]);
    if (!baidu && !quark) throw new BadRequestException("请先在 wallpaper-manager 配置可用网盘账号");
    const recent = await this.prisma.wallMuseArticle.findMany({ where: { copiedRevisionId: { not: null } }, orderBy: { copiedAt: "desc" }, take: 3, select: { copiedRevisionId: true } });
    const revisions = await this.prisma.wallMuseRevision.findMany({ where: { id: { in: recent.map((item) => item.copiedRevisionId!) } }, select: { payload: true } });
    const input: StoredGenerationInput = { ...request, sources, animeOnly: true,
      candidateBudget: request.candidateBudget ?? Math.min(60, Math.max(12, request.targetCount * 3)),
      storageSelection: { ...(baidu ? { baiduAccountId: baidu.id } : {}), ...(quark ? { quarkAccountId: quark.id } : {}) },
      requiredProviders: [...(baidu ? ["baidu" as const] : []), ...(quark ? ["quark" as const] : [])],
      includeInteraction: !revisions.some((item) => (item.payload as { interactionEnabled?: boolean }).interactionEnabled === true),
    };
    if (input.candidateBudget < input.targetCount) throw new BadRequestException("候选预算不能小于目标张数");
    try {
      const articleId = await this.prisma.$transaction(async (tx) => {
        const article = await tx.wallMuseArticle.create({ data: { requestKey: key, requestHash, title: request.preferredStyle || "待生成文章" } });
        const job = await tx.wallMuseJob.create({ data: { articleId: article.id, requestKey: digest({ create: key }), requestHash, input: json(input), checkpoint: json({ version: 1, attempts: 0 }), message: capabilities.schedule.allowed ? "等待采集" : capabilities.schedule.reason, nextRunAt: new Date(capabilities.schedule.nextEligibleAt || Date.now()) } });
        await tx.wallMuseArticle.update({ where: { id: article.id }, data: { activeJobId: job.id } });
        return article.id;
      });
      return this.latestJob(articleId);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const article = await this.prisma.wallMuseArticle.findUnique({ where: { requestKey: key } });
        if (article?.requestHash === requestHash) return this.latestJob(article.id);
        throw new ConflictException("请求编号已使用，请刷新任务列表");
      }
      throw error;
    }
  }

  async latestJob(articleId: string) {
    const job = await this.prisma.wallMuseJob.findFirst({ where: { articleId }, orderBy: { createdAt: "desc" }, select: jobSelect });
    if (!job) throw new NotFoundException("生成任务不存在");
    return { ...job, taskId: job.id, nextEligibleAt: job.nextRunAt.toISOString() };
  }

  async job(id: string) {
    const job = await this.prisma.wallMuseJob.findUnique({ where: { id }, select: jobSelect });
    if (!job) throw new NotFoundException("任务不存在");
    const assets = await this.prisma.wallMuseAsset.groupBy({ by: ["state"], where: { articleId: job.articleId }, _count: true });
    const recovery = [];
    if (job.status === "failed" && job.stage === "storage") {
      const failedAssets = await this.prisma.wallMuseAsset.findMany({ where: { articleId: job.articleId, state: "storage" }, include: { wallpaper: { select: { title: true, originalName: true } } } });
      for (const asset of failedAssets) for (const [provider, drive] of Object.entries(asset.drives as DriveState)) {
        if (!drive || !["uploading", "sharing"].includes(drive.phase)) continue;
        const account = await this.prisma.storageAccount.findUnique({ where: { id: drive.accountId }, select: { label: true } });
        recovery.push({ assetId: asset.id, title: asset.wallpaper.title, originalName: asset.wallpaper.originalName, provider, accountId: drive.accountId, accountLabel: account?.label || "原账号已不可用", phase: drive.phase, remotePath: drive.remotePath || null });
      }
    }
    return { ...job, taskId: job.id, nextEligibleAt: job.nextRunAt.toISOString(), counts: Object.fromEntries(assets.map((item) => [item.state, item._count])), recovery };
  }

  async reconcile(id: string, value: unknown) {
    await this.assertEnabled();
    const input = parseInput(z.object({ assetId: z.string().min(1).max(64), provider: z.enum(["baidu", "quark"]), accountId: z.string().min(1).max(64), expectedPhase: z.enum(["uploading", "sharing"]), decision: z.enum(["confirmed_missing", "share_found"]), confirmed: z.literal(true), url: z.string().max(1024).optional(), passcode: z.string().max(32).optional() }).strict(), value);
    if (input.decision === "share_found") {
      let url: URL;
      try { url = new URL(input.url || ""); } catch { throw new BadRequestException("请输入原网盘的有效分享链接"); }
      if (input.expectedPhase !== "sharing" || url.protocol !== "https:" || url.username || url.password || url.hostname !== (input.provider === "baidu" ? "pan.baidu.com" : "pan.quark.cn") || !url.pathname.startsWith("/s/")) throw new BadRequestException("分享链接必须来自本次原网盘，且仅能补记分享阶段");
    }
    await this.serial(async (tx) => {
      const job = await tx.wallMuseJob.findUnique({ where: { id }, include: { article: true } });
      if (!job || job.status !== "failed" || job.stage !== "storage" || job.article.lifecycle === "synced") throw new ConflictException("任务状态已变化，请重新读取");
      const cp = job.checkpoint as unknown as Checkpoint;
      if (cp.candidateId !== input.assetId) throw new ConflictException("本次失败素材已变化");
      const asset = await tx.wallMuseAsset.findFirst({ where: { id: input.assetId, articleId: job.articleId, state: "storage" } });
      if (!asset) throw new ConflictException("素材状态已变化");
      const drives = asset.drives as DriveState;
      const drive = drives[input.provider];
      if (!drive || drive.phase !== input.expectedPhase || drive.accountId !== input.accountId) throw new ConflictException("原网盘账号或检查点已变化，请重新核对");
      if (input.decision === "share_found") { drive.phase = "shared"; drive.url = input.url; drive.passcode = input.passcode; }
      else drive.phase = input.expectedPhase === "uploading" ? "pending" : "uploaded";
      await tx.wallMuseAsset.update({ where: { id: asset.id }, data: { drives: json(drives) } });
      const checkpoint = { ...cp, reconciliations: [...((cp as Checkpoint & { reconciliations?: unknown[] }).reconciliations || []), { assetId: asset.id, provider: input.provider, accountId: input.accountId, phase: input.expectedPhase, decision: input.decision, at: new Date().toISOString() }].slice(-20) };
      await tx.wallMuseJob.update({ where: { id }, data: { checkpoint: json(checkpoint), status: "queued", cancelRequested: false, error: null, message: "已记录人工核对结果，继续剩余步骤", nextRunAt: new Date() } });
    });
    return this.job(id);
  }

  async list(lifecycleValue: unknown, syncValue: unknown, pageValue: unknown) {
    const lifecycle = parseInput(z.enum(["pending", "history"]).default("pending"), lifecycleValue);
    const sync = parseInput(z.enum(["unsynced", "synced", "all"]).default("unsynced"), syncValue);
    const page = parseInput(z.coerce.number().int().min(1).max(10000).default(1), pageValue);
    const where: Prisma.WallMuseArticleWhereInput = { lifecycle: lifecycle === "pending" ? "pending" : sync === "all" ? { in: ["history", "synced"] } : sync === "synced" ? "synced" : "history" };
    const [rows, total] = await Promise.all([
      this.prisma.wallMuseArticle.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30,
        include: { jobs: { orderBy: { createdAt: "desc" }, take: 1, select: jobSelect }, collection: { select: { id: true } }, _count: { select: { assets: true } } } }),
      this.prisma.wallMuseArticle.count({ where }),
    ]);
    const ids = rows.map((row) => row.copiedRevisionId || row.currentRevisionId).filter((id): id is string => Boolean(id));
    const revisions = await this.prisma.wallMuseRevision.findMany({ where: { id: { in: ids } }, select: { id: true, payload: true } });
    const payloads = new Map(revisions.map((row) => [row.id, row.payload as unknown as ArticleRevision]));
    return { total, page, pageSize: 30, items: rows.map((row) => {
      const payload = payloads.get(row.copiedRevisionId || row.currentRevisionId || "");
      return { id: row.id, title: payload?.title || row.title, lifecycle: row.lifecycle, currentRevisionId: row.currentRevisionId, copiedRevisionId: row.copiedRevisionId,
        createdAt: row.createdAt, copiedAt: row.copiedAt, syncedAt: row.syncedAt, collectionId: row.collection?.id,
        imageCount: payload?.assets.length ?? 0, candidateCount: row._count.assets, job: row.jobs[0] ? { ...row.jobs[0], taskId: row.jobs[0].id } : null };
    }) };
  }

  async article(id: string, revisionId?: string) {
    const article = await this.prisma.wallMuseArticle.findUnique({ where: { id } });
    if (!article) throw new NotFoundException("文章不存在");
    const selected = revisionId || (article.lifecycle === "synced" ? article.copiedRevisionId : article.currentRevisionId);
    const revision = selected ? await this.prisma.wallMuseRevision.findFirst({ where: { id: selected, articleId: id } }) : null;
    if (revisionId && !revision) throw new NotFoundException("文章版本不存在");
    let visibleRevision = revision?.payload as unknown as ArticleRevision | undefined;
    if (visibleRevision) {
      const available = await this.prisma.wallMuseAsset.findMany({ where: { articleId: id, id: { in: visibleRevision.assets.map((asset) => asset.id) }, state: "ready", wallpaper: { status: { notIn: ["archived", "rejected"] } } }, select: { id: true } });
      const ids = new Set(available.map((asset) => asset.id));
      visibleRevision = { ...visibleRevision, assets: visibleRevision.assets.filter((asset) => ids.has(asset.id)) };
    }
    const candidates = await this.prisma.wallMuseRevision.findMany({ where: { articleId: id, candidate: true }, select: { id: true, revision: true, createdAt: true }, orderBy: { revision: "desc" }, take: 20 });
    return { articleId: id, lifecycle: article.lifecycle, copiedRevisionId: article.copiedRevisionId, currentRevision: visibleRevision || null,
      serverRevisionId: article.currentRevisionId, candidates, job: await this.latestJob(id) };
  }

  async asset(id: string) {
    const asset = await this.prisma.wallMuseAsset.findFirst({ where: { id, state: "ready", wallpaper: { status: { notIn: ["archived", "rejected"] }, aiAnalysis: { is: { safe: true } } } } });
    if (!asset) throw new NotFoundException("文章图片不存在或未通过审核");
    const path = privateAssetPath(asset.publishPath);
    if (!existsSync(path)) throw new NotFoundException("文章图片文件缺失，请从备份恢复，未静默替换素材");
    return path;
  }

  async articleAssets(articleId: string) {
    const assets = await this.prisma.wallMuseAsset.findMany({ where: { articleId, state: "ready", wallpaper: { status: { notIn: ["archived", "rejected"] }, aiAnalysis: { is: { safe: true } } } }, include: { wallpaper: { select: { title: true } } }, orderBy: { ordinal: "asc" } });
    return assets.map((asset) => ({ id: asset.id, wallpaperId: asset.wallpaperId, title: asset.wallpaper.title, src: `/assets/wallmuse/${asset.id}.jpg`, width: asset.width, height: asset.height, kind: "source", storageReady: true }));
  }

  private async canonicalRevision(tx: Prisma.TransactionClient, articleId: string, input: ArticleRevision) {
    if (input.articleId !== articleId) throw new BadRequestException("文章编号不匹配");
    if (new Set(input.assets.map((item) => item.id)).size !== input.assets.length) throw new BadRequestException("文章包含重复图片");
    const assets = await tx.wallMuseAsset.findMany({ where: { articleId, id: { in: input.assets.map((item) => item.id) }, state: "ready", wallpaper: { aiAnalysis: { is: { safe: true } } } }, include: { wallpaper: { select: { status: true, title: true } } } });
    if (assets.length !== input.assets.length || assets.some((item) => ["archived", "rejected"].includes(item.wallpaper.status))) throw new BadRequestException("文章只能使用本次采集且可用的图片");
    const mapped = input.assets.map((item) => {
      const source = assets.find((asset) => asset.id === item.id)!;
      if (source.wallpaperId !== item.wallpaperId) throw new BadRequestException("壁纸引用与文章素材不匹配");
      return { id: source.id, wallpaperId: source.wallpaperId, title: source.wallpaper.title, src: `/assets/wallmuse/${source.id}.jpg`, kind: "source" as const, storageReady: true, width: source.width, height: source.height };
    });
    const title = input.titleMode === "automatic" ? titleFor(input.subject, mapped.length) : input.title;
    const count = title.match(/(\d+)\s*张/);
    if (count && Number(count[1]) !== mapped.length) throw new BadRequestException("标题数量与图片数量不一致");
    return { ...input, title, assets: mapped, templateVersion: 1 as const, rendererVersion: 1 as const };
  }

  async save(id: string, value: unknown, copied = false) {
    await this.assertEnabled();
    const { baseRevisionId, revision: input } = parseInput(revisionWriteSchema, value);
    return this.serial(async (tx) => {
      const article = await tx.wallMuseArticle.findUnique({ where: { id } });
      if (!article) throw new NotFoundException("文章不存在");
      if (article.lifecycle === "synced") {
        const fixed = copied && article.copiedRevisionId === input.id ? await tx.wallMuseRevision.findUnique({ where: { id: input.id } }) : null;
        if (fixed && fixed.contentHash === revisionDigest(input)) return { currentRevision: fixed.payload, serverRevisionId: article.currentRevisionId, lifecycle: "synced", copiedRevisionId: fixed.id };
        throw new ConflictException("文章已同步为固定合集，不再修改");
      }
      const normalized = await this.canonicalRevision(tx, id, input);
      const hash = revisionDigest(normalized);
      let stored = await tx.wallMuseRevision.findUnique({ where: { id: input.id } });
      if (stored) {
        if (stored.articleId !== id || stored.contentHash !== hash) throw new ConflictException("相同版本编号包含不同内容，请重新载入文章");
        if (!copied && article.currentRevisionId !== stored.id && article.copiedRevisionId !== stored.id) throw new ConflictException("文章已出现更新版本，请重新载入");
      } else {
        const staleBase = article.currentRevisionId !== baseRevisionId;
        if (staleBase && (!copied || !(await tx.wallMuseRevision.findFirst({ where: { id: baseRevisionId, articleId: id } })))) throw new ConflictException("文章已在其他窗口更新，未覆盖新内容");
        const latest = await tx.wallMuseRevision.aggregate({ where: { articleId: id }, _max: { revision: true } });
        const payload = { ...normalized, revision: (latest._max.revision || 0) + 1 };
        stored = await tx.wallMuseRevision.create({ data: { id: input.id, articleId: id, revision: payload.revision, payload: json(payload), contentHash: hash, candidate: staleBase } });
        if (!staleBase) {
          const previous = await tx.wallMuseRevision.findFirst({ where: { id: baseRevisionId, articleId: id } });
          const previousAssets = (previous?.payload as unknown as ArticleRevision | undefined)?.assets || [];
          const removed = previousAssets.filter((asset) => !payload.assets.some((item) => item.id === asset.id)).map((asset) => asset.wallpaperId);
          if (removed.length) {
            await tx.wallpaper.updateMany({ where: { id: { in: removed }, articleAssets: { some: { articleId: id } } }, data: { status: "archived", autoPublish: false } });
            await tx.storageLink.updateMany({ where: { wallpaperId: { in: removed } }, data: { isActive: false } });
            for (const wallpaperId of removed) await deleteWallpaperInTransaction(tx, wallpaperId);
          }
          const updated = await tx.wallMuseArticle.updateMany({ where: { id, currentRevisionId: baseRevisionId, lifecycle: { not: "synced" } }, data: { currentRevisionId: stored.id, title: payload.title } });
          if (!updated.count) throw new ConflictException("文章已更新，请重新载入");
          article.currentRevisionId = stored.id;
        }
      }
      if (copied && !stored.copiedAt) {
        const updated = await tx.wallMuseArticle.updateMany({ where: { id, lifecycle: { not: "synced" } }, data: { lifecycle: "history", copiedRevisionId: stored.id, copiedAt: new Date() } });
        if (!updated.count) throw new ConflictException("复制的版本已不是当前版本，请核对");
        await tx.wallMuseRevision.update({ where: { id: stored.id }, data: { copiedAt: new Date() } });
        article.copiedRevisionId = stored.id;
        article.lifecycle = "history";
      }
      return { currentRevision: stored.payload, serverRevisionId: article.currentRevisionId, lifecycle: article.lifecycle, copiedRevisionId: article.copiedRevisionId };
    });
  }

  async sync(id: string, value: unknown) {
    await this.assertEnabled();
    const { revisionId } = parseInput(z.object({ revisionId: z.string().min(1).max(64) }).strict(), value);
    return this.serial(async (tx) => {
      const article = await tx.wallMuseArticle.findUnique({ where: { id }, include: { collection: true } });
      if (!article) throw new NotFoundException("文章不存在");
      if (article.collection) {
        if (article.collection.revisionId !== revisionId) throw new ConflictException("文章已有固定合集，不支持更新");
        return { status: "synced", collectionId: article.collection.id, wallpaperIds: article.collection.wallpaperIds };
      }
      if (article.lifecycle === "synced") {
        if (article.copiedRevisionId !== revisionId) throw new ConflictException("文章已同步，不支持更新");
        const stored = await tx.wallMuseRevision.findFirst({ where: { id: revisionId, articleId: id } });
        if (!stored) throw new NotFoundException("已同步的文章版本不存在");
        return { status: "synced", wallpaperIds: parseInput(revisionSchema, stored.payload).assets.map((item) => item.wallpaperId) };
      }
      if (article.lifecycle !== "history" || article.copiedRevisionId !== revisionId) throw new ConflictException("只有成功复制到公众号并进入历史的版本可以同步");
      const stored = await tx.wallMuseRevision.findFirst({ where: { id: revisionId, articleId: id } });
      if (!stored) throw new NotFoundException("已复制的文章版本不存在");
      const revision = parseInput(revisionSchema, stored.payload);
      const assets = await tx.wallMuseAsset.findMany({ where: { articleId: id, id: { in: revision.assets.map((item) => item.id) }, state: "ready" }, include: { wallpaper: { include: { aiAnalysis: true, storageLinks: true } } } });
      if (assets.length !== revision.assets.length) throw new BadRequestException("部分素材尚未准备完成");
      for (const asset of assets) {
        if (!asset.wallpaper.aiAnalysis?.safe || ["archived", "rejected"].includes(asset.wallpaper.status)) throw new BadRequestException("部分壁纸已下架或未通过审核");
        const drives = asset.drives as DriveState;
        if (!Object.keys(drives).length || Object.entries(drives).some(([provider, drive]) => !drive || drive.phase !== "shared" || !asset.wallpaper.storageLinks.some((link) => link.provider === provider && link.storageAccountId === drive.accountId && link.url === drive.url && link.isActive))) throw new BadRequestException("部分壁纸缺少原网盘账号的有效分享链接");
      }
      const ids = revision.assets.map((item) => item.wallpaperId);
      const publish = await tx.wallpaper.updateMany({ where: { id: { in: ids }, status: { in: ["pending_review", "published"] }, aiAnalysis: { is: { safe: true } } }, data: { status: "published", collectionOnly: false } });
      if (publish.count !== ids.length) throw new ConflictException("素材状态已变化，未完成上架");
      const updated = await tx.wallMuseArticle.updateMany({ where: { id, lifecycle: "history", copiedRevisionId: revisionId }, data: { lifecycle: "synced", syncedAt: new Date() } });
      if (!updated.count) throw new ConflictException("文章状态已变化，请刷新后确认");
      return { status: "synced", wallpaperIds: ids };
    });
  }

  async cancel(id: string) {
    const job = await this.prisma.wallMuseJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException("任务不存在");
    if (["done", "cancelled"].includes(job.status)) return this.job(id);
    await this.prisma.wallMuseJob.updateMany({ where: { id, status: "failed" }, data: { status: "cancelled", cancelRequested: true, message: "任务已取消，完成的步骤保留" } });
    await this.prisma.wallMuseJob.updateMany({ where: { id, status: { in: activeStatuses } }, data: { cancelRequested: true, message: "取消已申请；当前传输完成记账后停止" } });
    return this.job(id);
  }

  async retry(id: string) {
    await this.assertEnabled();
    const job = await this.prisma.wallMuseJob.findUnique({ where: { id }, include: { article: true } });
    if (!job || job.status !== "failed") throw new BadRequestException("只有失败任务可以继续");
    if (job.article.lifecycle === "synced") throw new ConflictException("文章已同步为固定合集");
    const checkpoint = job.checkpoint as unknown as Checkpoint;
    // Exhausted legacy jobs may already contain enough safe, theme-rejected images.
    // Let the worker recover those first; its collection budget still prevents new fetches.
    const result = await this.prisma.wallMuseJob.updateMany({ where: { id, status: "failed" }, data: { status: "queued", error: null, checkpoint: json({ ...checkpoint, unavailableSources: [] }), nextRunAt: new Date(), message: "继续处理已保存步骤" } });
    if (!result.count) throw new ConflictException("任务状态已变化");
    return this.job(id);
  }

  async regenerate(id: string, value: unknown, keyValue: unknown) {
    await this.assertEnabled();
    const input = parseInput(regenerationSchema, value);
    const key = parseInput(z.string().regex(/^[A-Za-z0-9_-]{8,100}$/), keyValue);
    const hash = digest({ articleId: id, ...input });
    const requestKey = digest({ regenerate: key });
    const existing = await this.prisma.wallMuseJob.findUnique({ where: { requestKey } });
    if (existing) { if (existing.requestHash !== hash) throw new ConflictException("请求编号已用于其他生成操作"); return this.job(existing.id); }
    const jobId = await this.serial(async (tx) => {
      const repeated = await tx.wallMuseJob.findUnique({ where: { requestKey } });
      if (repeated) { if (repeated.requestHash !== hash) throw new ConflictException("请求编号已使用"); return repeated.id; }
      const article = await tx.wallMuseArticle.findUnique({ where: { id } });
      if (!article || article.currentRevisionId !== input.baseRevisionId) throw new ConflictException("请先保存并重新载入当前版本");
      if (article.lifecycle === "synced") throw new ConflictException("已同步的合集不再修改");
      if (await tx.wallMuseJob.count({ where: { articleId: id, status: { in: activeStatuses } } })) throw new ConflictException("已有文章任务在等待或执行");
      const original = await tx.wallMuseJob.findFirst({ where: { articleId: id, kind: "generate" }, orderBy: { createdAt: "asc" } });
      if (!original) throw new BadRequestException("原生成任务不存在");
      const stored = original.input as unknown as StoredGenerationInput;
      const revision = await tx.wallMuseRevision.findUnique({ where: { id: input.baseRevisionId } });
      const base = parseInput(revisionSchema, revision?.payload);
      const job = await tx.wallMuseJob.create({ data: { articleId: id, requestKey, requestHash: hash, kind: "regenerate", stage: input.scope === "plan" ? "plan" : "copy", input: json({ ...stored, ...input, targetCount: base.assets.length, copyDensity: base.density, preferredStyle: input.preferredStyle ?? stored.preferredStyle }),
        checkpoint: json({ version: 1, attempts: 0, theme: base.subject, ...(input.scope !== "plan" ? { plan: { subject: base.subject, selectedIds: base.assets.map((asset) => asset.id), templateId: base.templateId } } : {}) }), message: "等待空闲时段重新生成" } });
      await tx.wallMuseArticle.update({ where: { id }, data: { activeJobId: job.id } });
      return job.id;
    });
    return this.job(jobId);
  }
}
