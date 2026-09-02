import { API_BASE, post } from "../../utils/api";
import { ensureOpenid } from "../../utils/reward";

Page({
  data: {
    files: [] as Array<{ path: string; preview: string; type: "image" | "video" }>,
    manualTags: [] as string[],
    tagInput: "",
    titleInput: "",
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
      count: 9,
      mediaType: ["image", "video"],
      sourceType: ["album", "camera"],
      // 强制选原图，避免微信默认压缩图片导致上传/下载的壁纸被降分辨率（sizeType 仅对 image 生效）。
      sizeType: ["original"],
      success: (res) => {
        const added = res.tempFiles.map((file) => ({
          path: file.tempFilePath,
          preview: file.fileType === "video" ? file.thumbTempFilePath || file.tempFilePath : file.tempFilePath,
          type: file.fileType === "video" ? ("video" as const) : ("image" as const),
        }));
        this.setData({ files: [...this.data.files, ...added].slice(0, 20) });
      },
      fail: () => wx.showToast({ title: "无法打开相册，请重试", icon: "none" }),
    });
  },

  removeFile(event: WechatMiniprogram.TouchEvent) {
    const index = Number((event.currentTarget.dataset as { index?: number }).index);
    this.setData({ files: this.data.files.filter((_, i) => i !== index) });
  },

  onAutoPublishChange(event: WechatMiniprogram.SwitchChange) {
    this.setData({ autoPublish: event.detail.value });
  },

  onTagInput(event: WechatMiniprogram.Input) {
    this.setData({ tagInput: event.detail.value });
  },

  onTitleInput(event: WechatMiniprogram.Input) {
    this.setData({ titleInput: event.detail.value });
  },

  addTag() {
    const names = this.data.tagInput
      .split(/[,，\n]/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (!names.length) return;
    this.setData({
      manualTags: [...new Set([...this.data.manualTags, ...names])].slice(0, 12),
      tagInput: "",
    });
  },

  removeTag(event: WechatMiniprogram.TouchEvent) {
    const tag = String((event.currentTarget.dataset as { tag?: string }).tag || "");
    this.setData({ manualTags: this.data.manualTags.filter((item) => item !== tag) });
  },

  async uploadOne(filePath: string, openid: string, batchKey: string, batchTotal: number) {
    await ensureOpenid();
    return new Promise<void>((resolve, reject) => {
      wx.uploadFile({
        url: `${API_BASE}/wallpapers/upload`,
        filePath,
        name: "file",
        header: { "X-Openid": openid },
        formData: {
          autoPublish: this.data.autoPublish ? "true" : "false",
          batchKey,
          batchTotal: String(batchTotal),
          tags: this.data.manualTags.join(","),
          title: this.data.titleInput.trim(),
        },
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const body = JSON.parse(res.data) as { code?: number; message?: string };
              if (body.code === 200) {
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
  },

  async upload() {
    if (this.data.uploading) return;
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
    // 每次点击上传作为独立批次，多次点击不会合并成一条帖子。
    const batchKey = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const failed: Array<{ path: string; error: string }> = [];
    for (const file of files) {
      try {
        await this.uploadOne(file.path, openid, batchKey, files.length);
        this.setData({ files: this.data.files.filter((item) => item.path !== file.path) });
      } catch (error) {
        failed.push({ path: file.path, error: error instanceof Error ? error.message : "上传失败" });
      }
    }
    // 收尾通知：成功/部分失败都触发合并发帖（后端幂等）。
    try {
      await post("/wallpapers/upload/batch/complete", { batchKey });
    } catch {
      // 忽略收尾失败，最后一个文件上传成功时后端已自动触发。
    }
    this.setData({ uploading: false });
    const succeeded = files.length - failed.length;
    if (succeeded > 0 && failed.length === 0) {
      wx.showToast({ title: this.data.autoPublish ? `成功上传 ${succeeded} 张，将合并发帖` : `成功上传 ${succeeded} 张`, icon: "success" });
    } else if (succeeded > 0 && failed.length > 0) {
      wx.showToast({ title: this.data.autoPublish ? `成功 ${succeeded} 张，将合并发帖；失败 ${failed.length} 张` : `成功 ${succeeded} 张，失败 ${failed.length} 张`, icon: "none" });
    } else {
      wx.showToast({ title: failed[0] ? failed[0].error : "上传失败", icon: "none" });
    }
  }
});
