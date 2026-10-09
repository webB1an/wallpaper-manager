import { useEffect, useState } from "react";
import { Alert, Button, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, message } from "antd";
import { Copy } from "lucide-react";
import { request } from "../api";
import { copyText, providerText } from "../format";
import { Header } from "../ui";
import type { StorageAccount } from "../types";

export function StorageAccounts() {
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
