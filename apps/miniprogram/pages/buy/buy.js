"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const reward_1 = require("../../utils/reward");
const payment_1 = require("../../utils/payment");
Page({
    loadRequestId: 0,
    data: {
        products: [],
        entitlementText: "尚未购买",
        purchased: false,
        resources: [],
        paying: false,
        payingKey: "",
        pendingOrder: "",
        checkingOrder: false,
        loading: true,
        error: ""
    },
    onShow() {
        return this.loadProduct();
    },
    onUnload() {
        this.loadRequestId += 1;
    },
    async loadProduct() {
        const requestId = ++this.loadRequestId;
        this.setData({ loading: true, error: "" });
        try {
            await (0, reward_1.ensureOpenid)();
            const pendingOrder = wx.getStorageSync(pendingOrderKey());
            if (requestId !== this.loadRequestId)
                return;
            if (typeof pendingOrder === "string")
                this.setData({ pendingOrder });
            const [catalog, delivery] = await Promise.all([(0, payment_1.getPaymentCatalog)(), (0, payment_1.getPaymentDelivery)()]);
            if (requestId !== this.loadRequestId)
                return;
            let entitlementText = "尚未购买";
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
            if (delivery.purchased)
                entitlementText = "已永久解锁，以下资源可永久使用";
            if (delivery.purchased)
                this.clearPendingOrder();
            this.setData({ products: catalog.products || [], entitlementText, purchased: delivery.purchased, resources: delivery.resources || [] });
        }
        catch (error) {
            if (requestId !== this.loadRequestId)
                return;
            this.setData({ error: error instanceof Error ? error.message : "商品信息加载失败" });
        }
        finally {
            if (requestId === this.loadRequestId)
                this.setData({ loading: false });
        }
    },
    clearPendingOrder() {
        this.setData({ pendingOrder: "" });
        wx.removeStorageSync(pendingOrderKey());
    },
    async checkPendingOrder() {
        if (!this.data.pendingOrder || this.data.checkingOrder || this.data.paying)
            return;
        this.setData({ checkingOrder: true });
        try {
            await (0, reward_1.ensureOpenid)();
            const status = await (0, payment_1.getPaymentOrderStatus)(this.data.pendingOrder);
            if (status.delivered) {
                this.clearPendingOrder();
                await this.loadProduct();
                wx.showToast({ title: "权益已到账", icon: "success" });
            }
            else if (["closed", "failed", "refunded"].includes(status.status)) {
                this.clearPendingOrder();
                await this.loadProduct();
                wx.showToast({ title: status.status === "refunded" ? "订单已退款" : "订单已关闭或支付失败", icon: "none" });
            }
            else {
                wx.showToast({ title: "订单确认中，请勿重复支付", icon: "none" });
            }
        }
        catch {
            wx.showToast({ title: "查询暂未完成，请勿重复支付", icon: "none" });
        }
        finally {
            this.setData({ checkingOrder: false });
        }
    },
    goMemberRequest() {
        if (this.data.purchased)
            wx.navigateTo({ url: "/pages/request/request" });
    },
    copyResource(event) {
        const index = Number(event.currentTarget.dataset.index);
        const resource = this.data.resources[index];
        if (!resource)
            return;
        wx.setClipboardData({
            data: resource.url,
            success: () => wx.showToast({ title: "资源链接已复制", icon: "success" })
        });
    },
    retry() {
        void this.loadProduct();
    },
    async buyAll(event) {
        if (this.data.pendingOrder) {
            wx.showToast({ title: "订单确认中，请勿重复支付", icon: "none" });
            return;
        }
        const productKey = String(event.currentTarget.dataset.key || "");
        const product = this.data.products.find((item) => item.key === productKey);
        if (!product || this.data.paying)
            return;
        if (!(0, payment_1.canUseVirtualPayment)()) {
            wx.showToast({ title: "当前微信版本不支持虚拟支付，请先升级微信", icon: "none" });
            return;
        }
        if (!(0, payment_1.checkIosVersion)())
            return;
        this.setData({ paying: true, payingKey: product.key });
        try {
            await (0, reward_1.ensureOpenid)();
            const order = await (0, payment_1.payProduct)(product.key);
            this.setData({ pendingOrder: order.outTradeNo });
            wx.setStorageSync(pendingOrderKey(), order.outTradeNo);
            wx.showLoading({ title: "正在确认订单" });
            const delivered = await (0, payment_1.waitForPaymentDelivery)(order.outTradeNo, 20000);
            wx.hideLoading();
            if (!delivered) {
                wx.showToast({ title: "订单确认中，请勿重复支付", icon: "none" });
                return;
            }
            wx.showToast({ title: "购买成功", icon: "success" });
            this.clearPendingOrder();
            await this.loadProduct();
        }
        catch (error) {
            wx.hideLoading();
            wx.showToast({ title: this.data.pendingOrder ? "订单确认中，请勿重复支付" : error instanceof Error ? error.message : "购买失败", icon: "none" });
        }
        finally {
            this.setData({ paying: false, payingKey: "" });
        }
    },
    onShareAppMessage() {
        return {
            title: "全部壁纸下载权益｜漫元壁纸",
            path: "/pages/buy/buy"
        };
    }
});
function pendingOrderKey() {
    return `pending_payment_order:${wx.getStorageSync("openid") || ""}`;
}
function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return "";
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}
