import type { WallpaperAnalysis } from "../ai/ai.service";

export interface DriveCheckpoint {
  accountId: string;
  phase: "pending" | "uploading" | "uploaded" | "sharing" | "shared";
  remotePath?: string;
  fids?: string[];
  url?: string;
  passcode?: string;
}
export interface UploadCheckpoint {
  version: 1;
  stage: "analysis" | "storage" | "resources" | "resource_inflight" | "channel" | "channel_inflight" | "done" | "skipped";
  analysis?: WallpaperAnalysis;
  drives: Partial<Record<"baidu" | "quark", DriveCheckpoint>>;
}
export function canResumeUpload(value: unknown): boolean {
  const cp = value as UploadCheckpoint | null;
  return !!cp && cp.version === 1 && !!cp.drives && ["analysis", "storage", "resources", "channel", "done", "skipped"].includes(cp.stage) && (cp.stage === "analysis" || cp.stage === "skipped" || !!cp.analysis?.safe);
}

export function uploadResumeState(payload: unknown) {
  const data = (payload || {}) as Record<string, any>;
  const items = Object.values(data.uploadCheckpoints || {}) as UploadCheckpoint[];
  const groups = Object.values(data.uploadGroups || {}) as Array<{ status: string }>;
  return { resumable: items.length > 0 && items.every(canResumeUpload) && groups.every((group) => group.status !== "inflight"),
    needsUploadConfirmation: items.some((item) => Object.values(item.drives || {}).some((drive) => drive?.phase === "uploading")) };
}
