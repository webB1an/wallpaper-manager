-- Make previously synchronized WallMuse wallpapers visible in the normal feed.
-- Draft, rejected and archived wallpapers remain untouched.
UPDATE `Wallpaper` AS w
SET `collectionOnly` = false
WHERE w.`collectionOnly` = true AND w.`status` = 'published'
  AND EXISTS (
    SELECT 1 FROM `WallMuseAsset` AS asset
    JOIN `WallMuseArticle` AS article ON article.`id` = asset.`articleId`
    WHERE asset.`wallpaperId` = w.`id` AND article.`lifecycle` = 'synced'
  );
