import { post } from "./api";

export async function ensureOpenid(): Promise<string> {
  const cached = String(wx.getStorageSync("openid") || "");
  if (cached) return cached;
  const code = await new Promise<string>((resolve) => {
    wx.login({
      success: (result) => resolve(result.code || ""),
      fail: () => resolve(""),
    });
  });
  if (!code) throw new Error("微信登录失败");
  const result = await post<{ openid: string }>("/auth/login", { code });
  if (!result.openid) throw new Error("微信登录失败");
  wx.setStorageSync("openid", result.openid);
  return result.openid;
}
