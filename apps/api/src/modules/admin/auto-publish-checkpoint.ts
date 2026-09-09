import type { BridgeItem } from "./auto-publish-sources";

export type AutoPublishStage = "download" | "asset" | "analyze" | "storage" | "storage_inflight" | "publish" | "publish_inflight" | "published";
export interface AutoPublishCheckpoint {
  version: 1;
  expired?: boolean;
  failures?: Array<{ at: string; stage: AutoPublishStage; error: string }>;
  stage: AutoPublishStage;
  source: string;
  target?: { guildId: string; channelId: string };
  bridge?: BridgeItem;
  wallpaperId?: string;
  analysis?: { title?: string; safe: boolean; sensitiveFlags: string[]; tags: string[] };
  storageWarnings?: string[];
  publication?: { accountId: string; switchedAccounts?: number };
}

/** Never replay an external side effect whose result was not durably recorded. */
export function isAutoPublishCheckpoint(value: unknown): value is AutoPublishCheckpoint {
  if (!value || typeof value !== "object") return false;
  const checkpoint = value as AutoPublishCheckpoint;
  return checkpoint.version === 1 && Boolean(checkpoint.source) && ["download", "asset", "analyze", "storage", "storage_inflight", "publish", "publish_inflight", "published"].includes(checkpoint.stage);
}

export function canResumeAutoPublish(value: unknown): value is AutoPublishCheckpoint {
  if (!isAutoPublishCheckpoint(value) || value.expired) return false;
  const checkpoint = value;
  if (["download", "asset"].includes(checkpoint.stage)) return true;
  if (!checkpoint.wallpaperId) return false;
  if (checkpoint.stage === "analyze") return true;
  if (["storage", "publish"].includes(checkpoint.stage)) return Boolean(checkpoint.analysis?.safe);
  return checkpoint.stage === "published" && Boolean(checkpoint.publication?.accountId);
}
