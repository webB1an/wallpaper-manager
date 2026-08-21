import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { AuthModule } from "../auth/auth.module";
import { TasksModule } from "../tasks/tasks.module";
import { WdbzkModule } from "../wdbzk/wdbzk.module";
import { ImportController } from "./import.controller";
import { OldCoverImportService } from "./old-cover-import.service";

@Module({
  imports: [AiModule, AuthModule, TasksModule, WdbzkModule],
  controllers: [ImportController],
  providers: [OldCoverImportService],
  exports: [OldCoverImportService],
})
export class ImportModule {}
