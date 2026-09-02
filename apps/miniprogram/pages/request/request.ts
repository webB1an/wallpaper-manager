import { API_BASE, post } from "../../utils/api";
import { ensureOpenid } from "../../utils/reward";

type RequestStatus = { eligible: boolean; monthlyLimit: number; used: number; remaining: number; hasActive: boolean };
type RequestItem = {
  id: string;
  subject: string;
  description: string;
  wallpaperType: string;
  orientation: string;
  status: string;
  adminNote?: string;
  referenceImages?: string[];
  createdAt: string;
  wallpaper?: { id: string; title: string; coverUrl: string } | null;
};

Page({
  data: {
    access: null as RequestStatus | null,
    items: [] as Array<RequestItem & { statusText: string; createdText: string }>,
    subject: "",
    description: "",
    references: [] as Array<{ path: string; size: number }>,
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
      await ensureOpenid();
      const codes = await Promise.all([loginCode(), loginCode()]);
      const [access, items] = await Promise.all([
        post<RequestStatus>("/user/wallpaper-requests/status", { code: codes[0] }),
        post<RequestItem[]>("/user/wallpaper-requests/list", { code: codes[1] }),
      ]);
      this.setData({
        access,
        items: items.map((item) => ({ ...item, statusText: statusText(item.status), createdText: formatDate(item.createdAt) })),
      });
    } catch (error) {
      this.setData({ error: error instanceof Error ? error.message : "求图信息加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onSubjectInput(event: WechatMiniprogram.Input) { this.setData({ subject: event.detail.value }); },
  onDescriptionInput(event: WechatMiniprogram.TextareaInput) { this.setData({ description: event.detail.value }); },
  onTypeChange(event: WechatMiniprogram.PickerChange) { this.setData({ typeIndex: Number(event.detail.value) }); },
  onOrientationChange(event: WechatMiniprogram.PickerChange) { this.setData({ orientationIndex: Number(event.detail.value) }); },

  chooseReferences() {
    const remaining = 3 - this.data.references.length;
    if (remaining <= 0) return;
    wx.chooseMedia({
      count: remaining,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: (result) => {
        const oversized = result.tempFiles.some((file) => file.size > 3 * 1024 * 1024);
        if (oversized) wx.showToast({ title: "单张参考图不能超过 3MB", icon: "none" });
        const accepted = result.tempFiles
          .filter((file) => file.size <= 3 * 1024 * 1024)
          .map((file) => ({ path: file.tempFilePath, size: file.size }));
        this.setData({ references: [...this.data.references, ...accepted].slice(0, 3) });
      },
      fail: () => wx.showToast({ title: "无法打开相册，请重试", icon: "none" }),
    });
  },

  removeReference(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ references: this.data.references.filter((_, itemIndex) => itemIndex !== index) });
  },

  previewReference(event: WechatMiniprogram.TouchEvent) {
    const current = String(event.currentTarget.dataset.src || "");
    wx.previewImage({ current, urls: this.data.references.map((item) => item.path) });
  },

  previewHistoryReference(event: WechatMiniprogram.TouchEvent) {
    const itemIndex = Number(event.currentTarget.dataset.itemIndex);
    const current = String(event.currentTarget.dataset.src || "");
    const urls = this.data.items[itemIndex]?.referenceImages || [];
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  async submit() {
    if (this.data.submitting || !this.data.access || this.data.access.hasActive || this.data.access.remaining <= 0) return;
    if (!this.data.subject.trim()) {
      wx.showToast({ title: "请填写作品、角色或主题", icon: "none" });
      return;
    }
    if (!this.data.description.trim() && !this.data.references.length) {
      wx.showToast({ title: "请填写详细描述或上传参考图", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    try {
      const referenceTokens: string[] = [];
      for (const reference of this.data.references) referenceTokens.push(await uploadReference(reference.path));
      const code = await loginCode();
      await post("/user/wallpaper-requests", {
        code,
        subject: this.data.subject.trim(),
        description: this.data.description.trim(),
        wallpaperType: this.data.typeValues[this.data.typeIndex],
        orientation: this.data.orientationValues[this.data.orientationIndex],
        referenceTokens: referenceTokens.join(","),
      });
      wx.showToast({ title: "求图已提交", icon: "success" });
      this.setData({ subject: "", description: "", references: [] });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  openWallpaper(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    if (id) wx.navigateTo({ url: `/pages/detail/detail?id=${id}` });
  }
});

function statusText(status: string) {
  return ({ pending: "待处理", searching: "查找中", fulfilled: "已收录", not_found: "暂未找到", closed: "已关闭" } as Record<string, string>)[status] || status;
}

function formatDate(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function loginCode(): Promise<string> {
  return new Promise((resolve, reject) => wx.login({
    success: (result) => result.code ? resolve(result.code) : reject(new Error("微信登录失败")),
    fail: () => reject(new Error("微信登录失败")),
  }));
}

async function uploadReference(filePath: string): Promise<string> {
  const code = await loginCode();
  return new Promise((resolve, reject) => wx.uploadFile({
    url: `${API_BASE}/user/wallpaper-requests/references`,
    filePath,
    name: "file",
    formData: { code },
    timeout: 20000,
    success: (response) => {
      try {
        const body = JSON.parse(response.data) as { code?: number; data?: { token?: string }; message?: string };
        if (response.statusCode >= 200 && response.statusCode < 300 && body.code === 200 && body.data?.token) resolve(body.data.token);
        else reject(new Error(body.message || "参考图上传失败"));
      } catch { reject(new Error("参考图上传失败")); }
    },
    fail: (error) => reject(new Error(error.errMsg || "参考图上传失败")),
  }));
}
