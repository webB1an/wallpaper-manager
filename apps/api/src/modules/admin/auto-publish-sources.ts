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

const providers: Record<string, AutoSourceProvider> = {
  wallpost: fetchFromWallpost,
};

/** 已注册的数据来源 id，供管理端下拉选择。 */
export function autoSourceIds(): string[] {
  return Object.keys(providers);
}

/** 按来源 id 拉取一张未收录的壁纸；不认识的来源抛出明确错误。 */
export async function fetchAutoSource(sourceId: string, ctx: AutoSourceContext): Promise<AutoSourceItem> {
  const provider = providers[sourceId];
  if (!provider) throw new Error(`未知的数据来源：${sourceId}`);
  return provider(ctx);
}

/** 从 WallPost 桥接服务拉取一张 Wallhaven 壁纸（下载即交付，随后删除墙外临时文件）。 */
async function fetchFromWallpost(ctx: AutoSourceContext): Promise<AutoSourceItem> {
  const baseUrl = ctx.configService.get<string>("WALLPOST_BASE_URL")?.trim();
  const bridgeKey = ctx.configService.get<string>("WALLPOST_BRIDGE_KEY")?.trim();
  if (!baseUrl || !bridgeKey) throw new Error("未配置 WALLPOST_BASE_URL / WALLPOST_BRIDGE_KEY");
  const bridgeBase = baseUrl.replace(/\/$/, "");

  const response = await fetch(`${bridgeBase}/api/bridge/next-wallpaper`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bridge-key": bridgeKey },
    body: JSON.stringify({ exclude: ctx.exclude }),
    signal: AbortSignal.timeout(60_000),
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
    signal: AbortSignal.timeout(60_000),
  });
  if (!imageResponse.ok) throw new Error(`下载原图失败（${imageResponse.status}）`);
  const bytes = Buffer.from(await imageResponse.arrayBuffer());

  await fetch(`${bridgeBase}/api/bridge/download/${item.token}/complete`, {
    method: "POST",
    headers: { "x-bridge-key": bridgeKey },
  }).catch(() => undefined);

  return {
    sourceId: item.id,
    width: item.width,
    height: item.height,
    fileName: item.fileName,
    fileType: item.fileType,
    type: "static",
    bytes,
  };
}
