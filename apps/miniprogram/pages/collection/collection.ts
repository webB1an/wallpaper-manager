import { request, WallpaperCard } from "../../utils/api";
interface CollectionDetail { id: string; title: string; intro: string; createdAt: string; items: Array<WallpaperCard & { number: number }> }
Page({
  data: { id: "", title: "", intro: "", dateLabel: "", items: [] as CollectionDetail["items"], loading: true, error: "" },
  onLoad(options: { id?: string }) { this.setData({ id: options.id || "" }); void this.load(); },
  async load() {
    if (!this.data.id) { this.setData({ error: "合集编号缺失", loading: false }); return; }
    this.setData({ loading: true, error: "" });
    try {
      const result = await request<CollectionDetail>(`/wallpaper-collections/${encodeURIComponent(this.data.id)}`);
      this.setData({ title: result.title, intro: result.intro, dateLabel: result.createdAt.slice(0, 10).replace(/-/g, "."), items: result.items });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : "合集加载失败" }); }
    finally { this.setData({ loading: false }); }
  },
  retry() { void this.load(); },
  openDetail(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/detail/detail?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
  onShareAppMessage() { return { title: this.data.title || "漫元壁纸 · 公众号合集", path: `/pages/collection/collection?id=${encodeURIComponent(this.data.id)}`, imageUrl: this.data.items[0]?.coverUrl || undefined }; },
});
