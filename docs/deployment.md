# Deployment

目标服务器：宝塔 Linux 面板。

## 1. 域名

添加并解析：

- `wall-api.wdbzk.com`
- `wall-admin.wdbzk.com`
- `r.wdbzk.com`

三个域名都需要 HTTPS 证书。微信小程序后台把 `https://wall-api.wdbzk.com` 加入 request 合法域名。

## 2. 服务依赖

服务器需要：

- Node.js 22+
- MySQL 8
- Redis
- PM2
- ffmpeg
- `bdpan`
- 夸克网盘 skill CLI
- `tencent-channel-cli`，默认作为 API 生产依赖安装；也可配置固定路径

## 3. 宝塔数据库

在宝塔面板进入“数据库 > MySQL”：

1. 如页面提示“当前未安装 Mysql 环境/远程数据库”，先安装 MySQL 8。
2. 新建数据库：
   - 数据库名：`wallpaper_manager`
   - 用户名：`wallpaper_manager_user`
   - 密码：使用随机强密码
   - 访问权限：优先只允许本机/当前服务器访问；如果后端部署在另一台机器，再开放对应服务器 IP
   - 备注：`wallpaper-manager production`
3. 记录宝塔显示的数据库主机、端口、用户名和密码，填入 `apps/api/.env` 的 `DATABASE_URL`。

生产数据库示例：

```dotenv
DATABASE_URL=mysql://wallpaper_manager_user:YOUR_PASSWORD@BAOTA_DB_HOST:3306/wallpaper_manager
```

如果数据库和后端在同一台宝塔服务器，`BAOTA_DB_HOST` 通常可以写 `127.0.0.1`。

## 4. GitHub Actions 自动部署

代码推送到 GitHub 后，每次 push 到 `main` 会触发 `.github/workflows/deploy.yml`：

1. 在 GitHub runner 执行 `npm ci`
2. 校验 Prisma、类型、构建、JSON smoke test 和生产依赖审计
3. 通过 SSH/rsync 同步源码到宝塔服务器
4. 在服务器执行 `deploy/bootstrap-server.sh`
5. 在服务器执行 `npm run smoke:production`，确认公开接口和后台核心接口都可用
6. 额外输出一份非阻塞 `npm run readiness:launch -- --allow-empty-appid` 报告，便于在 Actions 日志里查看剩余上线待办

需要在 GitHub 仓库的 `Settings > Secrets and variables > Actions` 添加：

```text
DEPLOY_HOST=121.40.201.86
DEPLOY_PORT=22
DEPLOY_USER=root
DEPLOY_SSH_KEY=<用于登录服务器的私钥>
DEPLOY_PATH=/www/wwwroot/wallpaper-manager
```

`DEPLOY_PATH` 可以不填，默认就是 `/www/wwwroot/wallpaper-manager`。`DEPLOY_SSH_KEY` 对应的公钥需要提前放到服务器用户的 `~/.ssh/authorized_keys`。

服务器上的 `apps/api/.env`、`storage/`、`.runs/` 不会被 GitHub Actions 覆盖。

## 5. 环境变量

服务器上复制模板并填写真实密钥：

```bash
cp deploy/production.env.example apps/api/.env
vim apps/api/.env
```

生产模式下 API 启动时会拒绝 `CHANGE_ME`、`change-this-password` 和示例数据库地址等占位值；`ADMIN_PASSWORD` 至少 12 位，`JWT_SECRET` 至少 32 位，`DATABASE_URL` 必须替换成真实数据库账号和强密码。

关键配置参考：

```dotenv
NODE_ENV=production
PORT=4000
PUBLIC_API_ORIGIN=https://wall-api.wdbzk.com
ADMIN_ORIGIN=https://wall-admin.wdbzk.com
SHORT_LINK_ORIGIN=https://r.wdbzk.com
MINIPROGRAM_APPID=
DATABASE_URL=mysql://wallpaper_manager_user:password@BAOTA_DB_HOST:3306/wallpaper_manager
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
ADMIN_USERNAME=admin
ADMIN_PASSWORD=
JWT_SECRET=
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash-vision-exp
PANAPI_BASE_URL=https://panapi.wdbzk.com
PANAPI_TOKEN=
PANAPI_CATEGORY_ID=61
OLD_WALLPAPER_ROOT=/www/wwwroot/wallpaper.wdbzk.com
QUARK_SKILL_DIR=/www/server/quarkclouddrive-1.0.14
QUARK_AUTH_START_TIMEOUT_MS=12000
BDPAN_PATH=bdpan
BAIDU_REMOTE_BASE=/apps/bdpan/wallpapers
UPLOAD_MAX_FILE_MB=300
FFMPEG_PATH=ffmpeg
TENCENT_CHANNEL_CLI=
TENCENT_CHANNEL_RUN_ROOT=/www/wwwroot/wallpaper-manager/.runs/tencent-channel
WALLPOST_BASE_URL=
WALLPOST_BRIDGE_KEY=
MINIPROGRAM_ADMIN_OPENIDS=
```

- `WALLPOST_BASE_URL`：WallPost 桥接服务的地址（例如 `http://<wallpost-host>:4000`），用于「定时自动下载壁纸」从 WallPost 拉取未收录的 Wallhaven 壁纸。
- `WALLPOST_BRIDGE_KEY`：与 WallPost 端 `BRIDGE_API_KEY` 一致，用作服务端对服务端的 `x-bridge-key`。
- `MINIPROGRAM_ADMIN_OPENIDS`：小程序管理员的 openid 白名单（逗号分隔，例如 `olw4i0T76z7ksNimW0W9NGfxeBTQ`）。这些用户在小程序「我的」页会出现「上传壁纸」入口，并在详情页可「下架」壁纸；上传时默认不自动发帖到频道。
- 自动发帖按「板块」配置：在管理端「腾讯频道 → 自动发帖板块」新增配置（选择频道/版块、数据来源、周期、开关），数据来源目前支持 `wallpost`（Wallhaven，经 WallPost 桥接），后续可扩展动态壁纸或其它来源。调度器会按每个板块各自的周期、从该板块来源拉图并发布到该板块（用该板块开启了「参与自动发帖」的账号轮换），同一张图（来源+来源id）全局只发一次。

## 6. 首次服务器启动

首次可以直接把仓库源码同步到服务器，也可以本机打包上传。

```bash
mkdir -p /www/wwwroot/wallpaper-manager
cd /www/wwwroot/wallpaper-manager
cp deploy/production.env.example apps/api/.env
vim apps/api/.env
bash deploy/bootstrap-server.sh
```

`bootstrap-server.sh` 不在服务器重新构建前端和 TypeScript；GitHub runner 已经完成校验和构建。服务器只安装 API 运行时依赖、执行 Prisma 并重载 PM2：

```bash
npm ci --omit=dev --workspace apps/api --include-workspace-root=false
npm run prisma:generate
npm run prisma:deploy
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
```

本机打包方式仍可用：

```powershell
npm run package:release
```

脚本会先执行 `npm run build`，把 API、管理后台和共享包的 `dist` 产物一起打进压缩包；服务器只安装 API 运行时依赖并执行 Prisma，不会重复构建前端。生成 `wallpaper-manager-deploy-YYYYMMDDHHmmss.tar.gz` 后上传到宝塔服务器并解压到 `/www/wwwroot/wallpaper-manager`。

## 7. 网盘账号与授权

首次部署、换服务器、重装 `bdpan` 或夸克 skill 后，都需要在管理端页面完成业务账号授权。打开“网盘账号”，分别新增百度和夸克账号，点击“授权”获取链接，授权完成后把页面返回的授权码粘贴回管理端弹窗。每个网盘类型都支持多账号，并各自设置一个默认账号；上传处理默认使用该类型的默认账号同步网盘，上传页和资源库处理弹窗也可以为当前批次临时指定百度/夸克账号。

后台会为每个网盘账号使用独立 profile 目录，百度通过 `bdpan --config-path` 隔离授权态，夸克 skill 通过独立运行环境隔离授权态。授权码只用于完成登录，不会写入数据库。

删除网盘账号时，未同步过资源的账号会直接移除并清理独立 profile；已经产生资源链接的账号会停用并清理授权文件，历史短链和资源链接不会被删除。

服务器侧命令只用于排查 `bdpan` 或夸克 skill CLI 是否安装可执行，不作为正式授权流程。正式业务同步只读取管理端创建的多账号授权态。

两个网盘授权都完成并设为默认后，打开管理端“上线诊断”重新检查，`百度网盘账号` 和 `夸克网盘账号` 都应显示“正常”。如果只完成其中一个，上传处理仍可能继续使用另一个成功源，但会在任务结果里留下同步失败提醒。

## 8. Nginx

把 `deploy/nginx/wall-api.wdbzk.com.conf` 和 `deploy/nginx/wall-admin.wdbzk.com.conf` 内容放入宝塔对应站点配置。

确认：

- `wall-api.wdbzk.com` 反代到 `127.0.0.1:4000`
- `r.wdbzk.com` 反代到 `127.0.0.1:4000/r/`
- `wall-admin.wdbzk.com` 指向 `/www/wwwroot/wallpaper-manager/apps/admin/dist`
- `/assets/` 指向 `/www/wwwroot/wallpaper-manager/storage/public/`

## 9. 老封面迁移

先预览：

```bash
npm run import:old-covers -w apps/api -- --limit=100
```

后台也提供“老封面迁移”页面。迁移只复制封面，并按旧站同款归一化规则做唯一精确匹配；没有唯一匹配的资源会保留为待复核，避免把封面和网盘链接错配。分类、tag 和审核全部重新由 AI 识别。部署在旧站同一台服务器时，配置 `OLD_WALLPAPER_ROOT=/www/wwwroot/wallpaper.wdbzk.com` 后会优先从本地 `covers` 目录复制封面，找不到本地目录时才回退到公网下载。

## 10. 腾讯频道配置

腾讯频道不在 `.env` 中保存账号 Token。进入管理端“腾讯频道”页面添加一个或多个频道账号：

1. 填写账号名称和 Token。
2. 使用“获取频道”“获取版块”选择目标频道和版块。
3. 保存后至少设置一个默认账号。
4. 回到“上线诊断”，确认“腾讯频道账号”不再提醒。

系统默认的“上传后自动发腾讯频道”仍要求至少有一个默认频道账号；上传页单次批量上传时，可以在“本次发帖频道账号”里临时选择任意已保存的频道账号。资源库手动发帖也可以为本次发布选择频道账号。没有任何频道账号时，上传接口会拒绝 `autoPublish=true`，防止资源处理成功后才发现无法发帖。

## 11. 上线后检查

- 先打开管理端“上线诊断”，确认公开域名、数据库、Redis、ffmpeg、bdpan、夸克 skill、旧站封面目录、DeepSeek、panapi、腾讯频道 CLI 和频道账号状态。
- 对诊断失败项，优先使用页面右侧“复制命令”按钮，把命令粘贴到宝塔终端执行。
- 在填写 `apps/api/.env` 后，可先执行 `npm run preflight:env`，本地检查生产启动硬性配置；它不连接服务器，也不打印任何密码或 Token 值。
- 在服务器执行 `npm run readiness:production`，把当前失败/提醒项整理成可直接操作的上线待办；需要把提醒也作为失败处理时执行 `npm run readiness:production:strict`。
- 在服务器执行 `npm run smoke:production`，一次确认公开列表、详情、封面域名、短链域名、分类聚合、后台登录、概览、诊断和系统设置接口都可用。
- 需要强制所有诊断项无失败/提醒时执行 `npm run smoke:production:strict`。
- `DEEPSEEK_API_KEY` 必须配置后才能自动上架；未配置时 AI 审核会保护性失败，资源不会自动发布。
- 管理端登录连续失败 5 次会锁定 10 分钟；仍建议宝塔站点只开放 HTTPS，并妥善保存后台密码。
- 管理端新增至少一个腾讯频道账号，并设为默认账号；如果本批次要发到其他频道账号，在上传页选择“本次发帖频道账号”。
- 上传页确认“上传后自动处理”“处理成功后自动发腾讯频道”、本次网盘账号和本次频道账号是否符合当前批次；不自动处理时资源会以草稿入库。
- 任务队列里查看“提醒”列：单个网盘失败或腾讯频道发帖失败不会重试，也不会阻断已通过审核的资源上架。
- 资源库里可手动补夸克/百度链接，后台会为新增链接生成 `r.wdbzk.com` 短链。
- 小程序详情页会展示短链文本，用户点击复制后自行打开网盘。
- 小程序内点下载时，若服务器没有源文件，后端会自动从该壁纸的网盘分享链接按需回源（夸克优先、百度备用），拉回的文件写入 `storage/public/fetched/` 并按 `FETCHED_ASSET_TTL_DAYS`（默认 7 天）过期清理，过期后再次下载会重新回源。回源依赖第 7 节配置的网盘账号授权；夸克链路为 分享详情 → 转存 → 搜索 → 读取 四步，个别特殊文件名可能搜索不到，此时会自动尝试百度备用链接。
- 下架资源仍有关联活跃短链时，可先在服务器执行 `npm run cleanup:unpublished-links` 做 dry-run 审计；确认后执行 `npm run cleanup:unpublished-links -- --apply` 停用这些非上架资源的活跃网盘链接。

## 12. 发布前验收清单

上线前建议逐项确认：

- GitHub Actions 最新 `main` 部署成功。
- `https://wall-api.wdbzk.com/health` 返回 `{"code":200}`。
- `npm run smoke:production` 中 public/admin 两段都返回 `"ok": true`。
- `npm run readiness:production` 没有失败项；最终发布前 `npm run readiness:production:strict` 也应通过。
- 百度、夸克、腾讯频道授权配置完成后，`npm run smoke:production:strict` 通过。
- PM2 中 `wallpaper-api` 为 `online`。
- 管理端“上线诊断”中数据库、Redis、ffmpeg、DeepSeek、panapi、bdpan、夸克 skill、腾讯频道 CLI 都为正常。
- 管理端“网盘账号”中至少有一个默认百度账号和一个默认夸克账号，且探活可用。
- 管理端至少存在一个默认腾讯频道账号；需要分发到不同频道时，确认上传页和资源库发帖弹窗能列出多个频道账号。
- 资源库里已上架资源都有可用 `r.wdbzk.com` 短链。
- `npm run cleanup:unpublished-links` 返回 `Matched wallpapers: 0`，或已确认并执行过 `--apply`。
- 服务器执行 `npm run readiness:launch`，只剩你确认接受的提醒；正式发布前应全部通过。
- 小程序首页、分类页、详情页、我的页都能加载线上数据。
- 详情页复制短链后，“我的”页出现最近复制记录，且能点回详情。
- 抽查百度备用链接时，小程序详情页能展示提取码。

## 13. 网盘分享规则

- 夸克分享使用公开链接和 `expired-type=1`，按夸克 skill 文档为永久有效。
- `bdpan share` 当前不支持调用方指定提取码；系统会解析百度返回的随机提取码。若返回提取码，小程序短链跳转时会自动拼接 `pwd`。

## 14. 微信小程序发布

小程序源码在 `apps/miniprogram`，当前 `project.config.json` 的 `appid` 按需求留空。准备发布时：

1. 在微信公众平台创建小程序，拿到 AppID 后执行 `npm run miniprogram:appid -- wx你的AppID` 写入本机 `apps/miniprogram/project.config.json`；服务器 `.env` 也可填写 `MINIPROGRAM_APPID=wx你的AppID`，用于管理端上线诊断和 `readiness:launch`。
   - AppID 未填写时，可以先运行 `npm run readiness:miniprogram -- --allow-empty-appid` 检查页面、域名和短链策略。
   - 准备上传体验版或正式版前，运行 `npm run readiness:miniprogram`，此时 AppID 必须已填写。
2. 在“小程序后台 > 开发管理 > 开发设置 > 服务器域名”按 `deploy/wechat-miniprogram-domains.json` 配置合法域名：
   - request 合法域名：`https://wall-api.wdbzk.com`
   - downloadFile 合法域名：`https://wall-api.wdbzk.com`
   - uploadFile、socket 合法域名：当前不使用，留空
   - 业务域名：当前没有 web-view，留空
3. `r.wdbzk.com` 只作为复制给用户的短链文本，小程序内不请求、不跳转，不需要配置为服务器域名；如果未来改成小程序内打开短链，再重新评估。
4. 用微信开发者工具打开 `apps/miniprogram`，打开“详情 > 本地设置”，不要勾选“不校验合法域名”，确认首页、分类、详情、我的四个页面都能加载线上数据和封面图。
5. 详情页复制主短链后，到“我的”页确认最近复制记录存在，并可点回详情。
6. 上传体验版前，确认线上管理端“上线诊断”中 DeepSeek、panapi、夸克 skill、bdpan、腾讯频道 CLI 均正常。
7. 发布正式版前，至少抽查一个静态壁纸和一个动态壁纸：静态资源能展示封面和短链，动态资源只展示缩略图和短链，不在小程序内播放原视频。
