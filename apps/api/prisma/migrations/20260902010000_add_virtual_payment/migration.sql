-- CreateTable
CREATE TABLE `VirtualPaymentOrder` (
    `id` VARCHAR(191) NOT NULL,
    `outTradeNo` VARCHAR(191) NOT NULL,
    `wxOrderId` VARCHAR(191) NULL,
    `openid` VARCHAR(191) NOT NULL,
    `productKey` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `goodsPrice` INTEGER NOT NULL,
    `buyQuantity` INTEGER NOT NULL,
    `totalFee` INTEGER NOT NULL,
    `status` ENUM('pending', 'paid', 'delivered', 'closed', 'refunded', 'failed') NOT NULL DEFAULT 'pending',
    `attach` TEXT NOT NULL,
    `signData` TEXT NOT NULL,
    `paySig` TEXT NOT NULL,
    `signature` TEXT NOT NULL,
    `rawPayload` JSON NULL,
    `paidAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `lastQueryAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `VirtualPaymentOrder_outTradeNo_key`(`outTradeNo`),
    UNIQUE INDEX `VirtualPaymentOrder_wxOrderId_key`(`wxOrderId`),
    INDEX `VirtualPaymentOrder_openid_createdAt_idx`(`openid`, `createdAt`),
    INDEX `VirtualPaymentOrder_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `VirtualPaymentEntitlement` (
    `id` VARCHAR(191) NOT NULL,
    `openid` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `remaining` INTEGER NOT NULL DEFAULT 0,
    `expiresAt` DATETIME(3) NULL,
    `sourceOrderId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `VirtualPaymentEntitlement_openid_type_expiresAt_idx`(`openid`, `type`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
