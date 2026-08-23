"use strict";
const HISTORY_KEY = "wallpaper_download_history";
Page({
    data: {
        records: []
    },
    onShow() {
        this.setData({ records: readHistory().map((record) => ({ ...record, copiedAtText: formatTime(record.copiedAt) })) });
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
