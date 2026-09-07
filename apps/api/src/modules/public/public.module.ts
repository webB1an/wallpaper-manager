import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { PaymentModule } from "../payment/payment.module";
import { StorageModule } from "../storage/storage.module";
import { PublicController } from "./public.controller";
import { PublicService } from "./public.service";
import { MiniUploadGuard } from "./mini-upload.guard";

@Module({
  imports: [AdminModule, StorageModule, PaymentModule],
  controllers: [PublicController],
  providers: [PublicService, MiniUploadGuard],
})
export class PublicModule {}
