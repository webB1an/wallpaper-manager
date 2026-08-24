"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const ads_1 = require("../../utils/ads");
const HISTORY_KEY = "wallpaper_download_history";
let requestToken = 0;
Page({
    data: {
        item: null,
        primaryLink: null,
        primaryUrl: "",
        primaryPasscode: "",
        sizeText: "",
        typeText: "",
        orientationText: "",
        loading: true,
        error: "",
        id: "",
        capsuleTop: 48,
        capsuleHeight: 32,
        adUnit: ads_1.AD_UNITS.detailBanner
    },
    onAdError() {
        // 广告加载失败时静默隐藏。
    },
    async onLoad(options) {
        const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
        if (menu) {
            this.setData({ capsuleTop: menu.top, capsuleHeight: menu.height });
        }
        if (ads_1.AD_UNITS.interstitial) {
            const interstitial = wx.createInterstitialAd({ adUnitId: ads_1.AD_UNITS.interstitial });
            interstitial.onError(() => undefined);
            interstitial.onLoad(() => interstitial.show());
        }
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
        const token = ++requestToken;
        this.setData({ loading: true, error: "" });
        try {
            const item = await (0, api_1.request)(`/wallpapers/${targetId}`);
            if (token !== requestToken)
                return;
            this.setData({
                item,
                primaryLink: item.shortLinks[0] || null,
                primaryUrl: item.shortLinks[0]?.url || "",
                primaryPasscode: item.shortLinks[0]?.passcode || "",
                sizeText: formatBytes(item.fileSize),
                typeText: formatType(item.type),
                orientationText: formatOrientation(item.orientation)
            });
            wx.setNavigationBarTitle({ title: item.title.slice(0, 12) || "壁纸详情" });
        }
        catch (error) {
            if (token !== requestToken)
                return;
            const message = error instanceof Error ? error.message : "详情加载失败";
            this.setData({ error: message });
            wx.showToast({ title: "详情加载失败", icon: "none" });
        }
        finally {
            if (token === requestToken)
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
    goBack() {
        const pages = getCurrentPages();
        if (pages.length > 1) {
            wx.navigateBack();
        }
        else {
            wx.switchTab({ url: "/pages/index/index" });
        }
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
        if (!url) {
            wx.showToast({ title: "暂无短链", icon: "none" });
            return;
        }
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
        this.setData({ id, item: null, primaryLink: null, primaryUrl: "", primaryPasscode: "", sizeText: "", typeText: "", orientationText: "" });
        this.loadDetail(id);
    },
    openTag(event) {
        const tag = String(event.currentTarget.dataset.tag || "").trim();
        if (!tag)
            return;
        wx.navigateTo({ url: `/pages/list/list?tag=${encodeURIComponent(tag)}&title=${encodeURIComponent(`#${tag}`)}` });
    },
    async onDownload() {
        if (!this.data.item)
            return;
        if (!ads_1.AD_UNITS.rewarded) {
            wx.showToast({ title: "激励广告未配置", icon: "none" });
            return;
        }
        try {
            await ensureOpenid();
            const ad = wx.createRewardedVideoAd({ adUnitId: ads_1.AD_UNITS.rewarded });
            ad.onClose(async (result) => {
                const finished = result && result.isEnded;
                setTimeout(() => {
                    if (!finished) {
                        wx.showToast({ title: "完整观看视频后才能下载", icon: "none" });
                        return;
                    }
                    this.grantDownload().catch((error) => {
                        wx.showToast({ title: error instanceof Error ? error.message : "下载失败", icon: "none" });
                    });
                }, 400);
            });
            ad.onError(() => wx.showToast({ title: "广告加载失败，请稍后再试", icon: "none" }));
            try {
                await ad.show();
            }
            catch {
                await ad.load();
                await ad.show();
            }
        }
        catch (error) {
            wx.showToast({ title: error instanceof Error ? error.message : "操作失败", icon: "none" });
        }
    },
    async grantDownload() {
        if (!this.data.item)
            return;
        await (0, api_1.post)("/reward/watch", {});
        const result = await (0, api_1.post)(`/wallpapers/${this.data.item.id}/download`, {});
        await this.downloadToAlbum(result.token);
    },
    async downloadToAlbum(token) {
        const tempFilePath = await new Promise((resolve, reject) => {
            wx.downloadFile({
                url: `${api_1.API_BASE}/downloads/file/${token}`,
                success: (res) => res.statusCode === 200 ? resolve(res.tempFilePath) : reject(new Error("文件下载失败")),
                fail: (error) => reject(new Error(error.errMsg || "文件下载失败")),
            });
        });
        const isVideo = this.data.item?.type === "live";
        await new Promise((resolve, reject) => {
            const options = { filePath: tempFilePath, success: () => { wx.showToast({ title: "已保存到相册", icon: "success" }); resolve(); }, fail: () => reject(new Error("保存到相册失败")) };
            if (isVideo)
                wx.saveVideoToPhotosAlbum(options);
            else
                wx.saveImageToPhotosAlbum(options);
        });
    },
    onShareAppMessage() {
        const item = this.data.item;
        return {
            title: item ? `${item.title}｜漫元壁纸` : "漫元壁纸",
            path: item ? `/pages/detail/detail?id=${item.id}` : "/pages/index/index",
            imageUrl: item?.coverUrl || ""
        };
    },
    onShareTimeline() {
        const item = this.data.item;
        return {
            title: item ? `${item.title}｜漫元壁纸` : "漫元壁纸",
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
function formatOrientation(value) {
    if (value === "portrait")
        return "手机壁纸";
    if (value === "landscape")
        return "电脑壁纸";
    if (value === "square")
        return "方图";
    return "";
}
function ensureOpenid() {
    const cached = String(wx.getStorageSync("openid") || "");
    if (cached)
        return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
        wx.login({
            success: async (result) => {
                if (!result.code) {
                    reject(new Error("微信登录失败"));
                    return;
                }
                try {
                    const login = await (0, api_1.post)("/auth/login", { code: result.code });
                    if (!login.openid)
                        throw new Error("微信登录失败");
                    wx.setStorageSync("openid", login.openid);
                    resolve(login.openid);
                }
                catch (error) {
                    reject(error instanceof Error ? error : new Error("微信登录失败"));
                }
            },
            fail: () => reject(new Error("微信登录失败")),
        });
    });
}
