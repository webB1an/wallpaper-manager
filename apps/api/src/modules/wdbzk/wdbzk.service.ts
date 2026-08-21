import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface WdbzkResource {
  id: number;
  name: string;
  link: string;
  click_count?: number;
}

@Injectable()
export class WdbzkService {
  constructor(private readonly config: ConfigService) {}

  async createResource(name: string, link: string, description = ""): Promise<{ id?: number; duplicate?: boolean; message: string }> {
    const baseUrl = this.baseUrl();
    const token = this.token();
    const response = await fetch(`${baseUrl}/api/resources?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        link,
        categoryId: Number(this.config.get("PANAPI_CATEGORY_ID") || 61),
        resourceDescription: description,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await response.json()) as { code?: number; message?: string; data?: { id?: number } };
    if (body.code === 200) return { id: body.data?.id, message: body.message || "新增成功" };
    if (body.code === 400 && String(body.message || "").includes("已存在")) {
      return { duplicate: true, message: body.message || "链接已存在" };
    }
    throw new Error(body.message || `wdbzk 入库失败 (${response.status})`);
  }

  async listResources(page = 1, pageSize = 100, keyword = ""): Promise<{ list: WdbzkResource[]; total: number; page: number; pageSize: number }> {
    const url = new URL(`${this.baseUrl()}/api/wallpaper/resources`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(pageSize));
    if (keyword) url.searchParams.set("keyword", keyword);
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const body = (await response.json()) as { code?: number; message?: string; data?: { list?: WdbzkResource[]; total?: number; page?: number; pageSize?: number } };
    if (body.code !== 200) throw new Error(body.message || "读取 wdbzk 资源失败");
    return {
      list: body.data?.list || [],
      total: Number(body.data?.total || 0),
      page: Number(body.data?.page || page),
      pageSize: Number(body.data?.pageSize || pageSize),
    };
  }

  private baseUrl(): string {
    return (this.config.get<string>("PANAPI_BASE_URL") || "https://panapi.wdbzk.com").replace(/\/$/, "");
  }

  private token(): string {
    const token = this.config.get<string>("PANAPI_TOKEN")?.trim();
    if (!token) throw new Error("未配置 wdbzk panapi token");
    return token;
  }
}
