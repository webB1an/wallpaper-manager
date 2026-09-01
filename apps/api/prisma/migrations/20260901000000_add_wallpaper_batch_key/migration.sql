-- 小程序端一次上传（同一批次）的分组标识，用于把多张壁纸合并成一条帖子发布。
ALTER TABLE `Wallpaper` ADD COLUMN `batchKey` VARCHAR(191) NULL;
ALTER TABLE `Wallpaper` ADD COLUMN `batchPublishQueued` BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX `Wallpaper_batchKey_idx` ON `Wallpaper`(`batchKey`);
