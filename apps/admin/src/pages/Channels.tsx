import { useEffect, useState } from "react";
import { Alert, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, message } from "antd";
import { request } from "../api";
import { Header } from "../ui";
import type { AutoPublishBoardRow, ChannelAccount, TencentChannelOption, TencentGuildOption } from "../types";

export function BoardManager({ accounts }: { accounts: ChannelAccount[] }) {
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
  const sourceLabel = (sourceId: string) => sources.find((source) => source.id === sourceId)?.label || sourceId;
  const openEdit = (row: AutoPublishBoardRow) => {
    const visibleSourceConfig = row.sourceConfig
      ? Object.fromEntries(Object.entries(row.sourceConfig).filter(([key]) => key !== "sources" && key !== "lastSource"))
      : undefined;
    setEditingId(row.id);
    setOpen(true);
    form.setFieldsValue({
      guildId: row.guildId,
      guildName: row.guildName,
      channelId: row.channelId,
      channelName: row.channelName,
      sources: row.sources?.length ? row.sources : [row.source],
      intervalHours: row.intervalHours,
      enabled: row.enabled,
      sourceConfig: visibleSourceConfig && Object.keys(visibleSourceConfig).length ? JSON.stringify(visibleSourceConfig) : "",
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
        description="每个板块可选择多个数据源，系统每次只从其中一个来源取图并轮换使用；已停用的来源会自动跳过。"
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
        { title: "来源", render: (_, row) => (row.sources?.length ? row.sources : [row.source]).map(sourceLabel).join("、") },
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
          <Form.Item label="数据来源（可多选）" name="sources" initialValue={["wallpost"]} rules={[{ required: true, message: "请至少选择一个数据来源" }]}>
            <Select mode="multiple" placeholder="选择一个或多个数据来源" options={sources.map((source) => ({ value: source.id, label: `${source.label}${source.enabled ? "" : "（已停用）"}` }))} />
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

export function Channels() {
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
