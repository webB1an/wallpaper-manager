import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AdminAuthGuard } from "../admin/auth.guard";

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>("JWT_SECRET") || "development-secret-change-me-please",
        signOptions: { expiresIn: "7d" },
      }),
    }),
  ],
  providers: [AdminAuthGuard],
  exports: [JwtModule, AdminAuthGuard],
})
export class AuthModule {}
