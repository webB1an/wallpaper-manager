import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RewardDownloadType, StorageProvider, WallpaperOrientation, WallpaperRequestStatus, WallpaperStatus, WallpaperType } from "@prisma/client";
import { nanoid } from "nanoid";
import { existsSync } from "node:fs";
import { copyFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { shortUrl } from "../../common/public-url";
import { PaymentService } from "../payment/payment.service";
import { PrismaService } from "../prisma/prisma.service";
import { AssetFetchService } from "../storage/asset-fetch.service";

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly assetFetch: AssetFetchService,
    private readonly payment: PaymentService,
  ) {}

  /** 标签封面缓存：每个标签每 TAG_COVER_TTL_MS 随机换一张封面。 */
  private readonly tagCoverCache = new Map<string, { coverUrl: string; expiresAt: number }>();
  private readonly TAG_COVER_TTL_MS = 6 * 60 * 60 * 1000;

  async memberRequestStatusByCode(code: string) {
    const openid = await this.payment.openidForCode(code);
    return this.memberRequestStatus(openid);
  }

  private async memberRequestStatus(openid: string) {
    const entitlement = await this.payment.entitlementStatus(openid);
    const settings = await this.prisma.setting.findUnique({ where: { key: "system" }, select: { value: true } });
    const configuredLimit = Number((settings?.value as { memberRequestMonthlyLimit?: unknown } | null)?.memberRequestMonthlyLimit);
    const monthlyLimit = Number.isInteger(configuredLimit) && configuredLimit >= 0 ? Math.min(100, configuredLimit) : 3;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [used, active] = await Promise.all([
      this.prisma.wallpaperRequest.count({ where: { userId: openid, createdAt: { gte: monthStart } } }),
      this.prisma.wallpaperRequest.findFirst({
        where: { userId: openid, status: { in: [WallpaperRequestStatus.pending, WallpaperRequestStatus.searching] } },
        select: { id: true, status: true },
      }),
    ]);
    return { eligible: entitlement.permanent, monthlyLimit, used, remaining: Math.max(0, monthlyLimit - used), hasActive: Boolean(active) };
  }

  async memberRequests(code: string) {
    const openid = await this.payment.openidForCode(code);
    return this.prisma.wallpaperRequest.findMany({
      where: { userId: openid },
      orderBy: { createdAt: "desc" },
      include: { wallpaper: { select: { id: true, title: true, coverUrl: true } } },
      take: 50,
    });
  }

  async createMemberRequest(code: string, input: { subject?: string; description?: string; wallpaperType?: string; orientation?: string }) {
    const openid = await this.payment.openidForCode(code);
    const access = await this.memberRequestStatus(openid);
    if (!access.eligible) throw new BadRequestException("仅限已开通全部壁纸永久下载权益的用户提交求图");
    if (access.hasActive) throw new BadRequestException("已有一个求图需求正在处理中，请等待处理完成");
    if (access.remaining <= 0) throw new BadRequestException("本月免费求图次数已用完，下月可继续提交");
    const subject = String(input.subject || "").trim();
    const description = String(input.description || "").trim();
    if (subject.length < 2 || subject.length > 60) throw new BadRequestException("作品、角色或主题请填写 2–60 个字");
    if (description.length < 5 || description.length > 500) throw new BadRequestException("求图说明请填写 5–500 个字");
    const wallpaperType = ["static", "live", "mobile", "desktop", "other"].includes(String(input.wallpaperType))
      ? input.wallpaperType as WallpaperType : WallpaperType.static;
    const orientation = ["portrait", "landscape", "square", "unknown"].includes(String(input.orientation))
      ? input.orientation as WallpaperOrientation : WallpaperOrientation.portrait;
    return this.prisma.wallpaperRequest.create({ data: { userId: openid, subject, description, wallpaperType, orientation } });
  }

  async list(query: { page?: number; pageSize?: number; keyword?: string; tag?: string; type?: string; orientation?: string; sort?: string }, openid?: string) {
    const page = positiveInt(query.page, 1, "页码");
    const pageSize = positiveInt(query.pageSize, 20, "每页数量", 50);
    const type = optionalWallpaperType(query.type);
    const orientation = optionalWallpaperOrientation(query.orientation);
    const keyword = cleanSearchText(query.keyword);
    const tag = cleanSearchText(query.tag);
    const where = {
      status: WallpaperStatus.published,
      // 搜索同时匹配标题和标签，方便按标签词检索壁纸。
      ...(keyword ? {
        OR: [
          { title: { contains: keyword } },
          { tags: { some: { tag: { name: { contains: keyword } } } } },
        ],
      } : {}),
      ...(type ? { type } : {}),
      ...(orientation ? { orientation } : {}),
      ...(tag ? { tags: { some: { tag: { name: tag } } } } : {}),
    };
    const period = periodDays(query.sort);
    if (period) {
      const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000);
      const [allItems, counts] = await Promise.all([
        this.prisma.wallpaper.findMany({
          where,
          include: { tags: { include: { tag: true }, orderBy: [{ sortOrder: "asc" }, { tagId: "asc" }] } },
        }),
        this.prisma.wallpaperClick.groupBy({
          by: ["wallpaperId"],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
      ]);
      const countMap = new Map(counts.map((row) => [row.wallpaperId, row._count._all]));
      const sorted = allItems
        .sort((left, right) => {
          const diff = (countMap.get(right.id) || 0) - (countMap.get(left.id) || 0);
          return diff || right.downloadCount - left.downloadCount;
        });
      const total = sorted.length;
      const items = sorted.slice((page - 1) * pageSize, page * pageSize).map(wallpaperCard);
      void this.recordSearch(keyword, total, openid);
      return { list: items, total, page, pageSize };
    }
    const orderBy = query.sort === "hot"
      ? [{ downloadCount: "desc" as const }, { viewCount: "desc" as const }]
      : [{ sortOrder: "desc" as const }, { createdAt: "desc" as const }];
    const [items, total] = await Promise.all([
      this.prisma.wallpaper.findMany({
        where,
        include: { tags: { include: { tag: true }, orderBy: [{ sortOrder: "asc" }, { tagId: "asc" }] } },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.wallpaper.count({ where }),
    ]);
    void this.recordSearch(keyword, total, openid);
    return {
      list: items.map(wallpaperCard),
      total,
      page,
      pageSize,
    };
  }

  private async recordSearch(keyword: string, total: number, openid?: string) {
    if (!keyword) return;
    await this.prisma.searchLog
      .create({
        data: {
          keyword,
          hasResult: total > 0,
          resultCount: total,
          openid: openid?.trim() || null,
        },
      })
      .catch(() => undefined);
  }

  async detail(id: string) {
    const item = await this.prisma.wallpaper.findFirst({
      where: { id, status: WallpaperStatus.published },
      include: {
        tags: { include: { tag: true }, orderBy: [{ sortOrder: "asc" }, { tagId: "asc" }] },
        shortLinks: { include: { storageLink: true } },
      },
    });
    if (!item) throw new NotFoundException("壁纸不存在或未上架");
    const tagNames = item.tags.map(({ tag }) => tag.name);
    const related = await this.relatedWallpapers(item.id, item.type, tagNames);
    await this.prisma.wallpaper.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    return {
      id: item.id,
      title: item.title,
      type: item.type,
      orientation: item.orientation,
      coverUrl: publicCoverUrl(item.coverUrl),
      tags: tagNames,
      viewCount: item.viewCount + 1,
      downloadCount: item.downloadCount,
      fileSize: Number(item.fileSize || 0),
      createdAt: item.createdAt,
      shortLinks: item.shortLinks
        .filter((link) => link.storageLink.isActive)
        .sort(compareShortLinks)
        .map((link) => ({
          provider: link.provider,
          label: link.provider === StorageProvider.quark ? "夸克下载" : "百度备用",
          url: shortUrl(this.config, link.code),
          passcode: resolvePasscode(link.storageLink.provider, link.storageLink.url, link.storageLink.passcode),
        })),
      related,
    };
  }

  /** 首页轮播：每 6 小时按时间桶确定性随机换一批（热门 + 最新混合），同桶内保持稳定。 */
  async hero() {
    const ROTATE_MS = 6 * 60 * 60 * 1000;
    const COUNT = 5;
    const seed = Math.floor(Date.now() / ROTATE_MS);
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [recent, hotGroups] = await Promise.all([
      this.prisma.wallpaper.findMany({
        where: { status: WallpaperStatus.published },
        orderBy: { createdAt: "desc" },
        take: 60,
        include: { tags: { include: { tag: true }, orderBy: [{ sortOrder: "asc" }, { tagId: "asc" }] } },
      }),
      this.prisma.wallpaperClick.groupBy({
        by: ["wallpaperId"],
        where: { createdAt: { gte: since7d } },
        _count: { _all: true },
        orderBy: { _count: { wallpaperId: "desc" } },
        take: 20,
      }),
    ]);
    const recentById = new Map(recent.map((item) => [item.id, item]));
    const pool: Array<(typeof recent)[number]> = [];
    const seen = new Set<string>();
    for (const group of hotGroups) {
      const item = recentById.get(group.wallpaperId);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        pool.push(item);
      }
    }
    for (const item of recent) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        pool.push(item);
      }
    }
    const picks = seededPick(pool.length, COUNT, seed);
    return picks.map((index) => wallpaperCard(pool[index])).filter(Boolean);
  }

  async click(id: string) {
    const item = await this.prisma.wallpaper.findFirst({
      where: { id, status: WallpaperStatus.published },
      select: { id: true },
    });
    if (!item) throw new NotFoundException("壁纸不存在或未上架");
    await this.prisma.wallpaper.update({
      where: { id },
      data: { downloadCount: { increment: 1 } },
    });
    await this.prisma.wallpaperClick.create({ data: { wallpaperId: id } });
  }

  async loginWechat(code: string) {
    const appid = this.config.get<string>("MINIPROGRAM_APPID")?.trim() || this.config.get<string>("WECHAT_APPID")?.trim();
    const secret = this.config.get<string>("WECHAT_APP_SECRET")?.trim();
    if (!appid || !secret) throw new BadRequestException("微信登录未配置：请在服务器 .env 填写 MINIPROGRAM_APPID 和 WECHAT_APP_SECRET");
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set("appid", appid);
    url.searchParams.set("secret", secret);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    const body = (await response.json()) as { openid?: string; errcode?: number; errmsg?: string };
    if (!body.openid) throw new BadRequestException(body.errmsg || "微信登录失败");
    return { openid: body.openid };
  }

  async rewardStatus(openid: string) {
    const reward = await this.todayReward(openid);
    const rewardType = await this.rewardType();
    if (!reward) return { rewarded: false, remaining: 0, type: "none", rewardType };
    if (reward.type === "unlimited") return { rewarded: true, remaining: -1, type: "unlimited", rewardType };
    return { rewarded: true, remaining: Math.max(0, 10 - reward.usedCount), type: "daily10", rewardType };
  }

  async watchReward(openid: string) {
    const type = await this.rewardType();
    const today = this.startOfDay();
    const reward = await this.prisma.wallpaperReward.upsert({
      where: { userId_date: { userId: openid, date: today } },
      update: { type: type as RewardDownloadType, usedCount: 0 },
      create: { userId: openid, date: today, type, usedCount: 0 },
    });
    return { rewarded: true, remaining: reward.type === "unlimited" ? -1 : 10, type: reward.type };
  }

  async createDownload(openid: string, wallpaperId: string) {
    const wallpaper = await this.prisma.wallpaper.findFirst({
      where: { id: wallpaperId, status: WallpaperStatus.published },
      select: { id: true, coverPath: true, assetPath: true, mimeType: true },
    });
    if (!wallpaper) throw new NotFoundException("壁纸不存在或未上架");
    // 服务器没有源文件时按需从网盘回源：先返回 preparing，由客户端稍后重试，不发 token、不扣次数。
    if (!wallpaper.assetPath || !existsSync(join(process.cwd(), "storage", "public", wallpaper.assetPath))) {
      const ensure = await this.assetFetch.ensureAsset(wallpaperId);
      if (!ensure.ready) {
        if (ensure.fetching) return { preparing: true, retryAfterSec: 10 };
        throw new BadRequestException(ensure.message || "该壁纸暂无源文件");
      }
    }
    const fresh = await this.prisma.wallpaper.findUnique({ where: { id: wallpaper.id }, select: { assetPath: true } });
    if (!fresh?.assetPath) throw new BadRequestException("该壁纸暂无源文件");
    const assetPath = fresh.assetPath;
    const paidAccess = await this.payment.downloadAccess(openid);
    if (!paidAccess.allowed) {
      const reward = await this.requireTodayReward(openid);
      if (reward.type === "daily10" && reward.usedCount >= 10) {
        throw new BadRequestException("今日免费下载次数已用完，明天再来、观看视频或使用付费下载");
      }
    }
    await this.cleanupExpiredTokens();
    const token = nanoid(24);
    const filePath = await this.copyAssetToTemp(assetPath, token);
    await this.prisma.downloadToken.create({
      data: { token, wallpaperId, userId: openid, filePath, expiresAt: new Date(Date.now() + 5 * 60_000) },
    });
    let remaining: number;
    let type: string;
    if (paidAccess.allowed) {
      await this.payment.consumeDownloadAccess(openid, paidAccess);
      remaining = paidAccess.type === "paid_unlimited" || paidAccess.type === "paid_permanent"
        ? -1
        : Math.max(0, paidAccess.remaining - 1);
      type = paidAccess.type;
    } else {
      const reward = await this.prisma.wallpaperReward.findUnique({
        where: { userId_date: { userId: openid, date: this.startOfDay() } },
      });
      if (!reward) throw new BadRequestException("下载额度已失效，请重新解锁");
      if (reward.type === "daily10") {
        await this.prisma.wallpaperReward.update({
          where: { id: reward.id },
          data: { usedCount: { increment: 1 } },
        });
      }
      remaining = reward.type === "unlimited" ? -1 : 10 - reward.usedCount - 1;
      type = reward.type;
    }
    await this.recordDownload(openid, wallpaper.id);
    return { token, expiresIn: 300, remaining: Math.max(0, remaining), type };
  }

  async resolveDownloadToken(token: string) {
    const record = await this.prisma.downloadToken.findUnique({ where: { token } });
    if (!record || record.expiresAt < new Date()) throw new NotFoundException("下载链接已失效");
    if (!record.filePath || !existsSync(record.filePath)) throw new NotFoundException("下载文件不存在或已删除");
    const wallpaper = await this.prisma.wallpaper.findUnique({
      where: { id: record.wallpaperId },
      select: { mimeType: true },
    });
    if (!wallpaper) throw new NotFoundException("壁纸不存在");
    return { filePath: record.filePath, mimeType: wallpaper.mimeType || "application/octet-stream", token };
  }

  async completeDownload(token: string) {
    const record = await this.prisma.downloadToken.findUnique({ where: { token } });
    if (!record) return { ok: true };
    if (record.filePath && existsSync(record.filePath)) {
      await unlink(record.filePath).catch(() => undefined);
    }
    await this.prisma.downloadToken.deleteMany({ where: { token } });
    return { ok: true };
  }

  async favoriteIds(openid: string) {
    if (!openid) return [];
    const rows = await this.prisma.userFavorite.findMany({ where: { userId: openid }, select: { wallpaperId: true } });
    return rows.map((row) => row.wallpaperId);
  }

  async favorites(openid: string) {
    if (!openid) return [];
    const rows = await this.prisma.userFavorite.findMany({
      where: { userId: openid },
      include: { wallpaper: { select: { id: true, title: true, coverUrl: true, type: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((row) => ({ wallpaperId: row.wallpaperId, createdAt: row.createdAt, wallpaper: row.wallpaper }));
  }

  async setFavorite(openid: string, wallpaperId: string, action: "add" | "remove") {
    if (!openid) throw new BadRequestException("请先完成微信登录");
    const wallpaper = await this.prisma.wallpaper.findUnique({ where: { id: wallpaperId }, select: { id: true } });
    if (!wallpaper) throw new NotFoundException("壁纸不存在");
    if (action === "add") {
      await this.prisma.userFavorite.upsert({
        where: { userId_wallpaperId: { userId: openid, wallpaperId } },
        update: { createdAt: new Date() },
        create: { userId: openid, wallpaperId },
      });
    } else {
      await this.prisma.userFavorite.deleteMany({ where: { userId: openid, wallpaperId } });
    }
    return { ok: true };
  }

  async downloads(openid: string) {
    if (!openid) return [];
    const rows = await this.prisma.userDownload.findMany({
      where: { userId: openid },
      include: { wallpaper: { select: { id: true, title: true, coverUrl: true, type: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return rows.map((row) => ({ wallpaperId: row.wallpaperId, createdAt: row.createdAt, wallpaper: row.wallpaper }));
  }

  async recordDownload(openid: string, wallpaperId: string) {
    if (!openid) return { ok: true };
    const wallpaper = await this.prisma.wallpaper.findUnique({ where: { id: wallpaperId }, select: { id: true } });
    if (!wallpaper) return { ok: true };
    await this.prisma.userDownload.upsert({
      where: { userId_wallpaperId: { userId: openid, wallpaperId } },
      update: { createdAt: new Date() },
      create: { userId: openid, wallpaperId },
    });
    return { ok: true };
  }

  /** 指定 openid 是否具备小程序管理员权限（白名单在管理端「系统设置 → 小程序管理员 openid」维护）。 */
  async isMiniAdmin(openid: string): Promise<boolean> {
    if (!openid) return false;
    let list: string[] = [];
    try {
      const setting = await this.prisma.setting.findUnique({ where: { key: "system" }, select: { value: true } });
      const value = (setting?.value as { miniAdminOpenids?: unknown } | null)?.miniAdminOpenids;
      if (Array.isArray(value)) list = value.map((item) => String(item).trim()).filter(Boolean);
      else if (typeof value === "string") list = value.split(",").map((item) => item.trim()).filter(Boolean);
    } catch {
      // 读设置失败则不识别为管理员。
    }
    return list.includes(openid);
  }

  async getUserStatus(openid: string) {
    return { isAdmin: await this.isMiniAdmin(openid) };
  }

  /** 管理员在小程序内下架壁纸：状态置为 archived（不再对外展示）。 */
  async offlineWallpaper(openid: string, id: string) {
    if (!(await this.isMiniAdmin(openid))) throw new BadRequestException("无权限操作");
    const wallpaper = await this.prisma.wallpaper.findUnique({ where: { id }, select: { id: true } });
    if (!wallpaper) throw new NotFoundException("壁纸不存在");
    await this.prisma.wallpaper.update({ where: { id }, data: { status: WallpaperStatus.archived } });
    return { ok: true };
  }

  private async todayReward(openid: string) {
    return this.prisma.wallpaperReward.findUnique({
      where: { userId_date: { userId: openid, date: this.startOfDay() } },
    });
  }

  private async requireTodayReward(openid: string) {
    const reward = await this.todayReward(openid);
    if (!reward) throw new BadRequestException("请先观看激励视频获取下载次数");
    return reward;
  }

  private async rewardType() {
    const row = await this.prisma.setting.findUnique({ where: { key: "system" } });
    const value = (row?.value || {}) as { rewardDownloadType?: string };
    return value.rewardDownloadType === "unlimited" ? "unlimited" : "daily10";
  }

  private startOfDay() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private async copyAssetToTemp(assetPath: string, token: string) {
    const dir = join(process.cwd(), "storage", "private", "downloads");
    await mkdir(dir, { recursive: true });
    const source = join(process.cwd(), "storage", "public", assetPath);
    const destination = join(dir, token);
    await copyFile(source, destination);
    return destination;
  }

  private async cleanupExpiredTokens() {
    const expired = await this.prisma.downloadToken.findMany({ where: { expiresAt: { lt: new Date() } } });
    for (const item of expired) {
      if (item.filePath && existsSync(item.filePath)) {
        await unlink(item.filePath).catch(() => undefined);
      }
    }
    if (expired.length) {
      await this.prisma.downloadToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    }
  }

  async tags() {
    const tags = await this.prisma.tag.findMany({
      orderBy: { name: "asc" },
      where: { wallpapers: { some: { wallpaper: { status: WallpaperStatus.published } } } },
    });
    return tags.map((tag) => tag.name);
  }

  /** 全部标签（已上架壁纸），按壁纸数量降序，支持关键词与分页。 */
  async allTags(query: { page?: number; pageSize?: number; keyword?: string }) {
    const page = positiveInt(query.page, 1, "页码");
    const pageSize = positiveInt(query.pageSize, 40, "每页数量", 100);
    const keyword = cleanSearchText(query.keyword);
    const grouped = await this.prisma.wallpaperTag.groupBy({
      by: ["tagId"],
      where: { wallpaper: { status: WallpaperStatus.published } },
      _count: { _all: true },
      orderBy: { _count: { tagId: "desc" } },
    });
    const tags = grouped.length
      ? await this.prisma.tag.findMany({ where: { id: { in: grouped.map((group) => group.tagId) } } })
      : [];
    const nameById = new Map(tags.map((tag) => [tag.id, tag.name]));
    let items = grouped
      .map((group) => ({ name: nameById.get(group.tagId) || "", count: group._count._all }))
      .filter((item) => item.name);
    if (keyword) items = items.filter((item) => item.name.includes(keyword));
    const total = items.length;
    return {
      list: items.slice((page - 1) * pageSize, page * pageSize),
      total,
      page,
      pageSize,
    };
  }

  async facets() {
    const [typeGroups, orientationGroups, tagGroups] = await Promise.all([
      this.prisma.wallpaper.groupBy({
        by: ["type"],
        where: { status: WallpaperStatus.published },
        _count: { _all: true },
      }),
      this.prisma.wallpaper.groupBy({
        by: ["orientation"],
        where: { status: WallpaperStatus.published },
        _count: { _all: true },
      }),
      this.topTags(),
    ]);
    const tags = tagGroups.length
      ? await this.prisma.tag.findMany({ where: { id: { in: tagGroups.map((group) => group.tagId) } } })
      : [];
    const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]));
    const coverByTagId = tagGroups.length ? await this.tagCoverMap(tagGroups.map((group) => group.tagId)) : new Map<string, string>();
    return {
      types: typeGroups
        .map((group) => ({ type: group.type, count: group._count._all }))
        .sort((left, right) => right.count - left.count),
      orientations: orientationGroups
        .map((group) => ({ orientation: group.orientation, count: group._count._all }))
        .sort((left, right) => right.count - left.count),
      tags: tagGroups
        .map((group) => ({ name: tagNameById.get(group.tagId) || "", count: group.count, coverUrl: coverByTagId.get(group.tagId) || FALLBACK_COVER_URL }))
        .filter((tag) => tag.name),
    };
  }

  /** 热门标签：按「下载×5 + 浏览」加权热度排序，取前 16 个；壁纸数量做次排序。 */
  private async topTags() {
    const wallpapers = await this.prisma.wallpaper.findMany({
      where: { status: WallpaperStatus.published },
      select: { downloadCount: true, viewCount: true, tags: { select: { tagId: true } } },
    });
    const stats = new Map<string, { count: number; heat: number }>();
    for (const wallpaper of wallpapers) {
      const heat = wallpaper.downloadCount * 5 + wallpaper.viewCount;
      for (const { tagId } of wallpaper.tags) {
        const entry = stats.get(tagId) || { count: 0, heat: 0 };
        entry.count += 1;
        entry.heat += heat;
        stats.set(tagId, entry);
      }
    }
    return [...stats.entries()]
      .map(([tagId, value]) => ({ tagId, count: value.count, heat: value.heat }))
      .sort((left, right) => right.heat - left.heat || right.count - left.count)
      .slice(0, 16);
  }

  async redirect(code: string) {
    const link = await this.prisma.shortLink.findUnique({
      where: { code },
      include: { storageLink: true, wallpaper: true },
    });
    if (!link || !link.storageLink.isActive || link.wallpaper.status !== WallpaperStatus.published) {
      throw new NotFoundException("短链不存在或已失效");
    }
    await this.prisma.$transaction([
      this.prisma.shortLink.update({ where: { id: link.id }, data: { clickCount: { increment: 1 } } }),
      this.prisma.wallpaper.update({ where: { id: link.wallpaperId }, data: { downloadCount: { increment: 1 } } }),
    ]);
    const url = link.storageLink.passcode && link.storageLink.provider === StorageProvider.baidu && !link.storageLink.url.includes("pwd=")
      ? `${link.storageLink.url}${link.storageLink.url.includes("?") ? "&" : "?"}pwd=${link.storageLink.passcode}`
      : link.storageLink.url;
    return assertRedirectUrl(url);
  }

  private async relatedWallpapers(id: string, type: string, tags: string[]) {
    const related = await this.prisma.wallpaper.findMany({
      where: {
        id: { not: id },
        status: WallpaperStatus.published,
        OR: [
          ...(tags.length ? [{ tags: { some: { tag: { name: { in: tags } } } } }] : []),
          { type: type as never },
        ],
      },
      include: { tags: { include: { tag: true }, orderBy: [{ sortOrder: "asc" }, { tagId: "asc" }] } },
      orderBy: [{ downloadCount: "desc" }, { sortOrder: "desc" }, { createdAt: "desc" }],
      take: 6,
    });
    return related.map(wallpaperCard);
  }

  private async tagCoverMap(tagIds: string[]) {
    const result = new Map<string, string>();
    const now = Date.now();
    for (const tagId of tagIds) {
      const cached = this.tagCoverCache.get(tagId);
      if (cached && cached.expiresAt > now) {
        result.set(tagId, cached.coverUrl);
        continue;
      }
      const count = await this.prisma.wallpaperTag.count({
        where: { tagId, wallpaper: { status: WallpaperStatus.published } },
      });
      if (!count) continue;
      const item = await this.prisma.wallpaperTag.findFirst({
        where: { tagId, wallpaper: { status: WallpaperStatus.published } },
        skip: Math.floor(Math.random() * count),
        include: { wallpaper: { select: { coverUrl: true } } },
      });
      const coverUrl = item?.wallpaper?.coverUrl ? publicCoverUrl(item.wallpaper.coverUrl) : FALLBACK_COVER_URL;
      this.tagCoverCache.set(tagId, { coverUrl, expiresAt: now + this.TAG_COVER_TTL_MS });
      result.set(tagId, coverUrl);
    }
    return result;
  }
}

const FALLBACK_COVER_URL = "https://wallpaper.wdbzk.com/covers/%E6%B2%BB%E6%84%88__Lily%20On%20The%20Hill%20(%E4%B8%98%E3%81%AE%E4%B8%8A%E3%81%AE%E3%83%A6%E3%83%AA)%20-%20Lily%20Watching%20the%20Clouds%20-%20%5B4K%5D..jpg";

type PublicShortLink = {
  provider: StorageProvider;
  storageLink: {
    isPrimary: boolean;
  };
};

function compareShortLinks(left: PublicShortLink, right: PublicShortLink) {
  if (left.storageLink.isPrimary !== right.storageLink.isPrimary) {
    return left.storageLink.isPrimary ? -1 : 1;
  }
  if (left.provider !== right.provider) {
    return left.provider === StorageProvider.baidu ? -1 : 1;
  }
  return 0;
}

function wallpaperCard(item: {
  id: string;
  title: string;
  type: string;
  orientation: string;
  coverUrl: string | null;
  viewCount: number;
  downloadCount: number;
  createdAt: Date;
  tags: Array<{ tag: { name: string } }>;
}) {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    orientation: item.orientation,
    coverUrl: publicCoverUrl(item.coverUrl),
    tags: item.tags.map(({ tag }) => tag.name),
    viewCount: item.viewCount,
    downloadCount: item.downloadCount,
    createdAt: item.createdAt,
  };
}

function seededPick(count: number, k: number, seed: number): number[] {
  let state = seed >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const indices = Array.from({ length: count }, (_, index) => index);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, k);
}

function positiveInt(value: string | number | undefined, fallback: number, label: string, max?: number) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new BadRequestException(`${label}不正确`);
  return max ? Math.min(max, parsed) : parsed;
}

function optionalWallpaperType(value: string | undefined) {
  if (!value) return undefined;
  if (Object.values(WallpaperType).includes(value as WallpaperType)) return value as WallpaperType;
  throw new BadRequestException("壁纸类型不正确");
}

function optionalWallpaperOrientation(value: string | undefined) {
  if (!value) return undefined;
  if (Object.values(WallpaperOrientation).includes(value as WallpaperOrientation)) return value as WallpaperOrientation;
  throw new BadRequestException("壁纸方向不正确");
}

function periodDays(sort: string | undefined) {
  if (sort === "week") return 7;
  if (sort === "month") return 30;
  return 0;
}

function cleanSearchText(value: string | undefined) {
  const text = String(value || "").trim();
  return text.slice(0, 80);
}

function publicCoverUrl(value: string | null | undefined) {
  return value?.trim() || FALLBACK_COVER_URL;
}

function assertRedirectUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    // Fall through to a consistent business error.
  }
  throw new NotFoundException("短链目标地址不正确");
}

function resolvePasscode(provider: StorageProvider, url: string, passcode?: string | null) {
  const stored = passcode?.trim();
  if (stored) return stored;
  if (provider !== StorageProvider.baidu) return "";
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("pwd") || parsed.searchParams.get("password") || "";
  } catch {
    return "";
  }
}
