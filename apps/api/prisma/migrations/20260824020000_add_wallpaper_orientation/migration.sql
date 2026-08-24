ALTER TABLE `Wallpaper` ADD COLUMN `orientation` ENUM('portrait','landscape','square','unknown') NOT NULL DEFAULT 'unknown';
