import { ensureOpenid } from "../../utils/reward";
import { canUseVirtualPayment, checkIosVersion, getPaymentCatalog, getPaymentDelivery, payProduct, PaymentDeliveryResource, PaymentProduct, waitForPaymentDelivery } from "../../utils/payment";

Page({
  data: {
    product: null as PaymentProduct | null,
    entitlementText: "尚未购买",
    purchased: false,
    resources: [] as PaymentDeliveryResource[],
    paying: false,
    loading: true,
    error: ""
  },

  onLoad() {
    void this.loadProduct();
  },

  onShow() {
    void this.loadProduct();
  },

  async loadProduct() {
    this.setData({ loading: true, error: "" });
    try {
      await ensureOpenid();
      const [catalog, delivery] = await Promise.all([getPaymentCatalog(), getPaymentDelivery()]);
      const product = catalog.products.find((item) => item.key === "direct_download_lifetime") || null;
      let entitlementText = "尚未购买";
      if (catalog.entitlement?.hasPaidDownload) {
        if (catalog.entitlement.permanent) {
          entitlementText = "已永久解锁全部壁纸下载";
        } else if (catalog.entitlement.unlimitedUntil) {
          entitlementText = `权益有效期至 ${formatDate(catalog.entitlement.unlimitedUntil)}`;
        } else if (catalog.entitlement.singleRemaining > 0) {
          entitlementText = `当前剩余 ${catalog.entitlement.singleRemaining} 次付费直接下载`;
        }
      }
      if (delivery.purchased) entitlementText = "已永久解锁，以下资源可永久使用";
      this.setData({ product: delivery.purchased ? null : product, entitlementText, purchased: delivery.purchased, resources: delivery.resources || [] });
    } catch (error) {
      this.setData({ error: error instanceof Error ? error.message : "商品信息加载失败" });
    } finally {
      this.setData({ loading: false });
    }
  },

  copyResource(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const resource = this.data.resources[index];
    if (!resource) return;
    const text = resource.passcode ? `${resource.url}\n提取码：${resource.passcode}` : resource.url;
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: "资源链接已复制", icon: "success" })
    });
  },

  retry() {
    void this.loadProduct();
  },

  async buyAll() {
    if (!this.data.product || this.data.paying) return;
    if (!canUseVirtualPayment()) {
      wx.showToast({ title: "当前微信版本不支持虚拟支付，请先升级微信", icon: "none" });
      return;
    }
    if (!checkIosVersion()) return;
    this.setData({ paying: true });
    try {
      await ensureOpenid();
      const order = await payProduct(this.data.product.key);
      wx.showLoading({ title: "正在确认订单" });
      const delivered = await waitForPaymentDelivery(order.outTradeNo, 20_000);
      wx.hideLoading();
      if (!delivered) {
        wx.showToast({ title: "订单确认超时，请稍后重试", icon: "none" });
        return;
      }
      wx.showToast({ title: "已开通全部壁纸下载权益", icon: "success" });
      await this.loadProduct();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error instanceof Error ? error.message : "购买失败", icon: "none" });
    } finally {
      this.setData({ paying: false });
    }
  },

  onShareAppMessage() {
    return {
      title: "全部壁纸下载权益｜漫元壁纸",
      path: "/pages/buy/buy"
    };
  }
});

function formatDate(value: string | number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
