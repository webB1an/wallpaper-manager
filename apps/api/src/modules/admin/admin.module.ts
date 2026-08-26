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

@Module({
  imports: [
    BullModule.registerQueue({ name: WALLPAPER_QUEUE }),
    AuthModule,
    AiModule,
    StorageModule,
    WdbzkModule,
    ChannelModule,
    TasksModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, WallpaperProcessor],
  exports: [AdminService],
})
export class AdminModule {}
