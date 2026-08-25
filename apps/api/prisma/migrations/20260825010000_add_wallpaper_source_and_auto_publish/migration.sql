-- AlterTable
ALTER TABLE `ChannelAccount` ADD COLUMN `autoPublish` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `lastAutoPublishAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `WallpaperSource` (
  `id` VARCHAR(191) NOT NULL,
  `source` VARCHAR(64) NOT NULL,
  `sourceId` VARCHAR(255) NOT NULL,
  `wallpaperId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `WallpaperSource_source_sourceId_key`(`source`, `sourceId`),
  INDEX `WallpaperSource_source_createdAt_idx`(`source`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WallpaperSource` ADD CONSTRAINT `WallpaperSource_wallpaperId_fkey` FOREIGN KEY (`wallpaperId`) REFERENCES `Wallpaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
