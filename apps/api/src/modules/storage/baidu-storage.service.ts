import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
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
    const parentRemote = remotePath.slice(0, Math.max(0, remotePath.lastIndexOf("/")));
    await this.ensureRemoteDir(account, parentRemote);
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

  /** 通过分享链接下载文件（或整个分享目录）到本地目录。transferDir 为网盘内转存目录（相对 /apps/bdpan）。 */
  async downloadShare(url: string, localDir: string, passcode?: string, account?: ManagedStorageAccount, transferDir?: string): Promise<string> {
    await mkdir(localDir, { recursive: true });
    const args = [...baiduArgs(account), "download", url, localDir, ...(passcode ? ["-p", passcode] : []), ...(transferDir ? ["-t", transferDir] : []), "--json"];
    const result = await runCli(this.bdpan(), args, { timeoutMs: 60 * 60_000 });
    if (!result.ok) throw new Error(result.stderr || result.stdout || "百度网盘下载失败");
    return result.stdout;
  }

  /** 直接按网盘路径下载（适用于本账号自己上传的文件）。绕开分享链接，避免“自己的分享链接” errno=13045 导致本地目录为空。 */
  async downloadByPath(remotePath: string, localDir: string, account?: ManagedStorageAccount): Promise<string> {
    await mkdir(localDir, { recursive: true });
    const args = [...baiduArgs(account), "download", remotePath, localDir, "--json"];
    const result = await runCli(this.bdpan(), args, { timeoutMs: 60 * 60_000 });
    if (!result.ok) throw new Error(result.stderr || result.stdout || "百度网盘下载失败");
    return result.stdout;
  }

  /** 在网盘里按关键字搜索文件，返回匹配项（path 为网盘显示路径）。失败时返回空数组。 */
  async search(keyword: string, account?: ManagedStorageAccount): Promise<Array<{ path: string; name: string; size: number; isDir: boolean }>> {
    if (!keyword) return [];
    const result = await runCli(this.bdpan(), [...baiduArgs(account), "search", keyword, "--json"], { timeoutMs: 60_000 });
    if (!result.ok) throw new Error(result.stderr || result.stdout || "百度网盘搜索失败");
    return parseBaiduSearchItems(result.stdout);
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

function parseBaiduSearchItems(stdout: string): Array<{ path: string; name: string; size: number; isDir: boolean }> {
  const items: Array<{ path: string; name: string; size: number; isDir: boolean }> = [];
  const seen = new Set<string>();
  const push = (raw: Record<string, unknown>) => {
    const path = String(raw.path || raw.remote_path || raw.dpath || "");
    const name = String(raw.server_filename || raw.name || (path ? path.split("/").pop() || "" : ""));
    if (!path && !name) return;
    const key = path || name;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ path, name, size: Number(raw.size ?? raw.fs_size ?? 0) || 0, isDir: Boolean(raw.isdir || raw.is_dir || raw.dir) });
  };
  const collect = (rows: unknown) => {
    if (Array.isArray(rows)) rows.forEach((row) => push((row as Record<string, unknown>) || {}));
    else if (rows && typeof rows === "object") {
      const obj = rows as Record<string, unknown>;
      if (Array.isArray(obj.results)) (obj.results as unknown[]).forEach((row) => push((row as Record<string, unknown>) || {}));
      else push(obj);
    }
  };
  const trimmed = (stdout || "").trim();
  if (!trimmed) return items;
  for (const line of trimmed.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try {
      collect(JSON.parse(text));
    } catch {
      // 个别非 JSON 行忽略。
    }
  }
  if (!items.length) {
    try {
      collect(JSON.parse(trimmed));
    } catch {
      // 无法解析时保持空数组。
    }
  }
  return items;
}

/** 把 bdpan 返回的（可能是显示路径或相对路径）转成可用于 download 的 /apps/bdpan/... 绝对路径。 */
export function baiduApiPath(value: string): string {
  const p = String(value || "").replace(/\\/g, "/").trim();
  if (!p) return "";
  if (p === "/apps/bdpan") return p;
  if (p.startsWith("/apps/bdpan/")) return p;
  if (p.startsWith("我的应用数据")) return `/apps/bdpan/${p.replace("我的应用数据", "").replace(/^\//, "")}`;
  return `/apps/bdpan/${p.replace(/^\//, "")}`;
}
