import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, ConfigProvider, Form, Input, Layout, Menu, Modal, Progress, Select, Space, Table, Tag, Upload, message, Switch, Statistic, Tabs } from "antd";
import type { UploadProps } from "antd";
import { Activity, CloudUpload, GalleryVerticalEnd, ListChecks, RadioTower, Search, Settings as SettingsIcon, Tags, UploadCloud } from "lucide-react";
import zhCN from "antd/locale/zh_CN";
import "./styles.css";

const API = import.meta.env.VITE_API_BASE_URL || "";

type Wallpaper = {
  id: string;
  title: string;
  originalName: string;
  type: string;
  status: string;
  coverUrl?: string;
  sortOrder: number;
  tags: Array<{ tag: { name: string } }>;
  storageLinks: Array<{ id: string; provider: string; url: string; isActive: boolean; isPrimary: boolean }>;
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

type ImportPreview = {
  coverFileName: string;
  candidateTitle: string;
  confidence: number;
  matched?: { name: string };
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
  const [active, setActive] = useState("library");

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

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
            onClick={(event) => setActive(event.key)}
            items={[
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
          {active === "library" && <Library />}
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

function Library() {
  const [data, setData] = useState<{ list: Wallpaper[]; total: number }>({ list: [], total: 0 });
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [editing, setEditing] = useState<Wallpaper | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      setData(await request(`/api/admin/wallpapers?pageSize=50&keyword=${encodeURIComponent(keyword)}`));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  return (
    <section>
      <Header title="资源库" subtitle="审核、编辑、排序、上下架与查看网盘同步状态。" />
      <Space className="toolbar">
        <Input prefix={<Search size={16} />} placeholder="搜索标题" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={load} />
        <Button onClick={load}>搜索</Button>
        <Button type="primary" onClick={() => processBatch(selectedRowKeys, load)}>批量处理</Button>
        <Button onClick={() => bulkPatch(selectedRowKeys, { status: "published" }, load)}>批量上架</Button>
        <Button danger onClick={() => bulkPatch(selectedRowKeys, { status: "archived" }, load)}>批量下架</Button>
        <Button type="primary" ghost onClick={() => publishBatch(selectedRowKeys)}>发到频道</Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={data.list}
        rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
        pagination={{ total: data.total, pageSize: 50 }}
        columns={[
        {
          title: "封面",
          width: 112,
          render: (_, row) => row.coverUrl ? <img className="cover-thumb" src={row.coverUrl} /> : <div className="cover-empty" />,
        },
        { title: "标题", dataIndex: "title", render: (text, row) => <div><strong>{text}</strong><small>{row.originalName}</small></div> },
        { title: "类型", dataIndex: "type", render: (type) => <Tag>{type}</Tag> },
        { title: "状态", dataIndex: "status", render: (status) => <StatusTag status={status} /> },
        { title: "标签", render: (_, row) => row.tags?.map((item) => <Tag key={item.tag.name}>{item.tag.name}</Tag>) },
        {
          title: "网盘",
          render: (_, row) => row.storageLinks?.map((item) => (
            <Tag key={item.id} color={!item.isActive ? "default" : item.provider === "quark" ? "green" : "blue"}>
              {item.provider}{item.isPrimary ? " 主" : ""}{item.isActive ? "" : " 停"}
            </Tag>
          )),
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
          <Form.Item label="类型" name="type"><Select options={["static", "live", "mobile", "desktop", "other"].map((value) => ({ value, label: value }))} /></Form.Item>
          <Form.Item label="状态" name="status"><Select options={["draft", "processing", "pending_review", "published", "rejected", "archived"].map((value) => ({ value, label: value }))} /></Form.Item>
          <Form.Item label="排序" name="sortOrder"><Input type="number" /></Form.Item>
          <Form.Item label="标签" name="tags"><Input placeholder="多个标签用逗号分隔" /></Form.Item>
        </Form>
        {editing && <StorageLinkEditor wallpaper={editing} reload={load} />}
      </Modal>
    </section>
  );
}

function StorageLinkEditor({ wallpaper, reload }: { wallpaper: Wallpaper; reload: () => void }) {
  const [form] = Form.useForm();
  return (
    <div className="sub-panel">
      <strong>网盘链接</strong>
      <Space wrap>
        {wallpaper.storageLinks?.map((link) => (
          <Button
            key={link.id}
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
            {link.provider} {link.isActive ? "停用" : "启用"}
          </Button>
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
  useEffect(() => {
    request<SystemSettings>("/api/admin/settings")
      .then((settings) => {
        setAutoProcess(settings.defaultAutoProcess);
        setAutoPublish(settings.defaultAutoPublish);
      })
      .catch(() => undefined);
  }, []);
  const props: UploadProps = {
    name: "files",
    multiple: true,
    action: `${API}/api/admin/uploads`,
    headers: { Authorization: `Bearer ${localStorage.getItem("wm_token") || ""}` },
    data: { autoProcess: String(autoProcess), autoPublish: String(autoPublish) },
    onChange(info) {
      if (info.file.status === "done") message.success(autoProcess ? `${info.file.name} 已上传并加入处理队列` : `${info.file.name} 已上传为草稿`);
      if (info.file.status === "error") message.error(`${info.file.name} 上传失败`);
    },
  };
  return (
    <section>
      <Header title="批量上传" subtitle="拖拽上传静态图或动态壁纸，上传后可批量 AI 识别、同步网盘与发帖。" />
      <div className="upload-options">
        <span>上传后自动处理，本次上传可临时覆盖系统默认值</span>
        <Switch checked={autoProcess} onChange={setAutoProcess} />
      </div>
      <div className="upload-options">
        <span>处理成功后自动发腾讯频道</span>
        <Switch checked={autoPublish} onChange={setAutoPublish} disabled={!autoProcess} />
      </div>
      <Upload.Dragger {...props} className="upload-dragger">
        <UploadCloud size={42} />
        <h2>拖拽壁纸文件到这里</h2>
        <p>支持批量图片和视频；自动处理会进入 AI 审核、网盘同步、wdbzk 入库队列。</p>
      </Upload.Dragger>
    </section>
  );
}

function Settings() {
  const [form] = Form.useForm<SystemSettings>();
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    request<SystemSettings>("/api/admin/settings").then((settings) => form.setFieldsValue(settings));
  }, [form]);
  return (
    <section>
      <Header title="系统设置" subtitle="设置上传和发布流程的默认行为；上传时仍可针对当前批次临时调整。" />
      <Form
        form={form}
        layout="vertical"
        className="form-grid"
        onFinish={async (values) => {
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
          <Switch />
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
        { title: "说明", dataIndex: "message" },
      ]} />
    </section>
  );
}

function Tasks() {
  const [items, setItems] = useState<TaskItem[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const load = () => request<TaskItem[]>("/api/admin/tasks").then(setItems);
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);
  return (
    <section>
      <Header title="任务队列" subtitle="查看上传、AI、网盘同步、wdbzk 入库、频道发帖等任务状态。" />
      <Space className="toolbar">
        <Button onClick={load}>刷新</Button>
        <span>自动刷新</span>
        <Switch checked={autoRefresh} onChange={setAutoRefresh} />
      </Space>
      <Table rowKey="id" dataSource={items} columns={[
        { title: "类型", dataIndex: "type" },
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
  const [running, setRunning] = useState(false);
  return (
    <section>
      <Header title="老封面迁移" subtitle="复制老站封面，用旧资源名匹配规则关联网盘链接，分类和标签重新 AI 识别。" />
      <Space className="toolbar">
        <Button onClick={async () => setPreview(await request<ImportPreview[]>("/api/admin/imports/old-covers/preview?limit=30"))}>预览前 30 条</Button>
        <Button type="primary" loading={running} onClick={async () => {
          setRunning(true);
          try {
            const result = await request<{ imported: number; pending: number }>("/api/admin/imports/old-covers/run?limit=100", { method: "POST" });
            Modal.success({ title: "迁移任务完成", content: `已导入 ${result.imported} 条，待确认 ${result.pending} 条。` });
          } finally {
            setRunning(false);
          }
        }}>导入前 100 条</Button>
        <Button onClick={async () => {
          const result = await request<{ classified: number; rejected: number; failed: number }>("/api/admin/imports/old-covers/classify?limit=50", { method: "POST" });
          Modal.success({ title: "AI 重识别完成", content: `已分类 ${result.classified} 条，拦截 ${result.rejected} 条，失败 ${result.failed} 条。` });
        }}>AI 重识别 50 条</Button>
      </Space>
      <Table rowKey="coverFileName" dataSource={preview} columns={[
        { title: "封面文件", dataIndex: "coverFileName" },
        { title: "候选标题", dataIndex: "candidateTitle" },
        { title: "匹配置信度", dataIndex: "confidence", render: (value) => Number(value).toFixed(2) },
        { title: "匹配资源", render: (_, row) => row.matched?.name || "-" },
      ]} />
    </section>
  );
}

function Channels() {
  const [items, setItems] = useState<ChannelAccount[]>([]);
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
      <Tabs items={[
        {
          key: "accounts",
          label: "账号列表",
          children: <Table rowKey="id" dataSource={items} columns={[
            { title: "名称", dataIndex: "label" },
            { title: "Token", dataIndex: "tokenTail", render: (tail) => `******${tail}` },
            { title: "频道", dataIndex: "guildName" },
            { title: "版块", dataIndex: "channelName" },
            { title: "默认", dataIndex: "isDefault", render: (value) => value ? <Tag color="green">默认</Tag> : null },
            {
              title: "操作",
              render: (_, row) => row.isDefault ? null : <Button size="small" onClick={async () => {
                await request(`/api/admin/channels/${row.id}/default`, { method: "POST" });
                await load();
              }}>设为默认</Button>,
            },
          ]} />,
        },
        {
          key: "new",
          label: "新增账号",
          children: <Form form={form} layout="vertical" className="form-grid" onFinish={async (values) => {
            await request("/api/admin/channels", { method: "POST", body: JSON.stringify(values) });
            form.resetFields();
            await load();
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
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow"><Tags size={14} /> Wallpaper Manager</span>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <Space>
        <Statistic title="今日队列" value="--" />
      </Space>
    </header>
  );
}

function StatusTag({ status }: { status: string }) {
  const colors: Record<string, string> = { published: "green", rejected: "red", failed: "red", processing: "gold", pending_review: "blue", success: "green" };
  return <Tag color={colors[status] || "default"}>{status}</Tag>;
}

function DiagnosticStatusTag({ status }: { status: DiagnosticItem["status"] }) {
  const label = { ok: "正常", warn: "提醒", fail: "失败" }[status];
  const color = { ok: "green", warn: "gold", fail: "red" }[status];
  return <Tag color={color}>{label}</Tag>;
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

async function publishBatch(ids: React.Key[]) {
  if (!ids.length) {
    message.warning("先选择资源");
    return;
  }
  await request("/api/admin/channels/publish", { method: "POST", body: JSON.stringify({ ids }) });
  message.success("频道发布完成");
}

function splitTags(value?: string) {
  return String(value || "")
    .split(/[,\n，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

createRoot(document.getElementById("root")!).render(<App />);
