"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
let requestToken = 0;
Page({
    data: {
        types: [
            { key: "live", title: "动态壁纸", subtitle: "视频与动态资源", icon: "dynamic", count: 0 },
            { key: "static", title: "静态壁纸", subtitle: "单张图片资源", icon: "static", count: 0 }
        ],
        orientations: [
            { key: "portrait", title: "手机壁纸", subtitle: "竖屏适配", icon: "📱", count: 0 },
            { key: "landscape", title: "电脑壁纸", subtitle: "横屏适配", icon: "🖥️", count: 0 },
            { key: "square", title: "方图", subtitle: "正方形适配", icon: "⬜", count: 0 },
        ],
        tags: [],
        leftTags: [],
        rightTags: [],
        loading: false,
        error: "",
        backTopVisible: false
    },
    onPageScroll(event) {
        const visible = event.scrollTop > 600;
        if (visible !== this.data.backTopVisible) {
            this.setData({ backTopVisible: visible });
        }
    },
    backTop() {
        wx.pageScrollTo({ scrollTop: 0, duration: 300 });
    },
    async onLoad() {
        this.loadFacets();
    },
    onPullDownRefresh() {
        this.loadFacets().finally(() => wx.stopPullDownRefresh());
    },
    async loadFacets() {
        const token = ++requestToken;
        this.setData({ loading: true, error: "" });
        try {
            const facets = await (0, api_1.request)("/wallpapers/facets");
            if (token !== requestToken)
                return;
            const countByType = new Map(facets.types.map((item) => [item.type, item.count]));
            const countByOrientation = new Map(facets.orientations.map((item) => [item.orientation, item.count]));
            this.setData({
                types: this.data.types.map((item) => ({ ...item, count: countByType.get(item.key) || 0 })),
                orientations: this.data.orientations.map((item) => ({ ...item, count: countByOrientation.get(item.key) || 0 })),
                tags: facets.tags,
                ...splitMasonry(facets.tags),
            });
        }
        catch (error) {
            if (token !== requestToken)
                return;
            const message = error instanceof Error ? error.message : "标签加载失败";
            this.setData({ error: message });
            wx.showToast({ title: "标签加载失败", icon: "none" });
        }
        finally {
            if (token === requestToken)
                this.setData({ loading: false });
        }
    },
    retry() {
        this.loadFacets();
    },
    openTag(event) {
        const tag = String(event.currentTarget.dataset.tag || "");
        openList(`tag=${encodeURIComponent(tag)}&title=${encodeURIComponent(`#${tag}`)}`);
    },
    openType(event) {
        const type = String(event.currentTarget.dataset.type || "");
        const title = this.data.types.find((item) => item.key === type)?.title || "壁纸列表";
        openList(`type=${encodeURIComponent(type)}&title=${encodeURIComponent(title)}`);
    },
    openOrientation(event) {
        const orientation = String(event.currentTarget.dataset.orientation || "");
        const title = this.data.orientations.find((item) => item.key === orientation)?.title || "设备方向";
        openList(`orientation=${encodeURIComponent(orientation)}&title=${encodeURIComponent(title)}`);
    },
    onShareAppMessage() {
        return {
            title: "按风格探索壁纸｜WDBZK",
            path: "/pages/category/category"
        };
    },
    onShareTimeline() {
        return {
            title: "按风格探索壁纸｜WDBZK"
        };
    }
});
function openList(query) {
    wx.navigateTo({ url: `/pages/list/list?${query}` });
}
function splitMasonry(items) {
    const leftTags = [];
    const rightTags = [];
    items.forEach((item, index) => {
        if (index % 2 === 0)
            leftTags.push(item);
        else
            rightTags.push(item);
    });
    return { leftTags, rightTags };
}
