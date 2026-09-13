import { Injectable } from "@nestjs/common";
import { Prisma, Wallpaper } from "@prisma/client";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { fetchAutoSource, type AutoSourceContext, type AutoSourceItem } from "../admin/auto-publish-sources";
import { PrismaService } from "../prisma/prisma.service";
import { WorkLeaseService } from "./work-lease.service";

export async function fileSha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export interface IntakeFiles {
  data: Prisma.WallpaperCreateInput;
  cleanup: () => Promise<void>;
}

@Injectable()
export class SourceIntakeService {
  protected fetchSource = fetchAutoSource;
  constructor(private readonly prisma: PrismaService, private readonly leases: WorkLeaseService) {}

  async obtain(source: string, context: Omit<AutoSourceContext, "exclude">,
    prepare: (item: AutoSourceItem, hash: string) => Promise<IntakeFiles>,
    onCreated: (tx: Prisma.TransactionClient, wallpaper: Wallpaper, item: AutoSourceItem, hash: string) => Promise<void>) {
    return this.leases.run(`source:${source}`, async (fence) => {
      const exclude = (await this.prisma.wallpaperSource.findMany({ where: { source }, select: { sourceId: true } })).map((row) => row.sourceId);
      const item = await this.fetchSource(source, { ...context, exclude });
      await fence.assert();
      if (!item.sourceId || item.sourceId.length > 255) throw new Error("来源返回了无效的素材编号");
      const info = await stat(item.filePath);
      if (!info.isFile() || info.size === 0) throw new Error("来源文件为空或不可用");
      const hash = await fileSha256(item.filePath);
      const existing = await this.prisma.wallpaper.findFirst({ where: { OR: [{ contentHash: hash }, { wallpaperSources: { some: { source, sourceId: item.sourceId } } }] } });
      if (existing) {
        await this.prisma.wallpaperSource.upsert({ where: { source_sourceId: { source, sourceId: item.sourceId } }, update: {}, create: { source, sourceId: item.sourceId, wallpaperId: existing.id } });
        return { wallpaper: existing, created: false, item, hash };
      }
      const files = await prepare(item, hash);
      try {
        const wallpaper = await this.prisma.$transaction(async (tx) => {
          await fence.assert(tx);
          const created = await tx.wallpaper.create({ data: { ...files.data, contentHash: hash, fileSize: BigInt(info.size) } });
          // A conflicting source alias rolls the whole transaction back; no orphan wallpaper.
          await tx.wallpaperSource.create({ data: { source, sourceId: item.sourceId, wallpaperId: created.id } });
          await onCreated(tx, created, item, hash);
          return created;
        });
        return { wallpaper, created: true, item, hash };
      } catch (error) {
        // A lost commit response is ambiguous. Read the committed row before removing prepared files.
        // If the database is unavailable, retain them for recovery instead of deleting possibly referenced images.
        const committed = await this.prisma.wallpaper.findFirst({ where: { OR: [{ contentHash: hash }, { wallpaperSources: { some: { source, sourceId: item.sourceId } } }] } });
        if (committed?.assetPath && committed.assetPath === files.data.assetPath) return { wallpaper: committed, created: true, item, hash };
        await files.cleanup();
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const duplicate = await this.prisma.wallpaper.findFirst({ where: { OR: [{ contentHash: hash }, { wallpaperSources: { some: { source, sourceId: item.sourceId } } }] } });
          if (duplicate) {
            await this.prisma.wallpaperSource.upsert({ where: { source_sourceId: { source, sourceId: item.sourceId } }, update: {}, create: { source, sourceId: item.sourceId, wallpaperId: duplicate.id } });
            return { wallpaper: duplicate, created: false, item, hash };
          }
        }
        throw error;
      }
    });
  }
}
