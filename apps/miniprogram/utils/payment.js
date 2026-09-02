"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymentCatalog = getPaymentCatalog;
exports.createPaymentOrder = createPaymentOrder;
exports.getPaymentOrderStatus = getPaymentOrderStatus;
exports.payProduct = payProduct;
exports.waitForPaymentDelivery = waitForPaymentDelivery;
exports.canUseVirtualPayment = canUseVirtualPayment;
exports.checkIosVersion = checkIosVersion;
const api_1 = require("./api");
const reward_1 = require("./reward");
async function getPaymentCatalog() {
    await (0, reward_1.ensureOpenid)();
    return (0, api_1.request)("/pay/catalog");
}
async function createPaymentOrder(productKey) {
    const code = await loginCode();
    return (0, api_1.post)("/pay/order", { code, productKey });
}
async function getPaymentOrderStatus(outTradeNo) {
    return (0, api_1.request)(`/pay/orders/${encodeURIComponent(outTradeNo)}`);
}
async function payProduct(productKey) {
    if (!canUseVirtualPayment()) {
        throw new Error("当前微信版本不支持虚拟支付，请先升级微信");
    }
    const order = await createPaymentOrder(productKey);
    await requestVirtualPayment(order);
    return order;
}
async function waitForPaymentDelivery(outTradeNo, timeoutMs = 20000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const status = await getPaymentOrderStatus(outTradeNo);
        if (status.delivered)
            return true;
        await sleep(2000);
    }
    return getPaymentOrderStatus(outTradeNo).then((status) => status.delivered).catch(() => false);
}
function canUseVirtualPayment() {
    if (typeof wx.requestVirtualPayment !== "function")
        return false;
    if (!wx.canIUse || wx.canIUse("requestVirtualPayment"))
        return true;
    return false;
}
function checkIosVersion() {
    const sys = wx.getSystemInfoSync();
    if (sys.platform !== "ios")
        return true;
    const current = String(sys.version || "").split(".").map((part) => Number(part) || 0);
    const base = [8, 0, 68];
    for (let index = 0; index < 3; index++) {
        if ((current[index] || 0) > base[index])
            return true;
        if ((current[index] || 0) < base[index])
            break;
    }
    wx.showModal({
        title: "提示",
        content: "请将微信更新至最新版后再进行支付",
        showCancel: false,
    });
    return false;
}
function requestVirtualPayment(order) {
    return new Promise((resolve, reject) => {
        wx.requestVirtualPayment({
            mode: order.mode,
            signData: order.signData,
            paySig: order.paySig,
            signature: order.signature,
            success() {
                resolve();
            },
            fail(error) {
                reject(new Error(paymentErrorMessage(error)));
            },
        });
    });
}
function loginCode() {
    return new Promise((resolve, reject) => {
        wx.login({
            success: (result) => {
                if (result.code) {
                    resolve(result.code);
                    return;
                }
                reject(new Error("微信登录失败"));
            },
            fail: () => reject(new Error("微信登录失败")),
        });
    });
}
function paymentErrorMessage(error) {
    const code = error?.errCode;
    const message = error?.errMsg || "";
    if (code === -2 || message.includes("cancel"))
        return "已取消支付";
    if (message.includes("not support") || message.includes("no permission"))
        return "当前微信版本不支持虚拟支付";
    return `支付失败：${message || code || "未知错误"}`;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
