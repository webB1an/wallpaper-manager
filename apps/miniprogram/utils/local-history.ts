export interface LocalWallpaper {
  id?: string;
  title: string;
  coverUrl: string;
  href?: string;
  at: number;
  atText?: string;
}

const DOWNLOAD_KEY = "wallpaper_downloaded_history";
const FAVORITE_KEY = "wallpaper_favorite_list";

function readList(key: string): LocalWallpaper[] {
  const value = wx.getStorageSync(key);
  return Array.isArray(value) ? value : [];
}

function writeList(key: string, list: LocalWallpaper[]) {
  wx.setStorageSync(key, list.slice(0, 50));
}

export function saveDownloadHistory(item: { id?: string; title: string; coverUrl: string }) {
  if (!item || !item.title) return;
  const next = [
    { id: item.id, title: item.title, coverUrl: item.coverUrl, at: Date.now() },
    ...readList(DOWNLOAD_KEY),
  ].slice(0, 50);
  writeList(DOWNLOAD_KEY, next);
}

export function readDownloadHistory(): LocalWallpaper[] {
  return readList(DOWNLOAD_KEY);
}

export function toggleFavorite(item: { id?: string; title: string; coverUrl: string }): boolean {
  const list = readList(FAVORITE_KEY);
  if (item.id && list.some((record) => record.id === item.id)) {
    writeList(FAVORITE_KEY, list.filter((record) => record.id !== item.id));
    return false;
  }
  writeList(FAVORITE_KEY, [{ id: item.id, title: item.title, coverUrl: item.coverUrl, at: Date.now() }, ...list]);
  return true;
}

export function isFavorite(id?: string): boolean {
  return Boolean(id && readList(FAVORITE_KEY).some((record) => record.id === id));
}

export function readFavorites(): LocalWallpaper[] {
  return readList(FAVORITE_KEY);
}
