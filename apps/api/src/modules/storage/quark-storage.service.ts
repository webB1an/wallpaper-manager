import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

export interface QuarkShareFile {
  fid: string;
  fileName: string;
  size: number;
  isDir: boolean;
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

  /** 列出分享链接里的文件（分享详情，第一页）。 */
  async shareDetail(url: string, passcode?: string, account?: ManagedStorageAccount): Promise<QuarkShareFile[]> {
    const result = await this.runQuarkCli(account, ["share-detail", "--url", withPasscode(url, passcode)], 120_000);
    const data = (result.data || {}) as { files?: Array<Record<string, unknown>> };
    const files = Array.isArray(data.files) ? data.files : [];
    return files.map((file) => ({
      fid: String(file.fid || ""),
      fileName: String(file.file_name ?? file.filename ?? ""),
      size: Number(file.size ?? 0),
      isDir: String(file.file_type ?? file.dir ?? "") === "0" || file.file_type === 0,
    })).filter((file) => file.fid);
  }

  /** 转存分享链接中的指定文件到自己的网盘。 */
  async saveas(url: string, fids: string[], passcode?: string, account?: ManagedStorageAccount): Promise<void> {
    await this.runQuarkCli(account, ["saveas", "--url", withPasscode(url, passcode), "--fid-list", fids.join(",")], 15 * 60_000);
  }

  /** 在自己网盘里按文件名搜索，返回精确匹配的 fid（转存后找回文件用）。 */
  async searchFileFid(fileName: string, account?: ManagedStorageAccount): Promise<string> {
    const skillDir = this.requireSkillDir();
    const cliPath = join(skillDir, "scripts", "quark-drive.cjs");
    const result = await runCli(process.execPath, [
      cliPath, "search", "--keyword", fileName, "--stdout-only",
      "--session-input", "wallpaper-manager fetch", "--session-id", this.sessionId(),
    ], { cwd: skillDir, timeoutMs: 120_000, env: quarkAccountEnv(account) });
    const lines = parseNdjson(result.stdout);
    const artifact = lines.find((line) => line.type === "artifact");
    const artifactPath = String((artifact?.data as { file_path?: string } | undefined)?.file_path || "");
    if (!artifactPath) throw new Error("夸克搜索未返回结果文件");
    const entries = (await readFile(artifactPath, "utf8"))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const matched = entries.find((entry) => String(entry.file_name ?? entry.filename ?? "") === fileName);
    const fid = String(matched?.fid || "");
    if (!fid) throw new Error(`夸克网盘中未找到转存文件：${fileName}`);
    return fid;
  }

  /** 把自己网盘里的文件读取（下载）到本地，返回本地绝对路径。 */
  async readFileToLocal(fid: string, account?: ManagedStorageAccount): Promise<string> {
    const skillDir = this.requireSkillDir();
    const cliPath = join(skillDir, "scripts", "quark-drive.cjs");
    const runtimeDir = this.config.get<string>("QUARK_RUNTIME_DIR")?.trim()
      || join(process.cwd(), "storage", "private", "quark-runtime");
    const result = await runCli(process.execPath, [
      cliPath, "read-file", "--fid", fid, "--overwrite",
      "--session-input", "wallpaper-manager fetch", "--session-id", this.sessionId(),
    ], { cwd: skillDir, timeoutMs: 60 * 60_000, env: { ...quarkAccountEnv(account), OPENCLAW_RUNTIME_DIR: runtimeDir } });
    const lines = parseNdjson(result.stdout);
    const final = lastResult(result.stdout);
    const code = Number(final?.code ?? (result.ok ? 0 : -1));
    if (!result.ok || code !== 0) {
      throw new Error(String(final?.msg || result.stderr || "夸克读取文件失败"));
    }
    const fromList = lines.find((line) => line.type === "list" && Number(line.code ?? 0) === 0);
    const filePath = String((fromList?.data as { filePath?: string } | undefined)?.filePath || "");
    if (!filePath || !existsSync(filePath)) throw new Error("夸克读取成功但未找到本地文件");
    return filePath;
  }

  private async runQuarkCli(account: ManagedStorageAccount | undefined, args: string[], timeoutMs: number) {
    const skillDir = this.requireSkillDir();
    const cliPath = join(skillDir, "scripts", "quark-drive.cjs");
    const result = await runCli(process.execPath, [
      cliPath, ...args,
      "--session-input", "wallpaper-manager fetch", "--session-id", this.sessionId(),
    ], { cwd: skillDir, timeoutMs, env: quarkAccountEnv(account) });
    const final = lastResult(result.stdout);
    const code = Number(final?.code ?? (result.ok ? 0 : -1));
    if (!result.ok || code !== 0) {
      throw new Error(String(final?.msg || result.stderr || "夸克网盘操作失败"));
    }
    return { data: (final?.data || {}) as Record<string, unknown> };
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

function withPasscode(url: string, passcode?: string) {
  if (!passcode || url.includes("pwd=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}pwd=${encodeURIComponent(passcode)}`;
}
