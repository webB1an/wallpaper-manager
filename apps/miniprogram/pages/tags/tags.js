"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
Page({
    data: {
        tags: [],
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
    onKeywordInput(event) {
        this.setData({ keyword: event.detail.value });
    },
    reload() {
        this.setData({ page: 1, tags: [] });
        void this.load();
    },
    loadMore() {
        if (this.data.loading)
            return;
        this.setData({ page: this.data.page + 1 });
        void this.load();
    },
    async load() {
        if (this.data.loading)
            return;
        const { page, pageSize, keyword } = this.data;
        this.setData({ loading: true, error: "" });
        try {
            const data = await (0, api_1.request)("/wallpapers/tags/list", { page, pageSize, keyword });
            this.setData({
                tags: page === 1 ? data.list : [...this.data.tags, ...data.list],
                total: data.total,
            });
        }
        catch (error) {
            this.setData({ error: error instanceof Error ? error.message : "加载失败" });
        }
        finally {
            this.setData({ loading: false });
        }
    },
    openTag(event) {
        const tag = String(event.currentTarget.dataset.tag || "");
        wx.navigateTo({ url: `/pages/list/list?tag=${encodeURIComponent(tag)}&title=${encodeURIComponent(`#${tag}`)}` });
    }
});
