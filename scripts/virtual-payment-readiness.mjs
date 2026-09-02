import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const json = process.argv.includes("--json");
const env = {
  ...readDotenv("apps/api/.env"),
  ...process.env,
};

const checks = [];
const manual = [];
const project = readJson("apps/miniprogram/project.config.json");
const paymentService = readText("apps/api/src/modules/payment/payment.service.ts");
const paymentController = readText("apps/api/src/modules/payment/payment.controller.ts");
const paymentFrontend = readText("apps/miniprogram/utils/payment.ts");
const detailFrontend = readText("apps/miniprogram/pages/detail/detail.ts");
const buyFrontend = readText("apps/miniprogram/pages/buy/buy.ts");
const publicService = readText("apps/api/src/modules/public/public.service.ts");

const appid = String(env.MINIPROGRAM_APPID || env.WECHAT_APPID || project.appid || "").trim();
add(/^wx[a-zA-Z0-9]{16,24}$/.test(appid), "appid", "小程序 AppID", appid ? "已配置" : "未配置", "在 apps/miniprogram/project.config.json 或服务器 .env 填写真实 AppID。");

const secret = String(env.WECHAT_APP_SECRET || "").trim();
add(Boolean(secret) && !["CHANGE_ME", ""].includes(secret), "wechat_secret", "微信 AppSecret", secret ? "已配置" : "未配置", "服务器 .env 填写 WECHAT_APP_SECRET。");

const offerId = String(env.VIRTUAL_PAY_OFFER_ID || "").trim();
add(Boolean(offerId) && !["CHANGE_ME", ""].includes(offerId), "offer_id", "虚拟支付 OfferID", offerId ? "已配置" : "未配置", "在 MP 后台「虚拟支付 → 基本配置」获取 OfferID。");

const appKey = String(env.VIRTUAL_PAY_APP_KEY || "").trim();
add(Boolean(appKey) && !["CHANGE_ME", ""].includes(appKey), "app_key", "现网 AppKey", appKey ? "已配置" : "未配置", "在 MP 后台「虚拟支付 → 基本配置」获取现网 AppKey。");

const messageToken = String(env.WECHAT_MESSAGE_TOKEN || "").trim();
add(Boolean(messageToken) && messageToken !== "CHANGE_ME", "message_token", "消息推送 Token", messageToken ? "已配置" : "未配置", "服务器 .env 填写与 MP 后台消息推送配置一致的 WECHAT_MESSAGE_TOKEN。");

add(paymentService.includes("virtualPaymentProducts"), "product_catalog", "后台商品目录", "虚拟支付商品由管理端动态配置，不再依赖单个商品环境变量", "在管理端“系统设置 → 虚拟支付商品”维护道具 ID、价格和权益。");

add(paymentService.includes("requestVirtualPayment&"), "pay_sig", "支付签名 paySig", "服务端已实现 requestVirtualPayment&signData 的 HMAC-SHA256", "保持签名算法与官方一致。");
add(paymentService.includes("/xpay/query_order") && paymentService.includes("syncPendingOrders"), "query_order", "定时兜底查单", "服务端已接入 /xpay/query_order 并每 5 分钟补查待确认订单", "保持 query_order 定时兜底发货逻辑。");
add(paymentController.includes('@Post("notify")'), "notify_route", "发货推送路由", "服务端已提供 POST /api/pay/notify", "在 MP 后台发货推送配置中填写公网回调地址。");
add(paymentService.includes("status === VirtualPaymentOrderStatus.delivered"), "idempotent", "发货幂等", "以订单状态和 wx_order_id 去重", "保留幂等判断，避免重复发货。");
add(paymentService.includes('event === "xpay_refund_notify"'), "refund_notify", "退款通知", "服务端会接收退款通知并撤销对应权益", "上线前分别验证 Android 和 iOS 退款通知。");
add(paymentFrontend.includes("wx.requestVirtualPayment"), "frontend_pay", "前端支付调用", "已调用 wx.requestVirtualPayment", "在真机完成支付联调。");
add(detailFrontend.includes("onPaidDownload"), "frontend_scenario", "永久下载入口", "详情页已增加永久下载权益入口", "按运营需要配置道具价格后发布。");
add(buyFrontend.includes("catalog.products") && buyFrontend.includes("payProduct"), "buy_tab", "动态商品购买 tab", "独立购买页会展示管理端启用的虚拟支付商品", "在管理端确认商品文案、道具 ID 和价格后发布。");
add(publicService.includes("this.payment.downloadAccess"), "entitlement", "付费权益发货", "下载接口已识别单次/包时权益", "保持发货通知和查单补发都写入权益。");
add(existsSync(join(root, "apps/api/prisma/migrations/20260902010000_add_virtual_payment/migration.sql")), "migration", "支付数据表迁移", "虚拟支付订单与权益表迁移文件存在", "部署时执行 npm run prisma:deploy。");

const apiOrigin = String(env.PUBLIC_API_ORIGIN || "https://wall-api.wdbzk.com").replace(/\/$/, "");
manual.push({
  key: "mp_open",
  label: "MP 后台开通虚拟支付",
  message: "需要登录微信开放平台/小程序后台完成开通、资料填写、审核和签约。",
  nextStep: "按指引完成【支付与交易 - 虚拟支付】开通并记录 AppID / OfferID / 现网 AppKey。",
});
manual.push({
  key: "notify_url",
  label: "发货推送 URL 配置",
  message: `代码已就绪，回调地址应为 ${apiOrigin}/api/pay/notify`,
  nextStep: "在 MP 后台【虚拟支付 → 基本配置 → 基础配置 → 发货推送配置】填写该地址并保存。",
});
manual.push({
  key: "test_order",
  label: "小额真单验证",
  message: "需要一台真实微信客户端完成支付 → 发货推送 → 直接保存。",
  nextStep: "用 0.01 元或最低价道具下一笔真实订单，并核对 MP 账单金额。",
});
manual.push({
  key: "rules",
  label: "退款与费率告知",
  message: "官方部署清单要求上线前向用户说明退款、结算周期与费率规则。",
  nextStep: "在独立的“购买须知”或用户协议页面说明，避免占用购买卡片主视觉，并确保支付前可进入查看。",
});

const summary = checks.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, { ok: 0, warn: 0, fail: 0 });
const ok = summary.fail === 0;
const result = { ok, summary, checks, manual };

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printHuman(result);
}

if (!ok) process.exit(1);

function add(conditionOrStatus, key, label, message, nextStep) {
  const status = typeof conditionOrStatus === "string" ? conditionOrStatus : conditionOrStatus ? "ok" : "fail";
  checks.push({ key, label, status, message, nextStep });
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

function readDotenv(path) {
  const fullPath = join(root, path);
  if (!existsSync(fullPath)) return {};
  return Object.fromEntries(
    readFileSync(fullPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return index === -1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1).trim()];
      }),
  );
}

function printHuman(data) {
  console.log("Virtual payment readiness");
  console.log(`Checks: ok ${data.summary.ok}, fail ${data.summary.fail}`);
  for (const check of data.checks) {
    console.log(`- [${check.status}] ${check.label} (${check.key})`);
    console.log(`  ${check.message}`);
    if (check.status !== "ok" && check.nextStep) console.log(`  Next: ${check.nextStep}`);
  }
  console.log("\nManual actions:");
  for (const item of data.manual) {
    console.log(`- [manual] ${item.label} (${item.key})`);
    console.log(`  ${item.message}`);
    console.log(`  Next: ${item.nextStep}`);
  }
}
