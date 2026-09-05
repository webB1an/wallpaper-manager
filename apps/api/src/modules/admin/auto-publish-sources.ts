import { ConfigService } from "@nestjs/config";

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
async function fetchFromWallpost(ctx: AutoSourceContext, type: "static" | "live"): Promise<AutoSourceItem> {
  const baseUrl = ctx.configService.get<string>("WALLPOST_BASE_URL")?.trim();
  const bridgeKey = ctx.configService.get<string>("WALLPOST_BRIDGE_KEY")?.trim();
  if (!baseUrl || !bridgeKey) throw new Error("未配置 WALLPOST_BASE_URL / WALLPOST_BRIDGE_KEY");
  const bridgeBase = baseUrl.replace(/\/$/, "");
  // 动态壁纸需要墙外先下载视频再返回，耗时可能几分钟；单独放大超时，且大于墙外脚本超时（30 分钟）。
  const isLive = type === "live";
  const nextTimeoutMs = isLive ? 35 * 60_000 : 90_000;
  // 下载视频超时低于墙外临时文件 TTL（30 分钟），避免下载途中被清理。
  const downloadTimeoutMs = isLive ? 25 * 60_000 : 300_000;

  const response = await fetch(`${bridgeBase}/api/bridge/next-wallpaper`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bridge-key": bridgeKey },
    body: JSON.stringify({ exclude: ctx.exclude, type }),
    signal: AbortSignal.timeout(nextTimeoutMs),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `桥接获取壁纸失败（${response.status}）`);
  }
  const payload = (await response.json()) as {
    data?: { id: string; token: string; width: number; height: number; fileName: string; fileType: string; downloadUrl: string };
  };
  const item = payload.data;
  if (!item?.id || !item.downloadUrl) throw new Error("桥接未返回壁纸信息");

  const imageResponse = await fetch(`${bridgeBase}${item.downloadUrl}`, {
    headers: { "x-bridge-key": bridgeKey },
    signal: AbortSignal.timeout(downloadTimeoutMs),
  });
  if (!imageResponse.ok) throw new Error(`下载原图失败（${imageResponse.status}）`);
  const bytes = Buffer.from(await imageResponse.arrayBuffer());

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
