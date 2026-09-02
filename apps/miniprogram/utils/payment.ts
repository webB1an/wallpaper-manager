import { post, request } from "./api";
import { ensureOpenid } from "./reward";

export interface PaymentProduct {
  key: string;
  name: string;
  description: string;
  price: number;
  priceText: string;
  entitlementType: string;
  entitlementValue: number;
}

export interface PaymentEntitlement {
  singleRemaining: number;
  unlimitedUntil: string | null;
  removeAdsUntil: string | null;
  permanent: boolean;
  hasPaidDownload: boolean;
  hasRemoveAds: boolean;
}

export interface PaymentCatalog {
  offerId: string;
  products: PaymentProduct[];
  entitlement: PaymentEntitlement | null;
}

export interface PaymentOrderData {
  outTradeNo: string;
  mode: "short_series_goods";
  signData: string;
  paySig: string;
  signature: string;
  product: {
    key: string;
    name: string;
    price: number;
    priceText: string;
  };
}

export interface PaymentOrderStatus {
  outTradeNo: string;
  status: string;
  delivered: boolean;
}

export interface PaymentDeliveryResource {
  key: string;
  name: string;
  provider: "baidu" | "quark";
  url: string;
  passcode?: string;
}

export interface PaymentDelivery {
  purchased: boolean;
  resources: PaymentDeliveryResource[];
}

export async function getPaymentCatalog(): Promise<PaymentCatalog> {
  await ensureOpenid();
  return request<PaymentCatalog>("/pay/catalog");
}

export async function createPaymentOrder(productKey: string): Promise<PaymentOrderData> {
  const code = await loginCode();
  return post<PaymentOrderData>("/pay/order", { code, productKey });
}

export async function getPaymentDelivery(): Promise<PaymentDelivery> {
  const code = await loginCode();
  return post<PaymentDelivery>("/pay/delivery", { code });
}

export async function getPaymentOrderStatus(outTradeNo: string): Promise<PaymentOrderStatus> {
  return request<PaymentOrderStatus>(`/pay/orders/${encodeURIComponent(outTradeNo)}`);
}

export async function payProduct(productKey: string): Promise<PaymentOrderData> {
  if (!canUseVirtualPayment()) {
    throw new Error("当前微信版本不支持虚拟支付，请先升级微信");
  }
  const order = await createPaymentOrder(productKey);
  await requestVirtualPayment(order);
  return order;
}

export async function waitForPaymentDelivery(outTradeNo: string, timeoutMs = 20_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await getPaymentOrderStatus(outTradeNo);
    if (status.delivered) return true;
    await sleep(2000);
  }
  return getPaymentOrderStatus(outTradeNo).then((status) => status.delivered).catch(() => false);
}

export function canUseVirtualPayment(): boolean {
  if (typeof wx.requestVirtualPayment !== "function") return false;
  if (!wx.canIUse || wx.canIUse("requestVirtualPayment")) return true;
  return false;
}

export function checkIosVersion(): boolean {
  const sys = wx.getSystemInfoSync();
  if (sys.platform !== "ios") return true;
  const current = String(sys.version || "").split(".").map((part) => Number(part) || 0);
  const base = [8, 0, 68];
  for (let index = 0; index < 3; index++) {
    if ((current[index] || 0) > base[index]) return true;
    if ((current[index] || 0) < base[index]) break;
  }
  wx.showModal({
    title: "提示",
    content: "请将微信更新至最新版后再进行支付",
    showCancel: false,
  });
  return false;
}

function requestVirtualPayment(order: PaymentOrderData): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.requestVirtualPayment({
      mode: order.mode,
      signData: order.signData as unknown as WechatMiniprogram.SignData,
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

function loginCode(): Promise<string> {
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

function paymentErrorMessage(error: WechatMiniprogram.RequestVirtualPaymentFailCallbackErr) {
  const code = error?.errCode;
  const message = error?.errMsg || "";
  if (code === -2 || message.includes("cancel")) return "已取消支付";
  if (message.includes("not support") || message.includes("no permission")) return "当前微信版本不支持虚拟支付";
  return `支付失败：${message || code || "未知错误"}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
