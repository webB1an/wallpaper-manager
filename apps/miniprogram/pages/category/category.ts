import { request } from "../../utils/api";

Page({
  data: {
    types: [
      { key: "live", title: "动态壁纸", subtitle: "视频与动态资源" },
      { key: "static", title: "静态壁纸", subtitle: "单张高清图片" },
      { key: "mobile", title: "手机壁纸", subtitle: "竖屏优先" },
      { key: "desktop", title: "电脑壁纸", subtitle: "桌面场景" }
    ],
    tags: [] as string[]
  },

  async onLoad() {
    const tags = await request<string[]>("/wallpapers/tags");
    this.setData({ tags });
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
