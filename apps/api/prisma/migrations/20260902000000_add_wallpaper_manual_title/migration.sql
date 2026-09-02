-- 用户手动填写的标题：存在时跳过 AI 识别，直接走网盘同步/发帖/上架。
ALTER TABLE `Wallpaper` ADD COLUMN `manualTitle` VARCHAR(191) NULL;
