import { request } from "../../utils/api";

type TagItem = { name: string; count: number };

Page({
  data: {
    tags: [] as TagItem[],
    keyword: "",
    page: 1,
    pageSize: 40,
    total: 0,
    loading: false,
    error: "",
  },

  onLoad() {
    this.reload();
  },

  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value });
  },

  reload() {
    this.setData({ page: 1, tags: [] });
    void this.load();
  },

  loadMore() {
    if (this.data.loading) return;
    this.setData({ page: this.data.page + 1 });
    void this.load();
  },

  async load() {
    if (this.data.loading) return;
    const { page, pageSize, keyword } = this.data;
    this.setData({ loading: true, error: "" });
    try {
      const data = await request<{ list: TagItem[]; total: number }>("/wallpapers/tags/list", { page, pageSize, keyword });
      this.setData({
        tags: page === 1 ? data.list : [...this.data.tags, ...data.list],
        total: data.total,
      });
    } catch (error) {
      this.setData({ error: error instanceof Error ? error.message : "加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  openTag(event: WechatMiniprogram.TouchEvent) {
    const tag = String(event.currentTarget.dataset.tag || "");
    wx.navigateTo({ url: `/pages/list/list?tag=${encodeURIComponent(tag)}&title=${encodeURIComponent(`#${tag}`)}` });
  }
});
