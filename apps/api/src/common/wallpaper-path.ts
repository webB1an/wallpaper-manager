export const QUARK_ROOT_DIR = "wallpapers";
export const QUARK_DYNAMIC_DIR = "动态壁纸";
export const QUARK_STATIC_DIR = "静态壁纸";
export const QUARK_UNCLASSIFIED_DIR = "未分类";

export interface WallpaperRemoteDir {
  /** 百度网盘根目录下的相对目录，例如 "静态壁纸/治愈"。 */
  baiduRelativeDir: string;
  /** 夸克目录层级，第一段固定 "wallpapers"，随后是类型和标签。 */
  quarkSegments: string[];
}

export function buildWallpaperRemoteDir(type: string, tags: string[]): WallpaperRemoteDir {
  const isLive = type === "live";
  const typeDir = isLive ? QUARK_DYNAMIC_DIR : QUARK_STATIC_DIR;
  const firstTag = normalizeTag(tags[0]);
  const tagDir = firstTag || QUARK_UNCLASSIFIED_DIR;
  const segments = [QUARK_ROOT_DIR, typeDir, tagDir];
  return {
    baiduRelativeDir: `${typeDir}/${tagDir}`,
    quarkSegments: segments,
  };
}

function normalizeTag(value: string | undefined | null): string {
  const name = String(value || "").trim();
  return name.replace(/[<>:"/\\|?*]/g, "_").slice(0, 40);
}
