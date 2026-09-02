"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const reward_1 = require("../../utils/reward");
Page({
    data: {
        access: null,
        items: [],
        subject: "",
        description: "",
        typeIndex: 0,
        orientationIndex: 0,
        typeOptions: ["静态壁纸", "动态壁纸"],
        typeValues: ["static", "live"],
        orientationOptions: ["手机竖屏", "电脑横屏", "正方形"],
        orientationValues: ["portrait", "landscape", "square"],
        loading: true,
        submitting: false,
        error: ""
    },
    onShow() { void this.load(); },
    async load() {
        this.setData({ loading: true, error: "" });
        try {
            await (0, reward_1.ensureOpenid)();
            const codes = await Promise.all([loginCode(), loginCode()]);
            const [access, items] = await Promise.all([
                (0, api_1.post)("/user/wallpaper-requests/status", { code: codes[0] }),
                (0, api_1.post)("/user/wallpaper-requests/list", { code: codes[1] }),
            ]);
            this.setData({
                access,
                items: items.map((item) => ({ ...item, statusText: statusText(item.status), createdText: formatDate(item.createdAt) })),
            });
        }
        catch (error) {
            this.setData({ error: error instanceof Error ? error.message : "求图信息加载失败" });
        }
        finally {
            this.setData({ loading: false });
        }
    },
    onSubjectInput(event) { this.setData({ subject: event.detail.value }); },
    onDescriptionInput(event) { this.setData({ description: event.detail.value }); },
    onTypeChange(event) { this.setData({ typeIndex: Number(event.detail.value) }); },
    onOrientationChange(event) { this.setData({ orientationIndex: Number(event.detail.value) }); },
    async submit() {
        if (this.data.submitting || !this.data.access || this.data.access.hasActive || this.data.access.remaining <= 0)
            return;
        this.setData({ submitting: true });
        try {
            const code = await loginCode();
            await (0, api_1.post)("/user/wallpaper-requests", {
                code,
                subject: this.data.subject.trim(),
                description: this.data.description.trim(),
                wallpaperType: this.data.typeValues[this.data.typeIndex],
                orientation: this.data.orientationValues[this.data.orientationIndex],
            });
            wx.showToast({ title: "求图已提交", icon: "success" });
            this.setData({ subject: "", description: "" });
            await this.load();
        }
        catch (error) {
            wx.showToast({ title: error instanceof Error ? error.message : "提交失败", icon: "none" });
        }
        finally {
            this.setData({ submitting: false });
        }
    },
    openWallpaper(event) {
        const id = String(event.currentTarget.dataset.id || "");
        if (id)
            wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
    }
});
function statusText(status) {
    return { pending: "待处理", searching: "查找中", fulfilled: "已收录", not_found: "暂未找到", closed: "已关闭" }[status] || status;
}
function formatDate(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function loginCode() {
    return new Promise((resolve, reject) => wx.login({
        success: (result) => result.code ? resolve(result.code) : reject(new Error("微信登录失败")),
        fail: () => reject(new Error("微信登录失败")),
    }));
}
