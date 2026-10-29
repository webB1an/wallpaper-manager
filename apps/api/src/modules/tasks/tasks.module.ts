import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { TaskRetentionService } from "./task-retention.service";
import { TasksController } from "./tasks.controller";
import { TasksService } from "./tasks.service";

@Module({
  imports: [AuthModule],
  controllers: [TasksController],
  providers: [TasksService, TaskRetentionService],
  exports: [TasksService, TaskRetentionService],
})
export class TasksModule {}
