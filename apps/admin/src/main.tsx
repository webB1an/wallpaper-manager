import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, Button, ConfigProvider, Form, Image, Input, InputNumber, Layout, Menu, Modal, Popconfirm, Progress, Select, Space, Table, Tag, Upload, message, Switch, Statistic, Tabs } from "antd";
import type { UploadFile, UploadProps } from "antd";
import { Activity, CloudUpload, Copy, GalleryVerticalEnd, HardDrive, Home, ListChecks, RadioTower, RefreshCw, Search, Settings as SettingsIcon, Tags, UploadCloud } from "lucide-react";
import zhCN from "antd/locale/zh_CN";
import "./styles.css";

const API = import.meta.env.VITE_API_BASE_URL || "";

type Wallpaper = {
  id: string;
  title: string;
  originalName: string;
  type: string;
  status: string;
  mimeType?: string;
  coverUrl?: string;
  sortOrder: number;
  tags: Array<{ tag: { name: string } }>;
  storageLinks: Array<{ id: string; provider: string; url: string; isActive: boolean; isPrimary: boolean }>;
  shortLinks: Array<{ id: string; provider: string; storageLinkId: string; url: string; clickCount: number }>;
  aiAnalysis?: {
    safe: boolean;
    sensitiveFlags: string[];
    summary?: string;
  } | null;
};

type TaskItem = {
  id: string;
  type: string;
  status: string;
  progress: number;
  message?: string;
  error?: string;
  result?: { warnings?: string[] };
};

type TaskSummary = {
  todayTotal: number;
  active: number;
  successToday: number;
  failedToday: number;
};

type ImportPreview = {
  coverFileName: string;
  candidateTitle: string;
  confidence: number;
  matched?: { name: string };
};

type ImportRecord = {
  id: string;
  coverFileName: string;
  candidateTitle: string;
  oldResourceName?: string;
  oldResourceLink?: string;
  confidence: number;
  status: string;
  message?: string;
  updatedAt: string;
};

type ImportStats = {
  imports: Record<string, number>;
  wallpapers: {
    total: number;
    published: number;
    rejected: number;
    pendingReview: number;
    unclassified: number;
  };
};

type ChannelAccount = {
  id: string;
  label: string;
  tokenTail: string;
  guildId: string;
  channelId: string;
  guildName?: string;
  channelName?: string;
  isDefault: boolean;
  autoPublish: boolean;
};

type StorageAccount = {
  id: string;
  provider: "quark" | "baidu";
  label: string;
  accountName?: string;
  isDefault: boolean;
  isActive: boolean;
  lastProbeOk?: boolean;
  lastProbeMessage?: string;
  lastProbeAt?: string;
  createdAt: string;
};

type TencentGuildOption = {
  id: string;
  name: string;
  role: string;
};

type TencentChannelOption = {
  id: string;
  name: string;
  type?: string;
};

type SystemSettings = {
  defaultAutoProcess: boolean;
  defaultAutoPublish: boolean;
  rewardDownloadType: string;
  processIdleEnabled?: boolean;
  processIdleWindows?: Array<{ start: string; end: string }>;
};

type StorageSelectionForm = {
  quarkAccountId?: string;
  baiduAccountId?: string;
};

type DiagnosticItem = {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail";
  message: string;
  command?: string;
};

type ReadinessReport = {
  ok: boolean;
  diagnostics: Record<"ok" | "warn" | "fail", number>;
  actions: Array<DiagnosticItem & { nextStep: string }>;
  report: string;
};

type AdminOverview = {
  wallpapers: {
    total: number;
    byStatus: Record<string, number>;
    draft: number;
    processing: number;
    pendingReview: number;
    published: number;
    rejected: number;
    archived: number;
    byType: Array<{ type: string; count: number }>;
  };
  ai: {
    unreviewed: number;
    safe: number;
    blocked: number;
  };
  storage: {
    activeQuark: number;
    activeBaidu: number;
    missingQuark: number;
    missingBaidu: number;
    missingActiveLinks: number;
    missingShortLinks: number;
    unpublishedActiveShortLinks: number;
  };
  channelAccounts: {
    total: number;
    defaultConfigured: boolean;
  };
  storageAccounts: {
    total: number;
    defaultBaidu: boolean;
    defaultQuark: boolean;
  };
  tags: {
    total: number;
  };
  tasks: TaskSummary;
};

type LibraryPreset = {
  status?: string;
  type?: string;
  aiReview?: string;
  storageFilter?: string;
  nonce?: number;
};

function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("wm_token");
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  }).then(async (response) => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.code !== 200) throw new Error(body.message || body.error || "请求失败");
    return body.data as T;
  });
}

function App() {
  const [authed, setAuthed] = useState(Boolean(localStorage.getItem("wm_token")));
  const [active, setActive] = useState("overview");
  const [libraryPreset, setLibraryPreset] = useState<LibraryPreset | null>(null);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const openLibrary = (preset?: LibraryPreset) => {
    setLibraryPreset(preset ? { ...preset, nonce: Date.now() } : null);
    setActive("library");
  };

  return (
    <ConfigProvider locale={zhCN} theme={{ token: { borderRadius: 8, colorPrimary: "#C05621", colorLink: "#C05621", colorInfo: "#C05621" } }}>
      <Layout className="app-shell">
        <Layout.Sider width={240} className="sider">
          <div className="brand">
            <div className="brand-mark"><GalleryVerticalEnd size={22} /></div>
            <div>
              <strong>Wallpaper Ops</strong>
              <span>wdbzk 内容中台</span>
            </div>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[active]}
            onClick={(event) => {
              if (event.key === "library") setLibraryPreset(null);
              setActive(event.key);
            }}
            items={[
              { key: "overview", icon: <Home size={18} />, label: "概览" },
              { key: "library", icon: <GalleryVerticalEnd size={18} />, label: "资源库" },
              { key: "upload", icon: <UploadCloud size={18} />, label: "批量上传" },
              { key: "tasks", icon: <ListChecks size={18} />, label: "任务队列" },
              { key: "searchLogs", icon: <Search size={18} />, label: "搜索日志" },
              { key: "import", icon: <CloudUpload size={18} />, label: "老封面迁移" },
              { key: "storageAccounts", icon: <HardDrive size={18} />, label: "网盘账号" },
              { key: "channels", icon: <RadioTower size={18} />, label: "腾讯频道" },
              { key: "settings", icon: <SettingsIcon size={18} />, label: "系统设置" },
              { key: "diagnostics", icon: <Activity size={18} />, label: "上线诊断" },
            ]}
          />
        </Layout.Sider>
        <Layout.Content className="content">
          {active === "overview" && <Dashboard onNavigate={setActive} onOpenLibrary={openLibrary} />}
          {active === "library" && <Library preset={libraryPreset} />}
          {active === "upload" && <Uploader />}
          {active === "tasks" && <Tasks />}
          {active === "searchLogs" && <SearchLogs />}
          {active === "import" && <OldImport />}
          {active === "storageAccounts" && <StorageAccounts />}
          {active === "channels" && <Channels />}
          {active === "settings" && <Settings />}
          {active === "diagnostics" && <Diagnostics onNavigate={setActive} onOpenLibrary={openLibrary} />}
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(false);
  return (
    <div className="login-page">
      <section className="login-panel">
        <div className="login-art">
          <span>WDBZK</span>
          <h1>壁纸内容运营台</h1>
          <p>上传、识别、审核、同步与频道发布，从这里收束。</p>
        </div>
        <Form layout="vertical" onFinish={async (values) => {
          setLoading(true);
          try {
            const data = await request<{ token: string }>("/api/admin/auth/login", {
              method: "POST",
              body: JSON.stringify(values),
            });
            localStorage.setItem("wm_token", data.token);
            onLogin();
          } catch (error) {
            message.error((error as Error).message);
          } finally {
            setLoading(false);
          }
        }}>
          <Form.Item label="账号" name="username" rules={[{ required: true }]}>
            <Input size="large" autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true }]}>
            <Input.Password size="large" autoComplete="current-password" />
          </Form.Item>
          <Button htmlType="submit" type="primary" size="large" loading={loading} block>登录</Button>
        </Form>
      </section>
    </div>
  );
}

function Dashboard({ onNavigate, onOpenLibrary }: { onNavigate: (key: string) => void; onOpenLibrary: (preset?: LibraryPreset) => void }) {
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

function LaunchChecklist({ overview, readiness, onNavigate, onOpenLibrary }: { overview: AdminOverview; readiness: ReadinessReport | null; onNavigate: (key: string) => void; onOpenLibrary: (preset?: LibraryPreset) => void }) {
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

function Library({ preset }: { preset?: LibraryPreset | null }) {
  const [data, setData] = useState<{ list: Wallpaper[]; total: number }>({ list: [], total: 0 });
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [aiReview, setAiReview] = useState("");
  const [storageFilter, setStorageFilter] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [editing, setEditing] = useState<Wallpaper | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [form] = Form.useForm();
  const [bulkForm] = Form.useForm<{ status?: string; tags?: string }>();
  const [processForm] = Form.useForm<StorageSelectionForm>();
  const [publishForm] = Form.useForm<{ accountId?: string }>();
  const [publishTargetIds, setPublishTargetIds] = useState<React.Key[]>([]);
  const [channelAccounts, setChannelAccounts] = useState<ChannelAccount[]>([]);
  const [storageAccounts, setStorageAccounts] = useState<StorageAccount[]>([]);
  const [processTargetIds, setProcessTargetIds] = useState<React.Key[]>([]);
  const [processModalOpen, setProcessModalOpen] = useState(false);
  const [processLoading, setProcessLoading] = useState(false);
  const [storageLoading, setStorageLoading] = useState(false);
  const [channelLoading, setChannelLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const load = async (nextPage = page, nextStatus = status, nextType = typeFilter, nextAiReview = aiReview, nextStorageFilter = storageFilter) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(pageSize),
        keyword,
        status: nextStatus,
        type: nextType,
        aiReview: nextAiReview,
        storage: nextStorageFilter,
      });
      setData(await request<{ list: Wallpaper[]; total: number }>(`/api/admin/wallpapers?${query.toString()}`));
      setPage(nextPage);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!preset) void load();
  }, []);

  useEffect(() => {
    if (!preset) return;
    const nextStatus = preset.status || "";
    const nextType = preset.type || "";
    const nextAiReview = preset.aiReview || "";
    const nextStorageFilter = preset.storageFilter || "";
    setStatus(nextStatus);
    setTypeFilter(nextType);
    setAiReview(nextAiReview);
    setStorageFilter(nextStorageFilter);
    setSelectedRowKeys([]);
    void load(1, nextStatus, nextType, nextAiReview, nextStorageFilter);
  }, [preset?.nonce]);

  const reloadFromFirstPage = () => {
    setSelectedRowKeys([]);
    void load(1);
  };

  const openProcess = async (ids: React.Key[]) => {
    if (!ids.length) {
      message.warning("先选择资源");
      return;
    }
    setProcessTargetIds(ids);
    processForm.resetFields();
    setProcessModalOpen(true);
    setStorageLoading(true);
    try {
      setStorageAccounts(await request<StorageAccount[]>("/api/admin/storage-accounts"));
    } finally {
      setStorageLoading(false);
    }
  };

  const openChannelPublish = async (ids: React.Key[]) => {
    if (!ids.length) {
      message.warning("先选择资源");
      return;
    }
    const issue = getChannelPublishIssue(ids, data.list);
    if (issue) {
      message.warning(issue);
      return;
    }
    setPublishTargetIds(ids);
    setChannelLoading(true);
    try {
      const accounts = await request<ChannelAccount[]>("/api/admin/channels");
      setChannelAccounts(accounts);
      const preferred = accounts.find((item) => item.isDefault) || accounts[0];
      publishForm.setFieldsValue({ accountId: preferred?.id });
    } finally {
      setChannelLoading(false);
    }
  };

  const clearFilters = () => {
    setStatus("");
    setTypeFilter("");
    setAiReview("");
    setStorageFilter("");
    setSelectedRowKeys([]);
    void load(1, "", "", "", "");
  };
  const activeFilters = [
    status ? { key: "status", label: "状态", value: statusText(status), clear: () => { setStatus(""); setSelectedRowKeys([]); void load(1, "", typeFilter, aiReview, storageFilter); } } : undefined,
    typeFilter ? { key: "type", label: "类型", value: typeText(typeFilter), clear: () => { setTypeFilter(""); setSelectedRowKeys([]); void load(1, status, "", aiReview, storageFilter); } } : undefined,
    aiReview ? { key: "aiReview", label: "AI审核", value: aiReviewText(aiReview), clear: () => { setAiReview(""); setSelectedRowKeys([]); void load(1, status, typeFilter, "", storageFilter); } } : undefined,
    storageFilter ? { key: "storage", label: "网盘", value: storageFilterText(storageFilter), clear: () => { setStorageFilter(""); setSelectedRowKeys([]); void load(1, status, typeFilter, aiReview, ""); } } : undefined,
  ].filter(Boolean) as Array<{ key: string; label: string; value: string; clear: () => void }>;
  const publishIdSet = new Set(publishTargetIds.map(String));
  const publishSelected = data.list.filter((row) => publishIdSet.has(row.id));
  const publishLiveCount = publishSelected.filter((row) => row.type === "live" || row.mimeType?.startsWith("video/")).length;
  const publishStaticCount = publishSelected.length - publishLiveCount;
  const publishIssue = getChannelPublishIssue(publishTargetIds, data.list);

  return (
    <section>
      <Header title="资源库" subtitle="审核、编辑、排序、上下架与查看网盘同步状态。" />
      <Space className="toolbar">
        <Input prefix={<Search size={16} />} placeholder="搜索标题" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={reloadFromFirstPage} />
        <Select
          allowClear
          placeholder="全部状态"
          value={status || undefined}
          onChange={(value) => {
            const nextStatus = value || "";
            setStatus(nextStatus);
            setSelectedRowKeys([]);
            void load(1, nextStatus);
          }}
          options={["draft", "processing", "pending_review", "published", "rejected", "archived"].map((value) => ({ value, label: statusText(value) }))}
          style={{ width: 170 }}
        />
        <Select
          allowClear
          placeholder="全部类型"
          value={typeFilter || undefined}
          onChange={(value) => {
            const nextType = value || "";
            setTypeFilter(nextType);
            setSelectedRowKeys([]);
            void load(1, status, nextType);
          }}
          options={["static", "live"].map((value) => ({ value, label: typeText(value) }))}
          style={{ width: 150 }}
        />
        <Select
          allowClear
          placeholder="AI审核"
          value={aiReview || undefined}
          onChange={(value) => {
            const nextAiReview = value || "";
            setAiReview(nextAiReview);
            setSelectedRowKeys([]);
            void load(1, status, typeFilter, nextAiReview, storageFilter);
          }}
          options={[
            { value: "unreviewed", label: "未识别" },
            { value: "safe", label: "通过" },
            { value: "blocked", label: "已拦截" },
          ]}
          style={{ width: 150 }}
        />
        <Select
          allowClear
          placeholder="网盘状态"
          value={storageFilter || undefined}
          onChange={(value) => {
            const nextStorageFilter = value || "";
            setStorageFilter(nextStorageFilter);
            setSelectedRowKeys([]);
            void load(1, status, typeFilter, aiReview, nextStorageFilter);
          }}
          options={[
            { value: "has_quark", label: "有夸克" },
            { value: "has_baidu", label: "有百度" },
            { value: "missing_quark", label: "缺夸克" },
            { value: "missing_baidu", label: "缺百度" },
            { value: "missing_active", label: "缺活跃链接" },
            { value: "missing_short", label: "缺短链" },
            { value: "unpublished_active_short", label: "下架活跃短链" },
          ]}
          style={{ width: 160 }}
        />
        <Button onClick={reloadFromFirstPage}>搜索</Button>
        <Button type="primary" onClick={() => openProcess(selectedRowKeys)}>批量处理</Button>
        <Button onClick={() => {
          if (!selectedRowKeys.length) {
            message.warning("先选择资源");
            return;
          }
          setBulkEditing(true);
        }}>批量编辑</Button>
        <Button onClick={async () => {
          message.loading({ content: "正在回填方向...", key: "backfillOrientation" });
          try {
            const result = await request<{ total: number; updated: number; skipped: number }>("/api/admin/wallpapers/backfill-orientation", { method: "POST" });
            message.success({ content: `回填完成：更新 ${result.updated}，跳过 ${result.skipped}`, key: "backfillOrientation" });
            await load();
          } catch (error) {
            message.error({ content: error instanceof Error ? error.message : "回填失败", key: "backfillOrientation" });
          }
        }}>回填方向</Button>
        <Button onClick={async () => {
          message.loading({ content: "正在清理本地原图...", key: "cleanupOriginals" });
          try {
            const result = await request<{ checked: number; removed: number }>("/api/admin/wallpapers/cleanup-originals", { method: "POST" });
            message.success({ content: `清理完成：检查 ${result.checked}，删除原图 ${result.removed}`, key: "cleanupOriginals" });
            await load();
          } catch (error) {
            message.error({ content: error instanceof Error ? error.message : "清理失败", key: "cleanupOriginals" });
          }
        }}>清理原图</Button>
        <Button onClick={() => bulkPatch(selectedRowKeys, { status: "published" }, load)}>批量上架</Button>
        <Button danger onClick={() => bulkPatch(selectedRowKeys, { status: "archived" }, load)}>批量下架</Button>
        {storageFilter === "unpublished_active_short" ? (
          <Button danger ghost onClick={() => deactivateUnpublishedLinks(selectedRowKeys, load)}>停用遗留短链</Button>
        ) : null}
        <Button type="primary" ghost onClick={() => openChannelPublish(selectedRowKeys)}>发到频道</Button>
      </Space>
      {activeFilters.length ? (
        <div className="active-filters">
          <span>当前筛选</span>
          <Space size={6} wrap>
            {activeFilters.map((item) => (
              <Tag
                key={item.key}
                closable
                onClose={(event) => {
                  event.preventDefault();
                  item.clear();
                }}
              >
                {item.label}：{item.value}
              </Tag>
            ))}
            <Button size="small" type="link" onClick={clearFilters}>清空筛选</Button>
          </Space>
        </div>
      ) : null}
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data.list}
        rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
        pagination={{ total: data.total, pageSize, current: page, showSizeChanger: false }}
        onChange={(pagination) => {
          const nextPage = Number(pagination.current || 1);
          setSelectedRowKeys([]);
          void load(nextPage);
        }}
        columns={[
        {
          title: "封面",
          width: 112,
          render: (_, row) => row.coverUrl ? <Image className="cover-thumb" src={row.coverUrl} preview={{ mask: "点击预览" }} /> : <div className="cover-empty" />,
        },
        { title: "标题", dataIndex: "title", render: (text, row) => <div><strong>{text}</strong><small>{row.originalName}</small></div> },
        { title: "类型", dataIndex: "type", render: (type) => <Tag>{typeText(type)}</Tag> },
        { title: "方向", dataIndex: "orientation", render: (orientation) => <Tag>{orientationText(orientation)}</Tag> },
        { title: "状态", dataIndex: "status", render: (status) => <StatusTag status={status} /> },
        { title: "AI审核", width: 170, render: (_, row) => <AiReviewCell wallpaper={row} /> },
        { title: "标签", render: (_, row) => row.tags?.map((item) => <Tag key={item.tag.name}>{item.tag.name}</Tag>) },
        {
          title: "网盘",
          render: (_, row) => (
            <Space direction="vertical" size={2}>
              <Space wrap>
                {row.storageLinks?.map((item) => (
                  <Tag key={item.id} color={!item.isActive ? "default" : item.provider === "quark" ? "green" : "blue"}>
                    {item.provider}{item.isPrimary ? " 主" : ""}{item.isActive ? "" : " 停"}
                  </Tag>
                ))}
              </Space>
              <Space wrap>
                {row.shortLinks?.map((item) => (
                  <Button key={item.id} size="small" type="link" onClick={() => copyText(item.url)}>复制{providerText(item.provider)}短链</Button>
                ))}
              </Space>
            </Space>
          ),
        },
        {
          title: "操作",
          fixed: "right",
          render: (_, row) => <Space>
            <Button size="small" onClick={() => {
              setEditing(row);
              form.setFieldsValue({
                title: row.title,
                type: row.type,
                status: row.status,
                sortOrder: row.sortOrder,
                tags: row.tags?.map((item) => item.tag.name) ?? [],
              });
            }}>编辑</Button>
            <Button size="small" onClick={() => analyze(row.id, load)}>AI识别</Button>
            <Button size="small" type="primary" onClick={() => openProcess([row.id])}>一键处理</Button>
            <Button size="small" onClick={() => openChannelPublish([row.id])}>发频道</Button>
            <Button size="small" onClick={() => patch(row.id, { status: "published" }, load)}>上架</Button>
            <Button size="small" danger onClick={() => patch(row.id, { status: "archived" }, load)}>下架</Button>
          </Space>,
        },
      ]} />
      <Modal
        title="编辑壁纸"
        width={760}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={async () => {
          if (!editing) return;
          const values = await form.validateFields();
          await patch(editing.id, {
            ...values,
            sortOrder: Number(values.sortOrder || 0),
            tags: splitTags(values.tags),
          }, load);
          setEditing(null);
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="标题" name="title" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item label="类型" name="type"><Select options={["static", "live"].map((value) => ({ value, label: typeText(value) }))} /></Form.Item>
          <Form.Item label="状态" name="status"><Select options={["draft", "processing", "pending_review", "published", "rejected", "archived"].map((value) => ({ value, label: statusText(value) }))} /></Form.Item>
          <Form.Item label="排序" name="sortOrder"><Input type="number" /></Form.Item>
          <Form.Item label="标签" name="tags">
            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="输入标签后回车，多个以逗号分隔" />
          </Form.Item>
        </Form>
        {editing && <StorageLinkEditor wallpaper={editing} reload={load} />}
      </Modal>
      <Modal
        title="批量编辑"
        open={bulkEditing}
        onCancel={() => {
          setBulkEditing(false);
          bulkForm.resetFields();
        }}
        onOk={async () => {
          const values = await bulkForm.validateFields();
          const data: { status?: string; tags?: string[] } = {};
          if (values.status) data.status = values.status;
          if (values.tags !== undefined) data.tags = splitTags(values.tags);
          if (!data.status && data.tags === undefined) {
            message.warning("请选择要修改的内容");
            return;
          }
          await bulkPatch(selectedRowKeys, data, load);
          setBulkEditing(false);
          bulkForm.resetFields();
        }}
      >
        <Form form={bulkForm} layout="vertical">
          <Form.Item label="已选择资源">
            <Tag color="gold">{selectedRowKeys.length} 个</Tag>
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select allowClear options={["draft", "processing", "pending_review", "published", "rejected", "archived"].map((value) => ({ value, label: statusText(value) }))} />
          </Form.Item>
          <Form.Item label="标签" name="tags">
            <Select mode="tags" tokenSeparators={[",", "，"]} placeholder="留空不修改；输入标签后回车，填写后会替换所选资源标签" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="批量处理"
        open={processModalOpen}
        confirmLoading={processLoading}
        onCancel={() => {
          setProcessModalOpen(false);
          setProcessTargetIds([]);
          processForm.resetFields();
        }}
        onOk={async () => {
          const values = await processForm.validateFields();
          setProcessLoading(true);
          try {
            await processBatch(processTargetIds, values, load);
            setProcessModalOpen(false);
            setProcessTargetIds([]);
            processForm.resetFields();
          } finally {
            setProcessLoading(false);
          }
        }}
      >
        <Alert
          className="modal-alert"
          type="info"
          showIcon
          message="可以为本次补处理临时指定网盘账号；留空时使用对应网盘的默认账号。"
        />
        <Form form={processForm} layout="vertical">
          <Form.Item label="已选择资源">
            <Tag color="gold">{processTargetIds.length} 个</Tag>
          </Form.Item>
          <Form.Item label="本次夸克同步账号" name="quarkAccountId">
            <Select
              allowClear
              loading={storageLoading}
              placeholder="使用默认夸克账号"
              options={storageAccounts
                .filter((account) => account.provider === "quark")
                .map((account) => ({
                  value: account.id,
                  label: `${account.label}${account.isDefault ? " · 默认" : ""}${account.accountName ? ` · ${account.accountName}` : ""}`,
                }))}
            />
          </Form.Item>
          <Form.Item label="本次百度同步账号" name="baiduAccountId">
            <Select
              allowClear
              loading={storageLoading}
              placeholder="使用默认百度账号"
              options={storageAccounts
                .filter((account) => account.provider === "baidu")
                .map((account) => ({
                  value: account.id,
                  label: `${account.label}${account.isDefault ? " · 默认" : ""}${account.accountName ? ` · ${account.accountName}` : ""}`,
                }))}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="发到腾讯频道"
        open={publishTargetIds.length > 0}
        confirmLoading={publishing}
        okButtonProps={{ disabled: !channelAccounts.length || Boolean(publishIssue) }}
        onCancel={() => {
          setPublishTargetIds([]);
          publishForm.resetFields();
        }}
        onOk={async () => {
          const values = await publishForm.validateFields();
          setPublishing(true);
          try {
            await request("/api/admin/channels/publish", {
              method: "POST",
              body: JSON.stringify({ ids: publishTargetIds, accountId: values.accountId }),
            });
            message.success("频道发布完成");
            setPublishTargetIds([]);
            publishForm.resetFields();
          } finally {
            setPublishing(false);
          }
        }}
      >
        <div className="publish-summary">
          <div>
            <span>选中资源</span>
            <strong>{publishTargetIds.length}</strong>
          </div>
          <div>
            <span>静态图片</span>
            <strong>{publishStaticCount}</strong>
          </div>
          <div>
            <span>动态壁纸</span>
            <strong>{publishLiveCount}</strong>
          </div>
          <div>
            <span>频道账号</span>
            <strong>{channelLoading ? "读取中" : channelAccounts.length ? `${channelAccounts.length} 个` : "未配置"}</strong>
          </div>
        </div>
        {publishIssue ? <Alert className="modal-alert" type="warning" showIcon message={publishIssue} /> : null}
        {!channelLoading && !channelAccounts.length ? <Alert className="modal-alert" type="warning" showIcon message="还没有配置频道账号，请先在频道配置中新增账号。" /> : null}
        <Form form={publishForm} layout="vertical">
          <Form.Item label="本次发布资源">
            <Tag color="gold">{publishTargetIds.length} 个</Tag>
            <span className="form-hint">动态壁纸一次只能发 1 个，静态壁纸一次最多 18 张。</span>
          </Form.Item>
          <Form.Item label="频道账号" name="accountId" rules={[{ required: true, message: "请选择频道账号" }]}>
            <Select
              loading={channelLoading}
              placeholder={channelAccounts.length ? "选择频道账号" : "还没有配置频道账号"}
              options={channelAccounts.map((account) => ({
                value: account.id,
                label: `${account.label}${account.isDefault ? " · 默认" : ""}${account.channelName ? ` · ${account.channelName}` : ""}`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

function AiReviewCell({ wallpaper }: { wallpaper: Wallpaper }) {
  const analysis = wallpaper.aiAnalysis;
  if (!analysis) {
    return (
      <Space direction="vertical" size={2}>
        <Tag>未识别</Tag>
        <small>需要 AI 审核后上架</small>
      </Space>
    );
  }
  const flags = Array.isArray(analysis.sensitiveFlags) ? analysis.sensitiveFlags : [];
  return (
    <Space direction="vertical" size={2}>
      <Space wrap size={2}>
        <Tag color={analysis.safe ? "green" : "red"}>{analysis.safe ? "通过" : "已拦截"}</Tag>
        {flags.map((flag) => <Tag key={flag} color="red">{sensitiveFlagText(flag)}</Tag>)}
      </Space>
      {analysis.summary ? <small className="ai-summary">{analysis.summary}</small> : null}
    </Space>
  );
}

function StorageLinkEditor({ wallpaper, reload }: { wallpaper: Wallpaper; reload: () => void }) {
  const [form] = Form.useForm();
  return (
    <div className="sub-panel">
      <strong>网盘链接</strong>
      <Space wrap className="link-actions">
        {wallpaper.storageLinks?.map((link) => (
          <Space key={link.id} className="link-chip" wrap>
            <Tag color={!link.isActive ? "default" : link.provider === "quark" ? "green" : "blue"}>
              {providerText(link.provider)}{link.isPrimary ? " 主链接" : ""}
            </Tag>
            <Button
              size="small"
              onClick={async () => {
                await request(`/api/admin/storage-links/${link.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ isActive: !link.isActive }),
                });
                message.success(link.isActive ? "链接已停用" : "链接已启用");
                reload();
              }}
            >
              {link.isActive ? "停用" : "启用"}
            </Button>
            {wallpaper.shortLinks
              ?.filter((shortLink) => shortLink.storageLinkId === link.id)
              .map((shortLink) => (
                <Button key={shortLink.id} size="small" type="link" onClick={() => copyText(shortLink.url)}>
                  复制短链
                </Button>
              ))}
          </Space>
        ))}
      </Space>
      <Form form={form} layout="vertical" className="storage-form" onFinish={async (values) => {
        await request(`/api/admin/wallpapers/${wallpaper.id}/storage-links`, {
          method: "POST",
          body: JSON.stringify(values),
        });
        form.resetFields();
        await reload();
        message.success("网盘链接已添加");
      }}>
        <Form.Item label="网盘" name="provider" rules={[{ required: true }]}><Select options={[
          { value: "quark", label: "夸克" },
          { value: "baidu", label: "百度" },
        ]} /></Form.Item>
        <Form.Item label="链接" name="url" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item label="提取码" name="passcode"><Input /></Form.Item>
        <Form.Item label="设为主链接" name="isPrimary" valuePropName="checked"><Switch /></Form.Item>
        <Button htmlType="submit">添加链接</Button>
      </Form>
    </div>
  );
}

function Uploader() {
  const [autoProcess, setAutoProcess] = useState(true);
  const [autoPublish, setAutoPublish] = useState(false);
  const [defaultChannelReady, setDefaultChannelReady] = useState(false);
  const [channelAccounts, setChannelAccounts] = useState<ChannelAccount[]>([]);
  const [channelAccountId, setChannelAccountId] = useState<string>();
  const [storageAccounts, setStorageAccounts] = useState<StorageAccount[]>([]);
  const [quarkAccountId, setQuarkAccountId] = useState<string>();
  const [baiduAccountId, setBaiduAccountId] = useState<string>();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [manualTags, setManualTags] = useState<string[]>([]);
  useEffect(() => {
    Promise.all([
      request<SystemSettings>("/api/admin/settings"),
      request<ChannelAccount[]>("/api/admin/channels"),
      request<StorageAccount[]>("/api/admin/storage-accounts"),
    ])
      .then(([settings, accounts, storage]) => {
        const hasDefaultChannel = accounts.some((account) => account.isDefault);
        const preferredChannel = accounts.find((account) => account.isDefault) || accounts[0];
        setDefaultChannelReady(hasDefaultChannel);
        setAutoProcess(settings.defaultAutoProcess);
        setAutoPublish(settings.defaultAutoPublish && Boolean(preferredChannel));
        setChannelAccounts(accounts);
        setChannelAccountId(preferredChannel?.id);
        setStorageAccounts(storage);
      })
      .catch(() => undefined);
  }, []);
  const autoPublishDisabled = !autoProcess || !channelAccounts.length;
  const quarkAccounts = storageAccounts.filter((account) => account.provider === "quark");
  const baiduAccounts = storageAccounts.filter((account) => account.provider === "baidu");
  const hasAnyStorageAccount = Boolean(quarkAccounts.length || baiduAccounts.length);
  const uploadDisabled = autoProcess && !hasAnyStorageAccount;
  const selectedStorageData = {
    autoProcess: String(autoProcess),
    autoPublish: String(autoPublish),
    tags: manualTags.join(","),
    ...(autoPublish && channelAccountId ? { channelAccountId } : {}),
    ...(quarkAccountId ? { quarkAccountId } : {}),
    ...(baiduAccountId ? { baiduAccountId } : {}),
  };
  const props: UploadProps = {
    name: "files",
    multiple: true,
    accept: "image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm",
    action: `${API}/api/admin/uploads`,
    headers: { Authorization: `Bearer ${localStorage.getItem("wm_token") || ""}` },
    data: selectedStorageData,
    disabled: uploadDisabled,
    fileList,
    listType: "picture",
    beforeUpload: () => false,
    onChange({ file, fileList: next }) {
      setFileList(next);
      if (file.status === "done") {
        const response = file.response as { code?: number; message?: string; error?: string } | undefined;
        if (response?.code && response.code !== 200) {
          message.error(`${file.name} 上传失败：${uploadErrorMessage(response)}`);
          return;
        }
        message.success(autoProcess ? `${file.name} 已上传并加入处理队列` : `${file.name} 已上传为草稿`);
      }
      if (file.status === "error") {
        message.error(`${file.name} 上传失败：${uploadErrorMessage(file.response || file.error)}`);
      }
      if (next.length && next.every((item) => item.status === "done" || item.status === "error")) {
        window.setTimeout(() => setFileList([]), 1200);
      }
    },
  };
  const uploadFile = async (file: UploadFile) => {
    const source = file.originFileObj;
    if (!source) return;
    setFileList((prev) => prev.map((item) => item.uid === file.uid ? { ...item, status: "uploading", percent: 0 } : item));
    const form = new FormData();
    form.append("files", source);
    for (const [key, value] of Object.entries(selectedStorageData)) {
      form.append(key, value);
    }
    try {
      const response = await fetch(`${API}/api/admin/uploads`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("wm_token") || ""}` },
        body: form,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.code !== 200) {
        throw new Error(uploadErrorMessage(body));
      }
      message.success(autoProcess ? `${file.name} 已上传并加入处理队列` : `${file.name} 已上传为草稿`);
      setFileList((prev) => prev.map((item) => item.uid === file.uid ? { ...item, status: "done", response: body } : item));
    } catch (error) {
      message.error(`${file.name} 上传失败：${error instanceof Error ? error.message : "请求失败"}`);
      setFileList((prev) => prev.map((item) => item.uid === file.uid ? { ...item, status: "error", error } : item));
    }
  };
  const startUpload = () => {
    const pending = fileList.filter((file) => file.originFileObj && file.status !== "done" && file.status !== "error" && file.status !== "uploading");
    pending.forEach(uploadFile);
  };
  return (
    <section>
      <Header title="批量上传" subtitle="拖拽上传静态图或动态壁纸，上传后可批量 AI 识别、同步网盘与发帖。" />
      <div className="upload-options">
        <span>上传后自动处理，本次上传可临时覆盖系统默认值</span>
        <Switch
          checked={autoProcess}
          onChange={(checked) => {
            setAutoProcess(checked);
            if (!checked) setAutoPublish(false);
          }}
        />
      </div>
      <div className="upload-options upload-tags-options">
        <span>手动标签（可选，AI 标签将追加在其后）</span>
        <Select
          mode="tags"
          placeholder="输入标签后回车，多个以逗号分隔"
          value={manualTags}
          onChange={setManualTags}
          tokenSeparators={[",", "，"]}
          maxTagCount={8}
          style={{ width: 320 }}
          allowClear
        />
      </div>
      <div className="upload-options">
        <span>处理成功后自动发腾讯频道</span>
        <Switch
          checked={autoPublish}
          onChange={setAutoPublish}
          disabled={autoPublishDisabled}
        />
        {!channelAccounts.length ? <Tag color="gold">未配置频道账号</Tag> : !defaultChannelReady ? <Tag color="gold">未设置默认频道账号</Tag> : null}
      </div>
      <div className="upload-options">
        <span>本次发帖频道账号</span>
        <Select
          allowClear
          placeholder={channelAccounts.length ? "使用默认频道账号" : "未配置频道账号"}
          value={channelAccountId}
          onChange={setChannelAccountId}
          disabled={!autoPublish || !channelAccounts.length}
          options={channelAccounts.map((account) => ({
            value: account.id,
            label: `${account.label}${account.isDefault ? " · 默认" : ""}${account.channelName ? ` · ${account.channelName}` : ""}`,
          }))}
        />
      </div>
      <div className="upload-storage-options">
        <div>
          <span>本次夸克同步账号</span>
          <Select
            allowClear
            placeholder={quarkAccounts.length ? "使用默认夸克账号" : "未配置夸克账号"}
            value={quarkAccountId}
            onChange={setQuarkAccountId}
            disabled={!autoProcess || !quarkAccounts.length}
            options={quarkAccounts.map((account) => ({
              value: account.id,
              label: `${account.label}${account.isDefault ? " · 默认" : ""}${account.accountName ? ` · ${account.accountName}` : ""}`,
            }))}
          />
        </div>
        <div>
          <span>本次百度同步账号</span>
          <Select
            allowClear
            placeholder={baiduAccounts.length ? "使用默认百度账号" : "未配置百度账号"}
            value={baiduAccountId}
            onChange={setBaiduAccountId}
            disabled={!autoProcess || !baiduAccounts.length}
            options={baiduAccounts.map((account) => ({
              value: account.id,
              label: `${account.label}${account.isDefault ? " · 默认" : ""}${account.accountName ? ` · ${account.accountName}` : ""}`,
            }))}
          />
        </div>
      </div>
      {!quarkAccounts.length || !baiduAccounts.length ? (
        <Alert
          className="page-alert"
          type={hasAnyStorageAccount ? "warning" : "error"}
          showIcon
          message={hasAnyStorageAccount ? "网盘默认账号未配置完整" : "未配置网盘账号"}
          description={hasAnyStorageAccount
            ? "上传处理会继续执行；缺少对应网盘账号时会在任务提醒里记录同步失败。请到“网盘账号”补齐授权和默认账号配置。"
            : "自动处理至少需要一个百度或夸克账号。请先到“网盘账号”新增并授权，或关闭自动处理后先上传为草稿。"}
        />
      ) : null}
      <Upload.Dragger {...props} className="upload-dragger">
        <UploadCloud size={42} />
        <h2>拖拽壁纸文件到这里</h2>
        <p>支持 JPG、PNG、WebP、GIF、AVIF、MP4、MOV、WebM；默认单文件上限 300MB。</p>
      </Upload.Dragger>
      <div className="upload-actions">
        <Button
          type="primary"
          icon={<UploadCloud size={16} />}
          disabled={!fileList.length || fileList.some((file) => file.status === "uploading")}
          onClick={startUpload}
        >
          开始上传{fileList.length ? `（${fileList.length}）` : ""}
        </Button>
      </div>
    </section>
  );
}

type SearchLogItem = {
  id: string;
  keyword: string;
  hasResult: boolean;
  resultCount: number;
  openid?: string | null;
  createdAt: string;
};

function SearchLogs() {
  const [data, setData] = useState<{ list: SearchLogItem[]; total: number }>({ list: [], total: 0 });
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const pageSize = 20;
  const load = async (nextPage = page, nextKeyword = keyword) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(nextPage), pageSize: String(pageSize) });
      if (nextKeyword.trim()) query.set("keyword", nextKeyword.trim());
      const next = await request<{ list: SearchLogItem[]; total: number }>(`/api/admin/search-logs?${query.toString()}`);
      setData(next);
      setPage(nextPage);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  return (
    <section>
      <Header title="搜索日志" subtitle="查看小程序用户搜索内容与是否有匹配结果。" />
      <Space className="toolbar">
        <Input.Search
          allowClear
          placeholder="按搜索词筛选"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={(value) => void load(1, value)}
          style={{ width: 260 }}
        />
        <Button onClick={() => void load()}>刷新</Button>
        <Tag color="gold">共 {data.total} 条</Tag>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data.list}
        pagination={{ total: data.total, pageSize, current: page, showSizeChanger: false }}
        onChange={(pagination) => {
          const nextPage = Number(pagination.current || 1);
          void load(nextPage);
        }}
        columns={[
          { title: "搜索内容", dataIndex: "keyword", render: (value: string) => <strong>{value}</strong> },
          { title: "是否有数据", dataIndex: "hasResult", render: (value: boolean) => (value ? <Tag color="success">有数据</Tag> : <Tag color="red">无数据</Tag>) },
          { title: "结果数", dataIndex: "resultCount" },
          { title: "用户", dataIndex: "openid", render: (value: string | null | undefined) => (value ? <span>{value}</span> : "-") },
          { title: "时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false }) },
        ]}
      />
    </section>
  );
}

function Settings() {
  const [form] = Form.useForm<SystemSettings>();
  const [loading, setLoading] = useState(false);
  const [defaultChannelReady, setDefaultChannelReady] = useState(false);
  useEffect(() => {
    Promise.all([
      request<SystemSettings>("/api/admin/settings"),
      request<ChannelAccount[]>("/api/admin/channels"),
    ]).then(([settings, accounts]) => {
      const hasDefaultChannel = accounts.some((account) => account.isDefault);
      setDefaultChannelReady(hasDefaultChannel);
      form.setFieldsValue({
        ...settings,
        defaultAutoPublish: settings.defaultAutoPublish && hasDefaultChannel,
      });
    });
  }, [form]);
  return (
    <section>
      <Header title="系统设置" subtitle="设置上传和发布流程的默认行为；上传时仍可针对当前批次临时调整。" />
      <Form
        form={form}
        layout="vertical"
        className="form-grid"
        onFinish={async (values) => {
          if (values.defaultAutoPublish && !defaultChannelReady) {
            message.warning("先配置默认腾讯频道账号，再开启默认自动发帖");
            return;
          }
          setLoading(true);
          try {
            await request("/api/admin/settings", { method: "PATCH", body: JSON.stringify(values) });
            message.success("系统设置已保存");
          } finally {
            setLoading(false);
          }
        }}
      >
        <Form.Item label="默认上传后自动处理" name="defaultAutoProcess" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item label="默认上传后自动发腾讯频道" name="defaultAutoPublish" valuePropName="checked">
          <Switch disabled={!defaultChannelReady} />
        </Form.Item>
        {!defaultChannelReady ? <span className="form-hint">未配置默认腾讯频道账号</span> : null}
        <Form.Item label="激励视频下载模式" name="rewardDownloadType">
          <Select options={[
            { value: "daily10", label: "当天 10 次" },
            { value: "unlimited", label: "无限次" },
          ]} />
        </Form.Item>
        <Form.Item label="仅在空闲时段自动处理上传" name="processIdleEnabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <div className="form-field">
          <div className="form-label">空闲时段（仅这些时段自动处理上传的壁纸）</div>
          <Form.List name="processIdleWindows">
            {(fields, { add, remove }) => (
              <div className="openid-list">
                {fields.map((field) => (
                  <div key={field.key} className="openid-row">
                    <Form.Item name={[field.name, "start"]} noStyle rules={[{ pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "HH:mm" }]}>
                      <Input placeholder="开始 00:00" style={{ width: 110 }} />
                    </Form.Item>
                    <span className="form-hint">至</span>
                    <Form.Item name={[field.name, "end"]} noStyle rules={[{ pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "HH:mm" }]}>
                      <Input placeholder="结束 09:00" style={{ width: 110 }} />
                    </Form.Item>
                    <Button size="small" danger type="text" onClick={() => remove(field.name)}>删除</Button>
                  </div>
                ))}
                <Button size="small" type="dashed" onClick={() => add({ start: "00:00", end: "09:00" })}>+ 添加时段</Button>
              </div>
            )}
          </Form.List>
          <div className="form-hint">非空闲时段上传的壁纸会排队，等到下一个空闲时段自动处理；格式 HH:mm，结束填 00:00 表示次日零点。</div>
        </div>
        <div className="form-field">
          <div className="form-label">小程序管理员 openid（白名单）</div>
          <Form.List name="miniAdminOpenids">
            {(fields, { add, remove }) => (
              <div className="openid-list">
                {fields.map((field) => (
                  <div key={field.key} className="openid-row">
                    <Form.Item {...field} noStyle>
                      <Input placeholder="用户 openid" />
                    </Form.Item>
                    <Button size="small" danger type="text" onClick={() => remove(field.name)}>删除</Button>
                  </div>
                ))}
                <Button size="small" type="dashed" onClick={() => add("")}>+ 添加</Button>
              </div>
            )}
          </Form.List>
          <div className="form-hint">这些用户在小程序「我的」页会出现上传壁纸入口、详情页可下架壁纸，无需配置服务器环境变量。</div>
        </div>
        <Button htmlType="submit" type="primary" loading={loading}>保存设置</Button>
      </Form>
    </section>
  );
}

function Diagnostics({ onNavigate, onOpenLibrary }: { onNavigate: (key: string) => void; onOpenLibrary: (preset?: LibraryPreset) => void }) {
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

function LaunchFinalSteps({ items, onNavigate }: { items: DiagnosticItem[]; onNavigate: (key: string) => void }) {
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

function MiniProgramReleaseGuide() {
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

function DiagnosticActions({ row, onNavigate, onOpenLibrary }: { row: DiagnosticItem; onNavigate: (key: string) => void; onOpenLibrary: (preset?: LibraryPreset) => void }) {
  const action = diagnosticAction(row, onNavigate, onOpenLibrary);
  if (!row.command && !action) return null;
  return (
    <Space size={8} wrap>
      {action ? <Button size="small" type={row.status === "fail" ? "primary" : "default"} onClick={action.onClick}>{action.label}</Button> : null}
      {row.command ? <Button size="small" icon={<Copy size={14} />} onClick={() => copyText(row.command || "", "命令已复制")}>复制命令</Button> : null}
    </Space>
  );
}

function diagnosticAction(row: DiagnosticItem, onNavigate: (key: string) => void, onOpenLibrary: (preset?: LibraryPreset) => void) {
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

function Tasks() {
  const [data, setData] = useState<{ list: TaskItem[]; total: number }>({ list: [], total: 0 });
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async (nextPage = page, nextStatus = status, nextType = type) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(nextPage),
        pageSize: String(pageSize),
        status: nextStatus,
        type: nextType,
      });
      const next = await request<{ list: TaskItem[]; total: number }>(`/api/admin/tasks?${query.toString()}`);
      setData(next);
      setPage(nextPage);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, page, status, type]);
  return (
    <section>
      <Header title="任务队列" subtitle="查看上传、AI、网盘同步、wdbzk 入库、频道发帖等任务状态。" />
      <Space className="toolbar">
        <Button onClick={() => void load()}>刷新</Button>
        <Tag color="gold">共 {data.total} 条</Tag>
        <Select
          allowClear
          placeholder="全部状态"
          value={status || undefined}
          onChange={(value) => {
            const nextStatus = value || "";
            setStatus(nextStatus);
            void load(1, nextStatus, type);
          }}
          options={["queued", "running", "success", "failed", "skipped"].map((value) => ({ value, label: statusText(value) }))}
          style={{ width: 150 }}
        />
        <Select
          allowClear
          placeholder="全部类型"
          value={type || undefined}
          onChange={(value) => {
            const nextType = value || "";
            setType(nextType);
            void load(1, status, nextType);
          }}
          options={["upload_asset", "ai_classify", "quark_sync", "baidu_sync", "wdbzk_sync", "channel_publish", "old_cover_import", "asset_fetch", "auto_publish"].map((value) => ({ value, label: taskTypeText(value) }))}
          style={{ width: 180 }}
        />
        <span>自动刷新</span>
        <Switch checked={autoRefresh} onChange={setAutoRefresh} />
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data.list}
        pagination={{ total: data.total, pageSize, current: page, showSizeChanger: false }}
        onChange={(pagination) => {
          const nextPage = Number(pagination.current || 1);
          void load(nextPage);
        }}
        columns={[
        { title: "类型", dataIndex: "type", render: (value) => taskTypeText(value) },
        { title: "状态", dataIndex: "status", render: (status) => <StatusTag status={status} /> },
        { title: "进度", dataIndex: "progress", render: (value, row) => <Progress percent={value} size="small" status={row.status === "failed" ? "exception" : row.status === "success" ? "success" : "active"} /> },
        { title: "消息", dataIndex: "message" },
        { title: "提醒", render: (_, row) => row.result?.warnings?.length ? row.result.warnings.map((item) => <Tag key={item} color="gold">{item}</Tag>) : "-" },
        { title: "错误", dataIndex: "error" },
      ]} />
    </section>
  );
}

function OldImport() {
  const [preview, setPreview] = useState<ImportPreview[]>([]);
  const [records, setRecords] = useState<{ list: ImportRecord[]; total: number }>({ list: [], total: 0 });
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [status, setStatus] = useState("needs_review");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [running, setRunning] = useState(false);
  const loadStats = () => request<ImportStats>("/api/admin/imports/old-covers/stats").then(setStats);
  const loadRecords = (nextPage = page) => request<{ list: ImportRecord[]; total: number }>(
    `/api/admin/imports/old-covers/records?page=${nextPage}&pageSize=50&status=${encodeURIComponent(status)}&keyword=${encodeURIComponent(keyword)}`,
  ).then(setRecords);
  useEffect(() => { void loadStats(); void loadRecords(); }, []);
  return (
    <section>
      <Header title="老封面迁移" subtitle="复制老站封面，用旧资源名匹配规则关联网盘链接，分类和标签重新 AI 识别。" />
      {stats && (
        <div className="stat-grid">
          <Statistic title="已匹配封面" value={stats.imports.matched || 0} />
          <Statistic title="待复核封面" value={stats.imports.needs_review || 0} />
          <Statistic title="已上架旧资源" value={stats.wallpapers.published} />
          <Statistic title="AI 拦截旧资源" value={stats.wallpapers.rejected} />
        </div>
      )}
      <Space className="toolbar">
        <Button onClick={async () => setPreview(await request<ImportPreview[]>("/api/admin/imports/old-covers/preview?limit=30"))}>预览前 30 条</Button>
        <Button type="primary" loading={running} onClick={async () => {
          setRunning(true);
          try {
            const result = await request<{ imported: number; pending: number }>("/api/admin/imports/old-covers/run?limit=100", { method: "POST" });
            Modal.success({ title: "迁移任务完成", content: `已导入 ${result.imported} 条，待确认 ${result.pending} 条。` });
            await loadStats();
            await loadRecords();
          } finally {
            setRunning(false);
          }
        }}>导入前 100 条</Button>
        <Button onClick={async () => {
          const result = await request<{ classified: number; rejected: number; failed: number }>("/api/admin/imports/old-covers/classify?limit=50", { method: "POST" });
          Modal.success({ title: "AI 重识别完成", content: `已分类 ${result.classified} 条，拦截 ${result.rejected} 条，失败 ${result.failed} 条。` });
          await loadStats();
          await loadRecords();
        }}>AI 重识别 50 条</Button>
        <Button onClick={async () => { await loadStats(); await loadRecords(); }}>刷新</Button>
      </Space>
      <Tabs items={[
        {
          key: "records",
          label: "迁移记录",
          children: <>
            <Space className="toolbar">
              <Select value={status} onChange={(value) => { setStatus(value); setPage(1); }} options={[
                { value: "", label: "全部状态" },
                { value: "needs_review", label: "待复核" },
                { value: "matched", label: "已匹配" },
                { value: "classify_failed", label: "识别失败" },
              ]} />
              <Input prefix={<Search size={16} />} placeholder="搜索封面或资源名" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => { setPage(1); void loadRecords(1); }} />
              <Button onClick={() => { setPage(1); void loadRecords(1); }}>筛选</Button>
            </Space>
            <Table
              rowKey="id"
              dataSource={records.list}
              pagination={{ total: records.total, pageSize: 50, current: page }}
              onChange={(pagination) => {
                const next = Number(pagination.current || 1);
                setPage(next);
                void loadRecords(next);
              }}
              columns={[
              { title: "状态", dataIndex: "status", width: 120, render: (value) => <StatusTag status={value} /> },
              { title: "封面文件", dataIndex: "coverFileName" },
              { title: "候选标题", dataIndex: "candidateTitle" },
              { title: "匹配资源", render: (_, row) => row.oldResourceName || "-" },
              { title: "置信度", dataIndex: "confidence", width: 100, render: (value) => Number(value).toFixed(2) },
              { title: "说明", dataIndex: "message" },
            ]} />
          </>,
        },
        {
          key: "preview",
          label: "规则预览",
          children: <Table rowKey="coverFileName" dataSource={preview} columns={[
            { title: "封面文件", dataIndex: "coverFileName" },
            { title: "候选标题", dataIndex: "candidateTitle" },
            { title: "匹配置信度", dataIndex: "confidence", render: (value) => Number(value).toFixed(2) },
            { title: "匹配资源", render: (_, row) => row.matched?.name || "-" },
          ]} />,
        },
      ]} />
    </section>
  );
}

type AutoPublishBoardRow = {
  id: string;
  guildId: string;
  guildName?: string;
  channelId: string;
  channelName?: string;
  source: string;
  sourceConfig?: Record<string, unknown> | null;
  enabled: boolean;
  intervalHours: number;
  lastRunAt?: string | null;
  lastMessage?: string | null;
};

function BoardManager({ accounts }: { accounts: ChannelAccount[] }) {
  const [boards, setBoards] = useState<AutoPublishBoardRow[]>([]);
  const [sources, setSources] = useState<Array<{ id: string; label: string; description: string; enabled: boolean }>>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [runningId, setRunningId] = useState<string>();
  const [form] = Form.useForm();
  const load = () => request<AutoPublishBoardRow[]>("/api/admin/auto-publish-boards").then(setBoards);
  useEffect(() => {
    void load();
    void request<Array<{ id: string; label: string; description: string; enabled: boolean }>>("/api/admin/auto-publish-sources").then(setSources);
  }, []);
  const guildOptions = Array.from(new Map(
    accounts.map((account): [string, string] => [account.guildId, account.guildName || account.guildId]),
  ).entries()).map(([value, label]) => ({ value, label }));
  const channelOptions = Array.from(new Map(
    accounts.map((account): [string, string] => [account.channelId, account.channelName || account.channelId]),
  ).entries()).map(([value, label]) => ({ value, label }));

  const runBoard = async (id: string) => {
    setRunningId(id);
    try {
      const data = await request<{ ok: boolean; message: string }>(`/api/admin/auto-publish-boards/${id}/run`, { method: "POST" });
      if (data.ok) message.success(data.message);
      else message.warning(data.message);
      await load();
    } finally {
      setRunningId(undefined);
    }
  };

  const guildLabel = (guildId: string, guildName?: string) =>
    guildName || accounts.find((account) => account.guildId === guildId)?.guildName || guildId;
  const channelLabel = (channelId: string, channelName?: string) =>
    channelName || accounts.find((account) => account.channelId === channelId)?.channelName || channelId;
  const openEdit = (row: AutoPublishBoardRow) => {
    setEditingId(row.id);
    setOpen(true);
    form.setFieldsValue({
      guildId: row.guildId,
      guildName: row.guildName,
      channelId: row.channelId,
      channelName: row.channelName,
      source: row.source,
      intervalHours: row.intervalHours,
      enabled: row.enabled,
      sourceConfig: row.sourceConfig ? JSON.stringify(row.sourceConfig) : "",
    });
  };

  return (
    <div className="board-manager">
      <Space className="toolbar">
        <Button type="primary" onClick={() => { setEditingId(undefined); form.resetFields(); setOpen(true); }}>新增自动发帖板块</Button>
        <Button onClick={load}>刷新</Button>
      </Space>
      <Alert
        className="page-alert"
        type="info"
        showIcon
        message="数据源可用性"
        description="每个数据源可独立开关；关闭后，使用该来源的板块会自动跳过发帖。"
      />
      <div className="source-list">
        {sources.map((source) => (
          <div key={source.id} className="source-row">
            <div>
              <strong>{source.label}</strong>
              <span className="form-hint">{source.description}</span>
            </div>
            <Switch checked={source.enabled} size="small" onChange={async (checked) => {
              await request(`/api/admin/auto-publish-sources/${source.id}`, { method: "PATCH", body: JSON.stringify({ enabled: checked }) });
              setSources((prev) => prev.map((item) => item.id === source.id ? { ...item, enabled: checked } : item));
              message.success(checked ? "数据源已启用" : "数据源已停用");
            }} />
          </div>
        ))}
      </div>
      <Table rowKey="id" dataSource={boards} pagination={false} columns={[
        { title: "频道 / 版块", render: (_, row) => `${guildLabel(row.guildId, row.guildName)} / ${channelLabel(row.channelId, row.channelName)}` },
        { title: "来源", dataIndex: "source" },
        { title: "周期(小时)", dataIndex: "intervalHours" },
        { title: "启用", dataIndex: "enabled", render: (value, row) => (
          <Switch checked={Boolean(value)} size="small" onChange={async (checked) => {
            await request(`/api/admin/auto-publish-boards/${row.id}`, { method: "PATCH", body: JSON.stringify({ enabled: checked }) });
            await load();
          }} />
        ) },
        { title: "上次运行", dataIndex: "lastRunAt", render: (value) => value ? new Date(value).toLocaleString("zh-CN") : "—" },
        { title: "最近结果", dataIndex: "lastMessage", render: (value) => value ? <span className="form-hint">{value}</span> : "—" },
        { title: "操作", render: (_, row) => (
          <Space>
            <Popconfirm title="立即执行这个板块？" okText="执行" cancelText="取消" onConfirm={() => runBoard(row.id)}>
              <Button size="small" type="primary" loading={runningId === row.id}>立即执行</Button>
            </Popconfirm>
            <Button size="small" onClick={() => openEdit(row)}>修改</Button>
            <Popconfirm title="删除这个自动发帖板块？" okText="删除" cancelText="取消" onConfirm={async () => {
              await request(`/api/admin/auto-publish-boards/${row.id}`, { method: "DELETE" });
              message.success("已删除");
              await load();
            }}>
              <Button size="small" danger>删除</Button>
            </Popconfirm>
          </Space>
        ) },
      ]} />
      <Modal title={editingId ? "编辑自动发帖板块" : "新增自动发帖板块"} open={open} onCancel={() => { setOpen(false); setEditingId(undefined); form.resetFields(); }} onOk={async () => {
        const values = await form.validateFields();
        const sourceConfig = typeof values.sourceConfig === "string" && values.sourceConfig.trim()
          ? JSON.parse(values.sourceConfig)
          : undefined;
        const payload = { ...values, sourceConfig };
        if (editingId) await request(`/api/admin/auto-publish-boards/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
        else await request("/api/admin/auto-publish-boards", { method: "POST", body: JSON.stringify(payload) });
        message.success("已保存");
        form.resetFields();
        setOpen(false);
        setEditingId(undefined);
        await load();
      }} okText="保存" cancelText="取消">
        <Form form={form} layout="vertical">
          <Form.Item label="频道" name="guildId" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" placeholder="选择频道" options={guildOptions}
              onChange={(guildId) => {
                const account = accounts.find((item) => item.guildId === guildId);
                form.setFieldsValue({ guildName: account?.guildName });
              }} />
          </Form.Item>
          <Form.Item label="版块" name="channelId" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" placeholder="选择版块" options={channelOptions}
              onChange={(channelId) => {
                const account = accounts.find((item) => item.channelId === channelId);
                form.setFieldsValue({ channelName: account?.channelName });
              }} />
          </Form.Item>
          <Form.Item label="数据来源" name="source" initialValue="wallpost" rules={[{ required: true }]}>
            <Select options={sources.map((source) => ({ value: source.id, label: `${source.label}${source.enabled ? "" : "（已停用）"}` }))} />
          </Form.Item>
          <Form.Item label="周期（小时）" name="intervalHours" initialValue={4} rules={[{ required: true }]}>
            <InputNumber min={1} max={72} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="启用" name="enabled" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
          <Form.Item label="来源配置（JSON，可选）" name="sourceConfig">
            <Input.TextArea rows={3} placeholder='例如 {"query":"wallpaper","categories":"111"}（WallPost 来源可留空）' />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function Channels() {
  const [items, setItems] = useState<ChannelAccount[]>([]);
  const [activeTab, setActiveTab] = useState("accounts");
  const [guildOptions, setGuildOptions] = useState<TencentGuildOption[]>([]);
  const [channelOptions, setChannelOptions] = useState<TencentChannelOption[]>([]);
  const [loadingGuilds, setLoadingGuilds] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [form] = Form.useForm();
  const load = () => request<ChannelAccount[]>("/api/admin/channels").then(setItems);
  useEffect(() => { void load(); }, []);
  const defaultAccount = items.find((item) => item.isDefault);
  const [renameTarget, setRenameTarget] = useState<{ id: string; label: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const openRename = (account: ChannelAccount) => {
    setRenameTarget({ id: account.id, label: account.label });
    setRenameValue(account.label);
  };
  const submitRename = async () => {
    if (!renameTarget) return;
    const label = renameValue.trim();
    if (!label) {
      message.warning("账号名称不能为空");
      return;
    }
    await request(`/api/admin/channels/${renameTarget.id}`, { method: "PATCH", body: JSON.stringify({ label }) });
    message.success("频道账号名称已更新");
    setRenameTarget(null);
    await load();
  };

  const discoverGuilds = async () => {
    const token = String(form.getFieldValue("token") || "").trim();
    if (!token) {
      message.warning("先填写 Token");
      return;
    }
    setLoadingGuilds(true);
    try {
      const guilds = await request<TencentGuildOption[]>("/api/admin/channels/discover-guilds", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setGuildOptions(guilds);
      setChannelOptions([]);
      message.success(`已获取 ${guilds.length} 个频道`);
      if (guilds.length === 1) {
        form.setFieldsValue({ guildId: guilds[0].id, guildName: guilds[0].name, channelId: "", channelName: "" });
        await discoverChannels(guilds[0].id);
      }
    } finally {
      setLoadingGuilds(false);
    }
  };

  const discoverChannels = async (selectedGuildId?: string) => {
    const token = String(form.getFieldValue("token") || "").trim();
    const guildId = String(selectedGuildId || form.getFieldValue("guildId") || "").trim();
    if (!token || !guildId) {
      message.warning("先填写 Token 和频道 ID");
      return;
    }
    setLoadingChannels(true);
    try {
      const channels = await request<TencentChannelOption[]>("/api/admin/channels/discover-channels", {
        method: "POST",
        body: JSON.stringify({ token, guildId }),
      });
      setChannelOptions(channels);
      message.success(`已获取 ${channels.length} 个版块`);
      if (channels.length === 1) {
        form.setFieldsValue({ channelId: channels[0].id, channelName: channels[0].name });
      }
    } finally {
      setLoadingChannels(false);
    }
  };

  return (
    <section>
      <Header title="腾讯频道" subtitle="支持多个 Token 账号，上传批次和资源库手动发帖都可以选择频道账号。" />
      <div className="channel-readiness">
        <div className={`channel-readiness-card${defaultAccount ? " is-ready" : ""}`}>
          <div>
            <strong>默认频道账号</strong>
            <span>{defaultAccount ? `${defaultAccount.guildName || "已选频道"} · ${defaultAccount.channelName || "已选版块"}` : "上传后自动发帖和资源库手动发帖都需要默认账号"}</span>
          </div>
          <div className="channel-readiness-meta">
            <Tag color={defaultAccount ? "green" : "gold"}>{defaultAccount ? `默认：${defaultAccount.label}` : "缺默认账号"}</Tag>
            <Tag color={items.length ? "green" : "default"}>{items.length ? `${items.length} 个账号` : "未新增"}</Tag>
            <Tag color="gold">静态最多 18 张 · 动态 1 个</Tag>
          </div>
          <Button size="small" type={defaultAccount ? "default" : "primary"} onClick={() => setActiveTab("new")}>新增频道账号</Button>
        </div>
      </div>
      <Alert
        className="page-alert"
        type="info"
        showIcon
        message="第一个频道账号会自动设为默认；保存前可先验证 Token 获取频道和版块，发帖内容不带网盘链接。"
      />
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: "accounts",
          label: "账号列表",
          children: <>
            {!items.length && (
              <Alert
                className="page-alert"
                type="warning"
                showIcon
                message="还没有腾讯频道账号"
                description="保存账号并设为默认后，批量上传和资源库发帖才可以选择目标频道。"
                action={<Button size="small" type="primary" onClick={() => setActiveTab("new")}>新增账号</Button>}
              />
            )}
            <Table rowKey="id" dataSource={items} columns={[
            { title: "名称", dataIndex: "label" },
            { title: "Token", dataIndex: "tokenTail", render: (tail) => `******${tail}` },
            { title: "频道", dataIndex: "guildName" },
            { title: "版块", dataIndex: "channelName" },
            { title: "默认", dataIndex: "isDefault", render: (value) => value ? <Tag color="gold">默认</Tag> : null },
            {
              title: "自动发帖",
              dataIndex: "autoPublish",
              render: (value, row) => (
                <Switch
                  checked={Boolean(value)}
                  size="small"
                  onChange={async (checked) => {
                    await request(`/api/admin/channels/${row.id}/auto-publish`, { method: "PATCH", body: JSON.stringify({ autoPublish: checked }) });
                    message.success(checked ? "已开启参与自动发帖" : "已关闭参与自动发帖");
                    await load();
                  }}
                />
              ),
            },
            {
              title: "操作",
              render: (_, row) => <Space>
                {row.isDefault ? null : <Button size="small" onClick={async () => {
                  await request(`/api/admin/channels/${row.id}/default`, { method: "POST" });
                  await load();
                }}>设为默认</Button>}
                <Button size="small" onClick={() => openRename(row)}>改名</Button>
                <Popconfirm title="删除这个频道账号？" okText="删除" cancelText="取消" onConfirm={async () => {
                  await request(`/api/admin/channels/${row.id}`, { method: "DELETE" });
                  message.success("频道账号已删除");
                  await load();
                }}>
                  <Button size="small" danger>删除</Button>
                </Popconfirm>
              </Space>,
            },
          ]} />
          </>,
        },
        {
          key: "new",
          label: "新增账号",
          children: <Form form={form} layout="vertical" className="form-grid" onFinish={async (values) => {
            await request("/api/admin/channels", { method: "POST", body: JSON.stringify(values) });
            form.resetFields();
            await load();
            setActiveTab("accounts");
            message.success("频道账号已保存");
          }}>
            <Form.Item label="账号名称" name="label" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item label="Token" name="token" rules={[{ required: true }]}><Input.Password /></Form.Item>
            <Space className="toolbar">
              <Button loading={loadingGuilds} onClick={discoverGuilds}>验证 Token 并获取频道</Button>
              <Button loading={loadingChannels} onClick={() => discoverChannels()}>获取版块</Button>
            </Space>
            {guildOptions.length > 0 && (
              <Form.Item label="选择频道">
                <Select
                  showSearch
                  placeholder="选择频道后会自动填写 ID"
                  optionFilterProp="label"
                  options={guildOptions.map((guild) => ({ label: `${guild.name} · ${guild.role}`, value: guild.id }))}
                  onChange={async (guildId) => {
                    const guild = guildOptions.find((item) => item.id === guildId);
                    form.setFieldsValue({ guildId, guildName: guild?.name, channelId: "", channelName: "" });
                    await discoverChannels(guildId);
                  }}
                />
              </Form.Item>
            )}
            <Form.Item label="频道 ID" name="guildId" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item label="频道名称" name="guildName"><Input /></Form.Item>
            {channelOptions.length > 0 && (
              <Form.Item label="选择版块">
                <Select
                  showSearch
                  placeholder="选择版块后会自动填写 ID"
                  optionFilterProp="label"
                  options={channelOptions.map((channel) => ({ label: channel.type ? `${channel.name} · ${channel.type}` : channel.name, value: channel.id }))}
                  onChange={(channelId) => {
                    const channel = channelOptions.find((item) => item.id === channelId);
                    form.setFieldsValue({ channelId, channelName: channel?.name });
                  }}
                />
              </Form.Item>
            )}
            <Form.Item label="版块 ID" name="channelId" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item label="版块名称" name="channelName"><Input /></Form.Item>
            <Form.Item label="设为默认" name="isDefault" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item
              label="参与自动发帖"
              name="autoPublish"
              valuePropName="checked"
              initialValue={true}
              extra="开启后，定时自动下载流程会从这个账号中轮换发帖"
            >
              <Switch />
            </Form.Item>
            <Button htmlType="submit" type="primary">保存账号</Button>
          </Form>,
        },
        {
          key: "boards",
          label: "自动发帖板块",
          children: <BoardManager accounts={items} />,
        },
      ]} />
      <Modal
        title="修改频道账号名称"
        open={Boolean(renameTarget)}
        onCancel={() => setRenameTarget(null)}
        onOk={submitRename}
        okText="保存"
        cancelText="取消"
      >
        <Form layout="vertical">
          <Form.Item label="账号名称" required>
            <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} placeholder="输入新的账号名称" />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

function StorageAccounts() {
  const [items, setItems] = useState<StorageAccount[]>([]);
  const [activeTab, setActiveTab] = useState("accounts");
  const [form] = Form.useForm();
  const [authCodeForm] = Form.useForm<{ code: string }>();
  const [authTarget, setAuthTarget] = useState<StorageAccount | null>(null);
  const [authUrl, setAuthUrl] = useState("");
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; label: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const load = () => request<StorageAccount[]>("/api/admin/storage-accounts").then(setItems);
  useEffect(() => { void load(); }, []);

  const startAuth = async (account: StorageAccount) => {
    setLoadingAuth(true);
    try {
      const result = await request<{ authUrl?: string; message?: string } | StorageAccount>(`/api/admin/storage-accounts/${account.id}/auth/start`, { method: "POST" });
      if ("authUrl" in result && result.authUrl) {
        setAuthTarget(account);
        setAuthUrl(result.authUrl);
        authCodeForm.resetFields();
      } else {
        message.success("账号已授权");
        await load();
      }
    } finally {
      setLoadingAuth(false);
    }
  };

  const finishAuth = async (values: { code: string }) => {
    if (!authTarget) return;
    await request(`/api/admin/storage-accounts/${authTarget.id}/auth/finish`, {
      method: "POST",
      body: JSON.stringify({ code: values.code }),
    });
    message.success("网盘账号授权完成");
    setAuthTarget(null);
    setAuthUrl("");
    await load();
  };

  const probe = async (account: StorageAccount) => {
    await request(`/api/admin/storage-accounts/${account.id}/probe`, { method: "POST" });
    message.success("探活完成");
    await load();
  };
  const openRename = (account: StorageAccount) => {
    setRenameTarget({ id: account.id, label: account.label });
    setRenameValue(account.label);
  };
  const submitRename = async () => {
    if (!renameTarget) return;
    const label = renameValue.trim();
    if (!label) {
      message.warning("账号名称不能为空");
      return;
    }
    await request(`/api/admin/storage-accounts/${renameTarget.id}`, { method: "PATCH", body: JSON.stringify({ label }) });
    message.success("账号名称已更新");
    setRenameTarget(null);
    await load();
  };
  const openCreateAccount = (provider: StorageAccount["provider"]) => {
    form.setFieldsValue({ provider, isDefault: false });
    setActiveTab("new");
  };
  const storageReadiness = ([
    { provider: "quark" as const, title: "夸克主源", description: "默认上传与分享源" },
    { provider: "baidu" as const, title: "百度备用源", description: "备用同步与短链入库" },
  ]).map((item) => {
    const accounts = items.filter((account) => account.provider === item.provider);
    const defaultAccount = accounts.find((account) => account.isDefault);
    const usable = accounts.some((account) => account.lastProbeOk);
    return { ...item, accounts, defaultAccount, usable };
  });

  return (
    <section>
      <Header title="网盘账号" subtitle="百度和夸克都在管理端页面完成授权，支持多账号并按网盘类型设置默认同步账号。" />
      <div className="storage-readiness">
        {storageReadiness.map((item) => (
          <div key={item.provider} className={`storage-readiness-card${item.defaultAccount && item.usable ? " is-ready" : ""}`}>
            <div>
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </div>
            <div className="storage-readiness-meta">
              <Tag color={item.defaultAccount ? "green" : "gold"}>{item.defaultAccount ? `默认：${item.defaultAccount.label}` : "缺默认账号"}</Tag>
              <Tag color={item.usable ? "green" : item.accounts.length ? "gold" : "default"}>{item.accounts.length ? `${item.accounts.length} 个账号` : "未新增"} · {item.usable ? "已探活" : "待授权"}</Tag>
            </div>
            <Button size="small" type={item.defaultAccount && item.usable ? "default" : "primary"} onClick={() => openCreateAccount(item.provider)}>
              新增{providerText(item.provider)}账号
            </Button>
          </div>
        ))}
      </div>
      <Alert
        className="page-alert"
        type="info"
        showIcon
        message="每种网盘的第一个账号会自动设为默认；每个账号使用独立授权态，多账号场景可以手动切换默认账号，上传批次也可以临时指定账号。"
      />
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: "accounts",
          label: "账号列表",
          children: <>
            {!items.length && (
              <Alert
                className="page-alert"
                type="warning"
                showIcon
                message="还没有网盘账号"
                description="新增百度或夸克账号后，在管理端页面完成授权并设为默认，上传处理才会使用对应账号同步网盘。"
                action={<Button size="small" type="primary" onClick={() => setActiveTab("new")}>新增账号</Button>}
              />
            )}
            <Table rowKey="id" dataSource={items} columns={[
              { title: "名称", dataIndex: "label" },
              { title: "类型", dataIndex: "provider", render: providerText },
              { title: "授权账号", dataIndex: "accountName", render: (value) => value || <span className="muted-text">未识别</span> },
              { title: "默认", dataIndex: "isDefault", render: (value) => value ? <Tag color="gold">默认</Tag> : null },
              {
                title: "状态",
                render: (_, row) => row.lastProbeOk === undefined
                  ? <Tag>未探活</Tag>
                  : row.lastProbeOk
                    ? <Tag color="gold">可用</Tag>
                    : <Tag color="red">不可用</Tag>,
              },
              { title: "最近探活", render: (_, row) => <small>{row.lastProbeMessage || "暂无"}</small> },
              {
                title: "操作",
                width: 360,
                render: (_, row) => <Space wrap>
                  {row.isDefault ? null : <Button size="small" onClick={async () => {
                    await request(`/api/admin/storage-accounts/${row.id}/default`, { method: "POST" });
                    await load();
                  }}>设为默认</Button>}
                  <Button size="small" loading={loadingAuth && authTarget?.id === row.id} onClick={() => startAuth(row)}>授权</Button>
                  <Button size="small" onClick={() => probe(row)}>探活</Button>
                  <Button size="small" onClick={() => openRename(row)}>改名</Button>
                  <Popconfirm title="删除这个网盘账号？" description="未使用账号会直接移除；已有资源链接的账号会被停用并清理授权文件，资源链接不会被删除。" okText="删除" cancelText="取消" onConfirm={async () => {
                    await request(`/api/admin/storage-accounts/${row.id}`, { method: "DELETE" });
                    message.success("网盘账号已删除");
                    await load();
                  }}>
                    <Button size="small" danger>删除</Button>
                  </Popconfirm>
                </Space>,
              },
            ]} />
          </>,
        },
        {
          key: "new",
          label: "新增账号",
          children: <Form form={form} layout="vertical" className="form-grid" initialValues={{ provider: "quark", isDefault: false }} onFinish={async (values) => {
            await request("/api/admin/storage-accounts", { method: "POST", body: JSON.stringify(values) });
            form.resetFields();
            await load();
            setActiveTab("accounts");
            message.success("网盘账号已创建，请继续授权");
          }}>
            <Form.Item label="网盘类型" name="provider" rules={[{ required: true }]}>
              <Select options={[
                { value: "quark", label: "夸克" },
                { value: "baidu", label: "百度" },
              ]} />
            </Form.Item>
            <Form.Item label="账号名称" name="label" rules={[{ required: true }]}><Input placeholder="例如：夸克主号、百度备用号" /></Form.Item>
            <Form.Item label="设为默认" name="isDefault" valuePropName="checked"><Switch /></Form.Item>
            <Button htmlType="submit" type="primary">保存账号</Button>
          </Form>,
        },
      ]} />
      <Modal
        title="修改账号名称"
        open={Boolean(renameTarget)}
        onCancel={() => setRenameTarget(null)}
        onOk={submitRename}
        okText="保存"
        cancelText="取消"
      >
        <Form layout="vertical">
          <Form.Item label="账号名称" required>
            <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} placeholder="输入新的账号名称" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={authTarget ? `${providerText(authTarget.provider)}账号授权` : "网盘账号授权"}
        open={Boolean(authTarget)}
        onCancel={() => {
          setAuthTarget(null);
          setAuthUrl("");
        }}
        footer={null}
      >
        <Alert
          className="modal-alert"
          type="info"
          showIcon
          message="打开授权链接后，把页面返回的授权码或完整回调 URL 粘贴到下面。"
        />
        <Space className="toolbar" wrap>
          <Button type="primary" onClick={() => window.open(authUrl, "_blank", "noopener,noreferrer")}>打开授权链接</Button>
          <Button icon={<Copy size={14} />} onClick={() => copyText(authUrl, "授权链接已复制")}>复制链接</Button>
        </Space>
        <code className="auth-url">{authUrl}</code>
        <Form form={authCodeForm} layout="vertical" onFinish={finishAuth}>
          <Form.Item label="授权码 / 回调 URL" name="code" rules={[{ required: true, message: "请粘贴授权码或回调 URL" }]}>
            <Input.TextArea rows={3} placeholder="粘贴授权后得到的 code、授权码或完整回调 URL" />
          </Form.Item>
          <Button htmlType="submit" type="primary">完成授权</Button>
        </Form>
      </Modal>
    </section>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
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

function StatusTag({ status }: { status: string }) {
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

function uploadErrorMessage(value: unknown) {
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

function DiagnosticStatusTag({ status }: { status: DiagnosticItem["status"] }) {
  const label = { ok: "正常", warn: "提醒", fail: "失败" }[status];
  const color = { ok: "green", warn: "gold", fail: "red" }[status];
  return <Tag color={color}>{label}</Tag>;
}

function DiagnosticMessage({ value, command }: { value: string; command?: string }) {
  if (!command) return <span>{value}</span>;
  return (
    <div className="diagnostic-message">
      <span>{value}</span>
      <code>{command}</code>
    </div>
  );
}

function IssueRow({ label, value, danger = false, onClick }: { label: string; value: number; danger?: boolean; onClick?: () => void }) {
  return (
    <div className={`issue-row${onClick ? " is-clickable" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <strong className={danger ? "is-danger" : ""}>{value}</strong>
    </div>
  );
}

async function analyze(id: string, reload: () => void) {
  await request(`/api/admin/wallpapers/${id}/analyze`, { method: "POST" });
  message.success("AI 识别完成");
  reload();
}

async function processBatch(ids: React.Key[], selection: StorageSelectionForm, reload: () => void) {
  if (!ids.length) {
    message.warning("先选择资源");
    return;
  }
  const result = await request<{ queued: number }>("/api/admin/wallpapers/bulk/process", {
    method: "POST",
    body: JSON.stringify({ ids, ...selection }),
  });
  message.success(`已加入 ${result.queued} 个处理任务`);
  reload();
}

async function patch(id: string, data: unknown, reload: () => void) {
  await request(`/api/admin/wallpapers/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  message.success("操作完成");
  reload();
}

async function bulkPatch(ids: React.Key[], data: unknown, reload: () => void) {
  if (!ids.length) {
    message.warning("先选择资源");
    return;
  }
  await request("/api/admin/wallpapers/bulk", { method: "POST", body: JSON.stringify({ ids, ...(data as object) }) });
  message.success("批量操作完成");
  reload();
}

async function deactivateUnpublishedLinks(ids: React.Key[], reload: () => void) {
  if (!ids.length) {
    message.warning("先选择资源");
    return;
  }
  Modal.confirm({
    title: "停用所选资源的遗留短链？",
    content: "只会停用非上架资源的活跃网盘链接，已上架资源不会受影响。",
    okText: "停用",
    okButtonProps: { danger: true },
    cancelText: "取消",
    onOk: async () => {
      const result = await request<{ affectedLinks: number; affectedWallpapers: number }>("/api/admin/wallpapers/bulk/deactivate-unpublished-links", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      message.success(`已停用 ${result.affectedLinks} 条链接，涉及 ${result.affectedWallpapers} 个资源`);
      reload();
    },
  });
}

function splitTags(value?: string | string[]) {
  const parts = Array.isArray(value) ? value : String(value || "").split(/[,\n，]/);
  return parts.map((item) => String(item).trim()).filter(Boolean);
}

function providerText(value: string) {
  return value === "quark" ? "夸克" : value === "baidu" ? "百度" : value;
}

function statusText(value: string) {
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

function typeText(value: string) {
  const map: Record<string, string> = {
    static: "静态壁纸",
    live: "动态壁纸",
    mobile: "手机壁纸",
    desktop: "桌面壁纸",
    other: "其他",
  };
  return map[value] || value;
}

function orientationText(value: string) {
  const map: Record<string, string> = {
    portrait: "手机壁纸",
    landscape: "电脑壁纸",
    square: "方图",
    unknown: "未知",
  };
  return map[value] || value || "未知";
}

function aiReviewText(value: string) {
  const map: Record<string, string> = {
    unreviewed: "未识别",
    safe: "通过",
    blocked: "已拦截",
  };
  return map[value] || value;
}

function storageFilterText(value: string) {
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

function taskTypeText(value: string) {
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

function sensitiveFlagText(value: string) {
  const map: Record<string, string> = {
    sexual: "色情",
    violence: "暴力",
    political: "政治",
    vulgar: "低俗",
  };
  return map[value] || value;
}

function getChannelPublishIssue(ids: React.Key[], rows: Wallpaper[]) {
  const idSet = new Set(ids.map(String));
  const selected = rows.filter((row) => idSet.has(row.id));
  const hasLive = selected.some((row) => row.type === "live" || row.mimeType?.startsWith("video/"));
  if (hasLive && ids.length > 1) return "动态壁纸一次只能发布 1 个，不能和静态图混发";
  if (!hasLive && ids.length > 18) return "静态壁纸一次最多发布 18 张图";
  return "";
}

async function copyText(value: string, successText = "短链已复制") {
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

createRoot(document.getElementById("root")!).render(<App />);
