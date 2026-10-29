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
  lastAutoPublishAt: true,
  unavailableAt: true,
  unavailableReason: true,
  createdAt: true,
} as const;

interface PublishInput {
  accountId: string;
  content: string;
  imagePaths?: string[];
  videoPaths?: string[];
  topicNames?: string[];
  onAccountSwitch?: (message: string) => Promise<void>;
  /** 账号体检（纯文字测试）时关闭切换：只验证指定账号本身，避免“测试成功但其实是别的账号发的”。 */
  allowAccountSwitch?: boolean;
}

export type ChannelSwitchReason = "unavailable" | "permission";

export interface ChannelSwitchEvent {
  accountId: string;
  label: string;
  reason: ChannelSwitchReason;
}

/** 提示里区分“Token 失效（已记到账号状态）”与“版块没权限（账号本身是正常的）”，避免状态与提示互相打脸。 */
export function describeChannelSwitches(events: ChannelSwitchEvent[]): string {
  const describe = (event: ChannelSwitchEvent) => event.reason === "unavailable"
    ? `账号「${event.label}」Token 已失效，已标记为不可用`
    : `账号「${event.label}」暂无该版块发帖权限，账号本身正常`;
  return `因${events.map(describe).join("；")}，已切换 ${events.length} 次账号`;
}

/** 平台明确拒绝本次发帖（内容未被发出），可以安全地换账号重试。 */
export class ChannelPublishRejectedError extends Error {}
export class ChannelPermissionDeniedError extends ChannelPublishRejectedError {}
/** 账号凭据失效（token 过期/无效）：换账号重试，同时把该账号标记为不可用。 */
export class ChannelAccountUnavailableError extends ChannelPublishRejectedError {}

export function isPermissionDeniedResult(parsed: { success?: boolean; error?: { message?: string } } | null, stderr: string, commandFailed = false): boolean {
  return (parsed?.success === false || (commandFailed && parsed?.success !== true)) && /暂无权限/.test(parsed?.error?.message || "") && !/timed?\s*out|timeout|超时/i.test(stderr);
}

/**
 * token 过期/失效（业务码 100051）不是权限也不是内容问题，重新授权即可恢复。
 * 只看明确的凭据失效信号，避免把超时、网络错误误判成账号不可用。
 */
export function isAccountUnavailableResult(parsed: { success?: boolean; error?: { message?: string } } | null, stderr = ""): boolean {
  if (/timed?\s*out|timeout|超时/i.test(stderr)) return false;
  const text = `${parsed?.error?.message || ""}\n${stderr}`;
  return /(?:^|[^0-9])100051(?:[^0-9]|$)/.test(text)
    || /token\s*(?:is\s*)?(?:expired|invalid)|token\s*(?:已)?(?:过期|失效)|登录态(?:已)?失效/i.test(text);
}

/** 可用账号优先，其次按最久未发帖；标记为不可用的账号排到最后，调用方会直接跳过它们。 */
export function sortChannelCandidates<T extends { unavailableAt: Date | null; lastAutoPublishAt: Date | null; createdAt: Date; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const badDiff = (a.unavailableAt ? 1 : 0) - (b.unavailableAt ? 1 : 0);
    if (badDiff !== 0) return badDiff;
    const lastDiff = (a.lastAutoPublishAt?.getTime() ?? 0) - (b.lastAutoPublishAt?.getTime() ?? 0);
    if (lastDiff !== 0) return lastDiff;
    return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
  });
}

/**
 * 话题名清洗：去首尾空白与前导 #，丢掉空串并去重。
 * CLI 对空数组、空话题名都是硬性拒绝（“topic_names 不能为空数组”），所以必须在传参前过滤干净。
 */
export function normalizeTopicNames(names?: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names || []) {
    if (typeof raw !== "string") continue;
    const name = raw.trim().replace(/^#+/, "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

export interface ChannelPublishPayloadInput {
  guildId: string;
  channelId: string;
  content: string;
  imagePaths?: readonly string[];
  videoPaths?: readonly string[];
  topicNames?: readonly string[];
}

/** CLI 的 stdin JSON：没有有效话题时整体省略 topic_names（空数组会被平台校验拦下）。 */
export function buildChannelPublishPayload(input: ChannelPublishPayloadInput) {
  const topics = normalizeTopicNames(input.topicNames).slice(0, 8);
  const payload: Record<string, unknown> = {
    guild_id: input.guildId,
    channel_id: input.channelId,
    content: input.content,
    file_paths: (input.imagePaths || []).map((filePath) => ({ file_path: filePath.replace(/\\/g, "/") })),
    video_paths: (input.videoPaths || []).map((filePath) => ({ file_path: filePath.replace(/\\/g, "/") })),
  };
  if (topics.length) payload.topic_names = topics;
  return payload;
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
    const allowSwitch = input.allowAccountSwitch !== false;
    const switched: ChannelSwitchEvent[] = [];
    const candidates = [account];
    // 同板块候选只在需要时查一次（初始账号被标记过，或它明确失败需要换号）。
    let expanded = false;
    const expand = async () => {
      expanded = true;
      const alternatives = await this.prisma.channelAccount.findMany({
        where: { id: { not: account.id }, autoPublish: true, guildId: account.guildId, channelId: account.channelId },
      });
      return { alternatives, healthy: sortChannelCandidates(alternatives).filter((row) => !row.unavailableAt) };
    };

    if (allowSwitch && account.unavailableAt) {
      const { alternatives, healthy } = await expand();
      // 全部账号都已知不可用时不空跑：每一次尝试都必然被平台拒绝，还把任务卡在等待 CLI 上。
      if (!healthy.length) {
        throw new ChannelPublishRejectedError(
          `同板块 ${alternatives.length + 1} 个账号均已标记为不可用（${[account, ...alternatives].map((row) => row.label).join("、")}），请在管理端「腾讯频道」更新 Token 后再发帖`,
        );
      }
      switched.push({ accountId: account.id, label: account.label, reason: "unavailable" });
      await input.onAccountSwitch?.(`账号「${account.label}」此前已标记不可用（Token 失效），本次跳过`);
      candidates.length = 0;
      candidates.push(...healthy);
    }

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
        // 明确拒绝（暂无权限 / token 失效）时内容没有发出，换账号是安全的；超时等不确定结果不在此列。
        if (!(error instanceof ChannelPublishRejectedError)) throw error;
        const unavailable = error instanceof ChannelAccountUnavailableError;
        if (unavailable) await this.markUnavailable(current.id, error.message);
        const why = unavailable ? "Token 已失效" : "暂无该版块发帖权限";
        if (!allowSwitch) {
          throw new ChannelPublishRejectedError(`账号「${current.label}」${why}：${error.message}`);
        }
        if (!expanded) {
          const { healthy } = await expand();
          candidates.push(...healthy);
        }
        const next = candidates[index + 1];
        if (!next) throw new ChannelPublishRejectedError(`同板块 ${candidates.length} 个账号均无法发帖，已停止：${error.message}`);
        switched.push({ accountId: current.id, label: current.label, reason: unavailable ? "unavailable" : "permission" });
        const accountState = unavailable ? `${why}，已标记为不可用` : `${why}，账号本身正常`;
        await input.onAccountSwitch?.(`账号「${current.label}」${accountState}，切换到「${next.label}」发帖`);
        continue;
      }
      // 发帖成功说明账号可用：清掉历史不可用标记。
      await this.clearUnavailable(current.id);
      // Once publishing succeeds, failures in later bookkeeping must never cause another publish.
      return {
        ...result,
        accountId: current.id,
        switchedAccounts: switched.length,
        switchReasons: switched,
        message: switched.length ? `腾讯频道发布成功（${describeChannelSwitches(switched)}）` : result.message,
      };
    }
    throw new Error("没有可用的发帖账号");
  }

  /** 纯文字发帖测试：不附图/视频，用来验证账号 Token 与版块发帖权限。成功即视为账号可用。 */
  async testTextPublish(accountId: string, content?: string) {
    const text = (content || "").trim() || `发帖测试 · ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
    if (text.length > 1000) throw new BadRequestException("测试文案不能超过 1000 字");
    // 测试只针对这一个账号：不许悄悄换号，否则会把“测试通过”报成别人的成绩。
    const result = await this.publish({ accountId, content: text, allowAccountSwitch: false });
    return { ...result, content: text };
  }

  /** 重新授权：更新 Token 并清除不可用标记。 */
  async updateToken(id: string, token: string) {
    const trimmed = token?.trim();
    if (!trimmed) throw new BadRequestException("Token 不能为空");
    const account = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException("腾讯频道账号不存在");
    return this.prisma.channelAccount.update({
      where: { id },
      data: {
        tokenCipher: encryptSecret(trimmed, this.secret()),
        tokenTail: trimmed.slice(-6),
        unavailableAt: null,
        unavailableReason: null,
      },
      select: PUBLIC_CHANNEL_ACCOUNT_SELECT,
    });
  }

  /** 标记失败不影响发帖主流程：换账号继续，账本下次还能再记。 */
  private async markUnavailable(id: string, reason: string) {
    try {
      await this.prisma.channelAccount.update({
        where: { id },
        data: { unavailableAt: new Date(), unavailableReason: reason.slice(0, 255) },
      });
    } catch {
      // 忽略：账号可用性标记是辅助信息，不应让发帖失败第二次。
    }
  }

  private async clearUnavailable(id: string) {
    try {
      await this.prisma.channelAccount.updateMany({
        where: { id, unavailableAt: { not: null } },
        data: { unavailableAt: null, unavailableReason: null },
      });
    } catch {
      // 同上：清理标记失败只影响展示。
    }
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
      await writeFile(stdinPath, JSON.stringify(buildChannelPublishPayload({
        guildId: input.guildId,
        channelId: input.channelId,
        content: input.content,
        imagePaths: input.imagePaths,
        videoPaths: input.videoPaths,
        topicNames: input.topicNames,
      })), { encoding: "utf8", mode: 0o600 });
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
        if (isAccountUnavailableResult(parsed, result.stderr)) throw new ChannelAccountUnavailableError(message);
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
