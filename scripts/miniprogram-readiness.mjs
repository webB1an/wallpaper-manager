import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const json = process.argv.includes("--json");
const allowEmptyAppid = process.argv.includes("--allow-empty-appid");

const checks = [];
const env = {
  ...readDotenv("apps/api/.env"),
  ...process.env,
};
const app = readJson("apps/miniprogram/app.json");
const project = readJson("apps/miniprogram/project.config.json");
const domains = readJson("deploy/wechat-miniprogram-domains.json");
const sitemap = readJson("apps/miniprogram/sitemap.json");
const apiText = readText("apps/miniprogram/utils/api.ts");
const appTs = readText("apps/miniprogram/app.ts");
const categoryTs = readText("apps/miniprogram/pages/category/category.ts");
const detailTs = readText("apps/miniprogram/pages/detail/detail.ts");

const envAppid = String(env.MINIPROGRAM_APPID || env.WECHAT_MINIPROGRAM_APPID || "").trim();
const appid = String(project.appid || envAppid || "").trim();
if (!appid) {
  add(allowEmptyAppid ? "warn" : "fail", "appid", "微信 AppID", "project.config.json 仍为空", "拿到真实 AppID 后填入 apps/miniprogram/project.config.json。");
} else if (!/^wx[a-zA-Z0-9]{16,24}$/.test(appid)) {
  add("fail", "appid", "微信 AppID", `AppID 格式看起来不正确：${appid}`, "确认微信公众平台 AppID 后重新填写。");
} else {
  add("ok", "appid", "微信 AppID", project.appid ? "已填写" : "已通过 MINIPROGRAM_APPID 配置", "");
}

add(
  project.setting?.urlCheck === true ? "ok" : "fail",
  "url_check",
  "合法域名校验",
  project.setting?.urlCheck === true ? "urlCheck 已开启" : "urlCheck 未开启",
  "不要勾选微信开发者工具里的“不校验合法域名”。",
);

add(
  apiText.includes('const API_BASE = "https://wall-api.wdbzk.com/api"') ? "ok" : "fail",
  "api_base",
  "API 地址",
  "小程序 API 地址检查",
  "保持 apps/miniprogram/utils/api.ts 指向 https://wall-api.wdbzk.com/api。",
);

add(
  Array.isArray(domains.request) && domains.request.includes("https://wall-api.wdbzk.com"),
  "request_domain",
  "request 合法域名",
  "需要 wall-api.wdbzk.com",
  "在微信小程序后台配置 request 合法域名：https://wall-api.wdbzk.com。",
);

add(
  Array.isArray(domains.downloadFile) && domains.downloadFile.includes("https://wall-api.wdbzk.com"),
  "download_domain",
  "downloadFile 合法域名",
  "封面图经 wall-api.wdbzk.com 返回",
  "在微信小程序后台配置 downloadFile 合法域名：https://wall-api.wdbzk.com。",
);

add(
  ![...(domains.request || []), ...(domains.downloadFile || []), ...(domains.businessDomain || [])].includes("https://r.wdbzk.com"),
  "short_domain",
  "短链域名策略",
  "r.wdbzk.com 只作为复制文本",
  "不要把 r.wdbzk.com 加到 request/downloadFile；小程序不请求短链域名。",
);

for (const page of app.pages || []) {
  for (const extension of ["json", "ts", "wxml", "wxss"]) {
    const file = `apps/miniprogram/${page}.${extension}`;
    add(existsSync(join(root, file)), `page_${page}_${extension}`, "页面文件", file, `补齐 ${file}。`);
  }
}

const tabs = new Set((app.tabBar?.list || []).map((item) => item.pagePath));
for (const page of ["pages/index/index", "pages/category/category", "pages/mine/mine"]) {
  add(tabs.has(page), `tab_${page}`, "底部导航", page, `app.json tabBar 需要包含 ${page}。`);
}

const sitemapRules = sitemap.rules || [];
add(
  sitemapRules.some((rule) => rule.action === "disallow" && rule.page === "pages/detail/detail"),
  "sitemap_detail",
  "搜索收录规则",
  "详情页不被索引",
  "保持 sitemap.json 禁止索引详情页，避免无参数详情被收录。",
);

add(
  appTs.includes("showShareMenu") && appTs.includes("shareTimeline"),
  "share",
  "微信分享",
  "已启用分享给好友和朋友圈",
  "保持 app.ts 初始化分享能力。",
);

add(
  categoryTs.includes("wx.reLaunch") && !categoryTs.includes("wx.navigateTo({ url: `/pages/index/index"),
  "category_tab_jump",
  "分类跳转",
  "分类页可以携带筛选条件打开首页 tab",
  "首页是 tabBar 页面，分类页跳转必须使用 wx.reLaunch 或等价方案，不能用 wx.navigateTo 打开首页。",
);

add(
  apiText.includes("export function post") && detailTs.includes("recordDownloadClick") && detailTs.includes("/click`).catch"),
  "download_click",
  "下载统计",
  "复制短链后会上报下载点击，用于热门排序",
  "详情页复制短链成功后需要调用 /wallpapers/:id/click，保持热门排序和下载次数可信。",
);

const summary = checks.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, { ok: 0, warn: 0, fail: 0 });
const result = {
  ok: summary.fail === 0,
  allowEmptyAppid,
  appidConfigured: Boolean(appid),
  summary,
  actions: checks.filter((item) => item.status !== "ok"),
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printHuman(result);
}

if (!result.ok) process.exit(1);

function add(conditionOrStatus, key, label, message, nextStep) {
  const status = typeof conditionOrStatus === "string" ? conditionOrStatus : conditionOrStatus ? "ok" : "fail";
  checks.push({ key, label, status, message, nextStep });
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

function readDotenv(path) {
  const fullPath = join(root, path);
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

function printHuman(data) {
  console.log("WeChat Mini Program readiness");
  console.log(`AppID configured: ${data.appidConfigured ? "yes" : "no"}`);
  console.log(`Checks: ok ${data.summary.ok}, warn ${data.summary.warn}, fail ${data.summary.fail}`);
  console.log("");
  if (!data.actions.length) {
    console.log("Ready: mini program static release checks passed.");
    return;
  }
  console.log("Action required:");
  for (const action of data.actions) {
    console.log(`- [${action.status}] ${action.label} (${action.key})`);
    console.log(`  ${action.message}`);
    console.log(`  Next: ${action.nextStep}`);
  }
}
