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

## 7. Nginx

把 `deploy/nginx/wall-api.wdbzk.com.conf` 和 `deploy/nginx/wall-admin.wdbzk.com.conf` 内容放入宝塔对应站点配置。

确认：

- `wall-api.wdbzk.com` 反代到 `127.0.0.1:4000`
- `r.wdbzk.com` 反代到 `127.0.0.1:4000/r/`
- `wall-admin.wdbzk.com` 指向 `/www/wwwroot/wallpaper-manager/apps/admin/dist`
- `/assets/` 指向 `/www/wwwroot/wallpaper-manager/storage/public/`

## 8. 老封面迁移

先预览：

```bash
npm run import:old-covers -w apps/api -- --limit=100
```

后台也提供“老封面迁移”页面。迁移只复制封面，并按旧站同款归一化规则做唯一精确匹配；没有唯一匹配的资源会保留为待复核，避免把封面和网盘链接错配。分类、tag 和审核全部重新由 AI 识别。部署在旧站同一台服务器时，配置 `OLD_WALLPAPER_ROOT=/www/wwwroot/wallpaper.wdbzk.com` 后会优先从本地 `covers` 目录复制封面，找不到本地目录时才回退到公网下载。

## 9. 上线后检查

- 先打开管理端“上线诊断”，确认公开域名、数据库、Redis、ffmpeg、bdpan、夸克 skill、旧站封面目录、DeepSeek、panapi、腾讯频道 CLI 和频道账号状态。
- `DEEPSEEK_API_KEY` 必须配置后才能自动上架；未配置时 AI 审核会保护性失败，资源不会自动发布。
- 管理端登录连续失败 5 次会锁定 10 分钟；仍建议宝塔站点只开放 HTTPS，并妥善保存后台密码。
- 管理端新增至少一个腾讯频道账号，并设为默认账号。
- 上传页确认“上传后自动处理”和“处理成功后自动发腾讯频道”的默认值是否符合当前批次；不自动处理时资源会以草稿入库。
- 任务队列里查看“提醒”列：单个网盘失败或腾讯频道发帖失败不会重试，也不会阻断已通过审核的资源上架。
- 资源库里可手动补夸克/百度链接，后台会为新增链接生成 `r.wdbzk.com` 短链。
- 小程序详情页会展示短链文本，用户点击复制后自行打开网盘。

## 10. 网盘分享规则

- 夸克分享使用公开链接和 `expired-type=1`，按夸克 skill 文档为永久有效。
- `bdpan share` 当前不支持调用方指定提取码；系统会解析百度返回的随机提取码。若返回提取码，小程序短链跳转时会自动拼接 `pwd`。

## 11. 微信小程序发布

小程序源码在 `apps/miniprogram`，当前 `project.config.json` 的 `appid` 按需求留空。准备发布时：

1. 在微信公众平台创建小程序，拿到 AppID 后填入 `apps/miniprogram/project.config.json`。
2. 在“小程序后台 > 开发管理 > 开发设置 > 服务器域名”添加 request 合法域名：`https://wall-api.wdbzk.com`。
3. 用微信开发者工具打开 `apps/miniprogram`，确认首页、分类、详情、我的四个页面都能加载线上数据。
4. 详情页复制主短链后，到“我的”页确认最近复制记录存在，并可点回详情。
5. 上传体验版前，确认线上管理端“上线诊断”中 DeepSeek、panapi、夸克 skill、bdpan、腾讯频道 CLI 均正常。
6. 发布正式版前，至少抽查一个静态壁纸和一个动态壁纸：静态资源能展示封面和短链，动态资源只展示缩略图和短链，不在小程序内播放原视频。
