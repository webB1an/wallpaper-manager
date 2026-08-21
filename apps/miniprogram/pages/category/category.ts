import { request } from "../../utils/api";

Page({
  data: {
    tags: [] as string[]
  },

  async onLoad() {
    const tags = await request<string[]>("/wallpapers/tags");
    this.setData({ tags });
  },

  openTag(event: WechatMiniprogram.TouchEvent) {
    const tag = event.currentTarget.dataset.tag;
    wx.navigateTo({ url: `/pages/index/index?tag=${encodeURIComponent(tag)}` });
  }
});
