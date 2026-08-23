"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
Page({
    data: {
        items: [],
        topCovers: [],
        total: 0,
        page: 1,
        keyword: "",
        tag: "",
        type: "",
        sort: "latest",
        loading: false,
        error: ""
    },
    onLoad(options) {
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
    onKeywordInput(event) {
        this.setData({ keyword: event.detail.value });
    },
    reload() {
        this.setData({ page: 1, items: [] });
        this.load();
    },
    switchSort(event) {
        this.setData({ sort: event.currentTarget.dataset.sort || "latest", page: 1, items: [] });
        this.load();
    },
    switchType(event) {
        this.setData({ type: event.currentTarget.dataset.type || "", page: 1, items: [] });
        this.load();
    },
    async load(append = false) {
        this.setData({ loading: true, error: "" });
        try {
            const data = await (0, api_1.request)("/wallpapers", {
                page: this.data.page,
                pageSize: 20,
                keyword: this.data.keyword,
                tag: this.data.tag,
                type: this.data.type,
                sort: this.data.sort === "hot" ? "hot" : ""
            });
            this.setData({
                items: append ? [...this.data.items, ...data.list] : data.list,
                topCovers: append ? this.data.topCovers : data.list.slice(0, 3),
                total: data.total
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "加载失败";
            this.setData({ error: message });
            wx.showToast({ title: "加载失败", icon: "none" });
        }
        finally {
            this.setData({ loading: false });
        }
    },
    retry() {
        this.setData({ page: 1, items: [] });
        this.load();
    },
    openDetail(event) {
        wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
    },
    onShareAppMessage() {
        return {
            title: shareTitle(this.data.tag, this.data.type),
            path: sharePath(this.data.tag, this.data.type)
        };
    },
    onShareTimeline() {
        const query = shareQuery(this.data.tag, this.data.type);
        return {
            title: shareTitle(this.data.tag, this.data.type),
            query
        };
    }
});
function formatTypeTitle(value) {
    const map = {
        live: "动态壁纸",
        static: "静态壁纸",
        mobile: "手机壁纸",
        desktop: "电脑壁纸"
    };
    return map[value] || "壁纸库";
}
function shareTitle(tag, type) {
    if (tag)
        return `#${tag} 壁纸合集｜WDBZK`;
    if (type)
        return `${formatTypeTitle(type)}｜WDBZK`;
    return "今日灵感墙｜WDBZK壁纸库";
}
function sharePath(tag, type) {
    const query = shareQuery(tag, type);
    return query ? `/pages/index/index?${query}` : "/pages/index/index";
}
function shareQuery(tag, type) {
    const query = [];
    if (tag)
        query.push(`tag=${encodeURIComponent(tag)}`);
    if (type)
        query.push(`type=${encodeURIComponent(type)}`);
    return query.join("&");
}
