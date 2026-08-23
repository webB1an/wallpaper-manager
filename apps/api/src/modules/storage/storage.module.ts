import { Module } from "@nestjs/common";
import { BaiduStorageService } from "./baidu-storage.service";
import { StorageAccountService } from "./storage-account.service";
import { QuarkStorageService } from "./quark-storage.service";
import { StorageCoordinatorService } from "./storage-coordinator.service";

@Module({
  providers: [StorageAccountService, QuarkStorageService, BaiduStorageService, StorageCoordinatorService],
  exports: [StorageAccountService, QuarkStorageService, BaiduStorageService, StorageCoordinatorService],
})
export class StorageModule {}
