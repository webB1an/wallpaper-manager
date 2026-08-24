import { Module } from "@nestjs/common";
import { TasksModule } from "../tasks/tasks.module";
import { AssetFetchService } from "./asset-fetch.service";
import { BaiduStorageService } from "./baidu-storage.service";
import { StorageAccountService } from "./storage-account.service";
import { QuarkStorageService } from "./quark-storage.service";
import { StorageCoordinatorService } from "./storage-coordinator.service";

@Module({
  imports: [TasksModule],
  providers: [StorageAccountService, QuarkStorageService, BaiduStorageService, StorageCoordinatorService, AssetFetchService],
  exports: [StorageAccountService, QuarkStorageService, BaiduStorageService, StorageCoordinatorService, AssetFetchService],
})
export class StorageModule {}
