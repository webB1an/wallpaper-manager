import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const projectPath = join(process.cwd(), "apps/miniprogram/project.config.json");
const args = process.argv.slice(2);
const clear = args.includes("--clear");
const appid = args.find((arg) => !arg.startsWith("--")) || "";

if (!clear && !appid) {
  console.error("Usage: npm run miniprogram:appid -- <wx-appid>");
  console.error("       npm run miniprogram:appid -- --clear");
  process.exit(1);
}

if (!clear && !/^wx[a-zA-Z0-9]{16,24}$/.test(appid)) {
  console.error(`Invalid WeChat Mini Program AppID: ${appid}`);
  console.error("Expected format: wx followed by 16-24 letters or digits.");
  process.exit(1);
}

const project = JSON.parse(readFileSync(projectPath, "utf8"));
project.appid = clear ? "" : appid;
writeFileSync(projectPath, `${JSON.stringify(project, null, 2)}\n`);

console.log(clear ? "Mini Program AppID cleared" : `Mini Program AppID set to ${appid}`);
