import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { enableJsonBigIntSerialization } from "./common/json";

async function bootstrap() {
  enableJsonBigIntSerialization();
  const app = await NestFactory.create(AppModule, { cors: false });
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

void bootstrap();
