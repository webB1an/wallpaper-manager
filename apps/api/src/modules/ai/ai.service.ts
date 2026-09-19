import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WallpaperType } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import sharp from "sharp";

const analysisSchema = z.object({
  title: z.string().trim().min(1).max(40),
  type: z.enum(["static", "live", "mobile", "desktop", "other"]).default("other"),
  tags: z.array(z.string().trim().min(1).max(12)).min(1).max(8),
  sensitiveFlags: z.array(z.enum(["sexual", "violence", "political", "vulgar"])).default([]),
  safe: z.boolean(),
  animeStyle: z.boolean().optional(),
  summary: z.string().trim().max(160).optional(),
});

export type WallpaperAnalysis = z.infer<typeof analysisSchema>;

@Injectable()
export class AiService {
  constructor(private readonly config: ConfigService) {}

  isConfigured() { return Boolean(this.config.get<string>("DEEPSEEK_API_KEY")?.trim()); }

  /** Shared transport for article planning/copy; scheduling is enforced by the caller's WallMuse AI wrapper. */
  async generateJson(system: string, input: unknown, maxTokens = 2400): Promise<unknown> {
    const apiKey = this.config.get<string>("DEEPSEEK_API_KEY")?.trim();
    if (!apiKey) throw new Error("未配置 DeepSeek，无法生成文章");
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.get<string>("DEEPSEEK_TEXT_MODEL") || this.config.get<string>("DEEPSEEK_MODEL") || "deepseek-v4-flash-vision-exp",
        messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(input) }],
        response_format: { type: "json_object" }, thinking: { type: "disabled" }, temperature: 0.6, max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`DeepSeek 文案生成失败 (${response.status})`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string | null } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("DeepSeek 未返回文案");
    return JSON.parse(content);
  }

  async analyzeImage(imagePath: string, originalName: string, beforeRequest?: () => Promise<void>, classifyAnime = false): Promise<WallpaperAnalysis> {
    const apiKey = this.config.get<string>("DEEPSEEK_API_KEY")?.trim();
    if (!apiKey) {
      return fallbackAnalysis(originalName);
    }

    // 限制送审图分辨率：超高/超宽图（如 900x9869）会超出视觉模型输入上限导致失败。
    let imageBytes: Buffer;
    try {
      imageBytes = await sharp(imagePath)
        .rotate()
        .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
    } catch {
      imageBytes = await readFile(imagePath);
    }
    const base64 = imageBytes.toString("base64");
    await beforeRequest?.();
    const requestRaw = async (temperature: number) => {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.get<string>("DEEPSEEK_MODEL") || "deepseek-v4-flash-vision-exp",
          messages: [
            {
              role: "system",
              content: [
                "你是壁纸内容审核与分类助手。",
                "只根据图片内容输出 JSON。",
                classifyAnime ? "额外输出布尔字段 animeStyle：明确属于二次元动漫、漫画、日系角色插画或动漫风格场景时为true；真人照片、现实摄影风景、写实产品、抽象图案或无法判断时为false。风格与safe安全审核独立判断。不要根据文件名猜测。" : "",
                "需要识别标题、中文标签，以及是否包含色情、暴力、政治、低俗。",
                "敏感审核只拦截 sexual、violence、political、vulgar 四类。",
                "色情/暴力/政治/低俗任一命中时 safe=false；四类都未命中时 safe=true。",
              ].join(""),
            },
            {
              role: "user",
              content: [
                { type: "text", text: `文件名：${originalName}\n输出 JSON：{"title":"中文标题","tags":["标签"],"sensitiveFlags":["sexual|violence|political|vulgar"],"safe":true,"summary":"一句话描述，不超过60字"}` },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
              ],
            },
          ],
          response_format: { type: "json_object" },
          thinking: { type: "disabled" },
          temperature,
          max_tokens: 800,
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) throw new Error(`DeepSeek 识图失败 (${response.status})`);
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
      const raw = body.choices?.[0]?.message?.content;
      if (!raw) throw new Error("DeepSeek 未返回识别结果");
      return raw;
    };
    const parseAnalysis = (raw: string) => {
      const parsed = analysisSchema.parse(normalizeAnalysisPayload(parseImageAnalysisJson(raw), originalName));
      return {
        ...parsed,
        safe: parsed.safe && parsed.sensitiveFlags.length === 0,
      };
    };

    try {
      return parseAnalysis(await requestRaw(0.2));
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof z.ZodError)) throw error;
      return parseAnalysis(await requestRaw(0));
    }
  }

  async persistAnalysis(wallpaperId: string, analysis: WallpaperAnalysis, raw?: unknown) {
    return {
      ai: {
        wallpaperId,
        title: analysis.title,
        type: analysis.type as WallpaperType,
        tags: analysis.tags,
        sensitiveFlags: analysis.sensitiveFlags,
        safe: analysis.safe,
        summary: analysis.summary,
        raw,
      },
    };
  }
}

function fallbackAnalysis(originalName: string): WallpaperAnalysis {
  const title = originalName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 40) || "未命名壁纸";
  return {
    title,
    type: "other",
    tags: ["待识别"],
    sensitiveFlags: [],
    safe: false,
    summary: "未配置 DeepSeek，无法完成敏感内容审核，禁止自动上架。",
  };
}

function normalizeAnalysisPayload(value: unknown, originalName: string) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const flags = new Set(["sexual", "violence", "political", "vulgar"]);
  const types = new Set(["static", "live", "mobile", "desktop", "other"]);
  const tags = Array.isArray(record.tags)
    ? record.tags
      .map((tag) => String(tag || "").trim().slice(0, 12))
      .filter(Boolean)
      .slice(0, 8)
    : [];
  const sensitiveFlags = Array.isArray(record.sensitiveFlags)
    ? record.sensitiveFlags.map((flag) => String(flag || "").trim()).filter((flag) => flags.has(flag)).slice(0, 4)
    : [];
  const fallback = fallbackAnalysis(originalName);
  const title = String(record.title || fallback.title).trim().slice(0, 40);
  return {
    title: title || fallback.title,
    type: types.has(String(record.type)) ? String(record.type) : "other",
    tags: tags.length ? tags : ["待整理"],
    sensitiveFlags,
    safe: record.safe === true,
    ...(typeof record.animeStyle === "boolean" ? { animeStyle: record.animeStyle } : {}),
    summary: typeof record.summary === "string" ? record.summary.trim().slice(0, 160) : undefined,
  };
}

function parseImageAnalysisJson(raw: string): unknown {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  try {
    return JSON.parse(text);
  } catch {
    throw new SyntaxError(`识图结果 JSON 无法解析：${text.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}
