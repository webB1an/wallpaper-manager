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
- 夸克网盘 skill CLI，并完成授权
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

关键配置参考：

```dotenv
NODE_ENV=production
PORT=4000
PUBLIC_API_ORIGIN=https://wall-api.wdbzk.com
ADMIN_ORIGIN=https://wall-admin.wdbzk.com
SHORT_LINK_ORIGIN=https://r.wdbzk.com
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
BDPAN_PATH=bdpan
BAIDU_REMOTE_BASE=/apps/bdpan/wallpapers
UPLOAD_MAX_FILE_MB=300
FFMPEG_PATH=ffmpeg
TENCENT_CHANNEL_CLI=
TENCENT_CHANNEL_RUN_ROOT=/www/wwwroot/wallpaper-manager/.runs/tencent-channel
```

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

生成 `wallpaper-manager-deploy-YYYYMMDDHHmmss.tar.gz` 后上传到宝塔服务器并解压到 `/www/wwwroot/wallpaper-manager`。

## 7. 网盘授权

首次部署、换服务器、重装 `bdpan` 或夸克 skill 后，都需要在服务器上完成一次授权。授权完成前，管理端“上线诊断”会把对应命令展示出来，并提供“复制命令”按钮。

也可以在服务器项目目录使用统一授权助手：

```bash
cd /www/wwwroot/wallpaper-manager
npm run auth:storage -- baidu-url
npm run auth:storage -- baidu-code <授权码>
npm run auth:storage -- baidu-whoami
npm run auth:storage -- quark-login
npm run auth:storage -- quark-whoami
```

百度网盘登录：

```bash
'/root/.local/bin/bdpan' login --accept-disclaimer --get-auth-url
```

打开命令输出的授权链接，百度页面完成授权后会给一段授权码。把授权码回填到服务器：

```bash
'/root/.local/bin/bdpan' login --accept-disclaimer --set-code <授权码>
```

如果 `BDPAN_PATH` 配置为其他路径，以诊断页展示的命令为准。登录后验证：

```bash
'/root/.local/bin/bdpan' whoami
```

夸克 skill 登录：

```bash
cd '/www/server/quarkclouddrive-1.0.14' && CODEX_ENV=1 AI_AGENT=codex node scripts/quark-drive.cjs login
```

夸克 skill CLI 会识别 Agent 环境；生产后端调用时也会带 `CODEX_ENV=1 AI_AGENT=codex`。登录后验证：

```bash
cd '/www/server/quarkclouddrive-1.0.14' && CODEX_ENV=1 AI_AGENT=codex node scripts/quark-drive.cjs get-user-info
```

两个网盘授权都完成后，打开管理端“上线诊断”重新检查，`百度网盘 bdpan` 和 `夸克 skill` 都应显示“正常”。如果只完成其中一个，上传处理仍可能继续使用另一个成功源，但会在任务结果里留下同步失败提醒。

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

没有默认频道账号时，后台会禁止开启“默认上传后自动发腾讯频道”，上传接口也会拒绝 `autoPublish=true`，防止资源处理成功后才发现无法发帖。

## 11. 上线后检查

- 先打开管理端“上线诊断”，确认公开域名、数据库、Redis、ffmpeg、bdpan、夸克 skill、旧站封面目录、DeepSeek、panapi、腾讯频道 CLI 和频道账号状态。
- 对诊断失败项，优先使用页面右侧“复制命令”按钮，把命令粘贴到宝塔终端执行。
- 在服务器执行 `npm run readiness:production`，把当前失败/提醒项整理成可直接操作的上线待办；需要把提醒也作为失败处理时执行 `npm run readiness:production:strict`。
- 在服务器执行 `npm run smoke:production`，一次确认公开列表、详情、封面域名、短链域名、分类聚合、后台登录、概览、诊断和系统设置接口都可用。
- 需要强制所有诊断项无失败/提醒时执行 `npm run smoke:production:strict`。
- `DEEPSEEK_API_KEY` 必须配置后才能自动上架；未配置时 AI 审核会保护性失败，资源不会自动发布。
- 管理端登录连续失败 5 次会锁定 10 分钟；仍建议宝塔站点只开放 HTTPS，并妥善保存后台密码。
- 管理端新增至少一个腾讯频道账号，并设为默认账号。
- 上传页确认“上传后自动处理”和“处理成功后自动发腾讯频道”的默认值是否符合当前批次；不自动处理时资源会以草稿入库。
- 任务队列里查看“提醒”列：单个网盘失败或腾讯频道发帖失败不会重试，也不会阻断已通过审核的资源上架。
- 资源库里可手动补夸克/百度链接，后台会为新增链接生成 `r.wdbzk.com` 短链。
- 小程序详情页会展示短链文本，用户点击复制后自行打开网盘。

## 12. 发布前验收清单

上线前建议逐项确认：

- GitHub Actions 最新 `main` 部署成功。
- `https://wall-api.wdbzk.com/health` 返回 `{"code":200}`。
- `npm run smoke:production` 中 public/admin 两段都返回 `"ok": true`。
- `npm run readiness:production` 没有失败项；最终发布前 `npm run readiness:production:strict` 也应通过。
- 百度、夸克、腾讯频道授权配置完成后，`npm run smoke:production:strict` 通过。
- PM2 中 `wallpaper-api` 为 `online`。
- 管理端“上线诊断”中数据库、Redis、ffmpeg、DeepSeek、panapi、bdpan、夸克 skill、腾讯频道 CLI 都为正常。
- 管理端至少存在一个默认腾讯频道账号。
- 资源库里已上架资源都有可用 `r.wdbzk.com` 短链。
- 小程序首页、分类页、详情页、我的页都能加载线上数据。
- 详情页复制短链后，“我的”页出现最近复制记录，且能点回详情。
- 抽查百度备用链接时，小程序详情页能展示提取码。

## 13. 网盘分享规则

- 夸克分享使用公开链接和 `expired-type=1`，按夸克 skill 文档为永久有效。
- `bdpan share` 当前不支持调用方指定提取码；系统会解析百度返回的随机提取码。若返回提取码，小程序短链跳转时会自动拼接 `pwd`。

## 14. 微信小程序发布

小程序源码在 `apps/miniprogram`，当前 `project.config.json` 的 `appid` 按需求留空。准备发布时：

1. 在微信公众平台创建小程序，拿到 AppID 后填入 `apps/miniprogram/project.config.json`。
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
