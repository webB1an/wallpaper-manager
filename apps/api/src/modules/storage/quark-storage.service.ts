import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { lastResult, parseNdjson, runCli } from "../../common/cli";
import { ManagedStorageAccount, quarkAccountEnv } from "./storage-account.service";

export interface QuarkUploadResult {
  fids: string[];
  fileName: string;
  fullPath?: string;
}

export interface QuarkShareResult {
  url: string;
  passcode?: string;
}

@Injectable()
export class QuarkStorageService {
  constructor(private readonly config: ConfigService) {}

  async upload(filePath: string, account?: ManagedStorageAccount, remoteDirSegments?: string[]): Promise<QuarkUploadResult> {
    const skillDir = this.requireSkillDir();
    const cliPath = join(skillDir, "scripts", "quark-drive.cjs");
    const args = [cliPath, "upload", filePath, "--session-input", "wallpaper-manager upload", "--session-id", this.sessionId()];
    const parentFid = await this.resolveParentFid(account, remoteDirSegments);
    if (parentFid) args.splice(3, 0, "--parent-fid", parentFid);

    const result = await runCli(process.execPath, args, { cwd: skillDir, timeoutMs: 60 * 60_000, env: quarkAccountEnv(account) });
    const final = lastResult(result.stdout);
    const code = Number(final?.code ?? (result.ok ? 0 : -1));
    if (!result.ok || code !== 0) {
      throw new Error(String(final?.msg || result.stderr || "夸克上传失败"));
    }
    const data = (final?.data || {}) as { fids?: string[]; fileNames?: string[]; fullPath?: string };
    if (!data.fids?.length) throw new Error("夸克上传成功但未返回文件 ID");
    return {
      fids: data.fids,
      fileName: data.fileNames?.[0] || filePath,
      fullPath: data.fullPath,
    };
  }

  async share(fids: string[], title: string, account?: ManagedStorageAccount): Promise<QuarkShareResult> {
    const skillDir = this.requireSkillDir();
    const cliPath = join(skillDir, "scripts", "quark-drive.cjs");
    const args = [
      cliPath,
      "share",
      ...fids,
      "--title",
      title,
      "--url-type",
      "1",
      "--expired-type",
      "1",
      "--session-input",
      "wallpaper-manager share",
      "--session-id",
      this.sessionId(),
    ];
    const result = await runCli(process.execPath, args, { cwd: skillDir, timeoutMs: 120_000, env: quarkAccountEnv(account) });
    const final = lastResult(result.stdout);
    const code = Number(final?.code ?? (result.ok ? 0 : -1));
    if (!result.ok || code !== 0) {
      throw new Error(String(final?.msg || result.stderr || "夸克分享失败"));
    }
    const data = (final?.data || {}) as { share_url?: string; passcode?: string };
    if (!data.share_url) throw new Error("夸克分享成功但未返回链接");
    return { url: data.share_url, passcode: data.passcode };
  }

  async probe(account?: ManagedStorageAccount): Promise<{ ok: boolean; message: string }> {
    try {
      const skillDir = this.requireSkillDir();
      const cliPath = join(skillDir, "scripts", "quark-drive.cjs");
      const result = await runCli(process.execPath, [cliPath, "get-user-info"], { cwd: skillDir, timeoutMs: 60_000, env: quarkAccountEnv(account) });
      const final = parseNdjson(result.stdout).at(-1);
      return {
        ok: result.ok && Number(final?.code ?? 0) === 0,
        message: String(final?.msg || result.stderr || "夸克 CLI 可用"),
      };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }

  private requireSkillDir(): string {
    const skillDir = this.config.get<string>("QUARK_SKILL_DIR")?.trim();
    if (!skillDir || !existsSync(join(skillDir, "scripts", "quark-drive.cjs"))) {
      throw new Error("未配置可用的夸克网盘 Skill 目录");
    }
    return skillDir;
  }

  private async resolveParentFid(account?: ManagedStorageAccount, remoteDirSegments?: string[]): Promise<string | undefined> {
    if (!remoteDirSegments?.length) {
      return this.config.get<string>("QUARK_UPLOAD_PARENT_FID")?.trim();
    }
    let parentFid = this.config.get<string>("QUARK_UPLOAD_PARENT_FID")?.trim() || "0";
    for (const segment of remoteDirSegments) {
      parentFid = await this.createFolder(segment, parentFid, account);
    }
    return parentFid;
  }

  private async createFolder(dirPath: string, parentFid: string, account?: ManagedStorageAccount): Promise<string> {
    const skillDir = this.requireSkillDir();
    const cliPath = join(skillDir, "scripts", "quark-drive.cjs");
    const result = await runCli(process.execPath, [
      cliPath,
      "create-folder",
      "--dir-path",
      dirPath,
      "--parent-fid",
      parentFid,
      "--session-input",
      "wallpaper-manager upload",
      "--session-id",
      this.sessionId(),
    ], { cwd: skillDir, timeoutMs: 120_000, env: quarkAccountEnv(account) });
    const final = lastResult(result.stdout);
    const code = Number(final?.code ?? (result.ok ? 0 : -1));
    const data = (final?.data || {}) as { fid?: string };
    if (!result.ok || code !== 0 || !data.fid) {
      throw new Error(String(final?.msg || result.stderr || "夸克创建目录失败"));
    }
    return data.fid;
  }

  private sessionId(): string {
    return `${Math.floor(Date.now() / 1000)}-wmgr01`;
  }
}
