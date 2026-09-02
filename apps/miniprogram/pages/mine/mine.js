"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const reward_1 = require("../../utils/reward");
const local_history_1 = require("../../utils/local-history");
const payment_1 = require("../../utils/payment");
const HISTORY_KEY = "wallpaper_download_history";
Page({
    data: {
        records: [],
        downloads: [],
        favorites: [],
        quotaText: "",
        userOpenid: "",
        isAdmin: false,
        hasPermanentRequestAccess: false
    },
    onShow() {
        this.setData({
            records: readHistory().map((record) => ({ ...record, copiedAtText: formatTime(record.copiedAt) })),
            downloads: (0, local_history_1.readDownloadHistory)().map((record) => ({ ...record, atText: formatTime(record.at) })),
            favorites: (0, local_history_1.readFavorites)().map((record) => ({ ...record, atText: formatTime(record.at) }))
        });
        void this.syncFromServer();
        void this.loadOpenid();
        void this.loadAdminStatus();
        void this.loadMemberAccess();
    },
    async loadMemberAccess() {
        try {
            const catalog = await (0, payment_1.getPaymentCatalog)();
            this.setData({ hasPermanentRequestAccess: Boolean(catalog.entitlement?.permanent) });
        }
        catch {
            this.setData({ hasPermanentRequestAccess: false });
        }
    },
    goMemberRequest() {
        wx.navigateTo({ url: "/pages/request/request" });
    },
    async loadAdminStatus() {
        try {
            await (0, reward_1.ensureOpenid)();
            const status = await (0, api_1.request)("/user/status");
            if (status?.isAdmin)
                this.setData({ isAdmin: true });
        }
        catch {
            // 非管理员不展示。
        }
    },
    goUpload() {
        wx.navigateTo({
            url: "/pages/upload/upload",
            fail: () => wx.showToast({ title: "无法打开上传页，请重新编译", icon: "none" }),
        });
    },
    async loadOpenid() {
        try {
            const openid = await (0, reward_1.ensureOpenid)();
            this.setData({ userOpenid: openid });
        }
        catch {
            // 未登录时留空。
        }
    },
    copyOpenid() {
        const openid = this.data.userOpenid;
        if (!openid) {
            wx.showToast({ title: "暂无用户 ID", icon: "none" });
            return;
        }
        wx.setClipboardData({
            data: openid,
            success: () => wx.showToast({ title: "已复制用户 ID", icon: "success" })
        });
    },
    async loadQuota() {
        try {
            const reward = await (0, reward_1.getRewardStatus)();
            let text;
            if (reward.rewarded && reward.type === "unlimited")
                text = "已解锁今日不限次数下载";
            else if (reward.rewarded && reward.remaining > 0)
                text = `今日剩余 ${reward.remaining} 次下载`;
            else
                text = "今日暂无免费次数，观看视频即可解锁";
            this.setData({ quotaText: text });
        }
        catch {
            this.setData({ quotaText: "今日额度获取失败，请稍后重试" });
        }
    },
    async syncFromServer() {
        try {
            await (0, reward_1.ensureOpenid)();
            const [favorites, downloads] = await Promise.all([
                (0, api_1.request)("/user/favorites"),
                (0, api_1.request)("/user/downloads"),
            ]);
            const favList = favorites.map((record) => ({ id: record.wallpaperId, title: record.wallpaper.title, coverUrl: record.wallpaper.coverUrl, at: toTimestamp(record.createdAt) }));
            const dlList = downloads.map((record) => ({ id: record.wallpaperId, title: record.wallpaper.title, coverUrl: record.wallpaper.coverUrl, at: toTimestamp(record.createdAt) }));
            (0, local_history_1.replaceFavorites)(favList);
            (0, local_history_1.replaceDownloads)(dlList);
            this.setData({
                favorites: favList.map((record) => ({ ...record, atText: formatTime(record.at) })),
                downloads: dlList.map((record) => ({ ...record, atText: formatTime(record.at) }))
            });
        }
        catch {
            // 保留本地缓存。
        }
    },
    clearDownloads() {
        wx.removeStorageSync("wallpaper_downloaded_history");
        this.setData({ downloads: [] });
        wx.showToast({ title: "已清空", icon: "success" });
    },
    clearFavorites() {
        wx.removeStorageSync("wallpaper_favorite_list");
        this.setData({ favorites: [] });
        wx.showToast({ title: "已清空", icon: "success" });
    },
    copyLink(event) {
        const url = String(event.currentTarget.dataset.url || "");
        const passcode = String(event.currentTarget.dataset.passcode || "");
        if (!url) {
            wx.showToast({ title: "暂无短链", icon: "none" });
            return;
        }
        wx.setClipboardData({
            data: formatClipboardText(url, passcode),
            success: () => wx.showToast({ title: passcode ? "短链和提取码已复制" : "短链已复制", icon: "success" })
        });
    },
    clearHistory() {
        wx.showModal({
            title: "清空复制记录",
            content: "确认清空最近复制的短链记录？",
            confirmText: "清空",
            confirmColor: "#d85a3a",
            success: (result) => {
                if (!result.confirm)
                    return;
                wx.removeStorageSync(HISTORY_KEY);
                this.setData({ records: [] });
                wx.showToast({ title: "已清空", icon: "success" });
            }
        });
    },
    goExplore() {
        wx.switchTab({ url: "/pages/index/index" });
    },
    openDetail(event) {
        const id = String(event.currentTarget.dataset.id || "");
        if (!id)
            return;
        wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
    }
});
function readHistory() {
    const value = wx.getStorageSync(HISTORY_KEY);
    return Array.isArray(value) ? value : [];
}
function formatTime(value) {
    if (!value)
        return "刚刚";
    const diff = Date.now() - value;
    if (diff < 60000)
        return "刚刚";
    if (diff < 60 * 60000)
        return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 24 * 60 * 60000)
        return `${Math.floor(diff / 60 / 60000)} 小时前`;
    const date = new Date(value);
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${month}-${day}`;
}
function formatClipboardText(url, passcode) {
    return passcode ? `链接：${url}\n提取码：${passcode}` : url;
}
function toTimestamp(value) {
    if (typeof value === "number")
        return value;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : Date.now();
}
