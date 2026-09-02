# Wallpaper Manager

三端壁纸运营系统：

- 微信小程序：浏览动静态壁纸缩略图，展示短链下载入口。
- 后端：资源、短链、队列、AI 分类审核、网盘同步、wdbzk 入库、腾讯频道发帖。
- 管理端：批量上传、上传后自动处理、任务状态、批量编辑、上下架、手动补网盘链接、系统默认设置、上线诊断、账号与频道配置、老站封面迁移。
- 网盘账号：百度和夸克都在管理端页面授权，支持多账号、独立授权态和按类型设置默认同步账号。
- 腾讯频道账号：Token 在管理端保存，支持多账号；上传批次、资源库单条/批量发帖都可以临时选择账号。

## Domains

- API: `https://wall-api.wdbzk.com`
- Admin: `https://wall-admin.wdbzk.com`
- Short links: `https://r.wdbzk.com`

## Local Development

```powershell
npm install
npm run prisma:generate
npm run dev:api
npm run dev:admin
```

Copy `.env.example` to `apps/api/.env` before running the API.
`DEEPSEEK_API_KEY` is required for automatic publishing because resources without AI safety review are blocked by default.

For local MySQL/Redis:

```powershell
docker compose -f docker-compose.dev.yml up -d
```

## Production

Production deploys from GitHub Actions on every push to `main`.

- Server app path: `/www/wwwroot/wallpaper-manager`
- API domain: `https://wall-api.wdbzk.com`
- Admin domain: `https://wall-admin.wdbzk.com`
- Short links: `https://r.wdbzk.com`

See `docs/deployment.md` for Baota database setup, GitHub Secrets, Nginx configuration, managed storage-account authorization, Tencent channel setup, and the release checklist.

On the server, run this when you want the remaining launch work as copyable actions:

```bash
npm run preflight:env
npm run readiness:launch
npm run readiness:production
```

Before uploading the WeChat Mini Program release, run:

```bash
npm run miniprogram:appid -- wx你的AppID
npm run readiness:miniprogram
```

Storage authorization is completed in the admin web console, not as a shared server login. Open `网盘账号`, add one or more Baidu/Quark accounts, authorize each account, then choose the default account per provider.
For per-batch routing, the upload page and resource-library processing dialog can override the default Baidu/Quark accounts.

Tencent Channel authorization is also completed in the admin web console. Open `腾讯频道`, add one or more tokens, choose guild/channel, and set a default account for system defaults. Upload batches can choose a channel account for auto-posting, and manual channel publishing can choose an account per post.

To verify the managed multi-account storage flow through the admin API:

```bash
npm run smoke:storage-accounts
npm run smoke:storage-accounts -- --auth-start
```

To verify Tencent Channel multi-account configuration through the admin API:

```bash
npm run smoke:channel-accounts
```

To audit the remaining non-published resources that still have active short-link targets:

```bash
npm run cleanup:unpublished-links
```

## Virtual Payment (个人主体小程序)

当前小程序已接入个人主体虚拟支付的「道具直购」能力，用于在原有激励视频之外提供付费直接下载场景：

- 购买 tab：全部壁纸永久下载权益。
- 服务端：`POST /api/pay/order` 下单签名、`POST /api/pay/notify` 发货推送、`GET /api/pay/orders/:outTradeNo` 订单查询，以及 `query_order` 兜底查单。

上线前需在服务器 `.env` 配置：

```dotenv
WECHAT_APP_SECRET=
WECHAT_MESSAGE_TOKEN=
VIRTUAL_PAY_OFFER_ID=
VIRTUAL_PAY_APP_KEY=
VIRTUAL_PAY_LIFETIME_PRODUCT_ID=download_lifetime
VIRTUAL_PAY_LIFETIME_PRICE=100
```

`VIRTUAL_PAY_*_PRODUCT_ID` 需要与微信公众平台「虚拟支付 → 道具管理」中创建并发布的道具 ID、价格完全一致。发货推送 URL 填 `https://wall-api.wdbzk.com/api/pay/notify`。

验收：

```bash
npm run readiness:virtual-payment
```
