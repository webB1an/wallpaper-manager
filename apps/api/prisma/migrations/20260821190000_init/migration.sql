-- CreateTable
CREATE TABLE `Wallpaper` (
    `id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `type` ENUM('static', 'live', 'mobile', 'desktop', 'other') NOT NULL DEFAULT 'other',
    `status` ENUM('draft', 'processing', 'pending_review', 'published', 'rejected', 'archived') NOT NULL DEFAULT 'draft',
    `coverPath` VARCHAR(191) NULL,
    `coverUrl` VARCHAR(191) NULL,
    `assetPath` VARCHAR(191) NULL,
    `mimeType` VARCHAR(191) NULL,
    `fileSize` BIGINT NULL,
    `matchKey` VARCHAR(512) NULL,
    `matchConfidence` DOUBLE NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `downloadCount` INTEGER NOT NULL DEFAULT 0,
    `autoPublish` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Wallpaper_status_sortOrder_idx`(`status`, `sortOrder`),
    INDEX `Wallpaper_matchKey_idx`(`matchKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tag` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Tag_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WallpaperTag` (
    `wallpaperId` VARCHAR(191) NOT NULL,
    `tagId` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`wallpaperId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StorageLink` (
    `id` VARCHAR(191) NOT NULL,
    `wallpaperId` VARCHAR(191) NOT NULL,
    `provider` ENUM('quark', 'baidu') NOT NULL,
    `url` TEXT NOT NULL,
    `passcode` VARCHAR(191) NULL,
    `remotePath` VARCHAR(191) NULL,
    `remoteFileId` VARCHAR(191) NULL,
    `wdbzkResourceId` INTEGER NULL,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StorageLink_provider_isActive_idx`(`provider`, `isActive`),
    INDEX `StorageLink_wallpaperId_idx`(`wallpaperId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShortLink` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `wallpaperId` VARCHAR(191) NOT NULL,
    `storageLinkId` VARCHAR(191) NOT NULL,
    `provider` ENUM('quark', 'baidu') NOT NULL,
    `clickCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ShortLink_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AiAnalysis` (
    `id` VARCHAR(191) NOT NULL,
    `wallpaperId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `type` ENUM('static', 'live', 'mobile', 'desktop', 'other') NOT NULL,
    `tags` JSON NOT NULL,
    `sensitiveFlags` JSON NOT NULL,
    `safe` BOOLEAN NOT NULL,
    `summary` TEXT NULL,
    `raw` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AiAnalysis_wallpaperId_key`(`wallpaperId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('upload_asset', 'ai_classify', 'quark_sync', 'baidu_sync', 'wdbzk_sync', 'channel_publish', 'old_cover_import') NOT NULL,
    `status` ENUM('queued', 'running', 'success', 'failed', 'skipped') NOT NULL DEFAULT 'queued',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `message` TEXT NULL,
    `payload` JSON NULL,
    `result` JSON NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChannelAccount` (
    `id` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `tokenCipher` TEXT NOT NULL,
    `tokenTail` VARCHAR(191) NOT NULL,
    `guildId` VARCHAR(191) NOT NULL,
    `guildName` VARCHAR(191) NULL,
    `channelId` VARCHAR(191) NOT NULL,
    `channelName` VARCHAR(191) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OldCoverImport` (
    `id` VARCHAR(191) NOT NULL,
    `coverFileName` VARCHAR(191) NOT NULL,
    `coverPath` VARCHAR(191) NULL,
    `candidateTitle` VARCHAR(191) NOT NULL,
    `matchKey` VARCHAR(512) NOT NULL,
    `oldResourceId` INTEGER NULL,
    `oldResourceName` VARCHAR(191) NULL,
    `oldResourceLink` TEXT NULL,
    `confidence` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `message` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OldCoverImport_coverFileName_key`(`coverFileName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WallpaperTag` ADD CONSTRAINT `WallpaperTag_wallpaperId_fkey` FOREIGN KEY (`wallpaperId`) REFERENCES `Wallpaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WallpaperTag` ADD CONSTRAINT `WallpaperTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StorageLink` ADD CONSTRAINT `StorageLink_wallpaperId_fkey` FOREIGN KEY (`wallpaperId`) REFERENCES `Wallpaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShortLink` ADD CONSTRAINT `ShortLink_wallpaperId_fkey` FOREIGN KEY (`wallpaperId`) REFERENCES `Wallpaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShortLink` ADD CONSTRAINT `ShortLink_storageLinkId_fkey` FOREIGN KEY (`storageLinkId`) REFERENCES `StorageLink`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AiAnalysis` ADD CONSTRAINT `AiAnalysis_wallpaperId_fkey` FOREIGN KEY (`wallpaperId`) REFERENCES `Wallpaper`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
