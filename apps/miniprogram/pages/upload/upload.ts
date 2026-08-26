import { API_BASE } from "../../utils/api";
import { ensureOpenid } from "../../utils/reward";

Page({
  data: {
    filePath: "",
    autoPublish: false,
    uploading: false,
    isAdmin: true
  },

  async onLoad() {
    let isAdmin = true;
    try {
      await ensureOpenid();
      const status = await new Promise<{ isAdmin: boolean }>((resolve, reject) => {
        wx.request({
          url: `${API_BASE}/user/status`,
          method: "GET",
          header: { "X-Openid": wx.getStorageSync("openid") || "" },
          timeout: 12000,
          success: (res) => {
            const body = res.data as { code?: number; data?: { isAdmin?: boolean } };
            if (res.statusCode >= 200 && res.statusCode < 300 && body.code === 200) resolve({ isAdmin: Boolean(body.data?.isAdmin) });
            else reject(new Error("状态获取失败"));
          },
          fail: () => reject(new Error("网络请求失败")),
        });
      });
      isAdmin = Boolean(status.isAdmin);
    } catch {
      // 校验失败不拦截，后端会再次校验。
    }
    this.setData({ isAdmin });
    if (!isAdmin) wx.showToast({ title: "无上传权限", icon: "none" });
  },

  chooseMedia() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image", "video"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const file = res.tempFiles[0];
        if (file) this.setData({ filePath: file.tempFilePath });
      },
      fail: (error) => {
        const message = (error && (error as { errMsg?: string }).errMsg) || "";
        if (/scope is not declared|privacy/i.test(message)) {
          wx.showToast({
            title: "需在微信公众平台「用户隐私保护指引」声明「选中的照片或视频信息」权限后使用",
            icon: "none",
            duration: 3500,
          });
        } else {
          wx.showToast({ title: "无法打开相册，请检查相册/摄像头权限", icon: "none" });
        }
      },
    });
  },

  onAutoPublishChange(event: WechatMiniprogram.SwitchChange) {
    this.setData({ autoPublish: event.detail.value });
  },

  async upload() {
    if (this.data.uploading) return;
    if (!this.data.isAdmin) {
      wx.showToast({ title: "无上传权限", icon: "none" });
      return;
    }
    if (!this.data.filePath) {
      wx.showToast({ title: "请先选择壁纸", icon: "none" });
      return;
    }
    this.setData({ uploading: true });
    try {
      await ensureOpenid();
      const openid = wx.getStorageSync("openid") || "";
      await new Promise<void>((resolve, reject) => {
        wx.uploadFile({
          url: `${API_BASE}/wallpapers/upload`,
          filePath: this.data.filePath,
          name: "file",
          header: { "X-Openid": openid },
          formData: { autoPublish: this.data.autoPublish ? "true" : "false" },
          success: (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const body = JSON.parse(res.data) as { code?: number; data?: unknown; message?: string };
                if (body.code === 200) {
                  wx.showToast({ title: "上传成功，已进入处理排队", icon: "success" });
                  resolve();
                  return;
                }
                reject(new Error(body.message || "上传失败"));
              } catch {
                reject(new Error("上传失败"));
              }
            } else {
              reject(new Error(`上传失败：HTTP ${res.statusCode}`));
            }
          },
          fail: (error) => reject(new Error(error.errMsg || "上传失败")),
        });
      });
      setTimeout(() => wx.switchTab({ url: "/pages/index/index" }), 1200);
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "上传失败", icon: "none" });
    } finally {
      this.setData({ uploading: false });
    }
  }
});
