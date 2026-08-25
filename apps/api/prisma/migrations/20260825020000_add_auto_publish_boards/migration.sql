-- CreateTable
CREATE TABLE `AutoPublishBoard` (
  `id` VARCHAR(191) NOT NULL,
  `guildId` VARCHAR(128) NOT NULL,
  `guildName` VARCHAR(160) NULL,
  `channelId` VARCHAR(128) NOT NULL,
  `channelName` VARCHAR(160) NULL,
  `source` VARCHAR(64) NOT NULL DEFAULT 'wallpost',
  `sourceConfig` JSON NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `intervalHours` INTEGER NOT NULL DEFAULT 4,
  `lastRunAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  INDEX `AutoPublishBoard_enabled_idx`(`enabled`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
