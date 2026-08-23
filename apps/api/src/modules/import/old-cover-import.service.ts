import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WallpaperStatus } from "@prisma/client";
import { nanoid } from "nanoid";
import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { candidateTitleFromCoverFile, legacyResourceMatchKey } from "../../common/match";
import { publicAssetUrl } from "../../common/public-url";
import { positiveInt } from "../../common/query-values";
import { legacyShortCodeCandidates, normalizeLegacyResourceId } from "../../common/short-code";
import { AiService } from "../ai/ai.service";
import { PrismaService } from "../prisma/prisma.service";
import { TasksService } from "../tasks/tasks.service";
import { WdbzkService, WdbzkResource } from "../wdbzk/wdbzk.service";

const OLD_COVERS_URL = "https://wallpaper.wdbzk.com/covers";

@Injectable()
export class OldCoverImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wdbzk: WdbzkService,
    private readonly config: ConfigService,
    private readonly ai: AiService,
    private readonly tasks: TasksService,
  ) {}

  async preview(limit = 50) {
    const covers = await this.readCoverFiles();
    const resources = await this.readAllOldResources();
    const indexed = indexResources(resources);
    return covers.slice(0, limit).map((coverFileName) => {
      const match = this.findMatch(coverFileName, indexed);
      return {
        coverFileName,
        candidateTitle: candidateTitleFromCoverFile(coverFileName),
        matchKey: legacyResourceMatchKey(coverFileName),
        matched: match?.resource,
        confidence: match?.confidence || 0,
      };
    });
  }

  async stats() {
    const [groups, totalWallpapers, published, rejected, pendingReview, unclassified] = await Promise.all([
      this.prisma.oldCoverImport.groupBy({ by: ["status"], _count: { status: true } }),
      this.prisma.wallpaper.count({ where: { matchKey: { not: null } } }),
      this.prisma.wallpaper.count({ where: { matchKey: { not: null }, status: WallpaperStatus.published } }),
      this.prisma.wallpaper.count({ where: { matchKey: { not: null }, status: WallpaperStatus.rejected } }),
      this.prisma.wallpaper.count({ where: { matchKey: { not: null }, status: WallpaperStatus.pending_review } }),
      this.prisma.wallpaper.count({ where: { matchKey: { not: null }, aiAnalysis: null } }),
    ]);
    return {
      imports: Object.fromEntries(groups.map((item) => [item.status, item._count.status])),
      wallpapers: {
        total: totalWallpapers,
        published,
        rejected,
        pendingReview,
        unclassified,
      },
    };
  }

  async records(query: { page?: number; pageSize?: number; status?: string; keyword?: string }) {
    const page = positiveInt(query.page, 1, "页码");
    const pageSize = positiveInt(query.pageSize, 20, "每页数量", 100);
    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword ? {
        OR: [
          { coverFileName: { contains: query.keyword } },
          { candidateTitle: { contains: query.keyword } },
          { oldResourceName: { contains: query.keyword } },
        ],
      } : {}),
    };
    const [list, total] = await Promise.all([
      this.prisma.oldCoverImport.findMany({
        where,
        orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.oldCoverImport.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  async run(limit = 0) {
    const covers = await this.readCoverFiles();
    const resources = await this.readAllOldResources();
    const indexed = indexResources(resources);
    const selected = limit > 0 ? covers.slice(0, limit) : covers;
    let imported = 0;
    let pending = 0;
    for (const coverFileName of selected) {
      const match = this.findMatch(coverFileName, indexed);
      const candidateTitle = candidateTitleFromCoverFile(coverFileName);
      const coverPath = await this.copyCover(coverFileName).catch(() => undefined);
      await this.prisma.oldCoverImport.upsert({
        where: { coverFileName },
        update: {
          coverPath,
          candidateTitle,
          matchKey: legacyResourceMatchKey(coverFileName),
          oldResourceId: match?.resource.id,
          oldResourceName: match?.resource.name,
          oldResourceLink: match?.resource.link,
          confidence: match?.confidence || 0,
          status: match ? "matched" : "needs_review",
          message: match ? undefined : "未匹配到网盘资源",
        },
        create: {
          coverFileName,
          coverPath,
          candidateTitle,
          matchKey: legacyResourceMatchKey(coverFileName),
          oldResourceId: match?.resource.id,
          oldResourceName: match?.resource.name,
          oldResourceLink: match?.resource.link,
          confidence: match?.confidence || 0,
          status: match ? "matched" : "needs_review",
          message: match ? undefined : "未匹配到网盘资源",
        },
      });
      if (match && coverPath) {
        await this.createWallpaperFromImport(coverFileName, candidateTitle, coverPath, match.resource, match.confidence);
        imported += 1;
      } else {
        pending += 1;
      }
    }
    return { scanned: selected.length, imported, pending };
  }

  async classifyImported(limit = 50) {
    const selected = await this.prisma.wallpaper.findMany({
      where: {
        matchKey: { not: null },
        coverPath: { not: null },
        status: { in: [WallpaperStatus.pending_review, WallpaperStatus.processing] },
        aiAnalysis: null,
      },
      orderBy: { createdAt: "asc" },
      take: Math.min(200, Math.max(1, limit)),
    });
    const task = await this.tasks.create("ai_classify", { limit, selected: selected.length }, "开始 AI 重识别旧封面");
    let classified = 0;
    let rejected = 0;
    let failed = 0;
    await this.tasks.update(task.id, { status: "running", progress: 1, message: "AI 重识别进行中" });

    for (const [index, wallpaper] of selected.entries()) {
      try {
        const coverPath = join(process.cwd(), "storage", "public", wallpaper.coverPath!);
        const analysis = await this.ai.analyzeImage(coverPath, wallpaper.originalName);
        const tags = await Promise.all(analysis.tags.map((name) => this.prisma.tag.upsert({
          where: { name },
          update: {},
          create: { name },
        })));
        await this.prisma.aiAnalysis.upsert({
          where: { wallpaperId: wallpaper.id },
          update: {
            title: analysis.title,
            type: analysis.type,
            tags: analysis.tags,
            sensitiveFlags: analysis.sensitiveFlags,
            safe: analysis.safe,
            summary: analysis.summary,
          },
          create: {
            wallpaperId: wallpaper.id,
            title: analysis.title,
            type: analysis.type,
            tags: analysis.tags,
            sensitiveFlags: analysis.sensitiveFlags,
            safe: analysis.safe,
            summary: analysis.summary,
          },
        });
        await this.prisma.wallpaper.update({
          where: { id: wallpaper.id },
          data: {
            title: analysis.title,
            type: analysis.type,
            status: analysis.safe ? WallpaperStatus.pending_review : WallpaperStatus.rejected,
            tags: {
              deleteMany: {},
              create: tags.map((tag) => ({ tagId: tag.id })),
            },
          },
        });
        if (wallpaper.matchKey) {
          await this.prisma.oldCoverImport.updateMany({
            where: { matchKey: wallpaper.matchKey },
            data: { status: "matched", message: null },
          });
        }
        if (analysis.safe) classified += 1;
        else rejected += 1;
      } catch (error) {
        failed += 1;
        if (wallpaper.matchKey) {
          await this.prisma.oldCoverImport.updateMany({
            where: { matchKey: wallpaper.matchKey },
            data: { status: "classify_failed", message: (error as Error).message },
          });
        }
      }
      await this.tasks.update(task.id, {
        progress: Math.round(((index + 1) / Math.max(1, selected.length)) * 100),
        message: `AI 重识别 ${index + 1}/${selected.length}`,
      });
    }

    await this.tasks.update(task.id, {
      status: failed ? "failed" : "success",
      progress: 100,
      message: failed ? "部分旧封面 AI 重识别失败" : "旧封面 AI 重识别完成",
      result: { classified, rejected, failed },
    });
    return { scanned: selected.length, classified, rejected, failed, taskId: task.id };
  }

  private async createWallpaperFromImport(
    coverFileName: string,
    title: string,
    coverPath: string,
    resource: WdbzkResource,
    confidence: number,
  ) {
    const key = legacyResourceMatchKey(coverFileName);
    const existing = await this.prisma.wallpaper.findFirst({ where: { matchKey: key } });
    if (existing) return existing;
    const wallpaper = await this.prisma.wallpaper.create({
      data: {
        title,
        originalName: resource.name,
        coverPath,
        coverUrl: publicAssetUrl(this.config, coverPath),
        matchKey: key,
        matchConfidence: confidence,
        status: "pending_review",
        type: "live",
      },
    });
    const storageLink = await this.prisma.storageLink.create({
      data: {
        wallpaperId: wallpaper.id,
        provider: resource.link.includes("pan.quark.cn") ? "quark" : "baidu",
        url: resource.link,
        wdbzkResourceId: resource.id,
        isPrimary: true,
      },
    });
    await this.prisma.shortLink.create({
      data: {
        code: await this.nextLegacyShortCode(resource.id),
        wallpaperId: wallpaper.id,
        storageLinkId: storageLink.id,
        provider: storageLink.provider,
      },
    });
    return wallpaper;
  }

  private findMatch(coverFileName: string, indexed: ReturnType<typeof indexResources>) {
    const key = legacyResourceMatchKey(coverFileName);
    const exact = indexed.byKey.get(key);
    if (exact) return { resource: exact, confidence: 1 };
    return undefined;
  }

  private async nextLegacyShortCode(resourceId: number): Promise<string> {
    for (const code of legacyShortCodeCandidates(resourceId)) {
      const existing = await this.prisma.shortLink.findUnique({ where: { code }, select: { id: true } });
      if (!existing) return code;
    }
    return `${normalizeLegacyResourceId(resourceId)}-${nanoid(6)}`;
  }

  private async copyCover(coverFileName: string): Promise<string> {
    const dir = join(process.cwd(), "storage", "public", "legacy-covers");
    await mkdir(dir, { recursive: true });
    const safeName = basename(coverFileName).replace(/[<>:"/\\|?*]/g, "_");
    const relativePath = `legacy-covers/${safeName}`;
    const output = join(process.cwd(), "storage", "public", relativePath);
    if (existsSync(output)) return relativePath;

    const localSource = this.localCoverPath(coverFileName);
    if (localSource) {
      await copyFile(localSource, output);
      return relativePath;
    }

    const response = await fetch(`${OLD_COVERS_URL}/${encodeURIComponent(coverFileName)}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) throw new Error(`封面下载失败: ${coverFileName}`);
    await pipeline(response.body as never, createWriteStream(output));
    return relativePath;
  }

  private async readCoverFiles(): Promise<string[]> {
    const configuredList = this.localCoverListPath();
    if (configuredList) {
      return this.parseCoverList(await readFile(configuredList, "utf8"));
    }

    const configuredDir = this.localCoverDir();
    if (configuredDir) {
      const files = await readdir(configuredDir);
      return files
        .filter((fileName) => /\.(jpe?g|png|webp|gif)$/i.test(fileName))
        .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
    }

    const local = join(process.cwd(), "old-covers.js");
    const text = existsSync(local)
      ? await readFile(local, "utf8")
      : await fetch("https://wallpaper.wdbzk.com/covers.js").then((response) => response.text());
    return this.parseCoverList(text);
  }

  private parseCoverList(text: string): string[] {
    const match = text.match(/=\s*(\[[\s\S]*\]);?/);
    if (!match) throw new Error("无法解析旧封面列表");
    return JSON.parse(match[1].replace(/^\uFEFF/, "")) as string[];
  }

  private localCoverPath(coverFileName: string): string | undefined {
    const dir = this.localCoverDir();
    if (!dir) return undefined;
    const source = join(dir, basename(coverFileName));
    return existsSync(source) ? source : undefined;
  }

  private localCoverDir(): string | undefined {
    const explicit = this.config.get<string>("OLD_COVER_SOURCE_DIR")?.trim();
    if (explicit && existsSync(explicit)) return explicit;
    const root = this.config.get<string>("OLD_WALLPAPER_ROOT")?.trim();
    const fromRoot = root ? join(root, "covers") : undefined;
    if (fromRoot && existsSync(fromRoot)) return fromRoot;
    return undefined;
  }

  private localCoverListPath(): string | undefined {
    const explicit = this.config.get<string>("OLD_COVER_LIST_PATH")?.trim();
    if (explicit && existsSync(explicit)) return explicit;
    const root = this.config.get<string>("OLD_WALLPAPER_ROOT")?.trim();
    const fromRoot = root ? join(root, "covers.js") : undefined;
    if (fromRoot && existsSync(fromRoot)) return fromRoot;
    return undefined;
  }

  private async readAllOldResources(): Promise<WdbzkResource[]> {
    const all: WdbzkResource[] = [];
    const pageSize = 50;
    for (let page = 1; page <= 100; page += 1) {
      const result = await this.wdbzk.listResources(page, pageSize);
      all.push(...result.list);
      if (all.length >= result.total || result.list.length === 0) break;
    }
    return all;
  }
}

function indexResources(resources: WdbzkResource[]) {
  const byKey = new Map<string, WdbzkResource>();
  const duplicates = new Set<string>();
  for (const resource of resources) {
    const key = legacyResourceMatchKey(resource.name);
    if (!key || duplicates.has(key)) continue;
    if (byKey.has(key)) {
      byKey.delete(key);
      duplicates.add(key);
      continue;
    }
    byKey.set(key, resource);
  }
  return { resources, byKey };
}
