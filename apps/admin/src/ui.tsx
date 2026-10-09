import { useEffect, useState } from "react";
import { Space, Statistic, Tag } from "antd";
import { Tags } from "lucide-react";
import { request } from "./api";
import { statusText } from "./format";
import type { DiagnosticItem, HotWallpaper, TaskSummary } from "./types";

export function Header({ title, subtitle }: { title: string; subtitle: string }) {
  const [summary, setSummary] = useState<TaskSummary | null>(null);

  useEffect(() => {
    request<TaskSummary>("/api/admin/tasks/summary")
      .then(setSummary)
      .catch(() => undefined);
  }, []);

  return (
    <header className="page-header">
      <div>
        <span className="eyebrow"><Tags size={14} /> Wallpaper Manager</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <Space>
        <Statistic title="今日队列" value={summary?.todayTotal ?? "--"} />
        <Statistic title="进行中" value={summary?.active ?? "--"} />
      </Space>
    </header>
  );
}

export function StatusTag({ status }: { status: string }) {
  const colors: Record<string, string> = {
    archived: "default",
    classify_failed: "red",
    draft: "default",
    failed: "red",
    matched: "green",
    needs_review: "gold",
    pending_review: "blue",
    processing: "gold",
    published: "green",
    queued: "blue",
    rejected: "red",
    running: "gold",
    skipped: "default",
    success: "green",
  };
  return <Tag color={colors[status] || "default"}>{statusText(status)}</Tag>;
}

export function DiagnosticStatusTag({ status }: { status: DiagnosticItem["status"] }) {
  const label = { ok: "正常", warn: "提醒", fail: "失败" }[status];
  const color = { ok: "green", warn: "gold", fail: "red" }[status];
  return <Tag color={color}>{label}</Tag>;
}

export function DiagnosticMessage({ value, command }: { value: string; command?: string }) {
  if (!command) return <span>{value}</span>;
  return (
    <div className="diagnostic-message">
      <span>{value}</span>
      <code>{command}</code>
    </div>
  );
}

export function IssueRow({ label, value, danger = false, onClick }: { label: string; value: number; danger?: boolean; onClick?: () => void }) {
  return (
    <div className={`issue-row${onClick ? " is-clickable" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <strong className={danger ? "is-danger" : ""}>{value}</strong>
    </div>
  );
}

export function TrendBars({ labels, values }: { labels: string[]; values: number[] }) {
  const max = Math.max(1, ...values);
  const latest = values.length ? values[values.length - 1] : 0;
  return (
    <div className="trend-row">
      <div className="trend-bars">
        {values.map((value, index) => (
          <div key={index} className="trend-bar-col" title={`${labels[index]}：${value}`}>
            <div className="trend-bar" style={{ height: `${(value / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <span className="trend-latest">{latest}</span>
    </div>
  );
}

export function RankList({ items }: { items: HotWallpaper[] }) {
  if (!items.length) return <span className="muted">暂无数据</span>;
  return (
    <ol className="rank-list">
      {items.map((item, index) => (
        <li key={item.id} className="rank-item">
          <span className={`rank-no ${index < 3 ? "rank-top" : ""}`}>{index + 1}</span>
          {item.coverUrl ? <img className="rank-cover" src={item.coverUrl} /> : <span className="rank-cover rank-cover-empty" />}
          <span className="rank-title">{item.title}</span>
          <span className="rank-clicks">{item.clicks}</span>
        </li>
      ))}
    </ol>
  );
}

export function TagCloud({ items, gap }: { items: Array<{ keyword: string; count: number }>; gap: boolean }) {
  if (!items.length) return <span className="muted">无</span>;
  return (
    <div className="hot-tag-cloud">
      {items.map((item) => <Tag key={item.keyword} color={gap ? "red" : "default"}>{item.keyword} · {item.count}</Tag>)}
    </div>
  );
}
