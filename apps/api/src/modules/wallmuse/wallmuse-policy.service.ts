import { Injectable } from "@nestjs/common";
import { AdminService } from "../admin/admin.service";
import { idleDecision, WaitForIdleError } from "./idle-policy";

@Injectable()
export class WallMusePolicyService {
  constructor(private readonly admin: AdminService) {}
  async schedule() { const settings = await this.admin.getSettings(); return idleDecision(settings.processIdleWindows || []); }
  async assertIdle() { const decision = await this.schedule(); if (!decision.allowed) throw new WaitForIdleError(decision); }
}
