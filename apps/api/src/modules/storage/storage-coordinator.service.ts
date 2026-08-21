import { Injectable } from "@nestjs/common";
import { StorageProvider } from "@prisma/client";
import { nanoid } from "nanoid";
import { PrismaService } from "../prisma/prisma.service";
import { BaiduStorageService } from "./baidu-storage.service";
import { QuarkStorageService } from "./quark-storage.service";

@Injectable()
export class StorageCoordinatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quark: QuarkStorageService,
    private readonly baidu: BaiduStorageService,
  ) {}

  async syncWallpaper(wallpaperId: string, filePath: string, title: string) {
    const results: Array<{ provider: StorageProvider; ok: boolean; url?: string; passcode?: string; remoteFileId?: string; remotePath?: string; error?: string }> = [];

    try {
      const upload = await this.quark.upload(filePath);
      const share = await this.quark.share(upload.fids, title);
      results.push({ provider: StorageProvider.quark, ok: true, url: share.url, passcode: share.passcode, remoteFileId: upload.fids[0], remotePath: upload.fullPath });
    } catch (error) {
      results.push({ provider: StorageProvider.quark, ok: false, error: (error as Error).message });
    }

    try {
      const share = await this.baidu.uploadAndShare(filePath);
      results.push({ provider: StorageProvider.baidu, ok: true, url: share.url, passcode: share.passcode, remotePath: share.remotePath });
    } catch (error) {
      results.push({ provider: StorageProvider.baidu, ok: false, error: (error as Error).message });
    }

    for (const result of results.filter((item) => item.ok && item.url)) {
      const storageLink = await this.prisma.storageLink.create({
        data: {
          wallpaperId,
          provider: result.provider,
          url: result.url!,
          passcode: result.passcode,
          remoteFileId: result.remoteFileId,
          remotePath: result.remotePath,
          isPrimary: result.provider === StorageProvider.quark,
        },
      });
      await this.prisma.shortLink.create({
        data: {
          code: nanoid(8),
          wallpaperId,
          storageLinkId: storageLink.id,
          provider: result.provider,
        },
      });
    }

    if (!results.some((item) => item.ok)) {
      throw new Error(results.map((item) => `${item.provider}: ${item.error}`).join("; "));
    }

    return results;
  }
}
