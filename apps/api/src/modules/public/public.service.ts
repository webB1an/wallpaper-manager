import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageProvider, WallpaperStatus } from "@prisma/client";
import { shortUrl } from "../../common/public-url";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async list(query: { page?: number; pageSize?: number; keyword?: string; tag?: string; type?: string; sort?: string }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20)));
    const where = {
      status: WallpaperStatus.published,
      ...(query.keyword ? { title: { contains: query.keyword } } : {}),
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.tag ? { tags: { some: { tag: { name: query.tag } } } } : {}),
    };
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
      list: items.map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        coverUrl: item.coverUrl,
        tags: item.tags.map(({ tag }) => tag.name),
        viewCount: item.viewCount,
        downloadCount: item.downloadCount,
        createdAt: item.createdAt,
      })),
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
    await this.prisma.wallpaper.update({ where: { id }, data: { viewCount: { increment: 1 } } });
    return {
      id: item.id,
      title: item.title,
      type: item.type,
      coverUrl: item.coverUrl,
      tags: item.tags.map(({ tag }) => tag.name),
      viewCount: item.viewCount + 1,
      downloadCount: item.downloadCount,
      fileSize: Number(item.fileSize || 0),
      createdAt: item.createdAt,
      shortLinks: item.shortLinks
        .filter((link) => link.storageLink.isActive)
        .sort((left) => left.provider === StorageProvider.quark ? -1 : 1)
        .map((link) => ({
          provider: link.provider,
          label: link.provider === StorageProvider.quark ? "夸克下载" : "百度备用",
          url: shortUrl(this.config, link.code),
        })),
    };
  }

  async tags() {
    const tags = await this.prisma.tag.findMany({
      orderBy: { name: "asc" },
      where: { wallpapers: { some: { wallpaper: { status: WallpaperStatus.published } } } },
    });
    return tags.map((tag) => tag.name);
  }

  async redirect(code: string) {
    const link = await this.prisma.shortLink.findUnique({
      where: { code },
      include: { storageLink: true, wallpaper: true },
    });
    if (!link || !link.storageLink.isActive) throw new NotFoundException("短链不存在或已失效");
    await this.prisma.$transaction([
      this.prisma.shortLink.update({ where: { id: link.id }, data: { clickCount: { increment: 1 } } }),
      this.prisma.wallpaper.update({ where: { id: link.wallpaperId }, data: { downloadCount: { increment: 1 } } }),
    ]);
    const url = link.storageLink.passcode && link.storageLink.provider === StorageProvider.baidu && !link.storageLink.url.includes("pwd=")
      ? `${link.storageLink.url}${link.storageLink.url.includes("?") ? "&" : "?"}pwd=${link.storageLink.passcode}`
      : link.storageLink.url;
    return url;
  }
}
