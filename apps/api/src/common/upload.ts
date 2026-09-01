import { BadRequestException } from "@nestjs/common";
import { diskStorage } from "multer";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { nanoid } from "nanoid";

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

export const DEFAULT_UPLOAD_MAX_FILE_MB = 300;

export function uploadMaxBytes() {
  const value = Number(process.env.UPLOAD_MAX_FILE_MB || DEFAULT_UPLOAD_MAX_FILE_MB);
  return Number.isFinite(value) && value > 0 ? value * 1024 * 1024 : DEFAULT_UPLOAD_MAX_FILE_MB * 1024 * 1024;
}

export function uploadFileFilter() {
  return (_request: unknown, file: Express.Multer.File, callback: (error: Error | null, acceptFile: boolean) => void) => {
    if (ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) return callback(null, true);
    callback(new BadRequestException(`不支持的文件格式：${file.originalname}`), false);
  };
}

let cleanedOnce = false;

function tempUploadDir() {
  const dir = join(process.cwd(), "storage", "tmp-uploads");
  mkdirSync(dir, { recursive: true });
  if (!cleanedOnce) {
    cleanedOnce = true;
    try {
      const now = Date.now();
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        try {
          if (statSync(full).mtimeMs < now - 24 * 60 * 60 * 1000) rmSync(full, { force: true });
        } catch {
          // 单个文件清理失败忽略
        }
      }
    } catch {
      // 清理失败不影响上传
    }
  }
  return dir;
}

/** 磁盘流式上传：边传边写盘，避免大文件全部缓存在内存。 */
export function uploadDiskStorage() {
  return diskStorage({
    destination: (_request, _file, callback) => callback(null, tempUploadDir()),
    filename: (_request, file, callback) => {
      const match = /\.([^.]+)$/.exec(file.originalname || "");
      callback(null, `${Date.now()}-${nanoid(10)}${match ? `.${match[1]}` : ""}`);
    },
  });
}

/** 清理本次请求已写入磁盘、但后续处理失败的临时文件。 */
export function removeUploadedTempFiles(files?: Array<{ path?: string }>) {
  if (!files) return;
  for (const file of files) {
    if (!file.path) continue;
    try {
      rmSync(file.path, { force: true });
    } catch {
      // 忽略清理失败
    }
  }
}
