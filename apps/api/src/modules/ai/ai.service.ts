import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WallpaperType } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const analysisSchema = z.object({
  title: z.string().trim().min(1).max(40),
  type: z.enum(["static", "live", "mobile", "desktop", "other"]),
  tags: z.array(z.string().trim().min(1).max(12)).min(1).max(8),
  sensitiveFlags: z.array(z.enum(["sexual", "violence", "political", "vulgar"])).default([]),
  safe: z.boolean(),
  summary: z.string().trim().max(160).optional(),
});

export type WallpaperAnalysis = z.infer<typeof analysisSchema>;

@Injectable()
export class AiService {
  constructor(private readonly config: ConfigService) {}

  async analyzeImage(imagePath: string, originalName: string): Promise<WallpaperAnalysis> {
    const apiKey = this.config.get<string>("DEEPSEEK_API_KEY")?.trim();
    if (!apiKey) {
      return fallbackAnalysis(originalName);
    }

    const bytes = await readFile(imagePath);
    const base64 = bytes.toString("base64");
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
              "需要识别标题、壁纸类型、中文标签，以及是否包含色情、暴力、政治、低俗。",
              "敏感审核只拦截 sexual、violence、political、vulgar 四类。",
              "色情/暴力/政治/低俗任一命中时 safe=false；四类都未命中时 safe=true。",
            ].join(""),
          },
          {
            role: "user",
            content: [
              { type: "text", text: `文件名：${originalName}\n输出 JSON：{"title":"中文标题","type":"static|live|mobile|desktop|other","tags":["标签"],"sensitiveFlags":["sexual|violence|political|vulgar"],"safe":true,"summary":"一句话描述"}` },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        temperature: 0.2,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) throw new Error(`DeepSeek 识图失败 (${response.status})`);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
    const raw = body.choices?.[0]?.message?.content;
    if (!raw) throw new Error("DeepSeek 未返回识别结果");
    const parsed = analysisSchema.parse(JSON.parse(raw));
    return {
      ...parsed,
      safe: parsed.safe && parsed.sensitiveFlags.length === 0,
    };
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
