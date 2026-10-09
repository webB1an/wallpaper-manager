import type React from "react";
import { useEffect, useState } from "react";
import { Alert, Button, Form, Image, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, message } from "antd";
import { Search } from "lucide-react";
import { request } from "../api";
import { aiReviewText, copyText, getChannelPublishIssue, orientationText, providerText, splitTags, statusText, storageFilterText, typeText } from "../format";
import { Header, StatusTag } from "../ui";
import { AiReviewCell, StorageLinkEditor } from "./Uploader";
import type { ChannelAccount, LibraryPreset, StorageAccount, StorageSelectionForm, Wallpaper } from "../types";

export function Library({ preset }: { preset?: LibraryPreset | null }) {
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
  const [publishForm] = Form.useForm<{ accountId?: string; manualReviewConfirmed?: boolean }>();
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
        <Button onClick={() => confirmManualListing(() => bulkPatch(selectedRowKeys, { status: "published", manualReviewConfirmed: true }, load))}>批量上架</Button>
        <Button danger onClick={() => bulkPatch(selectedRowKeys, { status: "archived" }, load)}>批量下架</Button>
        <Button disabled={!selectedRowKeys.length} onClick={() => bulkStorageLinks(selectedRowKeys, true, load)}>批量启用网盘链接</Button>
        <Button danger disabled={!selectedRowKeys.length} onClick={() => bulkStorageLinks(selectedRowKeys, false, load)}>批量停用网盘链接</Button>
        <Button danger disabled={!selectedRowKeys.length} onClick={() => {
          const ids = [...selectedRowKeys];
          Modal.confirm({
            title: `永久删除选中的 ${ids.length} 张壁纸？`,
            content: "将删除资源记录、缩略图和服务器图片文件，关联文章不再显示这些图片。网盘文件保留，此操作不可恢复。",
            okText: "确认批量删除", cancelText: "取消", okButtonProps: { danger: true },
            onOk: async () => {
              try {
                const result = await request<{ deleted: string[]; failed: Array<{ id: string; message: string }> }>("/api/admin/wallpapers/bulk/delete", { method: "POST", body: JSON.stringify({ ids }) });
                setSelectedRowKeys(result.failed.map((item) => item.id));
                await load();
                if (result.failed.length) Modal.warning({ title: `已删除 ${result.deleted.length} 张，${result.failed.length} 张未删除`, content: <div>{result.failed.map((item) => <p key={item.id}>{item.id}：{item.message}</p>)}</div> });
                else message.success(`已删除 ${result.deleted.length} 张壁纸及对应图片文件`);
              } catch (error) { message.error(error instanceof Error ? error.message : "批量删除失败，请刷新核对后重试"); throw error; }
            },
          });
        }}>批量删除</Button>
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
            <Button size="small" onClick={() => confirmManualListing(() => patch(row.id, { status: "published", manualReviewConfirmed: true }, load))}>上架</Button>
            <Button size="small" danger onClick={() => patch(row.id, { status: "archived" }, load)}>下架</Button>
            <Popconfirm title="永久删除这张壁纸？" description="删除资源记录、缩略图和服务器图片文件，关联文章将不再显示此图。网盘文件保留。不可恢复。" okText="确认删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={async () => {
              try {
                await request(`/api/admin/wallpapers/${row.id}`, { method: "DELETE" });
                setSelectedRowKeys((keys) => keys.filter((key) => key !== row.id));
                message.success("壁纸和对应图片文件已删除"); await load();
              } catch (error) { message.error(error instanceof Error ? error.message : "删除失败，请重试"); }
            }}><Button size="small" danger>删除</Button></Popconfirm>
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
          if (values.status === "published") {
            confirmManualListing(async () => {
              await patch(editing.id, { ...values, sortOrder: Number(values.sortOrder || 0), tags: splitTags(values.tags), manualReviewConfirmed: true }, load);
              setEditing(null);
            });
            return;
          }
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
          if (data.status === "published") {
            const ids = [...selectedRowKeys];
            confirmManualListing(async () => {
              await bulkPatch(ids, { ...data, manualReviewConfirmed: true }, load);
              setBulkEditing(false);
              bulkForm.resetFields();
            });
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
              body: JSON.stringify({ ids: publishTargetIds, accountId: values.accountId, manualReviewConfirmed: values.manualReviewConfirmed === true }),
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
          <Alert type="warning" showIcon message="AI 未通过或未审核的资源，须人工检查内容后开启下方确认。仅覆盖本次审核限制，不会修改 AI 结果；网盘短链及媒体检查仍生效。" />
          <Form.Item label="我已人工审核全部所选资源，确认允许发帖" name="manualReviewConfirmed" valuePropName="checked">
            <Switch />
          </Form.Item>
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

function bulkStorageLinks(selectedIds: React.Key[], isActive: boolean, reload: () => void) {
  const ids = [...selectedIds];
  if (!ids.length) return;
  Modal.confirm({
    title: `确认${isActive ? "启用" : "停用"} ${ids.length} 个资源的全部网盘链接？`,
    content: isActive
      ? "仅启用所选资源已有的网盘链接，不会上架资源或修改 AI 审核结果；短链仍需资源已上架才能访问。不会恢复网盘端已删除或失效的分享。"
      : "所选资源的全部网盘链接将停用，对应短链将无法访问。不会删除网盘文件，可再次批量启用。",
    okText: isActive ? "确认启用" : "确认停用", cancelText: "取消",
    okButtonProps: { danger: !isActive },
    onOk: async () => {
      const result = await request<{ count: number }>("/api/admin/wallpapers/bulk/storage-links", {
        method: "POST", body: JSON.stringify({ ids, isActive }),
      });
      message.success(`已${isActive ? "启用" : "停用"} ${result.count} 条网盘链接`);
      reload();
    },
  });
}

function confirmManualListing(onConfirm: () => Promise<void>) {
  Modal.confirm({
    title: "人工复核后上架",
    content: "请确认已人工检查全部所选壁纸，内容符合发布要求。确认后本次上架可覆盖 AI 未通过或未审核的限制；不会修改 AI 原始结果，仍需具备可用网盘短链。",
    okText: "已人工审核，确认上架",
    cancelText: "取消",
    onOk: onConfirm,
  });
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
