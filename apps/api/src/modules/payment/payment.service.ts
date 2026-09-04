import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma, VirtualPaymentOrderStatus } from "@prisma/client";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

type EntitlementType = "single_download" | "unlimited_days" | "unlimited_permanent" | "remove_ads_days";

type ProductConfig = {
  key: string;
  productId: string;
  name: string;
  description: string;
  goodsPrice: number;
  buyQuantity: number;
  entitlementType: EntitlementType;
  entitlementValue: number;
  enabled: boolean;
};

type DeliveryResource = {
  key: string;
  name: string;
  provider: "baidu" | "quark";
  url: string;
  passcode?: string;
};

type WechatSession = {
  openid: string;
  sessionKey: string;
};

type WechatOrder = {
  order_id?: string;
  status?: number;
  wx_order_id?: string;
  paid_time?: number;
  order_fee?: number;
  paid_fee?: number;
};

type ParsedNotify = {
  Event?: unknown;
  OpenId?: unknown;
  OutTradeNo?: unknown;
  Env?: unknown;
  GoodsInfo?: {
    ProductId?: unknown;
    Quantity?: unknown;
    OrigPrice?: unknown;
    ActualPrice?: unknown;
    Attach?: unknown;
  };
  WeChatPayInfo?: {
    MchOrderNo?: unknown;
    TransactionId?: unknown;
    PaidTime?: unknown;
  };
  [key: string]: unknown;
};

type DownloadAccess =
  | { allowed: false; type: null }
  | { allowed: true; type: "paid_unlimited"; expiresAt: string }
  | { allowed: true; type: "paid_permanent" }
  | { allowed: true; type: "paid_single"; remaining: number };

@Injectable()
export class PaymentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentService.name);
  private accessToken?: { token: string; expiresAt: number };
  private orderSyncTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    this.orderSyncTimer = setInterval(() => void this.syncPendingOrders(), 5 * 60_000);
    this.orderSyncTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.orderSyncTimer) clearInterval(this.orderSyncTimer);
  }

  async catalog(openid?: string) {
    const entitlement = openid ? await this.entitlementStatus(openid) : null;
    const products = await this.products();
    return {
      offerId: this.requireOfferId(false),
      products: products
        .filter((product) => product.enabled && !(entitlement?.permanent && product.entitlementType === "unlimited_permanent"))
        .map((product) => ({
        key: product.key,
        name: product.name,
        description: product.description,
        price: product.goodsPrice,
        priceText: formatPrice(product.goodsPrice),
        entitlementType: product.entitlementType,
        entitlementValue: product.entitlementValue,
      })),
      entitlement,
    };
  }

  async delivery(code: string) {
    if (!code?.trim()) throw new BadRequestException("缺少微信登录凭证");
    const session = await this.code2Session(code);
    const entitlement = await this.entitlementStatus(session.openid);
    return {
      purchased: entitlement.permanent,
      resources: entitlement.permanent ? await this.deliveryResources() : [],
    };
  }

  async openidForCode(code: string) {
    if (!code?.trim()) throw new BadRequestException("缺少微信登录凭证");
    return (await this.code2Session(code)).openid;
  }

  async createOrder(code: string, productKey: string) {
    if (!code?.trim()) throw new BadRequestException("缺少微信登录凭证");
    const session = await this.code2Session(code);
    const product = (await this.products()).find((item) => item.enabled && item.key === productKey);
    if (!product) throw new BadRequestException("虚拟支付商品不存在或未配置");
    if (product.entitlementType === "unlimited_permanent") {
      const entitlement = await this.entitlementStatus(session.openid);
      if (entitlement.permanent) throw new BadRequestException("已经永久解锁，无需重复购买");
    }
    this.assertServerConfig();

    const offerId = this.requireOfferId();
    const appKey = this.requireAppKey();
    const outTradeNo = this.createOutTradeNo();
    const attach = JSON.stringify({
      openid: session.openid,
      productKey: product.key,
      productName: product.name,
      entitlementType: product.entitlementType,
      entitlementValue: product.entitlementValue,
      source: "wallpaper-manager",
    });
    const signData = JSON.stringify({
      offerId,
      buyQuantity: product.buyQuantity,
      env: 0,
      currencyType: "CNY",
      productId: product.productId,
      goodsPrice: product.goodsPrice,
      outTradeNo,
      attach,
    });
    const paySig = hmacHex(appKey, `requestVirtualPayment&${signData}`);
    const signature = hmacHex(session.sessionKey, signData);

    await this.prisma.virtualPaymentOrder.create({
      data: {
        outTradeNo,
        openid: session.openid,
        productKey: product.key,
        productId: product.productId,
        goodsPrice: product.goodsPrice,
        buyQuantity: product.buyQuantity,
        totalFee: product.goodsPrice * product.buyQuantity,
        status: VirtualPaymentOrderStatus.pending,
        attach,
        signData,
        paySig,
        signature,
      },
    });

    return {
      outTradeNo,
      mode: "short_series_goods" as const,
      signData,
      paySig,
      signature,
      product: {
        key: product.key,
        name: product.name,
        price: product.goodsPrice,
        priceText: formatPrice(product.goodsPrice),
      },
    };
  }

  async orderStatus(openid: string, outTradeNo: string) {
    const order = await this.prisma.virtualPaymentOrder.findUnique({ where: { outTradeNo } });
    if (!order) throw new NotFoundException("订单不存在");
    if (order.openid !== openid) throw new BadRequestException("订单与当前用户不匹配");
    if (order.status === VirtualPaymentOrderStatus.delivered) {
      return { outTradeNo: order.outTradeNo, status: order.status, delivered: true };
    }
    await this.syncOrder(order.outTradeNo);
    const fresh = await this.prisma.virtualPaymentOrder.findUniqueOrThrow({ where: { outTradeNo } });
    return {
      outTradeNo: fresh.outTradeNo,
      status: fresh.status,
      delivered: fresh.status === VirtualPaymentOrderStatus.delivered,
    };
  }

  async notify(
    rawBody: string,
    query: { signature?: string; timestamp?: string; nonce?: string; echostr?: string } = {},
    contentType = "",
  ): Promise<string | { ErrCode: number; ErrMsg: string }> {
    if (!this.verifyMessageSignature(query)) {
      return this.notifyResponse(contentType, "签名校验失败");
    }
    const jsonMode = contentType.toLowerCase().includes("json") || rawBody.trimStart().startsWith("{");
    const parsed = jsonMode ? parseJsonNotify(rawBody) : parseNotifyXml(rawBody);
    const event = asText(parsed.Event);
    if (event === "xpay_refund_notify") {
      return this.handleRefundNotify(parsed, contentType);
    }
    if (event !== "xpay_goods_deliver_notify") {
      this.logger.warn(`忽略非发货事件：${event || "未知"}`);
      return this.notifyResponse(contentType, "", true);
    }

    const openid = asText(parsed.OpenId);
    const outTradeNo = asText(parsed.OutTradeNo);
    const productId = asText(parsed.GoodsInfo?.ProductId);
    const quantity = asNumber(parsed.GoodsInfo?.Quantity, 0);
    const actualPrice = asNumber(parsed.GoodsInfo?.ActualPrice, 0);
    const wxOrderId = asText(parsed.WeChatPayInfo?.MchOrderNo);
    const paidTime = asNumber(parsed.WeChatPayInfo?.PaidTime, 0);
    if (!openid || !outTradeNo || !productId || !quantity) {
      this.logger.error("发货推送缺少 openid、outTradeNo、productId 或 quantity", parsed);
      return this.notifyResponse(contentType, "发货推送字段不完整");
    }

    const order = await this.prisma.virtualPaymentOrder.findUnique({ where: { outTradeNo } });
    if (!order) {
      this.logger.warn(`收到本地不存在的订单发货推送：${outTradeNo}`);
      return this.notifyResponse(contentType, "", true);
    }
    if (order.openid !== openid || order.productId !== productId) {
      this.logger.error("发货推送订单信息不匹配", { order, parsed });
      return this.notifyResponse(contentType, "订单信息不匹配");
    }
    if (quantity !== order.buyQuantity) {
      this.logger.error("发货推送购买数量不匹配", { expected: order.buyQuantity, actual: quantity });
      return this.notifyResponse(contentType, "订单数量不匹配");
    }
    if (wxOrderId) {
      const deliveredOrder = await this.prisma.virtualPaymentOrder.findFirst({
        where: { wxOrderId, status: VirtualPaymentOrderStatus.delivered },
        select: { outTradeNo: true },
      });
      if (deliveredOrder && deliveredOrder.outTradeNo !== outTradeNo) {
        this.logger.error("平台订单号已关联其他已发货订单", { wxOrderId, outTradeNo });
        return this.notifyResponse(contentType, "平台订单号冲突");
      }
    }
    if (!actualPrice || actualPrice !== order.totalFee) {
      this.logger.error("发货推送金额不匹配", { expected: order.totalFee, actual: actualPrice });
      return this.notifyResponse(contentType, "订单金额不匹配");
    }

    const delivered = await this.deliverOrder(order.outTradeNo, {
      wxOrderId,
      paidTime,
      rawPayload: parsed as unknown as Prisma.InputJsonValue,
    });
    if (!delivered) return this.notifyResponse(contentType, "发货失败");
    return this.notifyResponse(contentType, "", true);
  }

  async verifyNotifyUrl(query: { signature?: string; timestamp?: string; nonce?: string; echostr?: string }) {
    if (!this.verifyMessageSignature(query)) throw new BadRequestException("签名校验失败");
    return query.echostr || "";
  }

  async entitlementStatus(openid: string) {
    const now = new Date();
    const rows = await this.prisma.virtualPaymentEntitlement.findMany({
      where: {
        openid,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
    });
    let singleRemaining = 0;
    let unlimitedUntil: Date | null = null;
    let removeAdsUntil: Date | null = null;
    let permanent = false;
    for (const row of rows) {
      if (row.type === "single_download") singleRemaining += Math.max(0, row.remaining);
      if (row.type === "unlimited_days") unlimitedUntil = later(unlimitedUntil, row.expiresAt);
      if (row.type === "unlimited_permanent") permanent = true;
      if (row.type === "remove_ads_days") removeAdsUntil = later(removeAdsUntil, row.expiresAt);
    }
    return {
      singleRemaining,
      unlimitedUntil: unlimitedUntil?.toISOString() || null,
      removeAdsUntil: removeAdsUntil?.toISOString() || null,
      permanent,
      hasPaidDownload: permanent || singleRemaining > 0 || (unlimitedUntil ? unlimitedUntil > now : false),
      hasRemoveAds: Boolean(removeAdsUntil && removeAdsUntil > now),
    };
  }

  async downloadAccess(openid: string): Promise<DownloadAccess> {
    const status = await this.entitlementStatus(openid);
    if (status.permanent) {
      return { allowed: true, type: "paid_permanent" };
    }
    if (status.unlimitedUntil && new Date(status.unlimitedUntil) > new Date()) {
      return { allowed: true, type: "paid_unlimited" as const, expiresAt: status.unlimitedUntil };
    }
    if (status.singleRemaining > 0) {
      return { allowed: true, type: "paid_single" as const, remaining: status.singleRemaining };
    }
    return { allowed: false, type: null };
  }

  async consumeDownloadAccess(openid: string, access: { type: "paid_unlimited" | "paid_permanent" | "paid_single" }) {
    if (access.type === "paid_unlimited" || access.type === "paid_permanent") return;
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.virtualPaymentEntitlement.findFirst({
        where: { openid, type: "single_download", remaining: { gt: 0 } },
        orderBy: { createdAt: "asc" },
      });
      if (!row) throw new BadRequestException("付费下载次数已用完");
      await tx.virtualPaymentEntitlement.update({
        where: { id: row.id },
        data: { remaining: { decrement: 1 } },
      });
    });
  }

  async hasRemoveAdsAccess(openid: string) {
    const status = await this.entitlementStatus(openid);
    return status.hasRemoveAds;
  }

  private async syncOrder(outTradeNo: string) {
    const order = await this.prisma.virtualPaymentOrder.findUniqueOrThrow({ where: { outTradeNo } });
    const response = await this.queryWechatOrder(order.openid, order.outTradeNo);
    const status = response?.order?.status;
    if (status === 2 || status === 3 || status === 4) {
      await this.deliverOrder(order.outTradeNo, {
        wxOrderId: response.order?.wx_order_id || order.wxOrderId || undefined,
        paidTime: response.order?.paid_time || 0,
        rawPayload: (response.order || {}) as unknown as Prisma.InputJsonValue,
      });
      return;
    }
    const mapped = mapWechatOrderStatus(status);
    if (mapped && mapped !== order.status) {
      await this.prisma.virtualPaymentOrder.update({
        where: { outTradeNo },
        data: { status: mapped, lastQueryAt: new Date() },
      });
    }
  }

  private async syncPendingOrders() {
    if (!this.config.get<string>("VIRTUAL_PAY_OFFER_ID")?.trim() || !this.config.get<string>("VIRTUAL_PAY_APP_KEY")?.trim()) return;
    const staleBefore = new Date(Date.now() - 5 * 60_000);
    const recentAfter = new Date(Date.now() - 24 * 60 * 60_000);
    const orders = await this.prisma.virtualPaymentOrder.findMany({
      where: {
        status: { in: [VirtualPaymentOrderStatus.pending, VirtualPaymentOrderStatus.paid] },
        createdAt: { gt: recentAfter },
        OR: [{ lastQueryAt: null }, { lastQueryAt: { lt: staleBefore } }],
      },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: { outTradeNo: true },
    });
    for (const order of orders) {
      try {
        await this.syncOrder(order.outTradeNo);
      } catch (error) {
        this.logger.warn(`虚拟支付兜底查单失败：${order.outTradeNo} ${(error as Error).message}`);
      }
    }
  }

  private async handleRefundNotify(parsed: ParsedNotify, contentType: string) {
    const outTradeNo = asText(parsed.OutTradeNo);
    if (!outTradeNo) return this.notifyResponse(contentType, "退款通知缺少 OutTradeNo");
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.virtualPaymentOrder.findUnique({ where: { outTradeNo }, select: { outTradeNo: true } });
      if (!order) return;
      await tx.virtualPaymentEntitlement.deleteMany({ where: { sourceOrderId: outTradeNo } });
      await tx.virtualPaymentOrder.update({
        where: { outTradeNo },
        data: { status: VirtualPaymentOrderStatus.refunded, rawPayload: parsed as unknown as Prisma.InputJsonValue },
      });
    });
    return this.notifyResponse(contentType, "", true);
  }

  private async deliverOrder(
    outTradeNo: string,
    payload: { wxOrderId?: string; paidTime?: number; rawPayload?: Prisma.InputJsonValue },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.virtualPaymentOrder.findUnique({ where: { outTradeNo } });
      if (!order) return false;
      if (order.status === VirtualPaymentOrderStatus.delivered) return true;
      const now = new Date();
      await tx.virtualPaymentOrder.update({
        where: { outTradeNo },
        data: {
          status: VirtualPaymentOrderStatus.delivered,
          wxOrderId: payload.wxOrderId || order.wxOrderId || undefined,
          rawPayload: payload.rawPayload || order.rawPayload || undefined,
          paidAt: payload.paidTime ? new Date(payload.paidTime * 1000) : now,
          deliveredAt: now,
          lastQueryAt: now,
        },
      });
      await this.grantEntitlement(tx, {
        openid: order.openid,
        productKey: order.productKey,
        quantity: order.buyQuantity,
        attach: order.attach,
        sourceOrderId: order.outTradeNo,
      });
      return true;
    });
  }

  private async grantEntitlement(
    tx: Prisma.TransactionClient,
    order: { openid: string; productKey: string; quantity: number; attach: string; sourceOrderId: string },
  ) {
    const attach = parseJson<{ entitlementType?: EntitlementType; entitlementValue?: number }>(order.attach);
    // 权益以创建订单时写入 attach 的快照为准，避免后台后续修改商品影响历史订单发货。
    const entitlementType = attach.entitlementType || "single_download";
    const entitlementValue = Number(attach.entitlementValue ?? 1);

    if (entitlementType === "single_download") {
      await tx.virtualPaymentEntitlement.create({
        data: {
          openid: order.openid,
          type: "single_download",
          remaining: order.quantity * Math.max(1, entitlementValue),
          sourceOrderId: order.sourceOrderId,
        },
      });
      return;
    }

    if (entitlementType === "unlimited_permanent") {
      await tx.virtualPaymentEntitlement.create({
        data: {
          openid: order.openid,
          type: "unlimited_permanent",
          sourceOrderId: order.sourceOrderId,
        },
      });
      return;
    }

    const active = await tx.virtualPaymentEntitlement.findFirst({
      where: {
        openid: order.openid,
        type: entitlementType,
        expiresAt: { gt: new Date() },
      },
      orderBy: { expiresAt: "desc" },
    });
    const base = active?.expiresAt && active.expiresAt > new Date() ? active.expiresAt : new Date();
    const expiresAt = new Date(base.getTime() + entitlementValue * 24 * 60 * 60 * 1000);
    await tx.virtualPaymentEntitlement.create({
      data: {
        openid: order.openid,
        type: entitlementType,
        expiresAt,
        sourceOrderId: order.sourceOrderId,
      },
    });
  }

  private async queryWechatOrder(openid: string, outTradeNo: string) {
    this.assertServerConfig();
    const accessToken = await this.getAccessToken();
    const postBody = JSON.stringify({ openid, env: 0, order_id: outTradeNo });
    const uri = "/xpay/query_order";
    const paySig = hmacHex(this.requireAppKey(), `${uri}&${postBody}`);
    const url = new URL("https://api.weixin.qq.com/xpay/query_order");
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("pay_sig", paySig);
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: postBody,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json()) as { errcode?: number; errmsg?: string; order?: WechatOrder };
    if (body.errcode !== 0 || !body.order) {
      throw new ServiceUnavailableException(body.errmsg || "虚拟支付查单失败");
    }
    await this.prisma.virtualPaymentOrder.update({
      where: { outTradeNo },
      data: { lastQueryAt: new Date() },
    });
    return body;
  }

  private async getAccessToken() {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.token;
    }
    const appid = this.requireMiniProgramAppid();
    const secret = this.config.get<string>("WECHAT_APP_SECRET")?.trim();
    if (!secret) throw new BadRequestException("WECHAT_APP_SECRET 未配置");
    const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
    url.searchParams.set("grant_type", "client_credential");
    url.searchParams.set("appid", appid);
    url.searchParams.set("secret", secret);
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    const body = (await response.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
    if (!body.access_token) throw new ServiceUnavailableException(body.errmsg || "获取微信 access_token 失败");
    this.accessToken = {
      token: body.access_token,
      expiresAt: Date.now() + Math.max(0, Number(body.expires_in || 7200)) * 1000,
    };
    return this.accessToken.token;
  }

  private async code2Session(code: string): Promise<WechatSession> {
    const appid = this.requireMiniProgramAppid();
    const secret = this.config.get<string>("WECHAT_APP_SECRET")?.trim();
    if (!secret) throw new BadRequestException("WECHAT_APP_SECRET 未配置");
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set("appid", appid);
    url.searchParams.set("secret", secret);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    const body = (await response.json()) as { openid?: string; session_key?: string; errcode?: number; errmsg?: string };
    if (!body.openid || !body.session_key) {
      throw new BadRequestException(body.errmsg || "微信登录失败，请重新进入小程序");
    }
    return { openid: body.openid, sessionKey: body.session_key };
  }

  private createOutTradeNo() {
    const stamp = Date.now().toString(36).toUpperCase();
    const random = randomBytes(6).toString("hex").toUpperCase();
    const value = `VP${stamp}${random}`;
    return value.slice(0, 32);
  }

  private assertServerConfig() {
    this.requireOfferId();
    this.requireAppKey();
    this.requireMiniProgramAppid();
  }

  private requireOfferId(required = true) {
    const value = this.config.get<string>("VIRTUAL_PAY_OFFER_ID")?.trim() || "";
    if (required && !value) throw new BadRequestException("VIRTUAL_PAY_OFFER_ID 未配置");
    return value;
  }

  private requireAppKey() {
    const value = this.config.get<string>("VIRTUAL_PAY_APP_KEY")?.trim() || "";
    if (!value) throw new BadRequestException("VIRTUAL_PAY_APP_KEY 未配置");
    return value;
  }

  private requireMiniProgramAppid() {
    const value = this.config.get<string>("MINIPROGRAM_APPID")?.trim() || this.config.get<string>("WECHAT_APPID")?.trim() || "";
    if (!value) throw new BadRequestException("MINIPROGRAM_APPID 未配置");
    return value;
  }

  private async products(): Promise<ProductConfig[]> {
    const defaults: ProductConfig[] = [
      {
        key: "direct_download_lifetime",
        productId: "download_lifetime",
        name: "全部壁纸永久下载权益",
        description: "购买后获得全部壁纸资源，一次购买永久有效，并享会员免费求图权益。",
        goodsPrice: 100,
        buyQuantity: 1,
        entitlementType: "unlimited_permanent",
        entitlementValue: 0,
        enabled: true,
      },
    ];
    const row = await this.prisma.setting.findUnique({ where: { key: "system" }, select: { value: true } });
    const configured = (row?.value as { virtualPaymentProducts?: unknown } | null)?.virtualPaymentProducts;
    if (!Array.isArray(configured)) return defaults;
    return configured.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      const entitlementType = String(item.entitlementType || "");
      if (!isEntitlementType(entitlementType)) return [];
      const key = String(item.key || "").trim();
      const productId = String(item.productId || "").trim();
      const name = String(item.name || "").trim();
      const goodsPrice = Number(item.goodsPrice);
      const buyQuantity = Number(item.buyQuantity || 1);
      const entitlementValue = Number(item.entitlementValue || 0);
      if (!key || !productId || !name || !Number.isInteger(goodsPrice) || goodsPrice <= 0) return [];
      return [{
        key,
        productId,
        name,
        description: String(item.description || "").trim(),
        goodsPrice,
        buyQuantity: Number.isInteger(buyQuantity) && buyQuantity > 0 ? buyQuantity : 1,
        entitlementType,
        entitlementValue: Number.isInteger(entitlementValue) && entitlementValue >= 0 ? entitlementValue : 0,
        enabled: item.enabled !== false,
      }];
    });
  }

  private async deliveryResources(): Promise<DeliveryResource[]> {
    const defaults: Omit<DeliveryResource, "key">[] = [
      {
        name: "百度网盘 1",
        provider: "baidu",
        url: "https://pan.baidu.com/s/1GXNyw2r1PdBxiELPFdw7GQ?pwd=8888",
        passcode: "8888",
      },
      {
        name: "百度网盘 2",
        provider: "baidu",
        url: "https://pan.baidu.com/s/1mrjt24X6mE6SGufD640k9w?pwd=8888",
        passcode: "8888",
      },
      {
        name: "夸克网盘 1",
        provider: "quark",
        url: "https://pan.quark.cn/s/a9f27f37d4bf",
      },
      {
        name: "夸克网盘 2",
        provider: "quark",
        url: "https://pan.quark.cn/s/69df606f9f99",
      },
    ];
    const row = await this.prisma.setting.findUnique({ where: { key: "system" }, select: { value: true } });
    const configured = (row?.value as { permanentDeliveryResources?: unknown } | null)?.permanentDeliveryResources;
    const resources = Array.isArray(configured) ? configured : defaults;
    return resources.flatMap((raw, index) => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Record<string, unknown>;
      const name = String(item.name || "").trim();
      const url = String(item.url || "").trim();
      if (!name || !url) return [];
      const passcode = String(item.passcode || "").trim();
      return [{
        key: `delivery-${index + 1}`,
        name,
        provider: item.provider === "quark" ? "quark" as const : "baidu" as const,
        url,
        ...(passcode ? { passcode } : {}),
      }];
    });
  }

  private notifyResponse(contentType: string, message: string, success = false) {
    const jsonMode = contentType.toLowerCase().includes("json");
    if (jsonMode) {
      return success ? { ErrCode: 0, ErrMsg: "success" } : { ErrCode: -1, ErrMsg: message };
    }
    return success ? xmlSuccess() : xmlError(message);
  }

  private verifyMessageSignature(query: { signature?: string; timestamp?: string; nonce?: string; echostr?: string }) {
    const token = this.config.get<string>("WECHAT_MESSAGE_TOKEN")?.trim() || "";
    if (!token) {
      this.logger.error("WECHAT_MESSAGE_TOKEN 未配置，拒绝处理虚拟支付通知");
      return false;
    }
    if (!query.signature || !query.timestamp || !query.nonce) return false;
    const raw = [token, query.timestamp, query.nonce].sort().join("");
    return createHash("sha1").update(raw).digest("hex") === query.signature;
  }
}

function parseNotifyXml(raw: string): ParsedNotify {
  const root = parseXmlObject(raw);
  const wechatPayload = extractXmlElement(raw, "WeChatPayInfo");
  const goodsPayload = extractXmlElement(raw, "GoodsInfo");
  return {
    ...root,
    WeChatPayInfo: wechatPayload ? parseXmlObject(wechatPayload) : undefined,
    GoodsInfo: goodsPayload ? parseXmlObject(goodsPayload) : undefined,
  };
}

function parseJsonNotify(raw: string): ParsedNotify {
  const payload = parseJson<Record<string, unknown>>(raw);
  return {
    Event: firstValue(payload, "Event", "event"),
    OpenId: firstValue(payload, "OpenId", "openid", "openId"),
    OutTradeNo: firstValue(payload, "OutTradeNo", "outTradeNo", "out_trade_no"),
    Env: firstValue(payload, "Env", "env"),
    WeChatPayInfo: normalizeNestedNotify(firstValue(payload, "WeChatPayInfo", "weChatPayInfo")) as ParsedNotify["WeChatPayInfo"],
    GoodsInfo: normalizeGoodsInfo(firstValue(payload, "GoodsInfo", "goodsInfo")),
  };
}

function normalizeGoodsInfo(value: unknown): ParsedNotify["GoodsInfo"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  return {
    ProductId: firstValue(source, "ProductId", "productId", "product_id"),
    Quantity: firstValue(source, "Quantity", "quantity"),
    OrigPrice: firstValue(source, "OrigPrice", "origPrice", "orig_price"),
    ActualPrice: firstValue(source, "ActualPrice", "actualPrice", "actual_price"),
    Attach: firstValue(source, "Attach", "attach"),
  };
}

function normalizeNestedNotify(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  return {
    MchOrderNo: firstValue(source, "MchOrderNo", "mchOrderNo", "mch_order_no"),
    TransactionId: firstValue(source, "TransactionId", "transactionId", "transaction_id"),
    PaidTime: firstValue(source, "PaidTime", "paidTime", "paid_time"),
  };
}

function firstValue(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function parseXmlObject(xml: string) {
  const result: Record<string, unknown> = {};
  const tagPattern = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml))) {
    const tag = match[1];
    const rawValue = match[2];
    if (!(tag in result)) result[tag] = decodeXmlValue(rawValue);
  }
  return result;
}

function extractXmlElement(xml: string, tag: string) {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
  return xml.match(pattern)?.[1] || "";
}

function decodeXmlValue(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function hmacHex(secret: string, message: string) {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

function isEntitlementType(value: string): value is EntitlementType {
  return ["single_download", "unlimited_days", "unlimited_permanent", "remove_ads_days"].includes(value);
}

function formatPrice(value: number) {
  const yuan = value / 100;
  return Number.isInteger(yuan) ? `¥${yuan}` : `¥${yuan.toFixed(2)}`;
}

function asText(value: unknown) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function asNumber(value: unknown, fallback: number) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseJson<T>(value: string): Partial<T> {
  try {
    return JSON.parse(value) as Partial<T>;
  } catch {
    return {};
  }
}

function later(left: Date | null, right: Date | null) {
  if (!left) return right;
  if (!right) return left;
  return right > left ? right : left;
}

function mapWechatOrderStatus(status?: number): VirtualPaymentOrderStatus | null {
  if (status === 2 || status === 3) return VirtualPaymentOrderStatus.paid;
  if (status === 4) return VirtualPaymentOrderStatus.delivered;
  if (status === 5 || status === 8) return VirtualPaymentOrderStatus.refunded;
  if (status === 6) return VirtualPaymentOrderStatus.closed;
  if (status === 7) return VirtualPaymentOrderStatus.failed;
  return null;
}

function xmlSuccess() {
  return "<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>";
}

function xmlError(message: string) {
  return `<xml><ErrCode>-1</ErrCode><ErrMsg><![CDATA[${escapeXml(message)}]]></ErrMsg></xml>`;
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) => {
    const map: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return map[character];
  });
}
