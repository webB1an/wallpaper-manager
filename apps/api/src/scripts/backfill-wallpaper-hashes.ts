import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { resolve, sep } from "node:path";
import { fileSha256 } from "../modules/sources/source-intake.service";

// Read-only by default. Never re-download originals or merge existing wallpaper records.
async function main() {
  const prisma = new PrismaClient();
  const apply = process.argv.includes("--apply");
  const arg = (name: string) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
  const limit = Number(arg("--limit") || 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("limit 必须在 1–1000 之间");
  const root = resolve(arg("--storage-root") || resolve(process.cwd(), "storage/public"));
  const after = arg("--after");
  const result = { mode: apply ? "apply" : "dry-run", scanned: 0, available: 0, written: 0, duplicates: 0, unavailable: 0, nextCursor: "" };
  const hashes = new Set<string>();
  try {
    const rows = await prisma.wallpaper.findMany({ where: { contentHash: null, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: "asc" }, take: limit, select: { id: true, assetPath: true } });
    for (const row of rows) {
      result.scanned++; result.nextCursor = row.id;
      const path = row.assetPath ? resolve(root, row.assetPath) : "";
      if (!path.startsWith(root + sep)) { result.unavailable++; continue; }
      let hash: string;
      try { hash = await fileSha256(path); } catch { result.unavailable++; continue; }
      result.available++;
      if (hashes.has(hash) || await prisma.wallpaper.findUnique({ where: { contentHash: hash }, select: { id: true } })) { result.duplicates++; continue; }
      hashes.add(hash);
      if (!apply) continue;
      try { result.written += (await prisma.wallpaper.updateMany({ where: { id: row.id, contentHash: null }, data: { contentHash: hash } })).count; }
      catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") result.duplicates++; else throw error; }
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } finally { await prisma.$disconnect(); }
}
void main().catch((error: Error) => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
