CREATE TABLE `WallpaperRequest` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `subject` VARCHAR(191) NOT NULL,
  `description` TEXT NOT NULL,
  `wallpaperType` ENUM('static', 'live', 'mobile', 'desktop', 'other') NOT NULL DEFAULT 'static',
  `orientation` ENUM('portrait', 'landscape', 'square', 'unknown') NOT NULL DEFAULT 'portrait',
  `status` ENUM('pending', 'searching', 'fulfilled', 'not_found', 'closed') NOT NULL DEFAULT 'pending',
  `adminNote` TEXT NULL,
  `wallpaperId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `WallpaperRequest_userId_createdAt_idx`(`userId`, `createdAt`),
  INDEX `WallpaperRequest_status_createdAt_idx`(`status`, `createdAt`),
  INDEX `WallpaperRequest_wallpaperId_idx`(`wallpaperId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WallpaperRequest`
  ADD CONSTRAINT `WallpaperRequest_wallpaperId_fkey`
  FOREIGN KEY (`wallpaperId`) REFERENCES `Wallpaper`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
