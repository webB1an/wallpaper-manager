import { post, request } from "./api";

export interface RewardStatus {
  rewarded: boolean;
  remaining: number;
  type: string;
  rewardType?: string;
}

/** 微信登录拿 openid（带缓存），供下载/额度等使用。 */
export async function ensureOpenid(): Promise<string> {
  const cached = String(wx.getStorageSync("openid") || "");
  if (cached) return cached;
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (result) => {
        if (!result.code) {
          reject(new Error("微信登录失败"));
          return;
        }
        try {
          const login = await post<{ openid: string }>("/auth/login", { code: result.code });
          if (!login.openid) throw new Error("微信登录失败");
          wx.setStorageSync("openid", login.openid);
          resolve(login.openid);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("微信登录失败"));
        }
      },
      fail: () => reject(new Error("微信登录失败")),
    });
  });
}

/** 获取今日激励下载额度状态（自动保证登录）。 */
export async function getRewardStatus(): Promise<RewardStatus> {
  await ensureOpenid();
  return request<RewardStatus>("/reward/status");
}
