# Wallpaper Manager

三端壁纸运营系统：

- 微信小程序：浏览动静态壁纸缩略图，展示短链下载入口。
- 后端：资源、短链、队列、AI 分类审核、网盘同步、wdbzk 入库、腾讯频道发帖。
- 管理端：批量上传、上传后自动处理、任务状态、批量编辑、上下架、手动补网盘链接、系统默认设置、上线诊断、账号与频道配置、老站封面迁移。

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

See `docs/deployment.md` for Baota database setup, GitHub Secrets, Nginx configuration, storage authorization commands, Tencent channel setup, and the release checklist.
