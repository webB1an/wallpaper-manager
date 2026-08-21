import { Module } from "@nestjs/common";
import { WdbzkService } from "./wdbzk.service";

@Module({
  providers: [WdbzkService],
  exports: [WdbzkService],
})
export class WdbzkModule {}
