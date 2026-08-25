import { request } from "../../utils/api";
import { ensureOpenid, getRewardStatus } from "../../utils/reward";
import { readDownloadHistory, readFavorites, replaceDownloads, replaceFavorites } from "../../utils/local-history";
import type { LocalWallpaper } from "../../utils/local-history";

const HISTORY_KEY = "wallpaper_download_history";

type UserWallpaper = { id: string; title: string; coverUrl: string };
type UserRecord = { wallpaperId: string; createdAt: string | number; wallpaper: UserWallpaper };

type DownloadRecord = {
  id?: string;
  title: string;
  coverUrl: string;
  label: string;
  url: string;
  passcode?: string;
  copiedAt: number;
  copiedAtText?: string;
};

Page({
  data: {
    records: [] as DownloadRecord[],
    downloads: [] as LocalWallpaper[],
    favorites: [] as LocalWallpaper[],
    quotaText: ""
  },

  onShow() {
    this.setData({
      records: readHistory().map((record) => ({ ...record, copiedAtText: formatTime(record.copiedAt) })),
      downloads: readDownloadHistory().map((record) => ({ ...record, atText: formatTime(record.at) })),
      favorites: readFavorites().map((record) => ({ ...record, atText: formatTime(record.at) }))
    });
    void this.loadQuota();
    void this.syncFromServer();
  },

  async loadQuota() {
    try {
      const reward = await getRewardStatus();
      let text: string;
      if (reward.rewarded && reward.type === "unlimited") text = "已解锁今日不限次数下载";
      else if (reward.rewarded && reward.remaining > 0) text = `今日剩余 ${reward.remaining} 次下载`;
      else text = "今日暂无免费次数，观看视频即可解锁";
      this.setData({ quotaText: text });
    } catch {
      this.setData({ quotaText: "今日额度获取失败，请稍后重试" });
    }
  },

  async syncFromServer() {
    try {
      await ensureOpenid();
      const [favorites, downloads] = await Promise.all([
        request<UserRecord[]>("/user/favorites"),
        request<UserRecord[]>("/user/downloads"),
      ]);
      const favList = favorites.map((record) => ({ id: record.wallpaperId, title: record.wallpaper.title, coverUrl: record.wallpaper.coverUrl, at: toTimestamp(record.createdAt) }));
      const dlList = downloads.map((record) => ({ id: record.wallpaperId, title: record.wallpaper.title, coverUrl: record.wallpaper.coverUrl, at: toTimestamp(record.createdAt) }));
      replaceFavorites(favList);
      replaceDownloads(dlList);
      this.setData({
        favorites: favList.map((record) => ({ ...record, atText: formatTime(record.at) })),
        downloads: dlList.map((record) => ({ ...record, atText: formatTime(record.at) }))
      });
    } catch {
      // 保留本地缓存。
    }
  },

  clearDownloads() {
    wx.removeStorageSync("wallpaper_downloaded_history");
    this.setData({ downloads: [] });
    wx.showToast({ title: "已清空", icon: "success" });
  },

  clearFavorites() {
    wx.removeStorageSync("wallpaper_favorite_list");
    this.setData({ favorites: [] });
    wx.showToast({ title: "已清空", icon: "success" });
  },

  copyLink(event: WechatMiniprogram.TouchEvent) {
    const url = String(event.currentTarget.dataset.url || "");
    const passcode = String(event.currentTarget.dataset.passcode || "");
    if (!url) {
      wx.showToast({ title: "暂无短链", icon: "none" });
      return;
    }
    wx.setClipboardData({
      data: formatClipboardText(url, passcode),
      success: () => wx.showToast({ title: passcode ? "短链和提取码已复制" : "短链已复制", icon: "success" })
    });
  },

  clearHistory() {
    wx.showModal({
      title: "清空复制记录",
      content: "确认清空最近复制的短链记录？",
      confirmText: "清空",
      confirmColor: "#d85a3a",
      success: (result) => {
        if (!result.confirm) return;
        wx.removeStorageSync(HISTORY_KEY);
        this.setData({ records: [] });
        wx.showToast({ title: "已清空", icon: "success" });
      }
    });
  },

  goExplore() {
    wx.switchTab({ url: "/pages/index/index" });
  },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  }
});

function readHistory(): DownloadRecord[] {
  const value = wx.getStorageSync(HISTORY_KEY);
  return Array.isArray(value) ? value : [];
}

function formatTime(value: number) {
  if (!value) return "刚刚";
  const diff = Date.now() - value;
  if (diff < 60_000) return "刚刚";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 60 / 60_000)} 小时前`;
  const date = new Date(value);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${month}-${day}`;
}

function formatClipboardText(url: string, passcode?: string) {
  return passcode ? `链接：${url}\n提取码：${passcode}` : url;
}

function toTimestamp(value: string | number): number {
  if (typeof value === "number") return value;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Date.now();
}
