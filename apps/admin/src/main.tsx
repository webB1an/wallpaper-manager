import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Alert, Button, ConfigProvider, Form, Input, Layout, Menu, Modal, Popconfirm, Progress, Select, Space, Table, Tag, Upload, message, Switch, Statistic, Tabs } from "antd";
import type { UploadProps } from "antd";
import { Activity, CloudUpload, Copy, GalleryVerticalEnd, Home, ListChecks, RadioTower, RefreshCw, Search, Settings as SettingsIcon, Tags, UploadCloud } from "lucide-react";
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
  guildName?: string;
  channelName?: string;
  isDefault: boolean;
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
};

type DiagnosticItem = {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail";
  message: string;
  command?: string;
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
    <ConfigProvider locale={zhCN} theme={{ token: { borderRadius: 8, colorPrimary: "#1f7a5a" } }}>
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
              { key: "import", icon: <CloudUpload size={18} />, label: "老封面迁移" },
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
          {active === "import" && <OldImport />}
          {active === "channels" && <Channels />}
          {active === "settings" && <Settings />}
          {active === "diagnostics" && <Diagnostics />}
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
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setOverview(await request<AdminOverview>("/api/admin/overview"));
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
      + (overview.channelAccounts.defaultConfigured ? 0 : 1)
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
      {overview && !overview.channelAccounts.defaultConfigured && (
        <Alert
          className="page-alert"
          type="warning"
          showIcon
          message="腾讯频道默认账号未配置"
          description="上传后自动发帖和资源库手动发帖会停在账号选择前。"
          action={<Button size="small" type="primary" onClick={() => onNavigate("channels")}>去配置</Button>}
        />
      )}
      <div className="stat-grid">
        <Statistic title="资源总数" value={overview?.wallpapers.total ?? "--"} />
        <Statistic title="已上架" value={overview?.wallpapers.published ?? "--"} />
        <Statistic title="待审核" value={overview?.wallpapers.pendingReview ?? "--"} />
        <Statistic title="待处理项" value={overview ? issueCount : "--"} valueStyle={{ color: issueCount ? "#b45309" : "#1f7a5a" }} />
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
  const [publishForm] = Form.useForm<{ accountId?: string }>();
  const [publishTargetIds, setPublishTargetIds] = useState<React.Key[]>([]);
  const [channelAccounts, setChannelAccounts] = useState<ChannelAccount[]>([]);
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
          options={["static", "live", "mobile", "desktop", "other"].map((value) => ({ value, label: typeText(value) }))}
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
        <Button type="primary" onClick={() => processBatch(selectedRowKeys, load)}>批量处理</Button>
        <Button onClick={() => {
          if (!selectedRowKeys.length) {
            message.warning("先选择资源");
            return;
          }
          setBulkEditing(true);
        }}>批量编辑</Button>
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
          render: (_, row) => row.coverUrl ? <img className="cover-thumb" src={row.coverUrl} /> : <div className="cover-empty" />,
        },
        { title: "标题", dataIndex: "title", render: (text, row) => <div><strong>{text}</strong><small>{row.originalName}</small></div> },
        { title: "类型", dataIndex: "type", render: (type) => <Tag>{typeText(type)}</Tag> },
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
                tags: row.tags?.map((item) => item.tag.name).join(","),
              });
            }}>编辑</Button>
            <Button size="small" onClick={() => analyze(row.id, load)}>AI识别</Button>
            <Button size="small" type="primary" onClick={() => processWallpaper(row.id, load)}>一键处理</Button>
            <Button size="small" onClick={() => openChannelPublish([row.id])}>发频道</Button>
            <Button size="small" onClick={() => patch(row.id, { status: "published" }, load)}>上架</Button>
            <Button size="small" danger onClick={() => patch(row.id, { status: "archived" }, load)}>下架</Button>
          </Space>,
        },
      ]} />
      <Modal
        title="编辑壁纸"
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
          <Form.Item label="类型" name="type"><Select options={["static", "live", "mobile", "desktop", "other"].map((value) => ({ value, label: typeText(value) }))} /></Form.Item>
          <Form.Item label="状态" name="status"><Select options={["draft", "processing", "pending_review", "published", "rejected", "archived"].map((value) => ({ value, label: statusText(value) }))} /></Form.Item>
          <Form.Item label="排序" name="sortOrder"><Input type="number" /></Form.Item>
          <Form.Item label="标签" name="tags"><Input placeholder="多个标签用逗号分隔" /></Form.Item>
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
            <Tag color="blue">{selectedRowKeys.length} 个</Tag>
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select allowClear options={["draft", "processing", "pending_review", "published", "rejected", "archived"].map((value) => ({ value, label: statusText(value) }))} />
          </Form.Item>
          <Form.Item label="标签" name="tags">
            <Input placeholder="留空不修改；多个标签用逗号分隔，填写后会替换所选资源标签" />
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
            <Tag color="blue">{publishTargetIds.length} 个</Tag>
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
  useEffect(() => {
    Promise.all([
      request<SystemSettings>("/api/admin/settings"),
      request<ChannelAccount[]>("/api/admin/channels"),
    ])
      .then(([settings, accounts]) => {
        const hasDefaultChannel = accounts.some((account) => account.isDefault);
        setDefaultChannelReady(hasDefaultChannel);
        setAutoProcess(settings.defaultAutoProcess);
        setAutoPublish(settings.defaultAutoPublish && hasDefaultChannel);
      })
      .catch(() => undefined);
  }, []);
  const autoPublishDisabled = !autoProcess || !defaultChannelReady;
  const props: UploadProps = {
    name: "files",
    multiple: true,
    accept: "image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm",
    action: `${API}/api/admin/uploads`,
    headers: { Authorization: `Bearer ${localStorage.getItem("wm_token") || ""}` },
    data: { autoProcess: String(autoProcess), autoPublish: String(autoPublish) },
    onChange(info) {
      if (info.file.status === "done") {
        const response = info.file.response as { code?: number; message?: string; error?: string } | undefined;
        if (response?.code && response.code !== 200) {
          message.error(`${info.file.name} 上传失败：${uploadErrorMessage(response)}`);
          return;
        }
        message.success(autoProcess ? `${info.file.name} 已上传并加入处理队列` : `${info.file.name} 已上传为草稿`);
      }
      if (info.file.status === "error") message.error(`${info.file.name} 上传失败：${uploadErrorMessage(info.file.response || info.file.error)}`);
    },
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
      <div className="upload-options">
        <span>处理成功后自动发腾讯频道</span>
        <Switch
          checked={autoPublish}
          onChange={setAutoPublish}
          disabled={autoPublishDisabled}
        />
        {!defaultChannelReady ? <Tag color="gold">未配置默认频道账号</Tag> : null}
      </div>
      <Upload.Dragger {...props} className="upload-dragger">
        <UploadCloud size={42} />
        <h2>拖拽壁纸文件到这里</h2>
        <p>支持 JPG、PNG、WebP、GIF、AVIF、MP4、MOV、WebM；默认单文件上限 300MB。</p>
      </Upload.Dragger>
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
          {!defaultChannelReady ? <span className="form-hint">未配置默认腾讯频道账号</span> : null}
        </Form.Item>
        <Button htmlType="submit" type="primary" loading={loading}>保存设置</Button>
      </Form>
    </section>
  );
}

function Diagnostics() {
  const [items, setItems] = useState<DiagnosticItem[]>([]);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      setItems(await request<DiagnosticItem[]>("/api/admin/diagnostics"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  const okCount = items.filter((item) => item.status === "ok").length;
  const failCount = items.filter((item) => item.status === "fail").length;
  return (
    <section>
      <Header title="上线诊断" subtitle="检查数据库、Redis、网盘工具、AI、panapi 和频道发布依赖是否已经就绪。" />
      <Space className="toolbar">
        <Button type="primary" onClick={load} loading={loading}>重新检查</Button>
        <Tag color="green">正常 {okCount}</Tag>
        <Tag color={failCount ? "red" : "default"}>失败 {failCount}</Tag>
      </Space>
      <Table rowKey="key" loading={loading} dataSource={items} pagination={false} columns={[
        { title: "项目", dataIndex: "label", width: 220 },
        { title: "状态", dataIndex: "status", width: 120, render: (status) => <DiagnosticStatusTag status={status} /> },
        { title: "说明", render: (_, row) => <DiagnosticMessage value={row.message} command={row.command} /> },
        { title: "操作", width: 150, render: (_, row) => {
          return row.command ? (
            <Button size="small" icon={<Copy size={14} />} onClick={() => copyText(row.command || "", "命令已复制")}>复制命令</Button>
          ) : null;
        } },
      ]} />
    </section>
  );
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
        <Tag color="blue">共 {data.total} 条</Tag>
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
          options={["upload_asset", "ai_classify", "quark_sync", "baidu_sync", "wdbzk_sync", "channel_publish", "old_cover_import"].map((value) => ({ value, label: taskTypeText(value) }))}
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
      <Header title="腾讯频道" subtitle="支持多个 Token 账号，保存后上传批次可以选择默认账号自动发帖。" />
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
            { title: "默认", dataIndex: "isDefault", render: (value) => value ? <Tag color="green">默认</Tag> : null },
            {
              title: "操作",
              render: (_, row) => <Space>
                {row.isDefault ? null : <Button size="small" onClick={async () => {
                  await request(`/api/admin/channels/${row.id}/default`, { method: "POST" });
                  await load();
                }}>设为默认</Button>}
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
            <Button htmlType="submit" type="primary">保存账号</Button>
          </Form>,
        },
      ]} />
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

async function processWallpaper(id: string, reload: () => void) {
  await request(`/api/admin/wallpapers/${id}/process`, { method: "POST" });
  message.success("已加入处理队列");
  reload();
}

async function processBatch(ids: React.Key[], reload: () => void) {
  if (!ids.length) {
    message.warning("先选择资源");
    return;
  }
  const result = await request<{ queued: number }>("/api/admin/wallpapers/bulk/process", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  message.success(`已加入 ${result.queued} 个处理任务`);
  reload();
}

async function patch(id: string, data: unknown, reload: () => void) {
  await request(`/api/admin/wallpapers/${id}`, { method: "PATCH", body: JSON.stringify(data) });
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

function splitTags(value?: string) {
  return String(value || "")
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean);
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
