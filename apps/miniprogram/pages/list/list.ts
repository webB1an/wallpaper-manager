import { request, WallpaperCard } from "../../utils/api";

let requestToken = 0;

Page({
  data: {
    title: "壁纸列表",
    subtitle: "",
    tag: "",
    type: "",
    items: [] as WallpaperCard[],
    leftItems: [] as WallpaperCard[],
    rightItems: [] as WallpaperCard[],
    total: 0,
    page: 1,
    loading: false,
    error: ""
  },

  onLoad(options?: { tag?: string; type?: string; title?: string }) {
    const tag = decodeOption(options?.tag);
    const type = decodeOption(options?.type);
    const title = decodeOption(options?.title) || (tag ? `#${tag}` : formatTypeTitle(type));
    this.setData({
      tag,
      type,
      title,
      subtitle: tag ? "标签下的全部壁纸" : "类型下的全部壁纸"
    });
    wx.setNavigationBarTitle({ title });
    this.load();
  },

  onPullDownRefresh() {
    this.setData({ page: 1, items: [], leftItems: [], rightItems: [] });
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.loading && this.data.items.length < this.data.total) {
      this.setData({ page: this.data.page + 1 });
      this.load(true);
    }
  },

  async load(append = false) {
    const token = ++requestToken;
    this.setData({ loading: true, error: "" });
    try {
      const data = await request<{ list: WallpaperCard[]; total: number }>("/wallpapers", {
        page: this.data.page,
        pageSize: 20,
        tag: this.data.tag,
        type: this.data.type,
        sort: "hot"
      });
      if (token !== requestToken) return;
      const list = data.list.map(decorateCard);
      const nextItems = append ? [...this.data.items, ...list] : list;
      this.setData({
        items: nextItems,
        total: data.total,
        ...splitMasonry(nextItems)
      });
    } catch (error) {
      if (token !== requestToken) return;
      const message = error instanceof Error ? error.message : "加载失败";
      this.setData({ error: message });
      wx.showToast({ title: "加载失败", icon: "none" });
    } finally {
      if (token === requestToken) this.setData({ loading: false });
    }
  },

  retry() {
    this.setData({ page: 1, items: [], leftItems: [], rightItems: [] });
    this.load();
  },

  openDetail(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
  },

  onShareAppMessage() {
    return {
      title: `${this.data.title}｜WDBZK壁纸库`,
      path: sharePath(this.data.tag, this.data.type, this.data.title)
    };
  },

  onShareTimeline() {
    return {
      title: `${this.data.title}｜WDBZK壁纸库`,
      query: shareQuery(this.data.tag, this.data.type, this.data.title)
    };
  }
});

function decorateCard(item: WallpaperCard): WallpaperCard {
  return { ...item, typeLabel: formatTypeLabel(item.type) };
}

function splitMasonry(items: WallpaperCard[]) {
  const leftItems: WallpaperCard[] = [];
  const rightItems: WallpaperCard[] = [];
  items.forEach((item, index) => {
    if (index % 2 === 0) leftItems.push(item);
    else rightItems.push(item);
  });
  return { leftItems, rightItems };
}

function decodeOption(value?: string) {
  return value ? decodeURIComponent(value) : "";
}

function formatTypeTitle(value: string) {
  if (value === "live") return "动态壁纸";
  if (value === "static") return "静态壁纸";
  return "壁纸列表";
}

function formatTypeLabel(value: string) {
  return value === "live" ? "动态" : "静态";
}

function sharePath(tag: string, type: string, title: string) {
  const query = shareQuery(tag, type, title);
  return query ? `/pages/list/list?${query}` : "/pages/list/list";
}

function shareQuery(tag: string, type: string, title: string) {
  const query: string[] = [];
  if (tag) query.push(`tag=${encodeURIComponent(tag)}`);
  if (type) query.push(`type=${encodeURIComponent(type)}`);
  if (title) query.push(`title=${encodeURIComponent(title)}`);
  return query.join("&");
}
