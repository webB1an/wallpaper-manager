import { useEffect, useState } from "react";
import { Button, Space, Statistic, Tag } from "antd";
import { Copy, RefreshCw } from "lucide-react";
import { request } from "../api";
import { copyText, statusText, typeText } from "../format";
import { Header, IssueRow } from "../ui";
import type { AdminOverview, LibraryPreset, ReadinessReport } from "../types";

export function Dashboard({ onNavigate, onOpenLibrary }: { onNavigate: (key: string) => void; onOpenLibrary: (preset?: LibraryPreset) => void }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [nextOverview, nextReadiness] = await Promise.all([
        request<AdminOverview>("/api/admin/overview"),
        request<ReadinessReport>("/api/admin/readiness"),
      ]);
      setOverview(nextOverview);
      setReadiness(nextReadiness);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const issueCount = overview
    ? overview.ai.unreviewed
      + overview.storage.missingActiveLinks
      + overview.storage.missingShortLinks
      + overview.storage.unpublishedActiveShortLinks
      + overview.storage.missingQuark
      + overview.storage.missingBaidu
      + overview.tasks.failedToday
      + (overview.storageAccounts.defaultBaidu ? 0 : 1)
      + (overview.storageAccounts.defaultQuark ? 0 : 1)
      + (overview.channelAccounts.defaultConfigured ? 0 : 1)
      + (readiness?.actions.some((item) => item.key === "miniprogram_release") ? 1 : 0)
    : 0;

  return (
    <section>
      <Header title="概览" subtitle="今日任务、审核风险、网盘短链和频道账号状态。" />
      <Space className="toolbar">
        <Button type="primary" icon={<RefreshCw size={16} />} loading={loading} onClick={load}>刷新</Button>
        <Button onClick={() => onNavigate("upload")}>上传壁纸</Button>
        <Button onClick={() => onOpenLibrary()}>查看资源库</Button>
        <Button onClick={() => onNavigate("tasks")}>任务队列</Button>
      </Space>
      {overview && <LaunchChecklist overview={overview} readiness={readiness} onNavigate={onNavigate} onOpenLibrary={onOpenLibrary} />}
      <div className="stat-grid">
        <Statistic title="资源总数" value={overview?.wallpapers.total ?? "--"} />
        <Statistic title="已上架" value={overview?.wallpapers.published ?? "--"} />
        <Statistic title="待审核" value={overview?.wallpapers.pendingReview ?? "--"} />
        <Statistic title="待处理项" value={overview ? issueCount : "--"} valueStyle={{ color: issueCount ? "#b45309" : "#C05621" }} />
      </div>
      <div className="overview-grid">
        <div className="ops-panel">
          <h2>资源状态</h2>
          <div className="status-pills">
            {["draft", "processing", "pending_review", "published", "rejected", "archived"].map((status) => (
              <span key={status} className="is-clickable" onClick={() => onOpenLibrary({ status })}>
                <strong>{overview?.wallpapers.byStatus[status] ?? 0}</strong>
                {statusText(status)}
              </span>
            ))}
          </div>
        </div>
        <div className="ops-panel">
          <h2>已上架类型</h2>
          <div className="status-pills">
            {(overview?.wallpapers.byType.length ? overview.wallpapers.byType : [{ type: "暂无", count: 0 }]).map((item) => (
              <span key={item.type} className={item.type === "暂无" ? "" : "is-clickable"} onClick={item.type === "暂无" ? undefined : () => onOpenLibrary({ status: "published", type: item.type })}>
                <strong>{item.count}</strong>
                {typeText(item.type)}
              </span>
            ))}
          </div>
        </div>
        <div className="ops-panel">
          <h2>审核与同步</h2>
          <IssueRow label="AI 未识别" value={overview?.ai.unreviewed ?? 0} danger={Boolean(overview?.ai.unreviewed)} />
          <IssueRow label="AI 已拦截" value={overview?.ai.blocked ?? 0} danger={Boolean(overview?.ai.blocked)} />
          <IssueRow label="缺活跃网盘链接" value={overview?.storage.missingActiveLinks ?? 0} danger={Boolean(overview?.storage.missingActiveLinks)} onClick={() => onOpenLibrary({ storageFilter: "missing_active" })} />
          <IssueRow label="缺短链" value={overview?.storage.missingShortLinks ?? 0} danger={Boolean(overview?.storage.missingShortLinks)} onClick={() => onOpenLibrary({ storageFilter: "missing_short" })} />
          <IssueRow label="下架活跃短链" value={overview?.storage.unpublishedActiveShortLinks ?? 0} danger={Boolean(overview?.storage.unpublishedActiveShortLinks)} onClick={() => onOpenLibrary({ storageFilter: "unpublished_active_short" })} />
        </div>
        <div className="ops-panel">
          <h2>外部服务</h2>
          <div className="issue-row">
            <span>网盘账号</span>
            <Tag color={overview?.storageAccounts.defaultBaidu && overview.storageAccounts.defaultQuark ? "green" : "gold"}>
              {overview?.storageAccounts.total ?? 0} 个{overview?.storageAccounts.defaultBaidu ? " · 百度默认" : " · 缺百度默认"}{overview?.storageAccounts.defaultQuark ? " · 夸克默认" : " · 缺夸克默认"}
            </Tag>
          </div>
          <IssueRow label="夸克活跃链接" value={overview?.storage.activeQuark ?? 0} />
          <IssueRow label="百度活跃链接" value={overview?.storage.activeBaidu ?? 0} />
          <IssueRow label="缺夸克链接" value={overview?.storage.missingQuark ?? 0} danger={Boolean(overview?.storage.missingQuark)} onClick={() => onOpenLibrary({ storageFilter: "missing_quark" })} />
          <IssueRow label="缺百度链接" value={overview?.storage.missingBaidu ?? 0} danger={Boolean(overview?.storage.missingBaidu)} onClick={() => onOpenLibrary({ storageFilter: "missing_baidu" })} />
          <div className="issue-row">
            <span>频道账号</span>
            <Tag color={overview?.channelAccounts.defaultConfigured ? "green" : "gold"}>
              {overview?.channelAccounts.total ?? 0} 个{overview?.channelAccounts.defaultConfigured ? " · 已设默认" : " · 未设默认"}
            </Tag>
          </div>
        </div>
      </div>
    </section>
  );
}

export function LaunchChecklist({ overview, readiness, onNavigate, onOpenLibrary }: { overview: AdminOverview; readiness: ReadinessReport | null; onNavigate: (key: string) => void; onOpenLibrary: (preset?: LibraryPreset) => void }) {
  const miniProgramAction = readiness?.actions.find((item) => item.key === "miniprogram_release");
  const items = [
    {
      key: "miniprogram",
      title: "微信小程序 AppID 与域名",
      done: !miniProgramAction,
      detail: miniProgramAction?.message || "发布配置通过",
      actionText: "发布文档",
      action: () => window.open("https://github.com/webB1an/wallpaper-manager/blob/main/docs/deployment.md#14-%E5%BE%AE%E4%BF%A1%E5%B0%8F%E7%A8%8B%E5%BA%8F%E5%8F%91%E5%B8%83", "_blank"),
    },
    {
      key: "baidu",
      title: "默认百度网盘账号",
      done: overview.storageAccounts.defaultBaidu,
      detail: overview.storageAccounts.defaultBaidu ? "已配置" : "用于备用网盘同步和短链入库",
      actionText: "配置网盘",
      action: () => onNavigate("storageAccounts"),
    },
    {
      key: "quark",
      title: "默认夸克网盘账号",
      done: overview.storageAccounts.defaultQuark,
      detail: overview.storageAccounts.defaultQuark ? "已配置" : "作为默认主源上传与分享",
      actionText: "配置网盘",
      action: () => onNavigate("storageAccounts"),
    },
    {
      key: "channel",
      title: "默认腾讯频道账号",
      done: overview.channelAccounts.defaultConfigured,
      detail: overview.channelAccounts.defaultConfigured ? "已配置" : "用于上传后自动发帖和资源库手动发帖",
      actionText: "配置频道",
      action: () => onNavigate("channels"),
    },
    {
      key: "ai",
      title: "AI 审核清空",
      done: overview.ai.unreviewed === 0,
      detail: overview.ai.unreviewed === 0 ? "没有未识别资源" : `${overview.ai.unreviewed} 个资源等待识别`,
      actionText: "查看资源",
      action: () => onOpenLibrary({ aiReview: "unreviewed" }),
    },
    {
      key: "short",
      title: "上架资源短链完整",
      done: overview.storage.missingActiveLinks === 0 && overview.storage.missingShortLinks === 0,
      detail: overview.storage.missingActiveLinks || overview.storage.missingShortLinks
        ? `缺活跃链接 ${overview.storage.missingActiveLinks}，缺短链 ${overview.storage.missingShortLinks}`
        : "短链状态正常",
      actionText: "查看问题",
      action: () => onOpenLibrary({ storageFilter: overview.storage.missingActiveLinks ? "missing_active" : "missing_short" }),
    },
    {
      key: "legacy",
      title: "下架资源无活跃短链",
      done: overview.storage.unpublishedActiveShortLinks === 0,
      detail: overview.storage.unpublishedActiveShortLinks ? `${overview.storage.unpublishedActiveShortLinks} 个下架资源仍有活跃短链` : "已清理",
      actionText: "处理短链",
      action: () => onOpenLibrary({ storageFilter: "unpublished_active_short" }),
    },
  ];
  const remaining = items.filter((item) => !item.done).length;

  return (
    <div className="launch-checklist">
      <div className="launch-head">
        <div>
          <strong>上线待办</strong>
          <span>{remaining ? `还有 ${remaining} 项需要处理` : "关键链路已就绪"}</span>
        </div>
        <Space size={8}>
          {readiness?.report ? <Button size="small" icon={<Copy size={14} />} onClick={() => copyText(readiness.report, "上线报告已复制")}>复制报告</Button> : null}
          <Button size="small" onClick={() => onNavigate("diagnostics")}>打开诊断</Button>
        </Space>
      </div>
      <div className="launch-items">
        {items.map((item) => (
          <div key={item.key} className={`launch-item${item.done ? " is-done" : ""}`}>
            <Tag color={item.done ? "green" : "gold"}>{item.done ? "完成" : "待办"}</Tag>
            <div>
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
            {item.done ? null : <Button size="small" type="primary" ghost onClick={item.action}>{item.actionText}</Button>}
          </div>
        ))}
      </div>
    </div>
  );
}
