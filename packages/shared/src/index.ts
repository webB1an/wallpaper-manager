export const WALLPAPER_TYPES = [
  "static",
  "live",
  "mobile",
  "desktop",
  "other"
] as const;

export const SENSITIVE_FLAGS = [
  "sexual",
  "violence",
  "political",
  "vulgar"
] as const;

export type WallpaperType = (typeof WALLPAPER_TYPES)[number];
export type SensitiveFlag = (typeof SENSITIVE_FLAGS)[number];

export interface ApiEnvelope<T> {
  code: number;
  data: T;
  message?: string;
}

export interface WallpaperSummary {
  id: string;
  title: string;
  type: WallpaperType;
  coverUrl: string;
  tags: string[];
  viewCount: number;
  downloadCount: number;
  createdAt: string;
}

export interface WallpaperDetail extends WallpaperSummary {
  shortLinks: Array<{
    provider: "quark" | "baidu";
    label: string;
    url: string;
    passcode?: string;
  }>;
  fileSize?: number;
}

export interface AdminTaskEvent {
  id: string;
  type: string;
  status: string;
  message?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
}
