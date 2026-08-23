import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { AdminService } from "./admin.service";
import { WALLPAPER_QUEUE } from "./admin.queue";

@Processor(WALLPAPER_QUEUE, { concurrency: 2 })
export class WallpaperProcessor extends WorkerHost {
  constructor(private readonly admin: AdminService) {
    super();
  }

  async process(job: Job<{ taskId: string; wallpaperId: string; storageSelection?: { quarkAccountId?: string; baiduAccountId?: string } }>) {
    if (job.name === "process-wallpaper") {
      return this.admin.runProcessWallpaper(job.data.wallpaperId, job.data.taskId, job.data.storageSelection);
    }
    return undefined;
  }
}
