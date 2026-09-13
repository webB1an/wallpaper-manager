-- AlterTable
ALTER TABLE `Wallpaper` ADD COLUMN `collectionOnly` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `contentHash` CHAR(64) NULL;

-- CreateTable
CREATE TABLE `WorkLease` (
    `key` VARCHAR(191) NOT NULL,
    `owner` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WallMuseArticle` (
    `id` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(100) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `title` VARCHAR(240) NOT NULL,
    `lifecycle` VARCHAR(24) NOT NULL DEFAULT 'pending',
    `currentRevisionId` VARCHAR(64) NULL,
    `copiedRevisionId` VARCHAR(64) NULL,
    `activeJobId` VARCHAR(64) NULL,
    `copiedAt` DATETIME(3) NULL,
    `syncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WallMuseArticle_requestKey_key`(`requestKey`),
    INDEX `WallMuseArticle_lifecycle_createdAt_idx`(`lifecycle`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WallMuseRevision` (
    `id` VARCHAR(64) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL,
    `payload` JSON NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `candidate` BOOLEAN NOT NULL DEFAULT false,
    `copiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WallMuseRevision_articleId_revision_key`(`articleId`, `revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WallMuseJob` (
    `id` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `requestKey` VARCHAR(100) NOT NULL,
    `requestHash` CHAR(64) NOT NULL,
    `kind` VARCHAR(24) NOT NULL DEFAULT 'generate',
    `status` VARCHAR(24) NOT NULL DEFAULT 'queued',
    `stage` VARCHAR(24) NOT NULL DEFAULT 'collect',
    `message` TEXT NULL,
    `error` TEXT NULL,
    `input` JSON NOT NULL,
    `checkpoint` JSON NOT NULL,
    `nextRunAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `cancelRequested` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WallMuseJob_requestKey_key`(`requestKey`),
    INDEX `WallMuseJob_status_nextRunAt_idx`(`status`, `nextRunAt`),
    INDEX `WallMuseJob_articleId_createdAt_idx`(`articleId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WallMuseAsset` (
    `id` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `wallpaperId` VARCHAR(191) NOT NULL,
    `ordinal` INTEGER NOT NULL,
    `source` VARCHAR(64) NOT NULL,
    `sourceId` VARCHAR(255) NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `perceptualHash` CHAR(16) NULL,
    `publishPath` VARCHAR(512) NOT NULL,
    `width` INTEGER NOT NULL,
    `height` INTEGER NOT NULL,
    `state` VARCHAR(24) NOT NULL DEFAULT 'analyze',
    `analysis` JSON NULL,
    `drives` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WallMuseAsset_articleId_wallpaperId_key`(`articleId`, `wallpaperId`),
    UNIQUE INDEX `WallMuseAsset_articleId_ordinal_key`(`articleId`, `ordinal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WallMuseCollection` (
    `id` VARCHAR(191) NOT NULL,
    `articleId` VARCHAR(191) NOT NULL,
    `revisionId` VARCHAR(64) NOT NULL,
    `title` VARCHAR(240) NOT NULL,
    `intro` TEXT NOT NULL,
    `coverUrl` VARCHAR(1024) NOT NULL,
    `wallpaperIds` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WallMuseCollection_articleId_key`(`articleId`),
    INDEX `WallMuseCollection_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WallMuseCollectionItem` (
    `collectionId` VARCHAR(191) NOT NULL,
    `wallpaperId` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL,

    UNIQUE INDEX `WallMuseCollectionItem_collectionId_sortOrder_key`(`collectionId`, `sortOrder`),
    PRIMARY KEY (`collectionId`, `wallpaperId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Wallpaper_contentHash_key` ON `Wallpaper`(`contentHash`);

-- AddForeignKey
ALTER TABLE `WallMuseRevision` ADD CONSTRAINT `WallMuseRevision_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `WallMuseArticle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WallMuseJob` ADD CONSTRAINT `WallMuseJob_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `WallMuseArticle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WallMuseAsset` ADD CONSTRAINT `WallMuseAsset_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `WallMuseArticle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WallMuseAsset` ADD CONSTRAINT `WallMuseAsset_wallpaperId_fkey` FOREIGN KEY (`wallpaperId`) REFERENCES `Wallpaper`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WallMuseCollection` ADD CONSTRAINT `WallMuseCollection_articleId_fkey` FOREIGN KEY (`articleId`) REFERENCES `WallMuseArticle`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WallMuseCollectionItem` ADD CONSTRAINT `WallMuseCollectionItem_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `WallMuseCollection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WallMuseCollectionItem` ADD CONSTRAINT `WallMuseCollectionItem_wallpaperId_fkey` FOREIGN KEY (`wallpaperId`) REFERENCES `Wallpaper`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
