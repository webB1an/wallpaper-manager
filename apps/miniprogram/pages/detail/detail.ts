import { API_BASE, post, request, WallpaperDetail } from "../../utils/api";
import { AD_UNITS } from "../../utils/ads";
import { logDownload, logDownloadError } from "../../utils/logger";
import { isFavorite, saveDownloadHistory, setFavoritePresence } from "../../utils/local-history";

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
    downloading: false,
    downloadMessage: "正在保存壁纸…",
    showRewardGuide: false,
    rewardModalText: "",
    fav: false,
    isAdmin: false
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
        orientationText: formatOrientation(item.orientation),
        fav: isFavorite(item.id)
      });
      wx.setNavigationBarTitle({ title: item.title.slice(0, 12) || "壁纸详情" });
      void this.loadFavStatus(item.id);
      void this.loadAdminStatus();
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

  async toggleFav() {
    if (!this.data.item) return;
    const adding = !this.data.fav;
    setFavoritePresence(this.data.item, adding);
    this.setData({ fav: adding });
    wx.showToast({ title: adding ? "已加入收藏" : "已取消收藏", icon: "none" });
    try {
      await ensureOpenid();
      await post(`/user/favorites/${this.data.item.id}`, { action: adding ? "add" : "remove" });
    } catch {
      wx.showToast({ title: "收藏同步失败，请稍后重试", icon: "none" });
    }
  },

  async loadFavStatus(id: string) {
    try {
      await ensureOpenid();
      const ids = await request<string[]>("/user/favorites/ids");
      if (Array.isArray(ids) && ids.includes(id)) this.setData({ fav: true });
    } catch {
      // 未同步时保留本地收藏状态。
    }
  },

  async loadAdminStatus() {
    try {
      await ensureOpenid();
      const status = await request<{ isAdmin: boolean }>("/user/status");
      if (status?.isAdmin) this.setData({ isAdmin: true });
    } catch {
      // 非管理员或未登录时不展示管理入口。
    }
  },

  async offlineWallpaper() {
    if (!this.data.item || !this.data.isAdmin) return;
    try {
      const result = await wx.showModal({
        title: "下架壁纸",
        content: `确认把「${this.data.item.title}」下架吗？将不再对外展示。`,
        confirmText: "下架",
        confirmColor: "#c05621",
        cancelText: "取消",
      });
      if (!result.confirm) return;
      await ensureOpenid();
      await post(`/wallpapers/${this.data.item.id}/offline`);
      this.showNotice("已下架");
      setTimeout(() => this.goBack(), 900);
    } catch (error) {
      this.showNotice(downloadErrorText(error));
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
    logDownload("onDownload", { id: this.data.item.id, type: this.data.item.type });
    // 下载前先确认隐私同意 + 相册授权，避免看完激励广告才发现无法保存。
    const permission = await this.ensureSavePermission();
    logDownload("permission", permission);
    if (permission === "privacy") {
      this.showNotice("请先同意《用户隐私保护指引》再保存");
      return;
    }
    if (permission === "album") {
      this.showNotice("需要相册权限，请点击“去开启权限”");
      this.setData({ showAlbumGuide: true });
      return;
    }
    let rewardType = "daily10";
    try {
      await ensureOpenid();
      const reward = await this.rewardStatus();
      logDownload("rewardStatus", reward);
      rewardType = reward.rewardType || "daily10";
      if (reward.rewarded && (reward.type === "unlimited" || reward.remaining > 0)) {
        this.setData({ downloading: true, downloadMessage: this.downloadMessageFor() });
        await this.grantDownload().finally(() => this.setData({ downloading: false }));
        return;
      }
    } catch (error) {
      logDownloadError("prepare", error);
      this.showNotice(downloadErrorText(error));
      return;
    }
    if (!AD_UNITS.rewarded) {
      logDownload("noRewardedAdUnit");
      this.showNotice("激励广告未配置");
      return;
    }
    // 没有下载次数：先弹窗确认，用户点确认才播放激励广告，取消则不执行。
    this.setData({ rewardModalText: this.rewardGuideText(rewardType), showRewardGuide: true });
  },

  rewardGuideText(rewardType?: string): string {
    return rewardType === "unlimited" ? "观看一次视频，解锁今日下载权限" : "观看一次视频，解锁10次下载权限";
  },

  downloadMessageFor(): string {
    const size = Number(this.data.item?.fileSize || 0);
    return size > 20 * 1024 * 1024 ? "资源过大，请等待下载完成…" : "正在保存壁纸…";
  },

  onRewardConfirm() {
    this.setData({ showRewardGuide: false });
    void this.playRewardAd();
  },

  onRewardCancel() {
    this.setData({ showRewardGuide: false });
  },

  async playRewardAd() {
    if (!AD_UNITS.rewarded) {
      this.showNotice("激励广告未配置");
      return;
    }
    try {
      const ad = wx.createRewardedVideoAd({ adUnitId: AD_UNITS.rewarded });
      ad.onClose(async (result) => {
        const finished = result && result.isEnded;
        logDownload("adClosed", { isEnded: finished });
        setTimeout(() => {
          if (!finished) {
            this.showNotice("完整观看视频后才能下载");
            return;
          }
          this.setData({ downloading: true, downloadMessage: this.downloadMessageFor() });
          this.grantDownload()
            .catch((error: unknown) => {
              logDownloadError("grantDownload", error);
              this.showNotice(downloadErrorText(error));
            })
            .finally(() => this.setData({ downloading: false }));
        }, 400);
      });
      ad.onError((error) => {
        logDownloadError("rewardedAd", error && (error as { errMsg?: string }).errMsg ? (error as { errMsg?: string }).errMsg : error);
        this.showNotice("广告加载失败，请稍后再试");
      });
      try {
        await ad.show();
        logDownload("adShown");
      } catch {
        await ad.load();
        await ad.show();
        logDownload("adShownAfterReload");
      }
    } catch (error) {
      logDownloadError("adShow", error);
      this.showNotice(error instanceof Error ? error.message : "操作失败");
    }
  },

  async rewardStatus() {
    return request<{ rewarded: boolean; remaining: number; type: string; rewardType?: string }>("/reward/status");
  },

  albumState(): Promise<"granted" | "denied" | "unknown"> {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (settings) => {
          const authSetting = settings.authSetting as Record<string, boolean>;
          logDownload("authSetting", authSetting);
          const value = authSetting["scope.writePhotosAlbum"];
          resolve(value === true ? "granted" : value === false ? "denied" : "unknown");
        },
        fail: (error) => {
          logDownloadError("getSetting", (error && error.errMsg) || error);
          resolve("unknown");
        },
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
        logDownload("privacyApiUnsupported");
        resolve(true);
        return;
      }
      wx.getPrivacySetting({
        success: (res) => {
          logDownload("privacySetting", { needAuthorization: res.needAuthorization });
          if (!res.needAuthorization) {
            resolve(true);
            return;
          }
          wx.requirePrivacyAuthorize({
            success: () => resolve(true),
            fail: (error) => {
              logDownloadError("requirePrivacyAuthorize", (error && error.errMsg) || error);
              resolve(false);
            },
          });
        },
        fail: (error) => {
          logDownloadError("getPrivacySetting", (error && error.errMsg) || error);
          resolve(true);
        },
      });
    });
  },

  requestAlbum(): Promise<boolean> {
    return new Promise((resolve) => {
      wx.authorize({
        scope: "scope.writePhotosAlbum",
        success: () => {
          logDownload("authorizeAlbum", "granted");
          resolve(true);
        },
        fail: (error) => {
          // 关键：这里能看到没弹窗的直接原因，比如隐私指引未声明相册权限
          logDownloadError("authorizeAlbum", (error && error.errMsg) || error);
          resolve(false);
        },
      });
    });
  },

  async grantDownload() {
    if (!this.data.item) return;
    await post("/reward/watch", {});
    const result = await this.requestDownloadToken(this.data.item.id);
    await this.downloadToAlbum(result.token);
  },

  // 服务器没有源文件时后端会异步从网盘回源，接口返回 preparing：
  // 轮询重试同一接口（不发 token 时不扣激励次数），拿到 token 后走正常下载。
  async requestDownloadToken(id: string): Promise<{ token: string }> {
    const maxAttempts = 36;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await post<{ token?: string; preparing?: boolean; retryAfterSec?: number }>(`/wallpapers/${id}/download`, {});
      if (result.token) {
        logDownload("token", { token: result.token });
        return { token: result.token };
      }
      if (result.preparing) {
        if (attempt === 1) this.showNotice("正在下载资源，请稍候…");
        logDownload("preparing", { attempt });
        await sleep(Math.min(Math.max(result.retryAfterSec || 5, 3), 15) * 1000);
        continue;
      }
      throw new Error("下载失败：未获取到下载凭证");
    }
    throw new Error("资源准备超时，请稍后再试");
  },

  async downloadToAlbum(token: string) {
    const url = `${API_BASE}/downloads/file/${token}`;
    logDownload("downloadFileStart", url);
    const tempFilePath = await new Promise<string>((resolve, reject) => {
      wx.downloadFile({
        url,
        success: (res) => {
          logDownload("downloadFileSuccess", { statusCode: res.statusCode, tempFilePath: res.tempFilePath });
          if (res.statusCode !== 200) {
            reject(new Error(`文件下载失败：HTTP ${res.statusCode}`));
            return;
          }
          post(`/downloads/file/${token}/complete`, {}).catch(() => undefined);
          resolve(res.tempFilePath);
        },
        fail: (error) => {
          logDownloadError("downloadFile", error.errMsg || error);
          reject(new Error(`文件下载失败：${error.errMsg || "未知错误"}`));
        },
      });
    });
    const isVideo = this.data.item?.type === "live";
    // 安卓真机有时无法直接保存 downloadFile 的临时路径（invalid file），
    // 先复制到用户数据目录，再校验文件有效性，最后用持久路径保存更稳。
    const filePath = await this.persistDownloadFile(tempFilePath, isVideo ? "mp4" : "jpg");
    logDownload("persisted", filePath);
    if (!isVideo) {
      const valid = await this.validateImageFile(filePath);
      logDownload("validateImage", valid);
      if (!valid) {
        this.showNotice("图片文件无效，请稍后重试");
        return;
      }
    }
    await new Promise<void>((resolve, reject) => {
      const options = {
        filePath,
        success: () => {
          logDownload("savedToAlbum", filePath);
          this.showNotice("已保存到相册");
          if (this.data.item) saveDownloadHistory(this.data.item);
          resolve();
        },
        fail: (error: { errMsg?: string }) => {
          const message = (error && error.errMsg) || "";
          logDownloadError("saveToAlbum", message || error);
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

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function downloadErrorText(error: unknown) {
  const message = error instanceof Error ? error.message : "下载失败";
  return message.includes("暂无源文件") ? "该壁纸暂不支持直接下载，请使用下方复制链接" : message;
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
