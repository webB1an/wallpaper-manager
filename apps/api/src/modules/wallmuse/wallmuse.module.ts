import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { AiModule } from "../ai/ai.module";
import { SourcesModule } from "../sources/sources.module";
import { StorageModule } from "../storage/storage.module";
import { CollectionsController } from "./collections.controller";
import { WallMuseAiService } from "./wallmuse-ai.service";
import { WallMusePolicyService } from "./wallmuse-policy.service";
import { WallMuseController } from "./wallmuse.controller";
import { WallMuseService } from "./wallmuse.service";
import { WallMuseWorker } from "./wallmuse.worker";

@Module({ imports: [AdminModule, AiModule, SourcesModule, StorageModule], controllers: [WallMuseController, CollectionsController],
  providers: [WallMuseService, WallMusePolicyService, WallMuseAiService, WallMuseWorker] })
export class WallMuseModule {}
