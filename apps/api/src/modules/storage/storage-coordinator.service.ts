import { Injectable } from "@nestjs/common";
import { StorageProvider } from "@prisma/client";
import { nanoid } from "nanoid";
import { buildWallpaperRemoteDir } from "../../common/wallpaper-path";
import { PrismaService } from "../prisma/prisma.service";
import { BaiduStorageService } from "./baidu-storage.service";
import { QuarkStorageService } from "./quark-storage.service";
import { StorageAccountService } from "./storage-account.service";
import { basename } from "node:path";
import { stat } from "node:fs/promises";
import type { DriveCheckpoint } from "../admin/upload-checkpoint";

@Injectable()
export class StorageCoordinatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quark: QuarkStorageService,
    private readonly baidu: BaiduStorageService,
    private readonly accounts: StorageAccountService,
  ) {}

  /** Persist upload and share independently, before moving to another provider. */
  async syncWallpaperResumable(wallpaperId: string, filePath: string, title: string, type: string, tags: string[],
    selection: { quarkAccountId?: string; baiduAccountId?: string } | undefined,
    drives: Partial<Record<"baidu" | "quark", DriveCheckpoint>>, save: () => Promise<void>) {
    const results: Array<{ provider: StorageProvider; ok: boolean; error?: string }> = [];
    const remoteDir = buildWallpaperRemoteDir(type, tags);
    for (const provider of [StorageProvider.baidu, StorageProvider.quark]) {
      try {
        const previous = drives[provider];
        const selected = provider === "baidu" ? selection?.baiduAccountId : selection?.quarkAccountId;
        const account = await this.accounts.getAccountForProvider(provider, previous?.accountId || selected);
        if (!account) throw new Error(missingManagedAccountError(provider));
        if (previous && account.id !== previous.accountId) throw new Error("原上传账号已不可用，禁止切换账号重建文件");
        const cp = drives[provider] ||= { accountId: account.id, phase: "pending" };
        await save();
        if (cp.phase === "uploading") {
          // A lost response is not evidence that upload failed. Inspect, never blindly re-upload.
          const size = (await stat(filePath)).size;
          if (provider === "baidu") {
            if (!cp.remotePath) throw new Error("缺少已上传路径");
            const parent = cp.remotePath.slice(0, cp.remotePath.lastIndexOf("/"));
            const list = await this.baidu.list(parent, account);
            const matches = list.items.filter((item) => !item.isDir && item.name === basename(cp.remotePath!) && item.size === size);
            if (matches.length !== 1) throw new Error("无法确认上传结果，请核对网盘；确认未上传后可重新同步");
          } else {
            cp.fids = [await this.quark.searchFileFid(basename(filePath), account, size)];
          }
          cp.phase = "uploaded";
          await save();
        }
        if (cp.phase === "pending") {
          if (provider === "baidu") cp.remotePath = this.baidu.uploadPath(filePath, remoteDir.baiduRelativeDir);
          cp.phase = "uploading";
          await save();
          if (provider === "baidu") cp.remotePath = await this.baidu.upload(filePath, account, remoteDir.baiduRelativeDir);
          else {
            const uploaded = await this.quark.upload(filePath, account, remoteDir.quarkSegments);
            cp.fids = uploaded.fids;
            cp.remotePath = uploaded.fullPath;
          }
          cp.phase = "uploaded";
          await save();
        }
        if (cp.phase === "uploaded" || cp.phase === "sharing") {
          cp.phase = "sharing";
          await save();
          const share = provider === "baidu" ? await this.baidu.share(cp.remotePath!, account) : await this.quark.share(cp.fids!, title, account);
          cp.url = share.url;
          cp.passcode = share.passcode;
          cp.phase = "shared";
          await save();
        }
        if (!cp.url) throw new Error("分享链接未保存，无法继续");
        await this.prisma.$transaction(async (tx) => {
          const existing = await tx.storageLink.findFirst({ where: { wallpaperId, provider, storageAccountId: account.id, url: cp.url } });
          const primary = await tx.storageLink.findFirst({ where: { wallpaperId, isActive: true, isPrimary: true } });
          const link = existing || await tx.storageLink.create({ data: { wallpaperId, provider, storageAccountId: account.id,
            url: cp.url!, passcode: cp.passcode, remotePath: cp.remotePath, remoteFileId: cp.fids?.[0], isPrimary: !primary } });
          if (!(await tx.shortLink.findFirst({ where: { storageLinkId: link.id } }))) {
            await tx.shortLink.create({ data: { code: nanoid(8), wallpaperId, storageLinkId: link.id, provider } });
          }
        });
        results.push({ provider, ok: true });
      } catch (error) { results.push({ provider, ok: false, error: (error as Error).message }); }
    }
    // Keep the original and stop the pipeline until selected providers are reconciled.
    if (results.some((item) => !item.ok && (drives[item.provider] || (item.provider === "baidu" ? selection?.baiduAccountId : selection?.quarkAccountId)))) throw new Error(results.filter((item) => !item.ok).map((item) => `${item.provider}: ${item.error}`).join("；"));
    if (!results.some((item) => item.ok)) throw new Error(results.map((item) => `${item.provider}: ${item.error}`).join("；"));
    return results;
  }

  async syncWallpaper(wallpaperId: string, filePath: string, title: string, type: string, tags: string[], selection?: { quarkAccountId?: string; baiduAccountId?: string }) {
    const results: Array<{ provider: StorageProvider; ok: boolean; url?: string; passcode?: string; remoteFileId?: string; remotePath?: string; storageAccountId?: string; error?: string }> = [];
    const remoteDir = buildWallpaperRemoteDir(type, tags);
    const quarkAccount = await this.accounts.getAccountForProvider(StorageProvider.quark, selection?.quarkAccountId);
    const baiduAccount = await this.accounts.getAccountForProvider(StorageProvider.baidu, selection?.baiduAccountId);

    if (!baiduAccount) {
      results.push({ provider: StorageProvider.baidu, ok: false, error: missingManagedAccountError(StorageProvider.baidu) });
    } else {
      try {
        const share = await this.baidu.uploadAndShare(filePath, baiduAccount, remoteDir.baiduRelativeDir);
        results.push({ provider: StorageProvider.baidu, ok: true, url: share.url, passcode: share.passcode, remotePath: share.remotePath, storageAccountId: baiduAccount.id });
      } catch (error) {
        results.push({ provider: StorageProvider.baidu, ok: false, error: (error as Error).message });
      }
    }

    if (!quarkAccount) {
      results.push({ provider: StorageProvider.quark, ok: false, error: missingManagedAccountError(StorageProvider.quark) });
    } else {
      try {
        const upload = await this.quark.upload(filePath, quarkAccount, remoteDir.quarkSegments);
        const share = await this.quark.share(upload.fids, title, quarkAccount);
        results.push({ provider: StorageProvider.quark, ok: true, url: share.url, passcode: share.passcode, remoteFileId: upload.fids[0], remotePath: upload.fullPath, storageAccountId: quarkAccount.id });
      } catch (error) {
        results.push({ provider: StorageProvider.quark, ok: false, error: (error as Error).message });
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
