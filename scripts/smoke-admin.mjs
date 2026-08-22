import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const env = {
  ...readDotenv("apps/api/.env"),
  ...process.env,
};
const adminOrigin = (env.ADMIN_ORIGIN || "https://wall-admin.wdbzk.com").replace(/\/$/, "");
const username = env.ADMIN_USERNAME || "admin";
const password = env.ADMIN_PASSWORD;
const strict = env.STRICT_ADMIN_SMOKE === "1" || process.argv.includes("--strict");

if (!password) {
  throw new Error("ADMIN_PASSWORD is required. Run this on the server or provide ADMIN_PASSWORD in the environment.");
}

async function request(path, init = {}) {
  const response = await fetch(`${adminOrigin}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 200) {
    throw new Error(`${path} failed with ${response.status}: ${body.message || body.error || "invalid response"}`);
  }
  return body.data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const login = await request("/api/admin/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});
assert(typeof login.token === "string" && login.token.length > 20, "admin login must return a token");

const headers = { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" };
const [me, overview, diagnostics, settings] = await Promise.all([
  request("/api/admin/me", { headers }),
  request("/api/admin/overview", { headers }),
  request("/api/admin/diagnostics", { headers }),
  request("/api/admin/settings", { headers }),
]);

assert(me.ok === true, "admin /me must return ok");
assert(typeof overview.wallpapers?.published === "number", "overview must include published wallpaper count");
assert(typeof overview.storage?.missingActiveLinks === "number", "overview must include storage health counts");
assert(Array.isArray(diagnostics) && diagnostics.length > 0, "diagnostics must be a non-empty array");
assert(typeof settings.defaultAutoProcess === "boolean", "settings must include defaultAutoProcess");

const diagnosticCounts = diagnostics.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, {});
if (strict && (diagnosticCounts.fail || diagnosticCounts.warn)) {
  throw new Error(`strict diagnostics failed: ${JSON.stringify(diagnosticCounts)}`);
}

console.log(JSON.stringify({
  ok: true,
  adminOrigin,
  wallpapers: {
    total: overview.wallpapers.total,
    published: overview.wallpapers.published,
    pendingReview: overview.wallpapers.pendingReview,
  },
  storage: {
    activeQuark: overview.storage.activeQuark,
    activeBaidu: overview.storage.activeBaidu,
    missingActiveLinks: overview.storage.missingActiveLinks,
    unpublishedActiveShortLinks: overview.storage.unpublishedActiveShortLinks,
  },
  diagnostics: diagnosticCounts,
  strict,
  settings: {
    defaultAutoProcess: settings.defaultAutoProcess,
    defaultAutoPublish: settings.defaultAutoPublish,
  },
}, null, 2));

function readDotenv(path) {
  const fullPath = join(process.cwd(), path);
  if (!existsSync(fullPath)) return {};
  return Object.fromEntries(
    readFileSync(fullPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return index === -1 ? [line, ""] : [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}
