import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageProvider, WallpaperOrientation, WallpaperStatus, WallpaperType } from "@prisma/client";
import { shortUrl } from "../../common/public-url";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async list(query: { page?: number; pageSize?: number; keyword?: string; tag?: string; type?: string; orientation?: string; sort?: string }) {
    const page = positiveInt(query.page, 1, "页码");
    const pageSize = positiveInt(query.pageSize, 20, "每页数量", 50);
    const type = optionalWallpaperType(query.type);
    const orientation = optionalWallpaperOrientation(query.orientation);
    const keyword = cleanSearchText(query.keyword);
    const tag = cleanSearchText(query.tag);
    const where = {
      status: WallpaperStatus.published,
      ...(keyword ? { title: { contains: keyword } } : {}),
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
          include: { tags: { include: { tag: true } } },
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
      return { list: items, total, page, pageSize };
    }
    const orderBy = query.sort === "hot"
      ? [{ downloadCount: "desc" as const }, { viewCount: "desc" as const }]
      : [{ sortOrder: "desc" as const }, { createdAt: "desc" as const }];
    const [items, total] = await Promise.all([
      this.prisma.wallpaper.findMany({
        where,
        include: { tags: { include: { tag: true } } },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.wallpaper.count({ where }),
    ]);
    return {
      list: items.map(wallpaperCard),
      total,
      page,
      pageSize,
    };
  }

  async detail(id: string) {
    const item = await this.prisma.wallpaper.findFirst({
      where: { id, status: WallpaperStatus.published },
      include: {
        tags: { include: { tag: true } },
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

  async tags() {
    const tags = await this.prisma.tag.findMany({
      orderBy: { name: "asc" },
      where: { wallpapers: { some: { wallpaper: { status: WallpaperStatus.published } } } },
    });
    return tags.map((tag) => tag.name);
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
      this.prisma.wallpaperTag.groupBy({
        by: ["tagId"],
        where: { wallpaper: { status: WallpaperStatus.published } },
        _count: { _all: true },
        orderBy: { _count: { tagId: "desc" } },
        take: 80,
      }),
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
        .map((group) => ({ name: tagNameById.get(group.tagId) || "", count: group._count._all, coverUrl: coverByTagId.get(group.tagId) || FALLBACK_COVER_URL }))
        .filter((tag) => tag.name),
    };
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
      include: { tags: { include: { tag: true } } },
      orderBy: [{ downloadCount: "desc" }, { sortOrder: "desc" }, { createdAt: "desc" }],
      take: 6,
    });
    return related.map(wallpaperCard);
  }

  private async tagCoverMap(tagIds: string[]) {
    const result = new Map<string, string>();
    for (const tagId of tagIds) {
      const item = await this.prisma.wallpaper.findFirst({
        where: { status: WallpaperStatus.published, tags: { some: { tagId } } },
        orderBy: [
          { downloadCount: "desc" },
          { sortOrder: "desc" },
          { createdAt: "desc" },
        ],
      });
      if (item) result.set(tagId, publicCoverUrl(item.coverUrl));
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
    return left.provider === StorageProvider.quark ? -1 : 1;
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
