import { Injectable } from "@nestjs/common";
import { StorageProvider } from "@prisma/client";
import { nanoid } from "nanoid";
import { PrismaService } from "../prisma/prisma.service";
import { BaiduStorageService } from "./baidu-storage.service";
import { QuarkStorageService } from "./quark-storage.service";
import { StorageAccountService } from "./storage-account.service";

@Injectable()
export class StorageCoordinatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quark: QuarkStorageService,
    private readonly baidu: BaiduStorageService,
    private readonly accounts: StorageAccountService,
  ) {}

  async syncWallpaper(wallpaperId: string, filePath: string, title: string, selection?: { quarkAccountId?: string; baiduAccountId?: string }) {
    const results: Array<{ provider: StorageProvider; ok: boolean; url?: string; passcode?: string; remoteFileId?: string; remotePath?: string; storageAccountId?: string; error?: string }> = [];
    const quarkAccount = await this.accounts.getAccountForProvider(StorageProvider.quark, selection?.quarkAccountId);
    const baiduAccount = await this.accounts.getAccountForProvider(StorageProvider.baidu, selection?.baiduAccountId);

    if (!quarkAccount) {
      results.push({ provider: StorageProvider.quark, ok: false, error: missingManagedAccountError(StorageProvider.quark) });
    } else {
      try {
        const upload = await this.quark.upload(filePath, quarkAccount);
        const share = await this.quark.share(upload.fids, title, quarkAccount);
        results.push({ provider: StorageProvider.quark, ok: true, url: share.url, passcode: share.passcode, remoteFileId: upload.fids[0], remotePath: upload.fullPath, storageAccountId: quarkAccount.id });
      } catch (error) {
        results.push({ provider: StorageProvider.quark, ok: false, error: (error as Error).message });
      }
    }

    if (!baiduAccount) {
      results.push({ provider: StorageProvider.baidu, ok: false, error: missingManagedAccountError(StorageProvider.baidu) });
    } else {
      try {
        const share = await this.baidu.uploadAndShare(filePath, baiduAccount);
        results.push({ provider: StorageProvider.baidu, ok: true, url: share.url, passcode: share.passcode, remotePath: share.remotePath, storageAccountId: baiduAccount.id });
      } catch (error) {
        results.push({ provider: StorageProvider.baidu, ok: false, error: (error as Error).message });
      }
    }

    const successful = results.filter((item) => item.ok && item.url);
    const primaryProvider = successful[0]?.provider;
    if (primaryProvider) {
      await this.prisma.storageLink.updateMany({
        where: { wallpaperId },
        data: { isPrimary: false },
      });
    }

    for (const result of successful) {
      const storageLink = await this.prisma.storageLink.create({
        data: {
          wallpaperId,
          provider: result.provider,
          url: result.url!,
          passcode: result.passcode,
          remoteFileId: result.remoteFileId,
          remotePath: result.remotePath,
          storageAccountId: result.storageAccountId,
          isPrimary: result.provider === primaryProvider,
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

function missingManagedAccountError(provider: StorageProvider) {
  return `未配置默认${provider === StorageProvider.quark ? "夸克" : "百度"}网盘账号，请先在管理端“网盘账号”新增、授权并设为默认账号`;
}
