import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runCli } from "../../common/cli";
import { decryptSecret, encryptSecret } from "../../common/crypto";
import { PrismaService } from "../prisma/prisma.service";

const PUBLIC_CHANNEL_ACCOUNT_SELECT = {
  id: true,
  label: true,
  tokenTail: true,
  guildId: true,
  guildName: true,
  channelId: true,
  channelName: true,
  isDefault: true,
  autoPublish: true,
  createdAt: true,
} as const;

interface PublishInput {
  accountId: string;
  content: string;
  imagePaths?: string[];
  videoPaths?: string[];
  topicNames?: string[];
  onAccountSwitch?: (message: string) => Promise<void>;
}

export class ChannelPermissionDeniedError extends Error {}

export function isPermissionDeniedResult(parsed: { success?: boolean; error?: { message?: string } } | null, stderr: string, commandFailed = false): boolean {
  return (parsed?.success === false || (commandFailed && parsed?.success !== true)) && /暂无权限/.test(parsed?.error?.message || "") && !/timed?\s*out|timeout|超时/i.test(stderr);
}

export interface TencentGuildOption {
  id: string;
  name: string;
  role: "created" | "managed" | "joined" | "unknown";
}

export interface TencentChannelOption {
  id: string;
  name: string;
  type?: string;
}

@Injectable()
export class ChannelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async listAccounts() {
    return this.prisma.channelAccount.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      select: PUBLIC_CHANNEL_ACCOUNT_SELECT,
    });
  }

  async getDefaultAccount() {
    const preferred = await this.prisma.channelAccount.findFirst({
      where: { isDefault: true },
      orderBy: { createdAt: "desc" },
    });
    return preferred || this.prisma.channelAccount.findFirst({ orderBy: { createdAt: "desc" } });
  }

  async saveAccount(input: {
    label: string;
    token: string;
    guildId: string;
    guildName?: string;
    channelId: string;
    channelName?: string;
    isDefault?: boolean;
    autoPublish?: boolean;
  }) {
    const label = input.label?.trim();
    const token = input.token?.trim();
    const guildId = input.guildId?.trim();
    const guildName = input.guildName?.trim();
    const channelId = input.channelId?.trim();
    const channelName = input.channelName?.trim();
    const autoPublish = input.autoPublish ?? true;
    if (!label) throw new BadRequestException("账号名称不能为空");
    if (!token) throw new BadRequestException("Token 不能为空");
    if (!guildId) throw new BadRequestException("频道 ID 不能为空");
    if (!channelId) throw new BadRequestException("版块 ID 不能为空");

    const secret = this.secret();
    const accountCount = await this.prisma.channelAccount.count();
    const shouldBeDefault = Boolean(input.isDefault) || accountCount === 0;
    if (shouldBeDefault) {
      await this.prisma.channelAccount.updateMany({ data: { isDefault: false } });
    }
    return this.prisma.channelAccount.create({
      data: {
        label,
        tokenCipher: encryptSecret(token, secret),
        tokenTail: token.slice(-6),
        guildId,
        guildName,
        channelId,
        channelName,
        isDefault: shouldBeDefault,
        autoPublish,
      },
      select: PUBLIC_CHANNEL_ACCOUNT_SELECT,
    });
  }

  async setDefaultAccount(id: string) {
    const account = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("腾讯频道账号不存在");
    await this.prisma.channelAccount.updateMany({ data: { isDefault: false } });
    return this.prisma.channelAccount.update({ where: { id }, data: { isDefault: true }, select: PUBLIC_CHANNEL_ACCOUNT_SELECT });
  }

  async setAutoPublish(id: string, autoPublish: boolean) {
    const account = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("腾讯频道账号不存在");
    return this.prisma.channelAccount.update({ where: { id }, data: { autoPublish }, select: PUBLIC_CHANNEL_ACCOUNT_SELECT });
  }

  async updateLabel(id: string, label: string) {
    const trimmed = label?.trim();
    if (!trimmed) throw new BadRequestException("账号名称不能为空");
    const account = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("腾讯频道账号不存在");
    return this.prisma.channelAccount.update({ where: { id }, data: { label: trimmed }, select: PUBLIC_CHANNEL_ACCOUNT_SELECT });
  }

  async deleteAccount(id: string) {
    const account = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("腾讯频道账号不存在");
    await this.prisma.channelAccount.delete({ where: { id } });
    if (account.isDefault) {
      const next = await this.prisma.channelAccount.findFirst({ orderBy: { createdAt: "desc" } });
      if (next) await this.prisma.channelAccount.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return { deleted: true };
  }

  async discoverGuilds(token: string): Promise<TencentGuildOption[]> {
    const data = await this.runAuthenticatedQuery(token, ["manage", "get-my-join-guild-info", "--json"]);
    const guilds = normalizeGuilds(data);
    if (!guilds.length) throw new BadRequestException("当前 Token 没有返回可用频道");
    return guilds;
  }

  async discoverChannels(token: string, guildId: string): Promise<TencentChannelOption[]> {
    const data = await this.runAuthenticatedQuery(token, ["manage", "get-guild-channel-list", "--guild-id", guildId, "--json"]);
    const channels = normalizeChannels(data);
    if (!channels.length) throw new BadRequestException("该频道没有返回可用版块");
    return channels;
  }

  async publish(input: PublishInput) {
    const account = await this.prisma.channelAccount.findUnique({ where: { id: input.accountId } });
    if (!account) throw new NotFoundException("腾讯频道账号不存在");
    const candidates = [account];
    let switchedAccounts = 0;
    for (let index = 0; index < candidates.length; index++) {
      const current = candidates[index];
      let result: Awaited<ReturnType<ChannelService["runPublish"]>>;
      try {
        result = await this.runPublish({
          token: decryptSecret(current.tokenCipher, this.secret()),
          guildId: account.guildId,
          channelId: account.channelId,
          content: input.content,
          imagePaths: input.imagePaths || [],
          videoPaths: input.videoPaths || [],
          topicNames: input.topicNames || [],
        });
      } catch (error) {
        if (!(error instanceof ChannelPermissionDeniedError)) throw error;
        if (index === 0) {
          const alternatives = await this.prisma.channelAccount.findMany({
            where: { id: { not: account.id }, autoPublish: true, guildId: account.guildId, channelId: account.channelId },
            orderBy: [{ lastAutoPublishAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          });
          candidates.push(...alternatives);
        }
        const next = candidates[index + 1];
        if (!next) throw new ChannelPermissionDeniedError(`同板块 ${candidates.length} 个候选账号均提示暂无权限，已停止发帖`);
        switchedAccounts++;
        await input.onAccountSwitch?.(`账号「${current.label}」暂无权限，切换到「${next.label}」发帖`);
        continue;
      }
      // Once publishing succeeds, failures in later bookkeeping must never cause another publish.
      return { ...result, accountId: current.id, switchedAccounts, message: switchedAccounts ? `腾讯频道发布成功（因暂无权限切换 ${switchedAccounts} 次账号）` : result.message };
    }
    throw new Error("没有可用的发帖账号");
  }

  private async runAuthenticatedQuery(token: string, args: string[]) {
    const root = resolve(this.config.get<string>("TENCENT_CHANNEL_RUN_ROOT") || ".runs/tencent-channel");
    await mkdir(root, { recursive: true });
    const workDir = await mkdtemp(join(root, "query-"));
    const profileDir = join(workDir, "profile");
    const dotenvPath = join(workDir, "qq-ai-connect.env");
    try {
      await mkdir(profileDir, { recursive: true });
      await writeFile(dotenvPath, `QQ_AI_CONNECT_TOKEN=${token}\n`, { encoding: "utf8", mode: 0o600 });
      const cli = this.cliInvocation(args);
      const result = await runCli(cli.command, cli.args, {
        cwd: workDir,
        timeoutMs: Number(this.config.get("TENCENT_CHANNEL_QUERY_TIMEOUT_MS") || 60_000),
        env: {
          QQ_AI_CONNECT_DOTENV: dotenvPath,
          USERPROFILE: profileDir,
          TEMP: workDir,
          TMP: workDir,
        },
      });
      if (!result.ok) throw new Error(scrub(result.stderr || result.stdout || "腾讯频道查询失败", token, dotenvPath));
      const parsed = parseLastJson(result.stdout);
      if (parsed?.success === false) throw new Error(scrub(parsed.error?.message || "腾讯频道查询失败", token, dotenvPath));
      return parsed?.data ?? parsed;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async runPublish(input: {
    token: string;
    guildId: string;
    channelId: string;
    content: string;
    imagePaths: string[];
    videoPaths: string[];
    topicNames: string[];
  }) {
    const root = resolve(this.config.get<string>("TENCENT_CHANNEL_RUN_ROOT") || ".runs/tencent-channel");
    await mkdir(root, { recursive: true });
    const workDir = await mkdtemp(join(root, "publish-"));
    const profileDir = join(workDir, "profile");
    const dotenvPath = join(workDir, "qq-ai-connect.env");
    const stdinPath = join(workDir, "cli-input.json");
    try {
      await mkdir(profileDir, { recursive: true });
      await writeFile(dotenvPath, `QQ_AI_CONNECT_TOKEN=${input.token}\n`, { encoding: "utf8", mode: 0o600 });
      await writeFile(stdinPath, JSON.stringify({
        guild_id: input.guildId,
        channel_id: input.channelId,
        content: input.content,
        file_paths: input.imagePaths.map((filePath) => ({ file_path: filePath.replace(/\\/g, "/") })),
        video_paths: input.videoPaths.map((filePath) => ({ file_path: filePath.replace(/\\/g, "/") })),
        topic_names: input.topicNames.slice(0, 8),
      }), { encoding: "utf8", mode: 0o600 });
      const cli = this.cliInvocation(["feed", "publish-feed", "--yes", "--json"]);
      const result = await runCli(cli.command, cli.args, {
        cwd: workDir,
        stdinFilePath: stdinPath,
        timeoutMs: 5 * 60_000,
        env: {
          QQ_AI_CONNECT_DOTENV: dotenvPath,
          USERPROFILE: profileDir,
          TEMP: workDir,
          TMP: workDir,
        },
      });
      const parsed = (!result.ok ? parseLastJson(result.stderr) : null) || parseLastJson(result.stdout);
      if (!result.ok || parsed?.success === false) {
        const message = scrub(parsed?.error?.message || result.stderr || result.stdout || "腾讯频道发布失败", input.token);
        // Only a definite platform rejection is safe to retry; timeouts may already have posted.
        if (isPermissionDeniedResult(parsed, result.stderr, !result.ok)) throw new ChannelPermissionDeniedError(message);
        throw new Error(message);
      }
      return { message: "腾讯频道发布成功", raw: parsed?.data || parsed };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private cliInvocation(args: string[]) {
    const configured = this.config.get<string>("TENCENT_CHANNEL_CLI")?.trim();
    if (configured) return { command: configured, args };

    const platformPackage = `tencent-channel-cli-${process.platform}-${process.arch}`;
    const binaryName = process.platform === "win32" ? "tencent-channel-cli.exe" : "tencent-channel-cli";
    const platformBinary = resolve("node_modules", platformPackage, "bin", binaryName);
    if (existsSync(platformBinary)) return { command: platformBinary, args };

    const localWrapper = resolve("node_modules", "tencent-channel-cli", "bin", "tencent-channel-cli");
    if (existsSync(localWrapper)) return { command: process.execPath, args: [localWrapper, ...args] };

    if (process.platform === "win32") {
      return {
        command: process.env.ComSpec || "cmd.exe",
        args: ["/d", "/s", "/c", ["npx", "-y", "tencent-channel-cli", ...args].map(quoteForCmd).join(" ")],
      };
    }
    return { command: "npx", args: ["-y", "tencent-channel-cli", ...args] };
  }

  private secret(): string {
    const secret = this.config.get<string>("JWT_SECRET")?.trim();
    if (!secret || secret.length < 32) throw new Error("JWT_SECRET 至少需要 32 位");
    return secret;
  }
}

function parseLastJson(value: string): { success?: boolean; data?: unknown; error?: { message?: string } } | null {
  try {
    return JSON.parse(value.trim()) as { success?: boolean; data?: unknown; error?: { message?: string } };
  } catch {
    // Keep scanning for the final CLI JSON line.
  }
  const lines = value.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // Keep scanning for the final CLI JSON line.
    }
  }
  return null;
}

function quoteForCmd(value: string): string {
  if (value === "" || /[\s"&|<>^()%!]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function scrub(value: string, secret: string, path = ""): string {
  const safe = secret ? value.split(secret).join("<redacted-token>") : value;
  return (path ? safe.split(path).join("<redacted-dotenv>") : safe).slice(0, 1000);
}

function normalizeGuilds(value: unknown): TencentGuildOption[] {
  const result: TencentGuildOption[] = [];
  const seen = new Set<string>();

  const walk = (current: unknown, inheritedRole: TencentGuildOption["role"] = "unknown") => {
    if (Array.isArray(current)) {
      current.forEach((item) => walk(item, inheritedRole));
      return;
    }
    if (!current || typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    const id = firstText(record, ["guild_id", "guildId"]) || (inheritedRole !== "unknown" ? firstText(record, ["id"]) : "");
    const name = firstText(record, ["guild_name", "guildName", "name", "title"]);
    if (id && name && !seen.has(id)) {
      seen.add(id);
      result.push({ id, name, role: inheritedRole });
    }
    for (const [key, item] of Object.entries(record)) {
      const normalized = key.replace(/[_-]/g, "").toLowerCase();
      const role: TencentGuildOption["role"] = normalized.includes("created")
        ? "created"
        : normalized.includes("managed")
          ? "managed"
          : normalized.includes("joined")
            ? "joined"
            : inheritedRole;
      walk(item, role);
    }
  };

  walk(value);
  return result;
}

function normalizeChannels(value: unknown): TencentChannelOption[] {
  const result: TencentChannelOption[] = [];
  const seen = new Set<string>();

  const walk = (current: unknown, inChannelList = false) => {
    if (Array.isArray(current)) {
      current.forEach((item) => walk(item, true));
      return;
    }
    if (!current || typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    const id = firstText(record, ["channel_id", "channelId"]) || (inChannelList ? firstText(record, ["id"]) : "");
    const name = firstText(record, ["channel_name", "channelName", "name", "title"]);
    if (id && name && !seen.has(id)) {
      seen.add(id);
      result.push({
        id,
        name,
        type: firstText(record, ["channel_type", "channelType", "type"]) || undefined,
      });
    }
    Object.values(record).forEach((item) => walk(item, inChannelList));
  };

  walk(value);
  return result;
}

function firstText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}
