import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { PublicService } from "./public.service";

/** Guards run before Multer: unauthorized requests must never reach disk storage. */
@Injectable()
export class MiniUploadGuard implements CanActivate {
  constructor(private readonly service: PublicService) {}

  async canActivate(context: ExecutionContext) {
    const openid = context.switchToHttp().getRequest().headers["x-openid"];
    if (typeof openid !== "string" || !(await this.service.isMiniAdmin(openid))) {
      throw new ForbiddenException("无上传权限");
    }
    return true;
  }
}
