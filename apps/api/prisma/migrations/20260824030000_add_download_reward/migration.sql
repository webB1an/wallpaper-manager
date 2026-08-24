CREATE TABLE `WallpaperReward` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `date` DATETIME(3) NOT NULL,
  `type` ENUM('daily10','unlimited') NOT NULL,
  `usedCount` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `WallpaperReward_userId_date_key`(`userId`, `date`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DownloadToken` (
  `token` VARCHAR(191) NOT NULL,
  `wallpaperId` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `DownloadToken_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DownloadToken` ADD CONSTRAINT `DownloadToken_wallpaperId_fkey` FOREIGN KEY (`wallpaperId`) REFERENCES `Wallpaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
