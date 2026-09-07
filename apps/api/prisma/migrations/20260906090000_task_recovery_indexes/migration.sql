CREATE INDEX `Task_status_type_updatedAt_idx` ON `Task`(`status`, `type`, `updatedAt`);
CREATE INDEX `Task_createdAt_idx` ON `Task`(`createdAt`);
