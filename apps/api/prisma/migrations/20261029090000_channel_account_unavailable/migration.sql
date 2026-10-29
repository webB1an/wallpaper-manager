-- 腾讯频道账号可用性：平台明确拒绝（token 过期/失效）时记录在账号下，重新授权后清空。
ALTER TABLE `ChannelAccount`
    ADD COLUMN `unavailableAt` DATETIME(3) NULL,
    ADD COLUMN `unavailableReason` VARCHAR(255) NULL;
