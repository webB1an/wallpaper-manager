"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const api_1 = require("../../utils/api");
const reward_1 = require("../../utils/reward");
Page({
    data: {
        files: [],
        autoPublish: false,
        uploading: false,
        isAdmin: true
    },
    async onLoad() {
        let isAdmin = true;
        try {
            await (0, reward_1.ensureOpenid)();
            const status = await new Promise((resolve, reject) => {
                wx.request({
                    url: `${api_1.API_BASE}/user/status`,
                    method: "GET",
                    header: { "X-Openid": wx.getStorageSync("openid") || "" },
                    timeout: 12000,
                    success: (res) => {
                        const body = res.data;
                        if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 200)
                            resolve({ isAdmin: Boolean(body.data?.isAdmin) });
                        else
                            reject(new Error("状态获取失败"));
                    },
                    fail: () => reject(new Error("网络请求失败")),
                });
            });
            isAdmin = Boolean(status.isAdmin);
        }
        catch {
            // 校验失败不拦截，后端会再次校验。
        }
        this.setData({ isAdmin });
        if (!isAdmin)
            wx.showToast({ title: "无上传权限", icon: "none" });
    },
    chooseMedia() {
        wx.chooseMedia({
            count: 9,
            mediaType: ["image", "video"],
            sourceType: ["album", "camera"],
            // 强制选原图，避免微信默认压缩图片导致上传/下载的壁纸被降分辨率（sizeType 仅对 image 生效）。
            sizeType: ["original"],
            success: (res) => {
                const added = res.tempFiles.map((file) => ({
                    path: file.tempFilePath,
                    preview: file.fileType === "video" ? file.thumbTempFilePath || file.tempFilePath : file.tempFilePath,
                    type: file.fileType === "video" ? "video" : "image",
                }));
                this.setData({ files: [...this.data.files, ...added].slice(0, 20) });
            },
            fail: () => wx.showToast({ title: "无法打开相册，请重试", icon: "none" }),
        });
    },
    removeFile(event) {
        const index = Number(event.currentTarget.dataset.index);
        this.setData({ files: this.data.files.filter((_, i) => i !== index) });
    },
    onAutoPublishChange(event) {
        this.setData({ autoPublish: event.detail.value });
    },
    async uploadOne(filePath, openid) {
        await (0, reward_1.ensureOpenid)();
        return new Promise((resolve, reject) => {
            wx.uploadFile({
                url: `${api_1.API_BASE}/wallpapers/upload`,
                filePath,
                name: "file",
                header: { "X-Openid": openid },
                formData: { autoPublish: this.data.autoPublish ? "true" : "false" },
                success: (res) => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const body = JSON.parse(res.data);
                            if (body.code === 200) {
                                resolve();
                                return;
                            }
                            reject(new Error(body.message || "上传失败"));
                        }
                        catch {
                            reject(new Error("上传失败"));
                        }
                    }
                    else {
                        reject(new Error(`上传失败：HTTP ${res.statusCode}`));
                    }
                },
                fail: (error) => reject(new Error(error.errMsg || "上传失败")),
            });
        });
    },
    async upload() {
        if (this.data.uploading)
            return;
        if (!this.data.isAdmin) {
            wx.showToast({ title: "无上传权限", icon: "none" });
            return;
        }
        if (this.data.files.length === 0) {
            wx.showToast({ title: "请先选择壁纸", icon: "none" });
            return;
        }
        this.setData({ uploading: true });
        const openid = wx.getStorageSync("openid") || "";
        const files = [...this.data.files];
        const failed = [];
        for (const file of files) {
            try {
                await this.uploadOne(file.path, openid);
                this.setData({ files: this.data.files.filter((item) => item.path !== file.path) });
            }
            catch (error) {
                failed.push({ path: file.path, error: error instanceof Error ? error.message : "上传失败" });
            }
        }
        this.setData({ uploading: false });
        const succeeded = files.length - failed.length;
        if (succeeded > 0 && failed.length === 0) {
            wx.showToast({ title: `成功上传 ${succeeded} 张`, icon: "success" });
        }
        else if (succeeded > 0 && failed.length > 0) {
            wx.showToast({ title: `成功 ${succeeded} 张，失败 ${failed.length} 张`, icon: "none" });
        }
        else {
            wx.showToast({ title: failed[0] ? failed[0].error : "上传失败", icon: "none" });
        }
    }
});
