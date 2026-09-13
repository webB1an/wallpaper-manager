import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { WallMuseService, parseInput } from "./wallmuse.service";

const visible = { status: "published" as const, aiAnalysis: { is: { safe: true } } };

@Controller("wallpaper-collections")
export class CollectionsController {
  constructor(private readonly prisma: PrismaService, private readonly service: WallMuseService) {}
  @Get()
  async list(@Query("page") pageValue?: string) {
    const page = parseInput(z.coerce.number().int().min(1).max(10000).default(1), pageValue);
    if (!(await this.service.enabled())) return { code: 200, data: { list: [], total: 0, page, pageSize: 12 } };
    const where = { article: { lifecycle: "synced" }, items: { some: { wallpaper: visible } } };
    const [rows, total] = await Promise.all([
      this.prisma.wallMuseCollection.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 12, take: 12,
        include: { items: { where: { wallpaper: visible }, orderBy: { sortOrder: "asc" }, take: 1, select: { wallpaper: { select: { coverUrl: true } } } }, _count: { select: { items: { where: { wallpaper: visible } } } } } }),
      this.prisma.wallMuseCollection.count({ where }),
    ]);
    return { code: 200, data: { list: rows.map((row) => ({ id: row.id, articleId: row.articleId, title: row.title, intro: row.intro.slice(0, 120), coverUrl: row.items[0]?.wallpaper.coverUrl || row.coverUrl, count: row._count.items, createdAt: row.createdAt })), total, page, pageSize: 12 } };
  }
  @Get(":id")
  async detail(@Param("id") id: string) {
    if (!(await this.service.enabled())) throw new NotFoundException("合集暂不可用");
    const collection = await this.prisma.wallMuseCollection.findFirst({
      where: { id, article: { lifecycle: "synced" } },
      include: {
        items: {
          where: { wallpaper: visible }, orderBy: { sortOrder: "asc" },
          include: { wallpaper: { include: { tags: { include: { tag: true }, orderBy: { sortOrder: "asc" } } } } },
        },
      },
    });
    if (!collection || !collection.items.length) throw new NotFoundException("合集不存在或内容已下架");
    return { code: 200, data: { id: collection.id, title: collection.title, intro: collection.intro, createdAt: collection.createdAt,
      items: collection.items.map(({ wallpaper, sortOrder }) => ({ id: wallpaper.id, title: wallpaper.title, coverUrl: wallpaper.coverUrl, type: wallpaper.type, orientation: wallpaper.orientation,
        tags: wallpaper.tags.map((item) => item.tag.name), viewCount: wallpaper.viewCount, downloadCount: wallpaper.downloadCount, number: sortOrder + 1 })) } };
  }
}
