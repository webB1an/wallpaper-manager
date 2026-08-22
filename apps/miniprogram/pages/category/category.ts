import { request } from "../../utils/api";

Page({
  data: {
    types: [
      { key: "live", title: "动态壁纸", subtitle: "视频与动态资源" },
      { key: "static", title: "静态壁纸", subtitle: "单张高清图片" },
      { key: "mobile", title: "手机壁纸", subtitle: "竖屏优先" },
      { key: "desktop", title: "电脑壁纸", subtitle: "桌面场景" }
    ],
    tags: [] as string[],
    loading: false,
    error: ""
  },

  async onLoad() {
    this.loadTags();
  },

  async loadTags() {
    this.setData({ loading: true, error: "" });
    try {
      const tags = await request<string[]>("/wallpapers/tags");
      this.setData({ tags });
    } catch (error) {
      const message = error instanceof Error ? error.message : "分类加载失败";
      this.setData({ error: message });
      wx.showToast({ title: "分类加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  retry() {
    this.loadTags();
  },

  openTag(event: WechatMiniprogram.TouchEvent) {
    const tag = event.currentTarget.dataset.tag;
    wx.navigateTo({ url: `/pages/index/index?tag=${encodeURIComponent(tag)}` });
  },

  openType(event: WechatMiniprogram.TouchEvent) {
    const type = event.currentTarget.dataset.type;
    wx.navigateTo({ url: `/pages/index/index?type=${encodeURIComponent(type)}` });
  }
});
