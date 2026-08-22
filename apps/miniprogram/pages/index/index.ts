import { request, WallpaperCard } from "../../utils/api";

Page({
  data: {
    items: [] as WallpaperCard[],
    total: 0,
    page: 1,
    keyword: "",
    tag: "",
    type: "",
    sort: "latest",
    loading: false
  },

  onLoad(options?: { tag?: string; type?: string }) {
    if (options?.tag) {
      this.setData({ tag: decodeURIComponent(options.tag) });
      wx.setNavigationBarTitle({ title: `#${decodeURIComponent(options.tag)}` });
    }
    if (options?.type) {
      const type = decodeURIComponent(options.type);
      this.setData({ type });
      wx.setNavigationBarTitle({ title: formatTypeTitle(type) });
    }
    this.load();
  },

  onPullDownRefresh() {
    this.setData({ page: 1, items: [] });
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.loading && this.data.items.length < this.data.total) {
      this.setData({ page: this.data.page + 1 });
      this.load(true);
    }
  },

  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value });
  },

  reload() {
    this.setData({ page: 1, items: [] });
    this.load();
  },

  switchSort(event: WechatMiniprogram.TouchEvent) {
    this.setData({ sort: event.currentTarget.dataset.sort || "latest", page: 1, items: [] });
    this.load();
  },

  switchType(event: WechatMiniprogram.TouchEvent) {
    this.setData({ type: event.currentTarget.dataset.type || "", page: 1, items: [] });
    this.load();
  },

  async load(append = false) {
    this.setData({ loading: true });
    try {
      const data = await request<{ list: WallpaperCard[]; total: number }>("/wallpapers", {
        page: this.data.page,
        pageSize: 20,
        keyword: this.data.keyword,
        tag: this.data.tag,
        type: this.data.type,
        sort: this.data.sort === "hot" ? "hot" : ""
      });
      this.setData({
        items: append ? [...this.data.items, ...data.list] : data.list,
        total: data.total
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  }
});

function formatTypeTitle(value: string) {
  const map: Record<string, string> = {
    live: "动态壁纸",
    static: "静态壁纸",
    mobile: "手机壁纸",
    desktop: "电脑壁纸"
  };
  return map[value] || "壁纸库";
}
