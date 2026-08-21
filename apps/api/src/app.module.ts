import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "node:path";
import { AdminModule } from "./modules/admin/admin.module";
import { AuthModule } from "./modules/auth/auth.module";
import { AiModule } from "./modules/ai/ai.module";
import { ChannelModule } from "./modules/channel/channel.module";
import { HealthController } from "./modules/health.controller";
import { ImportModule } from "./modules/import/import.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { PublicModule } from "./modules/public/public.module";
import { StorageModule } from "./modules/storage/storage.module";
import { TasksModule } from "./modules/tasks/tasks.module";
import { WdbzkModule } from "./modules/wdbzk/wdbzk.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["apps/api/.env", ".env"] }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>("REDIS_HOST") || "127.0.0.1",
          port: Number(config.get("REDIS_PORT") || 6379),
        },
      }),
    }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), "storage", "public"),
      serveRoot: "/assets",
    }),
    PrismaModule,
    AuthModule,
    AiModule,
    StorageModule,
    WdbzkModule,
    ChannelModule,
    TasksModule,
    PublicModule,
    AdminModule,
    ImportModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
