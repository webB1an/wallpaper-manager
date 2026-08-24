const API_BASE = "https://wall-api.wdbzk.com/api";

export function request<T>(path: string, data?: Record<string, string | number | undefined>): Promise<T> {
  return requestWithMethod<T>("GET", path, data);
}

export function post<T>(path: string, data?: Record<string, string | number | undefined>): Promise<T> {
  return requestWithMethod<T>("POST", path, data);
}

function requestWithMethod<T>(method: "GET" | "POST", path: string, data?: Record<string, string | number | undefined>): Promise<T> {
  const query = data
    ? "?" + Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join("&")
    : "";
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE}${path}${query}`,
      method,
      timeout: 12000,
      success(response) {
        const body = response.data as { code?: number; data?: T; message?: string };
        if (response.statusCode >= 200 && response.statusCode < 300 && body.code === 200) {
          resolve(body.data as T);
        } else {
          reject(new Error(body.message || "请求失败"));
        }
      },
      fail(error) {
        reject(new Error(formatRequestFailure(error.errMsg)));
      }
    });
  });
}

function formatRequestFailure(message = "") {
  if (message.includes("url not in domain list") || message.includes("domain list")) {
    return "请求被微信域名拦截，请在小程序后台加入 wall-api.wdbzk.com";
  }
  if (message.includes("timeout")) return "网络超时，请稍后重试";
  return message || "网络请求失败";
}

export interface WallpaperCard {
  id: string;
  title: string;
  type: string;
  typeLabel?: string;
  orientation?: string;
  orientationLabel?: string;
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
  tags: Array<{ name: string; count: number; coverUrl: string }>;
}
