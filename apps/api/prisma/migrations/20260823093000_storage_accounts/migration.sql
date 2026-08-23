-- CreateTable
CREATE TABLE `StorageAccount` (
    `id` VARCHAR(191) NOT NULL,
    `provider` ENUM('quark', 'baidu') NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `profileDir` VARCHAR(512) NOT NULL,
    `configPath` VARCHAR(512) NULL,
    `accountName` VARCHAR(191) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastProbeOk` BOOLEAN NULL,
    `lastProbeMessage` TEXT NULL,
    `lastProbeAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `StorageAccount_provider_isDefault_idx`(`provider`, `isDefault`),
    INDEX `StorageAccount_provider_isActive_idx`(`provider`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `StorageLink` ADD COLUMN `storageAccountId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `StorageLink_storageAccountId_idx` ON `StorageLink`(`storageAccountId`);

-- AddForeignKey
ALTER TABLE `StorageLink` ADD CONSTRAINT `StorageLink_storageAccountId_fkey` FOREIGN KEY (`storageAccountId`) REFERENCES `StorageAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
