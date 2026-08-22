const API_BASE = "https://wall-api.wdbzk.com/api";

export function request<T>(path: string, data?: Record<string, string | number | undefined>): Promise<T> {
  const query = data
    ? "?" + Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&")
    : "";
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${path}${query}`,
      method: "GET",
      success(response) {
        const body = response.data as { code?: number; data?: T; message?: string };
        if (response.statusCode >= 200 && response.statusCode < 300 && body.code === 200) {
          resolve(body.data as T);
        } else {
          reject(new Error(body.message || "请求失败"));
        }
      },
      fail(error) {
        reject(new Error(error.errMsg));
      }
    });
  });
}

export interface WallpaperCard {
  id: string;
  title: string;
  type: string;
  coverUrl: string;
  tags: string[];
  viewCount: number;
  downloadCount: number;
}

export interface WallpaperDetail extends WallpaperCard {
  fileSize: number;
  shortLinks: Array<{ provider: string; label: string; url: string; passcode?: string }>;
  related: WallpaperCard[];
}

export interface WallpaperFacets {
  types: Array<{ type: string; count: number }>;
  tags: Array<{ name: string; count: number }>;
}
