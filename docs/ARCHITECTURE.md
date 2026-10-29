# Wallpaper Manager 项目架构

> 三端壁纸运营系统：微信小程序（C 端浏览/下载/付费）+ 管理端（内容运营中台）+ NestJS 后端（资源、短链、队列、AI 审核、网盘同步、频道发帖）。
> 另含 WallMuse 子系统（二次元文章生成 + 公众号合集同步）。

---

## 一、总体形态

npm workspaces 单体仓库（monorepo），4 个 workspace，总代码约 **19.3k 行**（后端 13.5k / 小程序 4.7k / 管理端 3.4k / 共享 54 行）。

```
wallpaper-manager/
├── apps/api/          NestJS 后端（核心，13.5k 行）
├── apps/admin/        React 19 管理端 SPA
├── apps/miniprogram/  微信小程序（原生）
├── packages/shared/   跨端类型与常量
├── scripts/           17 个运维/验收脚本（readiness、smoke、verify-release）
├── deploy/            Nginx conf、服务器 bootstrap、发布打包、生产 env 样例
├── docs/              deployment.md / queue-recovery.md / wallmuse.md / ARCHITECTURE.md
└── storage/           public（静态资源）/ tmp-uploads / tmp-bridge（临时中转）
```

**技术栈总览**

| 层 | 技术 |
|---|---|
| 后端 | NestJS 11、Prisma 6.12、MySQL、BullMQ + Redis(ioredis)、sharp、multer、zod、bcryptjs、nanoid、JWT |
| 管理端 | React 19、Vite 8、Ant Design 6、lucide-react、dayjs |
| 小程序 | 微信原生（TS 编译 + JS 产物双份入库）、miniprogram-api-typings |
| 共享 | 纯 TS 类型/常量包 `@wallpaper-manager/shared` |
| 运行时 | Node ≥ 22.12.0，生产 PM2（ecosystem.config.cjs） |

---

## 二、后端架构（apps/api）

### 2.1 启动与全局配置

`main.ts` 关键点：

- 全局前缀 `api`，**排除** `/health` 与 `/r/:code`（短链不放前缀）。
- 端口 4000，监听 `0.0.0.0`，`trust proxy = 1`。
- CORS 白名单：管理端域名 + Tauri 桌面端 origins（`tauri://localhost` 等）。
- 全局 `ValidationPipe({ whitelist, transform })`。
- **生产环境强校验** `assertProductionConfig()`：ADMIN_PASSWORD ≥12 位、JWT_SECRET ≥32 位、DATABASE_URL 非默认值、三个域名必须精确匹配，否则启动失败。

### 2.2 模块划分（14 个业务模块）

| 模块 | 职责 |
|---|---|
| `prisma` | 数据库服务 |
| `auth` | 管理员 JWT 登录 |
| `public` | C 端公开 API（列表/详情/短链跳转/下载/收藏/激励/求图） |
| `admin` | 管理端 API（上传、资源库、批量操作、设置、诊断、账号配置）——**最重** |
| `ai` | DeepSeek 视觉模型：分类 + 安全审核（zod 结构化输出） |
| `storage` | 百度/夸克网盘多账号上传与分享；存储协调器 |
| `channel` | 腾讯频道发帖（token 加密存储，多账号） |
| `wdbzk` | wdbzk 资源站入库（HTTP + token） |
| `tasks` | 任务队列查询与摘要 |
| `payment` | 微信虚拟支付（道具直购）下单/发货/查单 |
| `import` | 老站封面迁移 |
| `sources` | 外部来源采集 + `WorkLease` 租约 |
| `wallmuse` | 文章生成与公众号合集子系统 |
| `health` | 健康检查 |

### 2.3 API 路由面

| 控制器 | 前缀 | 代表端点 |
|---|---|---|
| `PublicController` | `api` | `wallpapers`、`wallpapers/facets`、`wallpapers/random`、`/r/:code`、`downloads/file/:token`、`reward/watch`、`user/*`、`wallpapers/upload` |
| `AdminController` | `api/admin` | `uploads`、`wallpapers/bulk/*`、`wallpapers/:id/process`、`storage-accounts/*`、`channels/*`、`settings`、`diagnostics`、`readiness`、`analytics` |
| `PaymentController` | `api/pay` | `order`、`notify`、`orders/:outTradeNo`、`catalog`、`delivery` |
| `TasksController` | `api/tasks` | 列表、`summary` |
| `ImportController` | `api/import` | `preview`、`run`、`classify`、`records`、`stats` |
| `WallMuseController` | `api/wallmuse` | `articles`、`articles/:id/assets`、`tasks/:id/retry`、`tasks/:id/cancel`、`capabilities` |
| `CollectionsController` | `api/wallmuse/collections` | 合集公开读取 |

静态资源通过 `ServeStaticModule` 以 `/assets` 暴露 `storage/public`。

---

## 三、数据模型（Prisma / MySQL，22 次迁移）

**29 个模型 + 9 个枚举**，分五组：

```
① 内容核心       Wallpaper(中心) ─ Tag/WallpaperTag, AiAnalysis, WallpaperSource,
                 WallpaperClick, UserFavorite, UserDownload
② 分发与网盘     StorageLink, StorageAccount(多账号/默认), ShortLink, DownloadToken
③ 运营与任务     Task, Setting, SearchLog, AutoPublishBoard, ChannelAccount, OldCoverImport
④ 变现与互动     VirtualPaymentOrder, VirtualPaymentEntitlement,
                 WallpaperReward, WallpaperRequest(会员求图)
⑤ 并发控制       WorkLease（DB 租约）
⑥ WallMuse       WallMuseArticle, WallMuseRevision, WallMuseJob, WallMuseAsset,
                 WallMuseCollection, WallMuseCollectionItem
```

核心状态机：

- `WallpaperStatus`: `draft → processing → pending_review → published / rejected → archived`
- `TaskType`: `upload_asset / ai_classify / quark_sync / baidu_sync / wdbzk_sync / channel_publish / old_cover_import / asset_fetch / auto_publish`
- `TaskStatus`: `queued / running / success / failed / skipped`

去重设计：`Wallpaper.contentHash`（SHA-256，唯一）、`WallpaperSource` 唯一 `(source, sourceId)`、`matchKey` 索引。

---

## 四、异步与队列架构（本项目最核心的设计）

### 4.1 双引擎：BullMQ 队列 + 自研 DB 调度器

只有 **一条 BullMQ 队列 `"wallpaper"`**，processor `concurrency: 1`，任务名 `process-wallpaper` / `process-wallpaper-batch`。
设计原则（源码注释）：**MySQL 是持久化任务账本，Redis 只是派发队列，单 API 实例。**

### 4.2 队列恢复 `QueueRecoveryService`

- 每 60s 扫描 `Task`：`type ∈ {upload_asset, auto_publish}`、`status ∈ {queued, running}`、`updatedAt < now-2min`，每轮最多 100 条（游标分页）。
- 与 Redis 实时 jobs 交叉核对（`active/wait/delayed/paused/prioritized/waiting-children`）。
- **安全闸门**（防止重放）：从未开始执行、无 AI/网盘/上架痕迹、本地原文件仍存在、`queue.getJob(task.id)` 不存在（绝不复用终态 job）。
- 乐观认领：`updateMany({ where: { id, status:"queued", updatedAt: task.updatedAt }})`。
- 24h 后清理过期失败任务；`cleanupPending` 供后续对账重试。

### 4.3 检查点（Checkpoint）

- 上传任务：按「资源保存审核 → 网盘同步 → 资源入库 → 发帖」分段，百度/夸克分别记录账号、上传路径/文件 ID、分享链接。已完成阶段不重做；结果不明时先查远端核对，禁止盲目重放。
- 自动发帖：7 阶段（桥接下载 → 保存入库 → AI 审核 → 准备网盘上传 → 网盘上传中 → 准备发帖 → 发帖中 → 已取得回执）。写入 `Task.payload`，与资源入库、来源去重**同一事务提交**。
- 桥接下载用 `storage/tmp-bridge` 文件 + 元信息，跨重启核对 URL/强 ETag/长度/Range，不整份缓存在内存。

### 4.4 WorkLease：数据库栅栏租约

`WorkLease(key PK, owner, expiresAt)`：TTL 180s，每 30s 心跳；抢占仅允许 `expiresAt < now`；
`fence.assert(tx)` 在**事务内**执行条件更新，失权即抛 `LeaseLostError`。
租约键：`source:${source}`、`wallmuse-worker`、`storage-transfers`、`wallmuse-cleanup`、`originals-cleanup`。

### 4.5 WallMuse Worker（独立调度器）

不走 Redis：`setInterval(tick, 10_000)` 轮询 `WallMuseJob`（`nextRunAt <= now`），`leases.run("wallmuse-worker")` 保证单进程独占。
阶段：`collect → analyze → storage → plan → copy → finish → done`，每步写 `WallMuseJob.checkpoint` Json。
由 `WallMusePolicyService` 强制**北京时间空闲窗口**（`idle-policy.ts`），窗口外抛 `WaitForIdleError` 延后到下一窗口。

### 4.6 定时后台服务一览

| 服务 | 间隔 |
|---|---|
| QueueRecoveryService | 60s |
| 自动发帖循环（AutoPublishBoard） | 首 60s，之后按看板 `intervalHours`（默认 5min 轮询） |
| WallMuseWorker | 10s |
| WallMuseCleanupService | 1h |
| OriginalsCleanupService | 1h |
| TempCleanupService | 10min（清理 24h 前 tmp 文件） |
| PaymentService.syncPendingOrders | 5min（支付兜底查单） |
| PublicService 求图图片清理 | 24h |
| AssetFetchService 清理 | 6h |

### 4.7 部署排空（Deployment Drain）

`storage/private/deploy-drain.json` 标记，重启前暂停新任务，默认等待当前任务 60s（可配 `DEPLOY_DRAIN_SECONDS`，上限 120s）。两个 worker 入口都检查该标记。

---

## 五、外部集成

| 集成 | 机制 |
|---|---|
| **DeepSeek 视觉** | HTTP，`zod` 结构化输出（title/type/tags/sensitiveFlags/safe/animeStyle/summary）。未配置时资源默认被安全策略拦截，无法自动上架 |
| **百度网盘** | 子进程 CLI（`common/cli.ts` → `runCli`），多账号 profileDir 隔离，管理端授权 |
| **夸克网盘** | 子进程 CLI + NDJSON 解析（`parseNdjson`/`lastResult`） |
| **wdbzk 资源站** | HTTP + `PANAPI_TOKEN`，`categoryId` 默认 61 |
| **腾讯频道** | `tencent-channel-cli@1.0.10`，token 用 `common/crypto.ts` AES 加密存库（`tokenCipher` + `tokenTail`） |
| **微信虚拟支付** | 道具直购：下单签名、发货推送、查单兜底；商品目录存 `Setting` 表，改完即时生效无需重启 |
| **微信小程序登录** | openid 体系（C 端身份）；管理员上传沿用 openid 白名单 |

---

## 六、管理端（apps/admin）

React 19 + Vite 8 + Ant Design 6，**无路由库**，用 `useState` 切换页面，token 存 localStorage。

14 个页面：概览 Dashboard、资源库 Library（30k，最大）、批量上传 Uploader、任务队列 Tasks、搜索日志、会员求图、付费记录、运营分析、老封面迁移、网盘账号、腾讯频道、系统设置、上线诊断、登录。

网络层极简：`api.ts`（约 660 行）统一封装；`types.ts`、`format.tsx`、`ui.tsx`、`styles.css`。

---

## 七、小程序（apps/miniprogram）

微信原生，TS 源 + 编译后 JS 产物同时入库（便于微信开发者工具直接打开）。

10 个页面：`index`（首页/轮播）、`list`、`category`、`detail`、`tags`、`collections`、`collection`、`mine`、`request`（求图）、`upload`（管理员上传）、`buy`（付费）。
工具层：`api`、`ads`（广告）、`reward`（激励视频）、`payment`（虚拟支付）、`local-history`、`logger`。

变现双通道：激励视频（每日 10 次 / 无限）＋ 虚拟支付道具直购。

---

## 八、部署与运维

**CI/CD**（`.github/workflows/deploy.yml`，push `main` 触发）：
`checkout → Node setup → npm ci → audit-production（依赖审计）→ validate → SSH → rsync 同步到 /www/wwwroot/wallpaper-manager → bootstrap-server.sh → smoke 冒烟 → launch-readiness 报告`。

**域名**：API `wall-api.wdbzk.com`、Admin `wall-admin.wdbzk.com`、短链 `r.wdbzk.com`（独立 Nginx conf）。

**运维脚本**（`npm run`，17 个）：
`preflight:env`、`readiness:launch`、`readiness:production`、`readiness:miniprogram`、`readiness:virtual-payment`、`smoke:*`（admin/public/storage-accounts/channel-accounts/upload-routing）、`verify:release`、`cleanup:unpublished-links`、`miniprogram:appid`。

**测试**：18 个 `*.test.ts`（集中在队列恢复、检查点、租约、支付、去重、WallMuse 策略），用 `npx tsx --test` 运行，均使用模拟队列/DB，不产生真实上传或发帖。

---

## 九、架构特点与风险提示

**做得好的地方**
- 持久化账本与派发队列分离（MySQL 为真相源），Redis 挂掉可恢复。
- 检查点与租约双重机制，跨进程/重启安全，显式放弃全局 exactly-once 而用「结果不明即人工核对」的务实策略。
- 生产配置启动即强校验，避免带弱密钥上线。
- 网盘/频道多账号抽象，账号选择在任务 payload 中持久化，中途改默认账号不影响已进行任务。

**需要注意的风险**
- **单点**：单队列 `concurrency: 1` + 单 API 实例假设；并发吞吐受限，横向扩容前需先解决租约与队列语义。
- **CLI 依赖**：百度/夸克/腾讯频道均依赖外部 CLI 子进程，环境耦合强（`BDPAN_PATH`、`QUARK_SKILL_DIR`、`TENCENT_CHANNEL_CLI`）。
- **管理端体积**：`Library.tsx` 30k 单文件，无路由、无状态库，后续维护成本较高。
- **Redis 运维**：文档明确提示队列 Redis 需独立实例、禁 FLUSHALL、开持久化——若与其他项目共用存在清库风险。
- 小程序 JS 与 TS 双份入库，需保证编译产物同步，否则易出现行为不一致。
