ALTER TABLE `Task` MODIFY COLUMN `type` ENUM('upload_asset','ai_classify','quark_sync','baidu_sync','wdbzk_sync','channel_publish','old_cover_import','asset_fetch') NOT NULL;
