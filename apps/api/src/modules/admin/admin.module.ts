import { WallpaperDeleteService } from "./wallpaper-delete.service";
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AiModule } from "../ai/ai.module";
import { AuthModule } from "../auth/auth.module";
import { ChannelModule } from "../channel/channel.module";
import { StorageModule } from "../storage/storage.module";
import { TasksModule } from "../tasks/tasks.module";
import { WdbzkModule } from "../wdbzk/wdbzk.module";
import { AdminController } from "./admin.controller";
import { WALLPAPER_QUEUE } from "./admin.queue";
import { AdminService } from "./admin.service";
import { WallpaperProcessor } from "./wallpaper.processor";
import { QueueRecoveryService } from "./queue-recovery.service";
import { SourcesModule } from "../sources/sources.module";

@Module({
  imports: [
    SourcesModule,
    BullModule.registerQueue({ name: WALLPAPER_QUEUE }),
    AuthModule,
    AiModule,
    StorageModule,
    WdbzkModule,
    ChannelModule,
    TasksModule,
  ],
  controllers: [AdminController],
  providers: [WallpaperDeleteService, AdminService, WallpaperProcessor, QueueRecoveryService],
  exports: [AdminService],
})
export class AdminModule {}
