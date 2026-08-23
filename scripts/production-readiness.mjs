import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const env = {
  ...readDotenv("apps/api/.env"),
  ...process.env,
};

const adminOrigin = (env.ADMIN_ORIGIN || "https://wall-admin.wdbzk.com").replace(/\/$/, "");
const username = env.ADMIN_USERNAME || "admin";
const password = env.ADMIN_PASSWORD;
const strict = env.PRODUCTION_READINESS_STRICT === "1" || process.argv.includes("--strict");
const json = process.argv.includes("--json");

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
const [overview, diagnostics, settings] = await Promise.all([
  request("/api/admin/overview", { headers }),
  request("/api/admin/diagnostics", { headers }),
  request("/api/admin/settings", { headers }),
]);

const counts = diagnostics.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, { ok: 0, warn: 0, fail: 0 });
const blockers = diagnostics.filter((item) => item.status === "fail" || item.status === "warn");
const actions = blockers.map(toAction);
const ready = counts.fail === 0 && (!strict || counts.warn === 0);

const result = {
  ok: ready,
  strict,
  adminOrigin,
  wallpapers: {
    total: overview.wallpapers?.total ?? 0,
    published: overview.wallpapers?.published ?? 0,
    pendingReview: overview.wallpapers?.pendingReview ?? 0,
  },
  storage: {
    activeQuark: overview.storage?.activeQuark ?? 0,
    activeBaidu: overview.storage?.activeBaidu ?? 0,
    missingActiveLinks: overview.storage?.missingActiveLinks ?? 0,
    unpublishedActiveShortLinks: overview.storage?.unpublishedActiveShortLinks ?? 0,
  },
  diagnostics: counts,
  settings: {
    defaultAutoProcess: Boolean(settings.defaultAutoProcess),
    defaultAutoPublish: Boolean(settings.defaultAutoPublish),
  },
  actions,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printHuman(result);
}

if (!ready) process.exit(1);

async function request(path, init = {}) {
  const response = await fetch(`${adminOrigin}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 200) {
    throw new Error(`${path} failed with ${response.status}: ${body.message || body.error || "invalid response"}`);
  }
  return body.data;
}

function toAction(item) {
  const base = {
    key: item.key,
    status: item.status,
    label: item.label,
    message: item.message,
    command: item.command || undefined,
    nextStep: "",
  };
  if (item.key === "bdpan") {
    return {
      ...base,
      nextStep: "打开管理端“网盘账号”，新增或选择百度账号，点击授权，打开链接后把授权码粘贴回后台并设为默认账号。",
    };
  }
  if (item.key === "quark_skill") {
    return {
      ...base,
      nextStep: "打开管理端“网盘账号”，新增或选择夸克账号，点击授权，打开链接后把 code 授权码粘贴回后台并设为默认账号。",
    };
  }
  if (item.key === "channel_accounts") {
    return {
      ...base,
      nextStep: "打开管理端的腾讯频道账号配置，新增账号 token，选择频道/版块，并设置一个默认账号。",
    };
  }
  if (item.key === "miniprogram_release") {
    return {
      ...base,
      nextStep: "按 docs/deployment.md 的“微信小程序发布”章节处理：填写 AppID，确认 wall-api.wdbzk.com 合法域名，保持 r.wdbzk.com 只作为复制短链文本。",
    };
  }
  if (item.key === "unpublished_active_short_links") {
    return {
      ...base,
      nextStep: "在管理端资源库筛选“下架活跃短链”，确认后点击批量清理。公开跳转当前已经被后端拦截。",
    };
  }
  return {
    ...base,
    nextStep: item.command ? "复制命令到宝塔终端执行，完成后重新运行本检查。" : "按诊断信息处理后重新运行本检查。",
  };
}

function printHuman(data) {
  console.log("Wallpaper Manager production readiness");
  console.log(`Admin: ${data.adminOrigin}`);
  console.log(`Diagnostics: ok ${data.diagnostics.ok}, warn ${data.diagnostics.warn}, fail ${data.diagnostics.fail}`);
  console.log(`Wallpapers: total ${data.wallpapers.total}, published ${data.wallpapers.published}, pendingReview ${data.wallpapers.pendingReview}`);
  console.log(`Storage: quark ${data.storage.activeQuark}, baidu ${data.storage.activeBaidu}, missingActive ${data.storage.missingActiveLinks}, unpublishedActiveShort ${data.storage.unpublishedActiveShortLinks}`);
  console.log(`Defaults: autoProcess ${data.settings.defaultAutoProcess}, autoPublish ${data.settings.defaultAutoPublish}`);
  console.log("");

  if (!data.actions.length) {
    console.log("Ready: no failed or warning diagnostics.");
    return;
  }

  console.log("Action required:");
  for (const action of data.actions) {
    console.log(`- [${action.status}] ${action.label} (${action.key})`);
    console.log(`  ${action.message}`);
    if (action.command) console.log(`  Command: ${action.command}`);
    console.log(`  Next: ${action.nextStep}`);
  }

  console.log("");
  console.log(data.strict ? "Strict readiness failed while warnings remain." : "Readiness failed while failed diagnostics remain.");
}

function failEarly(message) {
  if (json) {
    console.log(JSON.stringify({
      ok: false,
      error: message,
      diagnostics: { ok: 0, warn: 0, fail: 1 },
      actions: [{
        key: "production_readiness",
        status: "fail",
        label: "后台与线上服务",
        message,
        nextStep: message.includes("ADMIN_PASSWORD")
          ? "在服务器项目目录运行 readiness，或在本地环境提供 ADMIN_PASSWORD 后重新运行。"
          : "按错误信息处理后重新运行本检查。",
      }],
    }, null, 2));
  }
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
