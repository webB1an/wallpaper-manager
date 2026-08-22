import { request, WallpaperFacets } from "../../utils/api";

type TypeCard = { key: string; title: string; subtitle: string; count: number };

Page({
  data: {
    types: [
      { key: "live", title: "动态壁纸", subtitle: "视频与动态资源", count: 0 },
      { key: "static", title: "静态壁纸", subtitle: "单张高清图片", count: 0 },
      { key: "mobile", title: "手机壁纸", subtitle: "竖屏优先", count: 0 },
      { key: "desktop", title: "电脑壁纸", subtitle: "桌面场景", count: 0 }
    ] as TypeCard[],
    tags: [] as Array<{ name: string; count: number }>,
    loading: false,
    error: ""
  },

  async onLoad() {
    this.loadFacets();
  },

  onPullDownRefresh() {
    this.loadFacets().finally(() => wx.stopPullDownRefresh());
  },

  async loadFacets() {
    this.setData({ loading: true, error: "" });
    try {
      const facets = await request<WallpaperFacets>("/wallpapers/facets");
      const countByType = new Map(facets.types.map((item) => [item.type, item.count]));
      this.setData({
        types: this.data.types.map((item) => ({ ...item, count: countByType.get(item.key) || 0 })),
        tags: facets.tags
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "分类加载失败";
      this.setData({ error: message });
      wx.showToast({ title: "分类加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  retry() {
    this.loadFacets();
  },

  openTag(event: WechatMiniprogram.TouchEvent) {
    const tag = String(event.currentTarget.dataset.tag || "");
    wx.navigateTo({ url: `/pages/index/index?tag=${encodeURIComponent(tag)}` });
  },

  openType(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type || "");
    wx.navigateTo({ url: `/pages/index/index?type=${encodeURIComponent(type)}` });
  },

  onShareAppMessage() {
    return {
      title: "按风格探索壁纸｜WDBZK",
      path: "/pages/category/category"
    };
  },

  onShareTimeline() {
    return {
      title: "按风格探索壁纸｜WDBZK"
    };
  }
});
