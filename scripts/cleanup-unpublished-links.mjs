import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const env = {
  ...readDotenv("apps/api/.env"),
  ...process.env,
};

const adminOrigin = (env.ADMIN_ORIGIN || "https://wall-admin.wdbzk.com").replace(/\/$/, "");
const username = env.ADMIN_USERNAME || "admin";
const password = env.ADMIN_PASSWORD;
const apply = process.argv.includes("--apply");
const json = process.argv.includes("--json");
const pageSize = 100;

if (!password) {
  failEarly("ADMIN_PASSWORD is required. Run this on the server or provide ADMIN_PASSWORD in the environment.");
}

const login = await request("/api/admin/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
});

if (typeof login.token !== "string" || login.token.length < 20) {
  failEarly("admin login did not return a valid token");
}

const headers = { Authorization: `Bearer ${login.token}`, "Content-Type": "application/json" };
const matches = await collectMatches(headers);

const result = {
  ok: true,
  apply,
  adminOrigin,
  matchedWallpapers: matches.length,
  sample: matches.slice(0, 10),
  affectedLinks: 0,
  affectedWallpapers: 0,
};

if (apply && matches.length) {
  for (const chunk of chunks(matches.map((item) => item.id), pageSize)) {
    const affected = await request("/api/admin/wallpapers/bulk/deactivate-unpublished-links", {
      method: "POST",
      headers,
      body: JSON.stringify({ ids: chunk }),
    });
    result.affectedLinks += affected.affectedLinks || 0;
    result.affectedWallpapers += affected.affectedWallpapers || 0;
  }
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printHuman(result);
}

async function collectMatches(headers) {
  const matches = [];
  let page = 1;
  let total = 0;
  do {
    const data = await request(`/api/admin/wallpapers?page=${page}&pageSize=${pageSize}&storage=unpublished_active_short`, { headers });
    total = Number(data.total || 0);
    for (const item of data.list || []) {
      matches.push({
        id: item.id,
        title: item.title,
        status: item.status,
        activeLinks: (item.storageLinks || []).filter((link) => link.isActive).length,
      });
    }
    page += 1;
  } while (matches.length < total);
  return matches;
}

async function request(path, init = {}) {
  const response = await fetch(`${adminOrigin}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 200) {
    throw new Error(`${path} failed with ${response.status}: ${body.message || body.error || "invalid response"}`);
  }
  return body.data;
}

function printHuman(data) {
  console.log("Wallpaper Manager unpublished link cleanup");
  console.log(`Admin: ${data.adminOrigin}`);
  console.log(`Mode: ${data.apply ? "apply" : "dry-run"}`);
  console.log(`Matched wallpapers: ${data.matchedWallpapers}`);
  if (data.sample.length) {
    console.log("Sample:");
    for (const item of data.sample) {
      console.log(`- ${item.id} [${item.status}] ${item.title} (${item.activeLinks} active links)`);
    }
  }
  if (data.apply) {
    console.log(`Affected links: ${data.affectedLinks}`);
    console.log(`Affected wallpapers: ${data.affectedWallpapers}`);
  } else {
    console.log("No data was changed. Re-run with --apply to deactivate active storage links for these non-published wallpapers.");
  }
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function failEarly(message) {
  if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(message);
  process.exit(1);
}

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
