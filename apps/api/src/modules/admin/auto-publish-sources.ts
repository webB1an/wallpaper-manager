import { ConfigService } from "@nestjs/config";
import { downloadBridgeFile, TransferProgress } from "./bridge-transfer";

export interface AutoSourceItem {
  /** 来源侧唯一 id，用于全站去重（source + sourceId 只发一次）。 */
  sourceId: string;
  width: number;
  height: number;
  fileName: string;
  fileType: string;
  type: "static" | "live";
  bytes: Buffer;
}

export interface AutoSourceContext {
  exclude: string[];
  config: Record<string, unknown>;
  configService: ConfigService;
  onTransferProgress?: (progress: TransferProgress) => Promise<void>;
}

export type AutoSourceProvider = (ctx: AutoSourceContext) => Promise<AutoSourceItem>;

export interface AutoSourceMeta {
  id: string;
  label: string;
  description: string;
}

interface AutoSourceProviderEntry {
  label: string;
  description: string;
  fetch: AutoSourceProvider;
}

const providers: Record<string, AutoSourceProviderEntry> = {
  ...Object.fromEntries([
    ["nekos_best", "Nekos.best"],
    ["nekos_moe", "Nekos.moe"],
    ["nekos_api", "Nekos API"],
    ["nekos_life", "Nekos.life"],
    ["nekosia", "Nekosia"],
    ["pic_re", "Pic.re"],
  ].map(([id, label]) => [id, {
    label: `${label}（二次元静态）`,
    description: `通过 WallPost 墙外桥接获取 ${label} 的 SFW 静态图片`,
    fetch: (ctx: AutoSourceContext) => fetchFromWallpost(ctx, "static", id),
  }])),
  wallpost: {
    label: "WallPost（Wallhaven）",
    description: "从 WallPost 下载桥接拉取一张未收录的 Wallhaven 静态壁纸",
    fetch: (ctx) => fetchFromWallpost(ctx, "static"),
  },
  wallpost_live: {
    label: "WallPost（动态壁纸）",
    description: "从 WallPost 下载桥接拉取一张未收录的动态壁纸（WallpaperWaifu 视频）",
    fetch: fetchFromWallpostLive,
  },
  waifu_im: {
    label: "Waifu.im（二次元静态）",
    description: "通过 WallPost 墙外桥接获取 Waifu.im 已审核的 SFW 静态二次元图片",
    fetch: (ctx) => fetchFromWallpost(ctx, "static", "waifu_im"),
  },
  safebooru: {
    label: "Safebooru（二次元静态）",
    description: "通过 WallPost 墙外桥接获取 Safebooru 标记为 safe 的静态二次元图片",
    fetch: (ctx) => fetchFromWallpost(ctx, "static", "safebooru"),
  },
  openverse: {
    label: "Openverse（开放授权）",
    description: "通过 WallPost 墙外桥接获取 Openverse 标记为非敏感的静态插画",
    fetch: (ctx) => fetchFromWallpost(ctx, "static", "openverse"),
  },
};

/** 已注册的数据来源 id。 */
export function autoSourceIds(): string[] {
  return Object.keys(providers);
}

/** 兼容旧版单来源配置，并从 JSON 配置中读取新版多来源列表。 */
export function normalizeAutoSources(source: string, config: unknown): string[] {
  const configured = config && typeof config === "object" && Array.isArray((config as Record<string, unknown>).sources)
    ? (config as Record<string, unknown>).sources as unknown[]
    : [];
  const valid = configured.filter((item): item is string => typeof item === "string" && Boolean(providers[item]));
  return Array.from(new Set(valid.length ? valid : [source])).filter((item) => Boolean(providers[item]));
}

/** 从可用来源中轮询选择一个；上次使用的来源排到本次末尾。 */
export function pickNextAutoSource(sources: string[], lastSource: unknown, enabledMap: Record<string, boolean> = {}): string | undefined {
  const enabled = sources.filter((source) => Boolean(providers[source]) && enabledMap[source] !== false);
  if (!enabled.length) return undefined;
  const lastIndex = typeof lastSource === "string" ? enabled.indexOf(lastSource) : -1;
  return enabled[(lastIndex + 1) % enabled.length];
}

/** 数据来源元信息（id / 名称 / 说明）与是否可用，供管理端展示与做开关。 */
export function autoSourceMeta(enabledMap: Record<string, boolean> = {}): Array<AutoSourceMeta & { enabled: boolean }> {
  return Object.entries(providers).map(([id, entry]) => ({
    id,
    label: entry.label,
    description: entry.description,
    enabled: enabledMap[id] !== false,
  }));
}

/** 按来源 id 拉取一张未收录的壁纸；不认识的来源抛出明确错误。 */
export async function fetchAutoSource(sourceId: string, ctx: AutoSourceContext): Promise<AutoSourceItem> {
  const entry = providers[sourceId];
  if (!entry) throw new Error(`未知的数据来源：${sourceId}`);
  return entry.fetch(ctx);
}

/** 从 WallPost 桥接服务拉取一张 Wallhaven 壁纸（下载即交付，随后删除墙外临时文件）。 */
async function fetchFromWallpost(ctx: AutoSourceContext, type: "static" | "live", source?: string): Promise<AutoSourceItem> {
  const baseUrl = ctx.configService.get<string>("WALLPOST_BASE_URL")?.trim();
  const bridgeKey = ctx.configService.get<string>("WALLPOST_BRIDGE_KEY")?.trim();
  if (!baseUrl || !bridgeKey) throw new Error("未配置 WALLPOST_BASE_URL / WALLPOST_BRIDGE_KEY");
  const bridgeBase = baseUrl.replace(/\/$/, "");
  // 桥接动态拉取总预算 10 分钟，给响应及网络开销额外预留 2 分钟。
  const isLive = type === "live";
  // 静态桥接也需要先下载图片，给候选重试预留时间。
  const nextTimeoutMs = isLive ? 12 * 60_000 : 180_000;
  // 下载视频超时低于墙外临时文件 TTL（30 分钟），避免下载途中被清理。
  const downloadTimeoutMs = isLive ? 25 * 60_000 : 300_000;

  const response = await fetch(`${bridgeBase}/api/bridge/next-wallpaper`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bridge-key": bridgeKey },
    body: JSON.stringify({ exclude: ctx.exclude, type, ...(source ? { source } : {}) }),
    signal: AbortSignal.timeout(nextTimeoutMs),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `桥接获取壁纸失败（${response.status}）`);
  }
  const payload = (await response.json()) as {
    data?: { id: string; token: string; width: number; height: number; fileSize?: number; fileName: string; fileType: string; downloadUrl: string };
  };
  const item = payload.data;
  if (!item?.id || !item.downloadUrl) throw new Error("桥接未返回壁纸信息");

  const configuredMax = Number(ctx.configService.get("UPLOAD_MAX_FILE_MB") || 300);
  const bytes = await downloadBridgeFile(`${bridgeBase}${item.downloadUrl}`, {
    headers: { "x-bridge-key": bridgeKey },
    timeoutMs: downloadTimeoutMs,
    maxBytes: (Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 300) * 1048576,
    expectedBytes: item.fileSize,
    onProgress: ctx.onTransferProgress,
  });

  await fetch(`${bridgeBase}/api/bridge/download/${item.token}/complete`, {
    method: "POST",
    headers: { "x-bridge-key": bridgeKey },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);

  return {
    sourceId: item.id,
    width: item.width,
    height: item.height,
    fileName: item.fileName,
    fileType: item.fileType,
    type,
    bytes,
  };
}

async function fetchFromWallpostLive(ctx: AutoSourceContext): Promise<AutoSourceItem> {
  return fetchFromWallpost(ctx, "live");
}
