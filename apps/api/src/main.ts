import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { config as loadEnv } from "dotenv";
import type { Express } from "express";
import { AppModule } from "./app.module";
import { enableJsonBigIntSerialization } from "./common/json";

async function bootstrap() {
  enableJsonBigIntSerialization();
  for (const envPath of ["apps/api/.env", ".env"]) {
    loadEnv({ path: envPath, quiet: true });
  }
  if (process.env.NODE_ENV === "production") {
    assertProductionConfig(process.env);
  }

  const app = await NestFactory.create(AppModule, { cors: false });
  (app.getHttpAdapter().getInstance() as Express).set("trust proxy", 1);
  const config = app.get(ConfigService);
  const adminOrigin = config.get<string>("ADMIN_ORIGIN") || "http://127.0.0.1:5173";

  app.enableCors({
    origin: [adminOrigin],
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix("api", {
    exclude: ["/health", "/r/:code"],
  });

  const port = Number(config.get("PORT") || 4000);
  await app.listen(port, "0.0.0.0");
  process.stdout.write(`Wallpaper API ready on :${port}\n`);
}

function assertProductionConfig(env: NodeJS.ProcessEnv) {
  const problems: string[] = [];
  const adminPassword = env.ADMIN_PASSWORD?.trim() || "";
  if (adminPassword.length < 12 || ["change-this-password", "CHANGE_ME"].includes(adminPassword)) {
    problems.push("ADMIN_PASSWORD 必须配置为至少 12 位的非默认强密码");
  }

  const jwtSecret = env.JWT_SECRET?.trim() || "";
  const insecureJwtSecrets = new Set([
    "development-secret-change-me-please",
    "change-this-to-a-random-secret-at-least-32-characters",
    "CHANGE_ME_TO_AT_LEAST_32_RANDOM_CHARS",
  ]);
  if (jwtSecret.length < 32 || insecureJwtSecrets.has(jwtSecret)) {
    problems.push("JWT_SECRET 必须配置为至少 32 位的非默认随机字符串");
  }

  const databaseUrl = env.DATABASE_URL?.trim() || "";
  const insecureDatabaseValues = ["CHANGE_ME", "YOUR_PASSWORD", ":password@", ":change-this-password@"];
  if (!databaseUrl || insecureDatabaseValues.some((value) => databaseUrl.includes(value))) {
    problems.push("DATABASE_URL 必须使用真实数据库地址和非默认密码");
  }

  const expectedOrigins: Array<[string, string]> = [
    ["PUBLIC_API_ORIGIN", "https://wall-api.wdbzk.com"],
    ["ADMIN_ORIGIN", "https://wall-admin.wdbzk.com"],
    ["SHORT_LINK_ORIGIN", "https://r.wdbzk.com"],
  ];
  for (const [key, expected] of expectedOrigins) {
    const value = (env[key] || "").trim().replace(/\/$/, "");
    if (value !== expected) {
      problems.push(`${key} 必须配置为 ${expected}`);
    }
  }

  if (problems.length) {
    throw new Error(`生产环境配置不完整：${problems.join("；")}`);
  }
}

void bootstrap();
