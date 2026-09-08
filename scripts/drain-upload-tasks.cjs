const { mkdir, writeFile, unlink } = require("node:fs/promises");
const { join } = require("node:path");
const { createRequire } = require("node:module");
const { setTimeout: delay } = require("node:timers/promises");
const marker = join(process.cwd(), "storage", "private", "deploy-drain.json");

async function main() {
  if (process.argv.includes("--release")) {
    await unlink(marker).catch((error) => { if (error.code !== "ENOENT") throw error; });
    return;
  }
  const api = createRequire(join(process.cwd(), "apps/api/package.json"));
  api("dotenv").config({ path: "apps/api/.env", quiet: true });
  const { PrismaClient } = api("@prisma/client");
  const db = new PrismaClient();
  const configured = Number(process.env.DEPLOY_DRAIN_SECONDS || 60);
  const budget = Math.min(120, Math.max(0, Number.isFinite(configured) ? configured : 60)) * 1000;
  await mkdir(join(process.cwd(), "storage", "private"), { recursive: true });
  await writeFile(marker, JSON.stringify({ until: Date.now() + 5 * 60_000 }), { mode: 0o600 });
  const deadline = Date.now() + budget;
  try {
    do {
      const count = await db.task.count({ where: { type: { in: ["upload_asset", "auto_publish"] }, status: "running" } });
      if (!count) { console.log("No running publishing tasks; ready to restart."); return; }
      if (Date.now() >= deadline) { console.log(`Drain budget reached with ${count} running task(s); restart will use durable checkpoints.`); return; }
      await delay(Math.min(3000, deadline - Date.now()));
    } while (true);
  } finally { await db.$disconnect(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
