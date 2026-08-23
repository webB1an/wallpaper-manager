"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
let requestToken = 0;
Page({
    data: {
        items: [],
        leftItems: [],
        rightItems: [],
        heroSlides: [],
        total: 0,
        page: 1,
        keyword: "",
        tag: "",
        sort: "latest",
        loading: false,
        error: ""
    },
    onLoad(options) {
        if (options?.tag) {
            this.setData({ tag: decodeURIComponent(options.tag) });
            wx.setNavigationBarTitle({ title: `#${decodeURIComponent(options.tag)}` });
        }
        this.loadHero();
        this.load();
    },
    onPullDownRefresh() {
        this.setData({ page: 1, items: [], leftItems: [], rightItems: [] });
        Promise.all([this.loadHero(), this.load()]).finally(() => wx.stopPullDownRefresh());
    },
    onReachBottom() {
        if (!this.data.loading && this.data.items.length < this.data.total) {
            this.setData({ page: this.data.page + 1 });
            this.load(true);
        }
    },
    onKeywordInput(event) {
        this.setData({ keyword: event.detail.value });
    },
    reload() {
        this.setData({ page: 1, items: [], leftItems: [], rightItems: [] });
        this.load();
    },
    switchSort(event) {
        this.setData({ sort: event.currentTarget.dataset.sort || "latest", page: 1, items: [], leftItems: [], rightItems: [] });
        this.load();
    },
    async load(append = false) {
        const token = ++requestToken;
        this.setData({ loading: true, error: "" });
        try {
            const data = await (0, api_1.request)("/wallpapers", {
                page: this.data.page,
                pageSize: 20,
                keyword: this.data.keyword,
                tag: this.data.tag,
                sort: this.data.sort === "hot" ? "hot" : ""
            });
            if (token !== requestToken)
                return;
            const list = data.list.map(decorateCard);
            const nextItems = append ? [...this.data.items, ...list] : list;
            this.setData({
                items: nextItems,
                total: data.total,
                ...splitMasonry(nextItems)
            });
        }
        catch (error) {
            if (token !== requestToken)
                return;
            const message = error instanceof Error ? error.message : "加载失败";
            this.setData({ error: message });
            wx.showToast({ title: "加载失败", icon: "none" });
        }
        finally {
            if (token === requestToken)
                this.setData({ loading: false });
        }
    },
    async loadHero() {
        try {
            const data = await (0, api_1.request)("/wallpapers", {
                page: 1,
                pageSize: 5,
                sort: "hot"
            });
            this.setData({ heroSlides: data.list.map(decorateCard) });
        }
        catch {
            // 首页主列表仍然可用时，不因为轮播失败打断用户。
        }
    },
    retry() {
        this.setData({ page: 1, items: [], leftItems: [], rightItems: [] });
        this.load();
    },
    openDetail(event) {
        wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
    },
    onShareAppMessage() {
        return {
            title: shareTitle(this.data.tag),
            path: sharePath(this.data.tag)
        };
    },
    onShareTimeline() {
        const query = shareQuery(this.data.tag);
        return {
            title: shareTitle(this.data.tag),
            query
        };
    }
});
function decorateCard(item) {
    return { ...item, typeLabel: formatTypeLabel(item.type) };
}
function splitMasonry(items) {
    const leftItems = [];
    const rightItems = [];
    items.forEach((item, index) => {
        if (index % 2 === 0)
            leftItems.push(item);
        else
            rightItems.push(item);
    });
    return { leftItems, rightItems };
}
function formatTypeLabel(value) {
    return value === "live" ? "动态" : "静态";
}
function shareTitle(tag) {
    if (tag)
        return `#${tag} 壁纸合集｜WDBZK`;
    return "今日灵感墙｜WDBZK壁纸库";
}
function sharePath(tag) {
    const query = shareQuery(tag);
    return query ? `/pages/index/index?${query}` : "/pages/index/index";
}
function shareQuery(tag) {
    const query = [];
    if (tag)
        query.push(`tag=${encodeURIComponent(tag)}`);
    return query.join("&");
}
