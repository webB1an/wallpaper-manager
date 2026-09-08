import { readFileSync } from "node:fs";
import { join } from "node:path";

export function deploymentDraining() {
  try {
    const marker = JSON.parse(readFileSync(join(process.cwd(), "storage", "private", "deploy-drain.json"), "utf8"));
    return Number.isFinite(marker.until) && marker.until > Date.now();
  } catch { return false; }
}
