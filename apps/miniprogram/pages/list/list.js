"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const ads_1 = require("../../utils/ads");
let requestToken = 0;
Page({
    data: {
        title: "壁纸列表",
        subtitle: "",
        tag: "",
        type: "",
        orientation: "",
        items: [],
        leftItems: [],
        rightItems: [],
        total: 0,
        page: 1,
        loading: false,
        error: "",
        backTopVisible: false,
        adUnit: ads_1.AD_UNITS.listBanner
    },
    onAdError() {
        // 广告加载失败时静默隐藏。
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
    onLoad(options) {
        const tag = decodeOption(options?.tag);
        const type = decodeOption(options?.type);
        const orientation = decodeOption(options?.orientation);
        const title = decodeOption(options?.title) || (tag ? `#${tag}` : orientation ? formatOrientationTitle(orientation) : formatTypeTitle(type));
        this.setData({
            tag,
            type,
            orientation,
            title,
            subtitle: tag ? "标签下的全部壁纸" : orientation ? `${formatOrientationTitle(orientation)}下的全部壁纸` : "类型下的全部壁纸"
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
            const data = await (0, api_1.request)("/wallpapers", {
                page: this.data.page,
                pageSize: 20,
                tag: this.data.tag,
                type: this.data.type,
                orientation: this.data.orientation,
                sort: "hot"
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
    retry() {
        this.setData({ page: 1, items: [], leftItems: [], rightItems: [] });
        this.load();
    },
    openDetail(event) {
        wx.navigateTo({ url: `/pages/detail/detail?id=${event.currentTarget.dataset.id}` });
    },
    onShareAppMessage() {
        return {
            title: `${this.data.title}｜漫元壁纸`,
            path: sharePath(this.data.tag, this.data.type, this.data.orientation, this.data.title)
        };
    },
    onShareTimeline() {
        return {
            title: `${this.data.title}｜漫元壁纸`,
            query: shareQuery(this.data.tag, this.data.type, this.data.orientation, this.data.title)
        };
    }
});
function decorateCard(item) {
    return { ...item, typeLabel: formatTypeLabel(item.type), orientationLabel: formatOrientationLabel(item.orientation) };
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
function decodeOption(value) {
    return value ? decodeURIComponent(value) : "";
}
function formatTypeTitle(value) {
    if (value === "live")
        return "动态壁纸";
    if (value === "static")
        return "静态壁纸";
    return "壁纸列表";
}
function formatOrientationTitle(value) {
    if (value === "portrait")
        return "手机壁纸";
    if (value === "landscape")
        return "电脑壁纸";
    if (value === "square")
        return "方图";
    return "设备方向";
}
function formatTypeLabel(value) {
    return value === "live" ? "动态" : "静态";
}
function formatOrientationLabel(value) {
    if (value === "portrait")
        return "手机";
    if (value === "landscape")
        return "电脑";
    return "";
}
function sharePath(tag, type, orientation, title) {
    const query = shareQuery(tag, type, orientation, title);
    return query ? `/pages/list/list?${query}` : "/pages/list/list";
}
function shareQuery(tag, type, orientation, title) {
    const query = [];
    if (tag)
        query.push(`tag=${encodeURIComponent(tag)}`);
    if (type)
        query.push(`type=${encodeURIComponent(type)}`);
    if (orientation)
        query.push(`orientation=${encodeURIComponent(orientation)}`);
    if (title)
        query.push(`title=${encodeURIComponent(title)}`);
    return query.join("&");
}
