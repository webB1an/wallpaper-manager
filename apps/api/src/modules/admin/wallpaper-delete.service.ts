import { ConflictException, Injectable } from "@nestjs/common";
import { lstat, realpath, unlink } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LeaseBusyError, WorkLeaseService } from "../sources/work-lease.service";

export async function removeOwnedFile(root: string, relative: string) {
  const absolute = resolve(root, relative);
  if (!absolute.startsWith(resolve(root) + sep)) throw new Error("图片路径超出存储目录，已停止删除");
  try {
    const info = await lstat(absolute);
    const actualRoot = await realpath(root);
    const actual = await realpath(absolute);
    if (info.isSymbolicLink() || !info.isFile() || !actual.startsWith(actualRoot + sep)) throw new Error("图片路径不安全，已停止删除");
    await unlink(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function deleteWallpaperInTransaction(tx: Prisma.TransactionClient, id: string) {
          const wallpaper = await tx.wallpaper.findUnique({ where: { id }, include: { articleAssets: true } });
          if (!wallpaper) return { deleted: true };
          const articleIds = wallpaper.articleAssets.map((asset) => asset.articleId);
          await tx.wallMuseJob.updateMany({ where: { articleId: { in: articleIds }, status: { in: ["queued", "waiting", "running", "failed"] } }, data: { status: "cancelled", cancelRequested: true, message: "关联壁纸已被管理员删除，任务已停止" } });
          // Keep historical revision text; article reads omit removed image references.
          await tx.wallMuseCollectionItem.deleteMany({ where: { wallpaperId: id } });
          await tx.wallMuseAsset.deleteMany({ where: { wallpaperId: id } });
          const root = resolve(process.cwd(), "storage");
          for (const path of new Set([wallpaper.coverPath, wallpaper.assetPath].filter((value): value is string => !!value))) {
            const shared = await tx.wallpaper.count({ where: { id: { not: id }, OR: [{ coverPath: path }, { assetPath: path }] } });
            if (!shared) {
              await removeOwnedFile(resolve(root, "public"), path);
              if (path === wallpaper.coverPath) await removeOwnedFile(resolve(root, "public"), path + ".preview.mp4");
            }
          }
          for (const asset of wallpaper.articleAssets) {
            if (!(await tx.wallMuseAsset.count({ where: { publishPath: asset.publishPath } }))) {
              await removeOwnedFile(resolve(root, "wallmuse"), asset.publishPath);
            }
          }
          await tx.wallpaper.delete({ where: { id } });
          return { deleted: true };
}

@Injectable()
export class WallpaperDeleteService {
  constructor(private readonly prisma: PrismaService, private readonly leases: WorkLeaseService) {}

  async remove(id: string) {
    try {
      return await this.leases.run("wallmuse-worker", async (worker) => this.leases.run("storage-transfers", async (storage) => {
        return this.prisma.$transaction(async (tx) => {
          await worker.assert(tx); await storage.assert(tx);
          return deleteWallpaperInTransaction(tx, id);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
      }));
    } catch (error) {
      if (error instanceof LeaseBusyError) throw new ConflictException("图片处理或网盘传输尚在进行，请稍后再次删除");
      throw error;
    }
  }
}
