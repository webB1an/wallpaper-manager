import { ConfigService } from "@nestjs/config";

export function publicAssetUrl(config: ConfigService, path: string): string {
  const origin = (config.get<string>("PUBLIC_API_ORIGIN") || "").replace(/\/$/, "");
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  return `${origin}/assets/${normalized}`;
}

export function shortUrl(config: ConfigService, code: string): string {
  const origin = (config.get<string>("SHORT_LINK_ORIGIN") || "https://r.wdbzk.com").replace(/\/$/, "");
  return `${origin}/${code}`;
}
