"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const reward_1 = require("../../utils/reward");
const payment_1 = require("../../utils/payment");
Page({
    data: {
        product: null,
        entitlementText: "尚未开通全部壁纸下载权益",
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
            await (0, reward_1.ensureOpenid)();
            const catalog = await (0, payment_1.getPaymentCatalog)();
            const product = catalog.products.find((item) => item.key === "direct_download_lifetime") || null;
            let entitlementText = "尚未开通全部壁纸下载权益";
            if (catalog.entitlement?.hasPaidDownload) {
                if (catalog.entitlement.permanent) {
                    entitlementText = "已永久解锁全部壁纸下载";
                }
                else if (catalog.entitlement.unlimitedUntil) {
                    entitlementText = `权益有效期至 ${formatDate(catalog.entitlement.unlimitedUntil)}`;
                }
                else if (catalog.entitlement.singleRemaining > 0) {
                    entitlementText = `当前剩余 ${catalog.entitlement.singleRemaining} 次付费直接下载`;
                }
            }
            this.setData({ product, entitlementText });
        }
        catch (error) {
            this.setData({ error: error instanceof Error ? error.message : "商品信息加载失败" });
        }
        finally {
            this.setData({ loading: false });
        }
    },
    retry() {
        void this.loadProduct();
    },
    async buyAll() {
        if (!this.data.product || this.data.paying)
            return;
        if (!(0, payment_1.canUseVirtualPayment)()) {
            wx.showToast({ title: "当前微信版本不支持虚拟支付，请先升级微信", icon: "none" });
            return;
        }
        if (!(0, payment_1.checkIosVersion)())
            return;
        this.setData({ paying: true });
        try {
            await (0, reward_1.ensureOpenid)();
            const order = await (0, payment_1.payProduct)(this.data.product.key);
            wx.showLoading({ title: "正在确认订单" });
            const delivered = await (0, payment_1.waitForPaymentDelivery)(order.outTradeNo, 20000);
            wx.hideLoading();
            if (!delivered) {
                wx.showToast({ title: "订单确认超时，请稍后重试", icon: "none" });
                return;
            }
            wx.showToast({ title: "已开通全部壁纸下载权益", icon: "success" });
            await this.loadProduct();
        }
        catch (error) {
            wx.hideLoading();
            wx.showToast({ title: error instanceof Error ? error.message : "购买失败", icon: "none" });
        }
        finally {
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
function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return "";
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}
