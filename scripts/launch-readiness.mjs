import { spawnSync } from "node:child_process";

const json = process.argv.includes("--json");
const strict = process.argv.includes("--strict");
const skipProduction = process.argv.includes("--skip-production");
const allowEmptyAppid = process.argv.includes("--allow-empty-appid");

const sections = [];

if (!skipProduction) {
  sections.push(runSection("production", "后台与线上服务", [
    "scripts/production-readiness.mjs",
    "--json",
    ...(strict ? ["--strict"] : []),
  ]));
} else {
  sections.push({
    key: "production",
    label: "后台与线上服务",
    ok: true,
    skipped: true,
    summary: { ok: 0, warn: 0, fail: 0 },
    actions: [],
  });
}

sections.push(runSection("miniprogram", "微信小程序发布", [
  "scripts/miniprogram-readiness.mjs",
  "--json",
  ...(allowEmptyAppid ? ["--allow-empty-appid"] : []),
]));

const normalizedSections = normalizeSections(sections);
const actionCount = normalizedSections.reduce((sum, section) => sum + (section.actions?.length || 0), 0);
const ok = sections.every((section) => section.ok);
const result = {
  ok,
  strict,
  allowEmptyAppid,
  skipProduction,
  actionCount,
  sections: normalizedSections,
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  printHuman(result);
}

if (!ok) process.exit(1);

function runSection(key, label, args) {
  const output = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
  });
  const raw = output.stdout.trim();
  const parsed = parseJson(raw);
  if (!parsed) {
    return {
      key,
      label,
      ok: false,
      exitCode: output.status ?? 1,
      summary: { ok: 0, warn: 0, fail: 1 },
      actions: [{
        key: `${key}_readiness`,
        status: "fail",
        label,
        message: (output.stderr || output.stdout || "readiness script did not return JSON").trim().slice(0, 1000),
        nextStep: "检查 readiness 脚本输出后重新运行。",
      }],
    };
  }
  return {
    key,
    label,
    ok: Boolean(parsed.ok),
    exitCode: output.status ?? 0,
    summary: parsed.diagnostics || parsed.summary || { ok: 0, warn: 0, fail: parsed.ok ? 0 : 1 },
    actions: parsed.actions || [],
    details: summarizeDetails(parsed),
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function summarizeDetails(value) {
  if (value.wallpapers || value.storage || value.settings) {
    return {
      wallpapers: value.wallpapers,
      storage: value.storage,
      settings: value.settings,
    };
  }
  if ("appidConfigured" in value) {
    return {
      appidConfigured: value.appidConfigured,
      allowEmptyAppid: value.allowEmptyAppid,
    };
  }
  return undefined;
}

function normalizeSections(value) {
  if (!allowEmptyAppid) return value;
  const miniprogramSection = value.find((section) => section.key === "miniprogram");
  const hasAppidWarning = miniprogramSection?.actions?.some((action) => action.key === "appid");
  if (!hasAppidWarning) return value;
  return value.map((section) => {
    if (section.key !== "production") return section;
    return {
      ...section,
      actions: (section.actions || []).filter((action) => action.key !== "miniprogram_release"),
    };
  });
}

function printHuman(data) {
  console.log("Wallpaper Manager launch readiness");
  console.log(`Result: ${data.ok ? "ready" : "action required"}`);
  console.log(`Actions: ${data.actionCount}`);
  console.log("");

  for (const section of data.sections) {
    const summary = section.summary || {};
    const skipped = section.skipped ? " · skipped" : "";
    console.log(`${section.ok ? "OK" : "CHECK"} ${section.label}${skipped}`);
    console.log(`  ok ${summary.ok || 0}, warn ${summary.warn || 0}, fail ${summary.fail || 0}`);
    if (section.details?.wallpapers) {
      console.log(`  wallpapers total ${section.details.wallpapers.total}, published ${section.details.wallpapers.published}`);
    }
    if (section.details?.storage) {
      console.log(`  storage quark ${section.details.storage.activeQuark}, baidu ${section.details.storage.activeBaidu}, missingActive ${section.details.storage.missingActiveLinks}`);
    }
    if (section.details && "appidConfigured" in section.details) {
      console.log(`  appid configured ${section.details.appidConfigured ? "yes" : "no"}`);
    }
    for (const action of section.actions || []) {
      console.log(`  - [${action.status}] ${action.label} (${action.key})`);
      console.log(`    ${action.message}`);
      if (action.command) console.log(`    Command: ${action.command}`);
      if (action.nextStep) console.log(`    Next: ${action.nextStep}`);
    }
    console.log("");
  }
}
