"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
Page({
    data: { items: [], total: 0, page: 1, loading: false, error: "", requestSerial: 0 },
    onLoad() { void this.load(); },
    onUnload() { this.setData({ requestSerial: this.data.requestSerial + 1 }); },
    onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
    onReachBottom() { if (!this.data.loading && !this.data.error && this.data.items.length < this.data.total)
        void this.load(true); },
    async load(append = false) {
        if (append && this.data.loading)
            return;
        const page = append ? this.data.page + 1 : 1;
        const serial = this.data.requestSerial + 1;
        this.setData({ loading: true, error: "", requestSerial: serial });
        try {
            const result = await (0, api_1.request)("/wallpaper-collections", { page });
            if (serial !== this.data.requestSerial)
                return;
            const items = result.list.map((item) => ({ ...item, dateLabel: item.createdAt.slice(0, 10).replace(/-/g, ".") }));
            this.setData({ items: append ? [...this.data.items, ...items] : items, total: result.total, page });
        }
        catch (error) {
            if (serial === this.data.requestSerial)
                this.setData({ error: error instanceof Error ? error.message : "合集加载失败" });
        }
        finally {
            if (serial === this.data.requestSerial)
                this.setData({ loading: false });
        }
    },
    retry() { void this.load(this.data.items.length > 0); },
    openCollection(event) { wx.navigateTo({ url: `/pages/collection/collection?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); },
    onShareAppMessage() { return { title: "漫元壁纸 · 公众号合集", path: "/pages/collections/collections" }; },
});
