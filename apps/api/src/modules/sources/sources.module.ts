import { Module } from "@nestjs/common";
import { WorkLeaseService } from "./work-lease.service";
import { SourceIntakeService } from "./source-intake.service";

@Module({ providers: [WorkLeaseService, SourceIntakeService], exports: [WorkLeaseService, SourceIntakeService] })
export class SourcesModule {}
