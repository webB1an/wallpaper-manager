import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { statSync } from "node:fs";
import { basename } from "node:path";
import { runCli } from "../../common/cli";
import { baiduArgs, ManagedStorageAccount } from "./storage-account.service";

export interface BaiduShareResult {
  remotePath: string;
  url: string;
  passcode?: string;
}

@Injectable()
export class BaiduStorageService {
  constructor(private readonly config: ConfigService) {}

  async uploadAndShare(filePath: string, account?: ManagedStorageAccount, remoteDir?: string): Promise<BaiduShareResult> {
    const remotePath = await this.upload(filePath, account, remoteDir);
    const share = await this.share(remotePath, account);
    return { remotePath, ...share };
  }

  async upload(filePath: string, account?: ManagedStorageAccount, remoteDir?: string): Promise<string> {
    const remoteBase = this.config.get<string>("BAIDU_REMOTE_BASE") || "/apps/bdpan/wallpapers";
    const base = remoteBase.replace(/\/$/, "");
    const remotePath = [base, remoteDir, sanitizeRemoteName(basename(filePath))]
      .filter(Boolean)
      .join("/");
    const size = statSync(filePath).size;
    const timeoutMs = Math.max(3_600_000, Math.ceil(size / 40_000) * 1500);
    await this.ensureRemoteDir(account, remoteDir);
    const result = await runCli(this.bdpan(), [...baiduArgs(account), "upload", filePath, remotePath], { timeoutMs });
    if (!result.ok) throw new Error(result.stderr || result.stdout || "百度网盘上传失败");
    return remotePath;
  }

  async share(remotePath: string, account?: ManagedStorageAccount): Promise<{ url: string; passcode?: string }> {
    const period = String(this.config.get("BAIDU_SHARE_PERIOD_DAYS") || 0);
    const result = await runCli(this.bdpan(), [...baiduArgs(account), "share", remotePath, "--period", period, "--json"], { timeoutMs: 120_000 });
    if (!result.ok) throw new Error(result.stderr || result.stdout || "百度网盘分享失败");
    try {
      const body = JSON.parse(result.stdout) as { link?: string; url?: string; pwd?: string; password?: string };
      const link = body.link || body.url;
      if (!link) throw new Error("缺少 link 字段");
      return { url: link, passcode: body.pwd || body.password };
    } catch {
      const link = result.stdout.match(/https:\/\/pan\.baidu\.com\/[^\s"']+/i)?.[0];
      if (link) return { url: link };
      throw new Error("无法解析百度分享结果");
    }
  }

  async probe(account?: ManagedStorageAccount): Promise<{ ok: boolean; message: string }> {
    const result = await runCli(this.bdpan(), [...baiduArgs(account), "whoami"], { timeoutMs: 15_000 });
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return { ok: result.ok && output.includes("已登录"), message: output || "bdpan 未登录" };
  }

  private bdpan(): string {
    return this.config.get<string>("BDPAN_PATH") || "bdpan";
  }

  private async ensureRemoteDir(account: ManagedStorageAccount | undefined, remoteDir?: string) {
    if (!remoteDir) return;
    const result = await runCli(this.bdpan(), [...baiduArgs(account), "mkdir", "--path", remoteDir], { timeoutMs: 30_000 }).catch(() => null);
    // bdpan 可能自动创建父目录；mkdir 命令不存在或目录已存在时都继续上传。
    void result;
  }
}

function sanitizeRemoteName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim();
}
