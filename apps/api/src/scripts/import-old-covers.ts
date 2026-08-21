import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { OldCoverImportService } from "../modules/import/old-cover-import.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn"] });
  const importer = app.get(OldCoverImportService);
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;
  const classify = process.argv.includes("--classify");
  const result = classify ? await importer.classifyImported(limit || 50) : await importer.run(limit);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await app.close();
}

void main();
