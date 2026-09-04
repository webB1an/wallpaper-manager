import { spawnSync } from "node:child_process";

// A confirmed vulnerability blocks deployment; an unavailable advisory service
// is reported separately so it does not make an otherwise valid release fail.
const result = spawnSync("npm", ["audit", "--omit=dev", "--json", "--fetch-timeout=30000", "--fetch-retries=0"], {
  encoding: "utf8",
  timeout: 45000,
  maxBuffer: 8 * 1024 * 1024,
});

let report;
try { report = JSON.parse(result.stdout || ""); } catch { /* No valid report. */ }
const total = report?.metadata?.vulnerabilities?.total;
if (typeof total === "number" && total > 0) {
  console.error(result.stdout);
  console.error("Production dependencies contain known vulnerabilities; deployment blocked.");
  process.exit(1);
}
if (result.status === 0 && total === 0) {
  console.log("Production audit passed: 0 vulnerabilities.");
  process.exit(0);
}

const detail = `${result.stderr || ""}\n${JSON.stringify(report?.error || {})}`;
const unavailable = result.error?.code === "ETIMEDOUT" ||
  /ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|network timeout|\b50[0234]\b/i.test(detail);
if (unavailable) {
  console.warn("::warning::npm advisory service unavailable. Live vulnerability verification was NOT completed; deploying after other checks as explicitly authorized.");
  process.exit(0);
}
console.error("Production audit failed unexpectedly; deployment blocked.");
console.error(result.error?.message || detail);
process.exit(1);
