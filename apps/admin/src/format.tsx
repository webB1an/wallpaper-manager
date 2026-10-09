import type React from "react";
import { message } from "antd";
import type { Wallpaper } from "./types";

export function statusText(value: string) {
  const map: Record<string, string> = {
    draft: "草稿",
    processing: "处理中",
    pending_review: "待审核",
    published: "已上架",
    rejected: "已拦截",
    archived: "已下架",
    queued: "排队中",
    running: "执行中",
    success: "成功",
    failed: "失败",
    skipped: "已跳过",
    matched: "已匹配",
    needs_review: "待复核",
    classify_failed: "识别失败",
  };
  return map[value] || value;
}

export function typeText(value: string) {
  const map: Record<string, string> = {
    static: "静态壁纸",
    live: "动态壁纸",
    mobile: "手机壁纸",
    desktop: "桌面壁纸",
    other: "其他",
  };
  return map[value] || value;
}

export function orientationText(value: string) {
  const map: Record<string, string> = {
    portrait: "手机壁纸",
    landscape: "电脑壁纸",
    square: "方图",
    unknown: "未知",
  };
  return map[value] || value || "未知";
}

export function aiReviewText(value: string) {
  const map: Record<string, string> = {
    unreviewed: "未识别",
    safe: "通过",
    blocked: "已拦截",
  };
  return map[value] || value;
}

export function storageFilterText(value: string) {
  const map: Record<string, string> = {
    has_quark: "有夸克",
    has_baidu: "有百度",
    missing_quark: "缺夸克",
    missing_baidu: "缺百度",
    missing_active: "缺活跃链接",
    missing_short: "缺短链",
    unpublished_active_short: "下架活跃短链",
  };
  return map[value] || value;
}

export function taskTypeText(value: string) {
  const map: Record<string, string> = {
    upload_asset: "上传处理",
    ai_classify: "AI 识别",
    quark_sync: "夸克同步",
    baidu_sync: "百度同步",
    wdbzk_sync: "wdbzk 入库",
    channel_publish: "频道发帖",
    old_cover_import: "老封面迁移",
    asset_fetch: "回源下载",
    auto_publish: "板块自动发帖",
  };
  return map[value] || value;
}

export function sensitiveFlagText(value: string) {
  const map: Record<string, string> = {
    sexual: "色情",
    violence: "暴力",
    political: "政治",
    vulgar: "低俗",
  };
  return map[value] || value;
}

export function providerText(value: string) {
  return value === "quark" ? "夸克" : value === "baidu" ? "百度" : value;
}

export function splitTags(value?: string | string[]) {
  const parts = Array.isArray(value) ? value : String(value || "").split(/[,\n，]/);
  return parts.map((item) => String(item).trim()).filter(Boolean);
}

export function taskTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

export function requestStatusLabel(status: string) {
  return ({ pending: "待处理", searching: "查找中", fulfilled: "已收录", not_found: "暂未找到", closed: "已关闭" } as Record<string, string>)[status] || status;
}

export function getChannelPublishIssue(ids: React.Key[], rows: Wallpaper[]) {
  const idSet = new Set(ids.map(String));
  const selected = rows.filter((row) => idSet.has(row.id));
  const hasLive = selected.some((row) => row.type === "live" || row.mimeType?.startsWith("video/"));
  if (hasLive && ids.length > 1) return "动态壁纸一次只能发布 1 个，不能和静态图混发";
  if (!hasLive && ids.length > 18) return "静态壁纸一次最多发布 18 张图";
  return "";
}

export function uploadErrorMessage(value: unknown) {
  if (!value) return "请检查文件格式和大小";
  if (typeof value === "string") return value.slice(0, 120);
  if (typeof value === "object") {
    const data = value as { message?: unknown; error?: unknown; statusText?: unknown };
    const messageText = typeof data.message === "string" ? data.message : "";
    const errorText = typeof data.error === "string" ? data.error : "";
    const statusText = typeof data.statusText === "string" ? data.statusText : "";
    return (messageText || errorText || statusText || "请检查文件格式和大小").slice(0, 120);
  }
  return "请检查文件格式和大小";
}

export async function copyText(value: string, successText = "短链已复制") {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
  message.success(successText);
}
