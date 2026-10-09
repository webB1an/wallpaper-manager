import { useEffect, useState } from "react";
import { Button, Space, Table, Tag } from "antd";
import { CloudUpload, Copy, HardDrive, RadioTower } from "lucide-react";
import { request } from "../api";
import { copyText } from "../format";
import { Header, DiagnosticMessage, DiagnosticStatusTag } from "../ui";
import type { DiagnosticItem, LibraryPreset, ReadinessReport } from "../types";

export function Diagnostics({ onNavigate, onOpenLibrary }: { onNavigate: (key: string) => void; onOpenLibrary: (preset?: LibraryPreset) => void }) {
  const [items, setItems] = useState<DiagnosticItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      setItems(await request<DiagnosticItem[]>("/api/admin/diagnostics"));
    } finally {
      setLoading(false);
    }
  };
  const copyReadinessReport = async () => {
    setReportLoading(true);
    try {
      const data = await request<ReadinessReport>("/api/admin/readiness");
      await copyText(data.report, "上线报告已复制");
    } finally {
      setReportLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  const okCount = items.filter((item) => item.status === "ok").length;
  const warnCount = items.filter((item) => item.status === "warn").length;
  const failCount = items.filter((item) => item.status === "fail").length;
  return (
    <section>
      <Header title="上线诊断" subtitle="检查数据库、Redis、网盘工具、AI、panapi 和频道发布依赖是否已经就绪。" />
      <Space className="toolbar">
        <Button type="primary" onClick={load} loading={loading}>重新检查</Button>
        <Button icon={<Copy size={14} />} onClick={copyReadinessReport} loading={reportLoading}>复制上线报告</Button>
        <Tag color="gold">正常 {okCount}</Tag>
        <Tag color={warnCount ? "gold" : "default"}>提醒 {warnCount}</Tag>
        <Tag color={failCount ? "red" : "default"}>失败 {failCount}</Tag>
      </Space>
      <LaunchFinalSteps items={items} onNavigate={onNavigate} />
      <Table rowKey="key" loading={loading} dataSource={items} pagination={false} columns={[
        { title: "项目", dataIndex: "label", width: 220 },
        { title: "状态", dataIndex: "status", width: 120, render: (status) => <DiagnosticStatusTag status={status} /> },
        { title: "说明", render: (_, row) => <DiagnosticMessage value={row.message} command={row.command} /> },
        { title: "操作", width: 220, render: (_, row) => <DiagnosticActions row={row} onNavigate={onNavigate} onOpenLibrary={onOpenLibrary} /> },
      ]} />
      <MiniProgramReleaseGuide />
    </section>
  );
}

export function LaunchFinalSteps({ items, onNavigate }: { items: DiagnosticItem[]; onNavigate: (key: string) => void }) {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const steps = [
    {
      key: "baidu",
      title: "授权百度备用源",
      description: "新增账号，打开授权链接，回填授权码并设为默认。",
      diagnostic: byKey.get("bdpan"),
      icon: <HardDrive size={16} />,
      action: () => onNavigate("storageAccounts"),
      actionText: "去网盘账号",
    },
    {
      key: "quark",
      title: "授权夸克主源",
      description: "新增账号，打开授权链接，回填 code 并设为默认。",
      diagnostic: byKey.get("quark_skill"),
      icon: <CloudUpload size={16} />,
      action: () => onNavigate("storageAccounts"),
      actionText: "去网盘账号",
    },
    {
      key: "channel",
      title: "配置腾讯频道",
      description: "保存 token，选择频道/版块，并设为默认账号。",
      diagnostic: byKey.get("channel_accounts"),
      icon: <RadioTower size={16} />,
      action: () => onNavigate("channels"),
      actionText: "去腾讯频道",
    },
  ];
  const visible = steps.filter((step) => step.diagnostic?.status !== "ok");
  if (!visible.length) return null;
  return (
    <div className="final-steps">
      <div className="final-steps-head">
        <div>
          <strong>上线收尾</strong>
          <span>这些账号需要在管理端完成授权；全部完成后再重新检查。</span>
        </div>
        <Tag color="gold">剩余 {visible.length} 项</Tag>
      </div>
      <div className="final-steps-grid">
        {visible.map((step) => (
          <div key={step.key} className={`final-step final-step-${step.diagnostic?.status || "warn"}`}>
            <span className="final-step-icon">{step.icon}</span>
            <div>
              <strong>{step.title}</strong>
              <span>{step.diagnostic?.message || step.description}</span>
            </div>
            <Button size="small" type={step.diagnostic?.status === "fail" ? "primary" : "default"} onClick={step.action}>{step.actionText}</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MiniProgramReleaseGuide() {
  const checklist = [
    "微信小程序发布参数",
    "AppID: 填入 apps/miniprogram/project.config.json",
    "request 合法域名: https://wall-api.wdbzk.com",
    "downloadFile 合法域名: https://wall-api.wdbzk.com",
    "uploadFile/connectSocket: 当前不使用，留空",
    "r.wdbzk.com: 只作为短链文本复制，不配置为小程序服务器域名",
    "开发者工具本地设置: 不勾选“不校验合法域名”",
  ].join("\n");
  return (
    <div className="release-guide">
      <div>
        <strong>微信小程序发布参数</strong>
        <span>AppID 填入项目配置；微信后台只配置 API 域名，短链域名只作为文本展示。</span>
      </div>
      <Space wrap>
        <Button size="small" icon={<Copy size={14} />} onClick={() => copyText("https://wall-api.wdbzk.com", "API 域名已复制")}>复制 API 域名</Button>
        <Button size="small" icon={<Copy size={14} />} onClick={() => copyText("https://r.wdbzk.com", "短链域名已复制")}>复制短链域名</Button>
        <Button size="small" icon={<Copy size={14} />} onClick={() => copyText(checklist, "小程序发布清单已复制")}>复制清单</Button>
      </Space>
      <div className="release-guide-grid">
        <span>request</span><code>https://wall-api.wdbzk.com</code>
        <span>downloadFile</span><code>https://wall-api.wdbzk.com</code>
        <span>短链策略</span><code>r.wdbzk.com 只复制文本</code>
      </div>
    </div>
  );
}

export function DiagnosticActions({ row, onNavigate, onOpenLibrary }: { row: DiagnosticItem; onNavigate: (key: string) => void; onOpenLibrary: (preset?: LibraryPreset) => void }) {
  const action = diagnosticAction(row, onNavigate, onOpenLibrary);
  if (!row.command && !action) return null;
  return (
    <Space size={8} wrap>
      {action ? <Button size="small" type={row.status === "fail" ? "primary" : "default"} onClick={action.onClick}>{action.label}</Button> : null}
      {row.command ? <Button size="small" icon={<Copy size={14} />} onClick={() => copyText(row.command || "", "命令已复制")}>复制命令</Button> : null}
    </Space>
  );
}

export function diagnosticAction(row: DiagnosticItem, onNavigate: (key: string) => void, onOpenLibrary: (preset?: LibraryPreset) => void) {
  if (row.key === "bdpan" || row.key === "quark_skill") {
    return { label: "去网盘账号", onClick: () => onNavigate("storageAccounts") };
  }
  if (row.key === "channel_accounts") {
    return { label: "去腾讯频道", onClick: () => onNavigate("channels") };
  }
  if (row.key === "unpublished_active_short_links") {
    return { label: "处理短链", onClick: () => onOpenLibrary({ storageFilter: "unpublished_active_short" }) };
  }
  if (row.key === "old_cover_source") {
    return { label: "老封面迁移", onClick: () => onNavigate("import") };
  }
  if (row.key === "miniprogram_release") {
    return { label: "发布文档", onClick: () => window.open("https://github.com/webB1an/wallpaper-manager/blob/main/docs/deployment.md#14-%E5%BE%AE%E4%BF%A1%E5%B0%8F%E7%A8%8B%E5%BA%8F%E5%8F%91%E5%B8%83", "_blank") };
  }
  return null;
}
