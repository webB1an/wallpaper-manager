import { Module } from "@nestjs/common";
import { BaiduStorageService } from "./baidu-storage.service";
import { QuarkStorageService } from "./quark-storage.service";
import { StorageCoordinatorService } from "./storage-coordinator.service";

@Module({
  providers: [QuarkStorageService, BaiduStorageService, StorageCoordinatorService],
  exports: [QuarkStorageService, BaiduStorageService, StorageCoordinatorService],
})
export class StorageModule {}
