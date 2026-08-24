import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { PublicController } from "./public.controller";
import { PublicService } from "./public.service";

@Module({
  imports: [StorageModule],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
