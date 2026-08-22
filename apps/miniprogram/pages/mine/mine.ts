const HISTORY_KEY = "wallpaper_download_history";

type DownloadRecord = {
  title: string;
  coverUrl: string;
  label: string;
  url: string;
  copiedAt: number;
};

Page({
  data: {
    records: [] as DownloadRecord[]
  },

  onShow() {
    this.setData({ records: readHistory() });
  },

  copyLink(event: WechatMiniprogram.TouchEvent) {
    const url = String(event.currentTarget.dataset.url || "");
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: "短链已复制", icon: "success" })
    });
  },

  clearHistory() {
    wx.removeStorageSync(HISTORY_KEY);
    this.setData({ records: [] });
  }
});

function readHistory(): DownloadRecord[] {
  const value = wx.getStorageSync(HISTORY_KEY);
  return Array.isArray(value) ? value : [];
}
