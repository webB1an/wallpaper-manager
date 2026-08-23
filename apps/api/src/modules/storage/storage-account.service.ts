import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageAccount, StorageProvider } from "@prisma/client";
import { nanoid } from "nanoid";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { lastResult, parseNdjson, runCli } from "../../common/cli";
import { PrismaService } from "../prisma/prisma.service";

export type ManagedStorageAccount = Pick<StorageAccount, "id" | "provider" | "label" | "profileDir" | "configPath">;

const PUBLIC_STORAGE_ACCOUNT_SELECT = {
  id: true,
  provider: true,
  label: true,
  accountName: true,
  isDefault: true,
  isActive: true,
  lastProbeOk: true,
  lastProbeMessage: true,
  lastProbeAt: true,
  createdAt: true,
} as const;

@Injectable()
export class StorageAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async listAccounts() {
    return this.prisma.storageAccount.findMany({
      where: { isActive: true },
      orderBy: [{ provider: "asc" }, { isDefault: "desc" }, { createdAt: "desc" }],
      select: PUBLIC_STORAGE_ACCOUNT_SELECT,
    });
  }

  async createAccount(input: { provider: StorageProvider; label: string; isDefault?: boolean }) {
    const label = input.label?.trim();
    if (!label) throw new BadRequestException("账号名称不能为空");
    const id = `sa_${nanoid(12)}`;
    const profileDir = resolve(this.root(), input.provider, id);
    await mkdir(profileDir, { recursive: true });
    const accountCount = await this.prisma.storageAccount.count({ where: { provider: input.provider, isActive: true } });
    const shouldBeDefault = Boolean(input.isDefault) || accountCount === 0;
    if (shouldBeDefault) {
      await this.prisma.storageAccount.updateMany({ where: { provider: input.provider }, data: { isDefault: false } });
    }
    return this.prisma.storageAccount.create({
      data: {
        id,
        provider: input.provider,
        label,
        profileDir,
        configPath: input.provider === StorageProvider.baidu ? join(profileDir, "bdpan.json") : null,
        isDefault: shouldBeDefault,
      },
      select: PUBLIC_STORAGE_ACCOUNT_SELECT,
    });
  }

  async setDefaultAccount(id: string) {
    const account = await this.requireAccount(id);
    await this.prisma.storageAccount.updateMany({ where: { provider: account.provider }, data: { isDefault: false } });
    return this.prisma.storageAccount.update({ where: { id }, data: { isDefault: true, isActive: true }, select: PUBLIC_STORAGE_ACCOUNT_SELECT });
  }

  async deleteAccount(id: string) {
    const account = await this.requireAccount(id);
    await this.prisma.storageAccount.update({ where: { id }, data: { isActive: false, isDefault: false } });
    if (account.isDefault) {
      const next = await this.prisma.storageAccount.findFirst({
        where: { provider: account.provider, isActive: true, id: { not: id } },
        orderBy: { createdAt: "desc" },
      });
      if (next) await this.prisma.storageAccount.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return { deleted: true };
  }

  async getDefaultAccount(provider: StorageProvider) {
    const defaultAccount = await this.prisma.storageAccount.findFirst({
      where: { provider, isDefault: true, isActive: true },
      orderBy: { createdAt: "desc" },
    });
    if (defaultAccount) return defaultAccount;
    return this.prisma.storageAccount.findFirst({
      where: { provider, isActive: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async getAccountForProvider(provider: StorageProvider, id?: string) {
    if (!id) return this.getDefaultAccount(provider);
    const account = await this.prisma.storageAccount.findFirst({ where: { id, provider, isActive: true } });
    if (!account) throw new BadRequestException(`${provider === StorageProvider.baidu ? "百度" : "夸克"}网盘账号不存在或类型不匹配`);
    return account;
  }

  async startBaiduAuth(id: string) {
    const account = await this.requireAccount(id, StorageProvider.baidu);
    await this.ensureProfile(account);
    const result = await runCli(this.bdpan(), [...baiduArgs(account), "login", "--accept-disclaimer", "--get-auth-url"], { timeoutMs: 30_000 });
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const authUrl = extractUrl(output);
    if (!authUrl) throw new BadRequestException(output || "百度授权链接生成失败");
    return { authUrl, message: "打开授权链接，授权后把页面显示的授权码或完整回调 URL 粘贴回后台。" };
  }

  async finishBaiduAuth(id: string, code: string) {
    const account = await this.requireAccount(id, StorageProvider.baidu);
    const authCode = normalizeAuthCode(code);
    if (!authCode) throw new BadRequestException("授权码不能为空");
    await this.ensureProfile(account);
    const result = await runCli(this.bdpan(), [...baiduArgs(account), "login", "--accept-disclaimer", "--set-code-stdin"], {
      stdin: authCode,
      timeoutMs: 60_000,
    });
    if (!result.ok) throw new BadRequestException(shortOutput(result.stderr || result.stdout || "百度授权失败"));
    return this.probeAccount(id);
  }

  async startQuarkAuth(id: string) {
    const account = await this.requireAccount(id, StorageProvider.quark);
    const result = await this.runQuark(account, ["login"], 45_000);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (result.ok) return this.probeAccount(id);
    const authUrl = extractUrl(output);
    if (!authUrl) throw new BadRequestException(shortOutput(output || "夸克授权链接生成失败"));
    return { authUrl, message: "打开授权链接，完成授权后把 code 参数或完整回调 URL 粘贴回后台。" };
  }

  async finishQuarkAuth(id: string, code: string) {
    const account = await this.requireAccount(id, StorageProvider.quark);
    const authCode = normalizeAuthCode(code);
    if (!authCode) throw new BadRequestException("授权码不能为空");
    const result = await this.runQuark(account, ["login", "--token", authCode], 60_000);
    const final = safeLastResult(result.stdout);
    const codeNumber = Number(final?.code ?? (result.ok ? 0 : -1));
    if (!result.ok || codeNumber !== 0) {
      throw new BadRequestException(shortOutput(String(final?.msg || result.stderr || result.stdout || "夸克授权失败")));
    }
    return this.probeAccount(id);
  }

  async probeAccount(id: string) {
    const account = await this.requireAccount(id);
    const result = account.provider === StorageProvider.baidu
      ? await this.probeBaidu(account)
      : await this.probeQuark(account);
    return this.prisma.storageAccount.update({
      where: { id },
      data: {
        accountName: result.accountName,
        lastProbeOk: result.ok,
        lastProbeMessage: shortOutput(result.message),
        lastProbeAt: new Date(),
      },
      select: PUBLIC_STORAGE_ACCOUNT_SELECT,
    });
  }

  async probeDefault(provider: StorageProvider) {
    const account = await this.getDefaultAccount(provider);
    if (!account) return { ok: false, message: `未在后台配置默认${provider === StorageProvider.baidu ? "百度" : "夸克"}网盘账号` };
    const result = provider === StorageProvider.baidu ? await this.probeBaidu(account) : await this.probeQuark(account);
    await this.prisma.storageAccount.update({
      where: { id: account.id },
      data: {
        accountName: result.accountName,
        lastProbeOk: result.ok,
        lastProbeMessage: shortOutput(result.message),
        lastProbeAt: new Date(),
      },
    });
    return { ...result, account };
  }

  runQuark(account: ManagedStorageAccount, args: string[], timeoutMs: number) {
    const skillDir = this.requireQuarkSkillDir();
    const cliPath = join(skillDir, "scripts", "quark-drive.cjs");
    return runCli(process.execPath, [cliPath, ...args], {
      cwd: skillDir,
      timeoutMs,
      env: quarkAccountEnv(account),
    });
  }

  private async probeBaidu(account: ManagedStorageAccount) {
    const result = await runCli(this.bdpan(), [...baiduArgs(account), "whoami"], { timeoutMs: 15_000 });
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return {
      ok: result.ok && output.includes("已登录"),
      message: output || "bdpan 未登录",
      accountName: result.ok ? parseBaiduName(output) : undefined,
    };
  }

  private async probeQuark(account: ManagedStorageAccount) {
    const result = await this.runQuark(account, ["get-user-info"], 60_000);
    const final = safeParseNdjson(result.stdout).at(-1);
    const data = (final?.data || {}) as { userInfo?: { nickname?: string }; nickname?: string };
    return {
      ok: result.ok && Number(final?.code ?? 0) === 0,
      message: String(final?.msg || result.stderr || "夸克 CLI 可用"),
      accountName: data.userInfo?.nickname || data.nickname,
    };
  }

  private async requireAccount(id: string, provider?: StorageProvider) {
    const account = await this.prisma.storageAccount.findUnique({ where: { id } });
    if (!account || !account.isActive) throw new NotFoundException("网盘账号不存在");
    if (provider && account.provider !== provider) throw new BadRequestException("网盘账号类型不匹配");
    return account;
  }

  private async ensureProfile(account: ManagedStorageAccount) {
    await mkdir(account.profileDir, { recursive: true });
    if (account.provider === StorageProvider.quark) {
      await mkdir(join(account.profileDir, ".config"), { recursive: true });
    }
  }

  private bdpan(): string {
    return this.config.get<string>("BDPAN_PATH") || "bdpan";
  }

  private requireQuarkSkillDir(): string {
    const skillDir = this.config.get<string>("QUARK_SKILL_DIR")?.trim();
    if (!skillDir || !existsSync(join(skillDir, "scripts", "quark-drive.cjs"))) {
      throw new Error("未配置可用的夸克网盘 Skill 目录");
    }
    return skillDir;
  }

  private root() {
    return resolve(this.config.get<string>("STORAGE_ACCOUNT_ROOT") || "storage/private/storage-accounts");
  }
}

export function baiduArgs(account?: ManagedStorageAccount) {
  return account?.configPath ? ["--config-path", account.configPath] : [];
}

export function quarkAccountEnv(account?: ManagedStorageAccount): NodeJS.ProcessEnv {
  if (!account) {
    return { CODEX_ENV: "1", AI_AGENT: "codex" };
  }
  return {
    CODEX_ENV: "1",
    AI_AGENT: "codex",
    HOME: account.profileDir,
    USERPROFILE: account.profileDir,
    XDG_CONFIG_HOME: join(account.profileDir, ".config"),
  };
}

function extractUrl(value: string) {
  return value.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
}

function parseBaiduName(output: string) {
  const line = output.split(/\r?\n/).map((item) => item.trim()).find((item) => item && !item.includes("已登录"));
  return line || undefined;
}

function normalizeAuthCode(value: string | undefined) {
  const text = value?.trim() || "";
  if (!text) return "";
  const direct = codeFromUrl(text);
  if (direct) return direct;
  const embeddedUrl = extractUrl(text);
  if (embeddedUrl) {
    const embedded = codeFromUrl(embeddedUrl);
    if (embedded) return embedded;
  }
  const match = text.match(/(?:^|[?&#\s])(?:code|auth_code)=([^&#\s]+)/i);
  return match ? decodeURIComponent(match[1]) : text;
}

function codeFromUrl(value: string) {
  try {
    const url = new URL(value);
    const hashCode = url.hash.match(/(?:^|[?&#])(?:code|auth_code)=([^&]+)/i)?.[1];
    return url.searchParams.get("code") || url.searchParams.get("auth_code") || (hashCode ? decodeURIComponent(hashCode) : "");
  } catch {
    return "";
  }
}

function shortOutput(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 1000);
}

function safeLastResult(stdout: string) {
  try {
    return lastResult(stdout);
  } catch {
    return null;
  }
}

function safeParseNdjson(stdout: string) {
  try {
    return parseNdjson(stdout);
  } catch {
    return [];
  }
}
