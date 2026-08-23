CREATE TABLE `WallpaperClick` (
  `id` VARCHAR(191) NOT NULL,
  `wallpaperId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `WallpaperClick_createdAt_wallpaperId_idx`(`createdAt`, `wallpaperId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WallpaperClick` ADD CONSTRAINT `WallpaperClick_wallpaperId_fkey` FOREIGN KEY (`wallpaperId`) REFERENCES `Wallpaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
