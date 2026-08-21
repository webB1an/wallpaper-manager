import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runCli } from "../../common/cli";
import { decryptSecret, encryptSecret } from "../../common/crypto";
import { PrismaService } from "../prisma/prisma.service";

interface PublishInput {
  accountId: string;
  content: string;
  imagePaths?: string[];
  videoPaths?: string[];
  topicNames?: string[];
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
      select: {
        id: true,
        label: true,
        tokenTail: true,
        guildId: true,
        guildName: true,
        channelId: true,
        channelName: true,
        isDefault: true,
        createdAt: true,
      },
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
  }) {
    const secret = this.secret();
    if (input.isDefault) {
      await this.prisma.channelAccount.updateMany({ data: { isDefault: false } });
    }
    return this.prisma.channelAccount.create({
      data: {
        label: input.label,
        tokenCipher: encryptSecret(input.token, secret),
        tokenTail: input.token.slice(-6),
        guildId: input.guildId,
        guildName: input.guildName,
        channelId: input.channelId,
        channelName: input.channelName,
        isDefault: Boolean(input.isDefault),
      },
    });
  }

  async setDefaultAccount(id: string) {
    const account = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!account) throw new Error("腾讯频道账号不存在");
    await this.prisma.channelAccount.updateMany({ data: { isDefault: false } });
    return this.prisma.channelAccount.update({ where: { id }, data: { isDefault: true } });
  }

  async publish(input: PublishInput) {
    const account = await this.prisma.channelAccount.findUnique({ where: { id: input.accountId } });
    if (!account) throw new Error("腾讯频道账号不存在");
    const token = decryptSecret(account.tokenCipher, this.secret());
    return this.runPublish({
      token,
      guildId: account.guildId,
      channelId: account.channelId,
      content: input.content,
      imagePaths: input.imagePaths || [],
      videoPaths: input.videoPaths || [],
      topicNames: input.topicNames || [],
    });
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
      if (!result.ok) throw new Error(scrub(result.stderr || result.stdout, input.token));
      const parsed = parseLastJson(result.stdout);
      if (parsed?.success === false) throw new Error(scrub(parsed.error?.message || "腾讯频道发布失败", input.token));
      return { message: "腾讯频道发布成功", raw: parsed?.data || parsed };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private cliInvocation(args: string[]) {
    const configured = this.config.get<string>("TENCENT_CHANNEL_CLI")?.trim();
    if (configured) return { command: configured, args };
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

function scrub(value: string, secret: string): string {
  return value.split(secret).join("<redacted-token>").slice(0, 1000);
}
