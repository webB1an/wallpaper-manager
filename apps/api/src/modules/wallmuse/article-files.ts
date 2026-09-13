import { copyFile, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, join, resolve, sep } from "node:path";
import sharp from "sharp";
import type { AutoSourceItem } from "../admin/auto-publish-sources";

export function privateAssetPath(relative: string) {
  if (!/^article-images\/[a-f0-9-]+\.jpg$/.test(relative)) throw new Error("文章图片路径无效");
  const root = resolve(process.cwd(), "storage", "wallmuse");
  const path = resolve(root, relative);
  if (!path.startsWith(root + sep)) throw new Error("文章图片路径超出保存目录");
  return path;
}

export async function prepareArticleFiles(item: AutoSourceItem) {
  if (item.type !== "static" || !item.fileType.startsWith("image/")) throw new Error("公众号文章仅支持静态图片");
  const base = randomUUID();
  const root = join(process.cwd(), "storage", "public");
  const originalRelative = `originals/wm-${base}${extname(item.fileName).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 8) || ".image"}`;
  const coverRelative = `covers/wm-${base}.jpg`;
  const publishRelative = `article-images/${base}.jpg`;
  const original = join(root, originalRelative);
  const cover = join(root, coverRelative);
  const publish = privateAssetPath(publishRelative);
  for (const dir of [join(root, "originals"), join(root, "covers"), join(process.cwd(), "storage", "wallmuse", "article-images")]) await mkdir(dir, { recursive: true });
  const cleanup = async () => { for (const path of [original, cover, publish, `${publish}.tmp`]) await unlink(path).catch(() => undefined); };
  try {
    const meta = await sharp(item.filePath, { limitInputPixels: 80_000_000 }).metadata();
    if (!meta.width || !meta.height || (meta.pages || 1) > 1) throw new Error("无法读取静态图片尺寸，或图片包含动画");
    await copyFile(item.filePath, original);
    const image = await sharp(item.filePath, { limitInputPixels: 80_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
    await writeFile(`${publish}.tmp`, image.data);
    await rename(`${publish}.tmp`, publish);
    await sharp(image.data).resize({ width: 720, height: 1080, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(cover);
    const gray = await sharp(image.data).resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();
    let bits = 0n;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1n : 0n);
    return { originalRelative, coverRelative, publishRelative, width: image.info.width, height: image.info.height, perceptualHash: bits.toString(16).padStart(16, "0"), cleanup };
  } catch (error) { await cleanup(); throw error; }
}
