import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { BridgeItem } from "../admin/auto-publish-sources";
import type { DriveCheckpoint } from "../admin/upload-checkpoint";

export const templateIds = ["editorial-journal", "editorial-gallery", "air-journal", "air-gallery", "film-journal", "film-gallery"] as const;
export const createInputSchema = z.object({
  targetCount: z.number().int().min(1).max(18),
  candidateBudget: z.number().int().min(1).max(60).optional(),
  sourceMode: z.enum(["auto", "manual"]).default("auto"),
  sources: z.array(z.string().min(1).max(64)).max(3).optional(),
  preferredStyle: z.string().trim().max(160).default(""),
  templateMode: z.literal("auto").default("auto"),
  copyDensity: z.enum(["light", "medium", "rich"]).default("medium"),
  scheduleMode: z.literal("respect_idle").default("respect_idle"),
  storagePolicy: z.literal("inherit_defaults").default("inherit_defaults"),
}).strict();
export type GenerationInput = z.infer<typeof createInputSchema>;
export interface StoredGenerationInput extends GenerationInput {
  candidateBudget: number;
  sources: string[];
  storageSelection: { baiduAccountId?: string; quarkAccountId?: string };
  requiredProviders: Array<"baidu" | "quark">;
  includeInteraction: boolean;
  scope?: "title" | "copy" | "plan";
  baseRevisionId?: string;
}
export const assetSchema = z.object({
  id: z.string().min(1).max(64), wallpaperId: z.string().min(1).max(64),
  title: z.string().max(120), src: z.string().max(1024),
  width: z.number().int().positive(), height: z.number().int().positive(),
  kind: z.literal("source"), storageReady: z.boolean(),
});
export const revisionSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1).max(64), articleId: z.string().min(1).max(64),
  revision: z.number().int().positive(), createdAt: z.string().datetime(),
  subject: z.string().trim().min(1).max(60), title: z.string().trim().min(1).max(120), titleMode: z.enum(["automatic", "manual"]),
  titleSuggestions: z.array(z.string().max(120)).max(3).optional(),
  intro: z.string().max(3000), groupCopies: z.array(z.string().max(2000)).max(5), ending: z.string().max(2000),
  interaction: z.string().max(500), interactionEnabled: z.boolean(),
  assets: z.array(assetSchema).min(1).max(18),
  templateId: z.enum(templateIds), templateVersion: z.literal(1).optional(), rendererVersion: z.literal(1).optional(),
  density: z.enum(["light", "medium", "rich"]), provenance: z.literal("service"),
  miniProgram: z.object({ name: z.string().max(80), appId: z.string().max(64), pagePath: z.string().max(512) }),
});
export type ArticleRevision = z.infer<typeof revisionSchema>;
export const revisionWriteSchema = z.object({ baseRevisionId: z.string().min(1).max(64), revision: revisionSchema });
export const regenerationSchema = z.object({ baseRevisionId: z.string().min(1).max(64), scope: z.enum(["title", "copy", "plan"]), preferredStyle: z.string().max(160).optional() }).strict();
export const planSchema = z.object({ subject: z.string().trim().min(1).max(60), selectedIds: z.array(z.string().min(1).max(64)).min(1).max(18), templateId: z.enum(templateIds) });
export type ArticlePlan = z.infer<typeof planSchema>;
export const copySchema = z.object({
  intro: z.string().trim().min(1).max(1800), groupCopies: z.array(z.string().max(1200)).max(5),
  ending: z.string().trim().min(1).max(1200), interaction: z.string().max(300).default(""),
  titleThemes: z.array(z.string().trim().min(1).max(60)).min(2).max(3),
});
export type ArticleCopy = z.infer<typeof copySchema>;
export interface Checkpoint {
  version: 1;
  attempts: number;
  activeSource?: string;
  unavailableSources?: string[];
  theme?: string;
  themeAnchorId?: string;
  selectedAssetIds?: string[];
  themeReviewedIds?: string[];
  bridge?: BridgeItem;
  transferKey?: string;
  candidateId?: string;
  plan?: ArticlePlan;
  copy?: ArticleCopy;
  resultRevisionId?: string;
  failures?: Array<{ stage: string; message: string; at: string }>;
}
export type DriveState = Partial<Record<"baidu" | "quark", DriveCheckpoint>>;
export function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
export function digest(value: unknown) {
  const serialized = JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
  return createHash("sha256").update(serialized).digest("hex");
}
export function revisionDigest(value: ArticleRevision) {
  const { id: _id, revision: _revision, createdAt: _createdAt, ...semantic } = value;
  void _id; void _revision; void _createdAt;
  return digest(semantic);
}
export function idempotencyKey(value: unknown) { return z.string().regex(/^[A-Za-z0-9_-]{8,100}$/).parse(value); }
export function assertSelection(ids: string[], candidates: string[], expected: number) {
  if (ids.length !== expected || new Set(ids).size !== ids.length || ids.some((id) => !candidates.includes(id))) throw new Error("AI 选图数量、重复项或素材引用不符合要求，请重新生成策划");
}
export function titleFor(subject: string, count: number) { return `Share｜${subject.replace(/壁纸$/, "")}壁纸${count}张`; }

export function perceptualDistance(left: string, right: string) {
  if (!/^[a-f0-9]{16}$/.test(left) || !/^[a-f0-9]{16}$/.test(right)) return 64;
  let bits = BigInt(`0x${left}`) ^ BigInt(`0x${right}`); let count = 0;
  while (bits) { bits &= bits - 1n; count++; }
  return count;
}
