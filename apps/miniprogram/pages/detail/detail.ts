import { API_BASE, post, request, WallpaperDetail } from "../../utils/api";
import { AD_UNITS } from "../../utils/ads";

const HISTORY_KEY = "wallpaper_download_history";

let requestToken = 0;

Page({
  data: {
    item: null as WallpaperDetail | null,
    primaryLink: null as { provider: string; label: string; url: string; passcode?: string } | null,
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
    adUnit: AD_UNITS.detailBanner,
    toastText: "",
    showAlbumGuide: false,
    downloading: false
  },

  onAdError() {
    // 广告加载失败时静默隐藏。
  },

  async onLoad(options: { id?: string }) {
    const menu = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : null;
    if (menu) {
      this.setData({ capsuleTop: menu.top, capsuleHeight: menu.height });
    }
    if (AD_UNITS.interstitial) {
      const interstitial = wx.createInterstitialAd({ adUnitId: AD_UNITS.interstitial });
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

  async loadDetail(id?: string) {
    const targetId = id || this.data.id;
    if (!targetId) return;
    const token = ++requestToken;
    this.setData({ loading: true, error: "" });
    try {
      const item = await request<WallpaperDetail>(`/wallpapers/${targetId}`);
      if (token !== requestToken) return;
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
    } catch (error) {
      if (token !== requestToken) return;
      const message = error instanceof Error ? error.message : "详情加载失败";
      this.setData({ error: message });
      wx.showToast({ title: "详情加载失败", icon: "none" });
    } finally {
      if (token === requestToken) this.setData({ loading: false });
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
    } else {
      wx.switchTab({ url: "/pages/index/index" });
    }
  },

  copyLink(event: WechatMiniprogram.TouchEvent) {
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

  copyShortLink(url: string, label: string, passcode?: string) {
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

  openRelated(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id || id === this.data.id) return;
    this.setData({ id, item: null, primaryLink: null, primaryUrl: "", primaryPasscode: "", sizeText: "", typeText: "", orientationText: "" });
    this.loadDetail(id);
  },

  openTag(event: WechatMiniprogram.TouchEvent) {
    const tag = String(event.currentTarget.dataset.tag || "").trim();
    if (!tag) return;
    wx.navigateTo({ url: `/pages/list/list?tag=${encodeURIComponent(tag)}&title=${encodeURIComponent(`#${tag}`)}` });
  },

  async onDownload() {
    if (!this.data.item || this.data.downloading) return;
    // 下载前先确认隐私同意 + 相册授权，避免看完激励广告才发现无法保存。
    const permission = await this.ensureSavePermission();
    if (permission === "privacy") {
      this.showNotice("请先同意《用户隐私保护指引》再保存");
      return;
    }
    if (permission === "album") {
      this.showNotice("需要相册权限，请点击“去开启权限”");
      this.setData({ showAlbumGuide: true });
      return;
    }
    try {
      await ensureOpenid();
      const reward = await this.rewardStatus();
      if (reward.rewarded && (reward.type === "unlimited" || reward.remaining > 0)) {
        this.setData({ downloading: true });
        await this.grantDownload().finally(() => this.setData({ downloading: false }));
        return;
      }
    } catch (error) {
      this.showNotice(error instanceof Error ? error.message : "微信登录失败，请稍后再试");
      return;
    }
    if (!AD_UNITS.rewarded) {
      this.showNotice("激励广告未配置");
      return;
    }
    try {
      const ad = wx.createRewardedVideoAd({ adUnitId: AD_UNITS.rewarded });
      ad.onClose(async (result) => {
        const finished = result && result.isEnded;
        setTimeout(() => {
          if (!finished) {
            this.showNotice("完整观看视频后才能下载");
            return;
          }
          this.setData({ downloading: true });
          this.grantDownload()
            .catch((error: unknown) => {
              this.showNotice(error instanceof Error ? error.message : "下载失败");
            })
            .finally(() => this.setData({ downloading: false }));
        }, 400);
      });
      ad.onError(() => this.showNotice("广告加载失败，请稍后再试"));
      try {
        await ad.show();
      } catch {
        await ad.load();
        await ad.show();
      }
    } catch (error) {
      this.showNotice(error instanceof Error ? error.message : "操作失败");
    }
  },

  async rewardStatus() {
    return request<{ rewarded: boolean; remaining: number; type: string }>("/reward/status");
  },

  albumState(): Promise<"granted" | "denied" | "unknown"> {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (settings) => {
          const value = (settings.authSetting as Record<string, boolean>)["scope.writePhotosAlbum"];
          resolve(value === true ? "granted" : value === false ? "denied" : "unknown");
        },
        fail: () => resolve("unknown"),
      });
    });
  },

  async ensureSavePermission(): Promise<"ok" | "privacy" | "album"> {
    if (!(await this.ensurePrivacyAgreed())) return "privacy";
    const state = await this.albumState();
    if (state === "granted") return "ok";
    if (state === "denied") {
      this.setData({ showAlbumGuide: true });
      return "album";
    }
    const granted = await this.requestAlbum();
    if (!granted) {
      this.setData({ showAlbumGuide: true });
      return "album";
    }
    return "ok";
  },

  ensurePrivacyAgreed(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!wx.getPrivacySetting || !wx.requirePrivacyAuthorize) {
        resolve(true);
        return;
      }
      wx.getPrivacySetting({
        success: (res) => {
          if (!res.needAuthorization) {
            resolve(true);
            return;
          }
          wx.requirePrivacyAuthorize({
            success: () => resolve(true),
            fail: () => resolve(false),
          });
        },
        fail: () => resolve(true),
      });
    });
  },

  requestAlbum(): Promise<boolean> {
    return new Promise((resolve) => {
      wx.authorize({
        scope: "scope.writePhotosAlbum",
        success: () => resolve(true),
        fail: () => resolve(false),
      });
    });
  },

  async grantDownload() {
    if (!this.data.item) return;
    await post("/reward/watch", {});
    const result = await post<{ token: string }>(`/wallpapers/${this.data.item.id}/download`, {});
    await this.downloadToAlbum(result.token);
  },

  async downloadToAlbum(token: string) {
    const tempFilePath = await new Promise<string>((resolve, reject) => {
      wx.downloadFile({
        url: `${API_BASE}/downloads/file/${token}`,
        success: (res) => {
          if (res.statusCode !== 200) {
            reject(new Error("文件下载失败"));
            return;
          }
          post(`/downloads/file/${token}/complete`, {}).catch(() => undefined);
          resolve(res.tempFilePath);
        },
        fail: (error) => reject(new Error(`文件下载失败：${error.errMsg || "未知错误"}`)),
      });
    });
    const isVideo = this.data.item?.type === "live";
    // 安卓真机有时无法直接保存 downloadFile 的临时路径（invalid file），
    // 先复制到用户数据目录，再校验文件有效性，最后用持久路径保存更稳。
    const filePath = await this.persistDownloadFile(tempFilePath, isVideo ? "mp4" : "jpg");
    if (!isVideo) {
      const valid = await this.validateImageFile(filePath);
      if (!valid) {
        this.showNotice("图片文件无效，请稍后重试");
        return;
      }
    }
    await new Promise<void>((resolve, reject) => {
      const options = {
        filePath,
        success: () => { this.showNotice("已保存到相册"); resolve(); },
        fail: (error: { errMsg?: string }) => {
          const message = (error && error.errMsg) || "";
          if (/auth|deny|denial|permission|album|privacy/i.test(message)) {
            this.showNotice("需要相册权限，请点击“去开启权限”");
            this.setData({ showAlbumGuide: true });
          } else {
            this.showNotice(`保存失败：${message || "未知错误"}`);
          }
          reject(new Error("保存到相册失败"));
        },
      };
      if (isVideo) wx.saveVideoToPhotosAlbum(options);
      else wx.saveImageToPhotosAlbum(options);
    });
  },

  persistDownloadFile(tempFilePath: string, ext: string): Promise<string> {
    return new Promise((resolve) => {
      if (!tempFilePath || !wx.getFileSystemManager || !wx.env) {
        resolve(tempFilePath);
        return;
      }
      const fs = wx.getFileSystemManager();
      const target = `${wx.env.USER_DATA_PATH}/dl_${Date.now()}.${ext}`;
      fs.copyFile({
        srcPath: tempFilePath,
        destPath: target,
        success: () => resolve(target),
        fail: () => resolve(tempFilePath),
      });
    });
  },

  validateImageFile(filePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!filePath || !wx.getImageInfo) {
        resolve(true);
        return;
      }
      wx.getImageInfo({
        src: filePath,
        success: () => resolve(true),
        fail: () => resolve(false),
      });
    });
  },

  showNotice(text: string) {
    this.setData({ toastText: text });
    setTimeout(() => this.setData({ toastText: "" }), 2200);
  },

  openAlbumSetting() {
    wx.openSetting({
      success: () => this.setData({ showAlbumGuide: false }),
      fail: () => this.setData({ showAlbumGuide: false }),
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

function saveHistory(item: WallpaperDetail | null, url: string, label: string, passcode?: string) {
  if (!item || !url) return;
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

function readHistory(): Array<{ id?: string; title: string; coverUrl: string; label: string; url: string; passcode?: string; copiedAt: number }> {
  const value = wx.getStorageSync(HISTORY_KEY);
  return Array.isArray(value) ? value : [];
}

function formatClipboardText(url: string, passcode?: string) {
  return passcode ? `链接：${url}\n提取码：${passcode}` : url;
}

function recordDownloadClick(id?: string) {
  if (!id) return;
  post<{ ok: boolean }>(`/wallpapers/${id}/click`).catch(() => undefined);
}

function formatBytes(value: number) {
  if (!value) return "原图资源";
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(value / 1024)} KB`;
}

function formatType(value: string) {
  const map: Record<string, string> = {
    live: "动态壁纸",
    static: "静态壁纸",
    mobile: "手机壁纸",
    desktop: "电脑壁纸",
    other: "壁纸资源"
  };
  return map[value] || "壁纸资源";
}

function formatOrientation(value?: string) {
  if (value === "portrait") return "手机壁纸";
  if (value === "landscape") return "电脑壁纸";
  if (value === "square") return "方图";
  return "";
}

function ensureOpenid(): Promise<string> {
  const cached = String(wx.getStorageSync("openid") || "");
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    wx.login({
      success: async (result) => {
        if (!result.code) {
          reject(new Error("微信登录失败"));
          return;
        }
        try {
          const login = await post<{ openid: string }>("/auth/login", { code: result.code });
          if (!login.openid) throw new Error("微信登录失败");
          wx.setStorageSync("openid", login.openid);
          resolve(login.openid);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("微信登录失败"));
        }
      },
      fail: () => reject(new Error("微信登录失败")),
    });
  });
}
