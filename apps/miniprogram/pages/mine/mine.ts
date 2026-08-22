const HISTORY_KEY = "wallpaper_download_history";

type DownloadRecord = {
  id?: string;
  title: string;
  coverUrl: string;
  label: string;
  url: string;
  copiedAt: number;
  copiedAtText?: string;
};

Page({
  data: {
    records: [] as DownloadRecord[]
  },

  onShow() {
    this.setData({ records: readHistory().map((record) => ({ ...record, copiedAtText: formatTime(record.copiedAt) })) });
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
