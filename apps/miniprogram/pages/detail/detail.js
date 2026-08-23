"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const HISTORY_KEY = "wallpaper_download_history";
Page({
    data: {
        item: null,
        primaryLink: null,
        primaryUrl: "",
        primaryPasscode: "",
        sizeText: "",
        typeText: "",
        loading: true,
        error: "",
        id: ""
    },
    async onLoad(options) {
        if (!options.id) {
            this.setData({ loading: false, error: "没有找到壁纸，请返回首页重新打开" });
            return;
        }
        this.setData({ id: options.id });
        this.loadDetail(options.id);
    },
    onUnload() {
        wx.setNavigationBarTitle({ title: "壁纸详情" });
    },
    async loadDetail(id) {
        const targetId = id || this.data.id;
        if (!targetId)
            return;
        this.setData({ loading: true, error: "" });
        try {
            const item = await (0, api_1.request)(`/wallpapers/${targetId}`);
            this.setData({
                item,
                primaryLink: item.shortLinks[0] || null,
                primaryUrl: item.shortLinks[0]?.url || "",
                primaryPasscode: item.shortLinks[0]?.passcode || "",
                sizeText: formatBytes(item.fileSize),
                typeText: formatType(item.type)
            });
            wx.setNavigationBarTitle({ title: item.title.slice(0, 12) || "壁纸详情" });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "详情加载失败";
            this.setData({ error: message });
            wx.showToast({ title: "详情加载失败", icon: "none" });
        }
        finally {
            this.setData({ loading: false });
        }
    },
    retry() {
        if (!this.data.id) {
            this.goHome();
            return;
        }
        this.loadDetail();
    },
    goHome() {
        wx.switchTab({ url: "/pages/index/index" });
    },
    copyLink(event) {
        const url = String(event.currentTarget.dataset.url || "");
        const label = String(event.currentTarget.dataset.label || "下载短链");
        const passcode = String(event.currentTarget.dataset.passcode || "");
        this.copyShortLink(url, label, passcode);
    },
    copyPrimaryLink() {
        if (!this.data.primaryLink) {
            wx.showToast({ title: "暂无短链", icon: "none" });
            return;
        }
        this.copyShortLink(this.data.primaryLink.url, this.data.primaryLink.label, this.data.primaryLink.passcode);
    },
    copyShortLink(url, label, passcode) {
        if (!url)
            return;
        wx.setClipboardData({
            data: formatClipboardText(url, passcode),
            success: () => {
                saveHistory(this.data.item, url, label, passcode);
                recordDownloadClick(this.data.item?.id);
                wx.showToast({ title: passcode ? "短链和提取码已复制" : "短链已复制", icon: "success" });
            }
        });
    },
    openRelated(event) {
        const id = String(event.currentTarget.dataset.id || "");
        if (!id || id === this.data.id)
            return;
        this.setData({ id, item: null, primaryLink: null, primaryUrl: "", primaryPasscode: "", sizeText: "", typeText: "" });
        this.loadDetail(id);
    },
    onShareAppMessage() {
        const item = this.data.item;
        return {
            title: item ? `${item.title}｜WDBZK壁纸库` : "WDBZK壁纸库",
            path: item ? `/pages/detail/detail?id=${item.id}` : "/pages/index/index",
            imageUrl: item?.coverUrl || ""
        };
    },
    onShareTimeline() {
        const item = this.data.item;
        return {
            title: item ? `${item.title}｜WDBZK壁纸库` : "WDBZK壁纸库",
            query: item ? `id=${item.id}` : "",
            imageUrl: item?.coverUrl || ""
        };
    }
});
function saveHistory(item, url, label, passcode) {
    if (!item || !url)
        return;
    const previous = readHistory();
    const next = [
        {
            id: item.id,
            title: item.title,
            coverUrl: item.coverUrl,
            label,
            url,
            passcode,
            copiedAt: Date.now()
        },
        ...previous.filter((record) => record.url !== url)
    ].slice(0, 20);
    wx.setStorageSync(HISTORY_KEY, next);
}
function readHistory() {
    const value = wx.getStorageSync(HISTORY_KEY);
    return Array.isArray(value) ? value : [];
}
function formatClipboardText(url, passcode) {
    return passcode ? `链接：${url}\n提取码：${passcode}` : url;
}
function recordDownloadClick(id) {
    if (!id)
        return;
    (0, api_1.post)(`/wallpapers/${id}/click`).catch(() => undefined);
}
function formatBytes(value) {
    if (!value)
        return "原图资源";
    if (value >= 1024 * 1024 * 1024)
        return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (value >= 1024 * 1024)
        return `${(value / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.ceil(value / 1024)} KB`;
}
function formatType(value) {
    const map = {
        live: "动态壁纸",
        static: "静态壁纸",
        mobile: "手机壁纸",
        desktop: "电脑壁纸",
        other: "壁纸资源"
    };
    return map[value] || "壁纸资源";
}
