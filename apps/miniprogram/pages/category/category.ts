import { request, WallpaperFacets } from "../../utils/api";

type TypeCard = { key: string; title: string; subtitle: string; icon: string; count: number };

let requestToken = 0;

Page({
  data: {
    types: [
      { key: "live", title: "动态壁纸", subtitle: "视频与动态资源", icon: "dynamic", count: 0 },
      { key: "static", title: "静态壁纸", subtitle: "单张图片资源", icon: "static", count: 0 }
    ] as TypeCard[],
    tags: [] as Array<{ name: string; count: number; coverUrl: string }>,
    leftTags: [] as Array<{ name: string; count: number; coverUrl: string }>,
    rightTags: [] as Array<{ name: string; count: number; coverUrl: string }>,
    loading: false,
    error: "",
    backTopVisible: false
  },

  onPageScroll(event: { scrollTop: number }) {
    const visible = event.scrollTop > 600;
    if (visible !== this.data.backTopVisible) {
      this.setData({ backTopVisible: visible });
    }
  },

  backTop() {
    wx.pageScrollTo({ scrollTop: 0, duration: 300 });
  },

  async onLoad() {
    this.loadFacets();
  },

  onPullDownRefresh() {
    this.loadFacets().finally(() => wx.stopPullDownRefresh());
  },

  async loadFacets() {
    const token = ++requestToken;
    this.setData({ loading: true, error: "" });
    try {
      const facets = await request<WallpaperFacets>("/wallpapers/facets");
      if (token !== requestToken) return;
      const countByType = new Map(facets.types.map((item) => [item.type, item.count]));
      this.setData({
        types: this.data.types.map((item) => ({ ...item, count: countByType.get(item.key) || 0 })),
        tags: facets.tags,
        ...splitMasonry(facets.tags),
      });
    } catch (error) {
      if (token !== requestToken) return;
      const message = error instanceof Error ? error.message : "标签加载失败";
      this.setData({ error: message });
      wx.showToast({ title: "标签加载失败", icon: "none" });
    } finally {
      if (token === requestToken) this.setData({ loading: false });
    }
  },

  retry() {
    this.loadFacets();
  },

  openTag(event: WechatMiniprogram.TouchEvent) {
    const tag = String(event.currentTarget.dataset.tag || "");
    openList(`tag=${encodeURIComponent(tag)}&title=${encodeURIComponent(`#${tag}`)}`);
  },

  openType(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type || "");
    const title = this.data.types.find((item) => item.key === type)?.title || "壁纸列表";
    openList(`type=${encodeURIComponent(type)}&title=${encodeURIComponent(title)}`);
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

function openList(query: string) {
  wx.navigateTo({ url: `/pages/list/list?${query}` });
}

function splitMasonry(items: Array<{ name: string; count: number; coverUrl: string }>) {
  const leftTags: Array<{ name: string; count: number; coverUrl: string }> = [];
  const rightTags: Array<{ name: string; count: number; coverUrl: string }> = [];
  items.forEach((item, index) => {
    if (index % 2 === 0) leftTags.push(item);
    else rightTags.push(item);
  });
  return { leftTags, rightTags };
}
