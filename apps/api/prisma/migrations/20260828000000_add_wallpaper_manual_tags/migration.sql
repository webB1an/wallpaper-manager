-- 小程序/管理端手动指定的标签（JSON 数组），用于与 AI 标签合并。
ALTER TABLE `Wallpaper` ADD COLUMN `manualTags` JSON NULL;

-- 标签在壁纸上的展示顺序：手动标签在前（0..n），AI 标签追加在后。
ALTER TABLE `WallpaperTag` ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0;
