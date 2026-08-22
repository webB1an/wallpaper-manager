import { request, WallpaperDetail } from "../../utils/api";

const HISTORY_KEY = "wallpaper_download_history";

Page({
  data: {
    item: null as WallpaperDetail | null,
    primaryLink: null as { provider: string; label: string; url: string } | null,
    primaryUrl: "",
    sizeText: "",
    typeText: "",
    loading: true,
    error: "",
    id: ""
  },

  async onLoad(options: { id?: string }) {
    if (!options.id) return;
    this.setData({ id: options.id });
    this.loadDetail(options.id);
  },

  onUnload() {
    wx.setNavigationBarTitle({ title: "壁纸详情" });
  },

  async loadDetail(id = this.data.id) {
    if (!id) return;
    this.setData({ loading: true, error: "" });
    try {
      const item = await request<WallpaperDetail>(`/wallpapers/${id}`);
      this.setData({
        item,
        primaryLink: item.shortLinks[0] || null,
        primaryUrl: item.shortLinks[0]?.url || "",
        sizeText: formatBytes(item.fileSize),
        typeText: formatType(item.type)
      });
      wx.setNavigationBarTitle({ title: item.title.slice(0, 12) || "壁纸详情" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "详情加载失败";
      this.setData({ error: message });
      wx.showToast({ title: "详情加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  retry() {
    this.loadDetail();
  },

  copyLink(event: WechatMiniprogram.TouchEvent) {
    const url = String(event.currentTarget.dataset.url || "");
    const label = String(event.currentTarget.dataset.label || "下载短链");
    this.copyShortLink(url, label);
  },

  copyPrimaryLink() {
    if (!this.data.primaryLink) {
      wx.showToast({ title: "暂无短链", icon: "none" });
      return;
    }
    this.copyShortLink(this.data.primaryLink.url, this.data.primaryLink.label);
  },

  copyShortLink(url: string, label: string) {
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => {
        saveHistory(this.data.item, url, label);
        wx.showToast({ title: "短链已复制", icon: "success" });
      }
    });
  },

  openRelated(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id || id === this.data.id) return;
    this.setData({ id, item: null, primaryLink: null, primaryUrl: "", sizeText: "", typeText: "" });
    this.loadDetail(id);
  },

  onShareAppMessage() {
    const item = this.data.item;
    return {
      title: item ? `${item.title}｜WDBZK壁纸库` : "WDBZK壁纸库",
      path: item ? `/pages/detail/detail?id=${item.id}` : "/pages/index/index",
      imageUrl: item?.coverUrl || ""
    };
  },

  onShareTimeline() {
    const item = this.data.item;
    return {
      title: item ? `${item.title}｜WDBZK壁纸库` : "WDBZK壁纸库",
      query: item ? `id=${item.id}` : "",
      imageUrl: item?.coverUrl || ""
    };
  }
});

function saveHistory(item: WallpaperDetail | null, url: string, label: string) {
  if (!item || !url) return;
  const previous = readHistory();
  const next = [
    {
      title: item.title,
      coverUrl: item.coverUrl,
      label,
      url,
      copiedAt: Date.now()
    },
    ...previous.filter((record) => record.url !== url)
  ].slice(0, 20);
  wx.setStorageSync(HISTORY_KEY, next);
}

function readHistory(): Array<{ title: string; coverUrl: string; label: string; url: string; copiedAt: number }> {
  const value = wx.getStorageSync(HISTORY_KEY);
  return Array.isArray(value) ? value : [];
}

function formatBytes(value: number) {
  if (!value) return "原图资源";
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(value / 1024)} KB`;
}

function formatType(value: string) {
  const map: Record<string, string> = {
    live: "动态壁纸",
    static: "静态壁纸",
    mobile: "手机壁纸",
    desktop: "电脑壁纸",
    other: "壁纸资源"
  };
  return map[value] || "壁纸资源";
}
