import { useEffect, useState } from "react";
import { Button, Popconfirm, Progress, Select, Space, Switch, Table, Tag, message } from "antd";
import { request } from "../api";
import { statusText, taskTime, taskTypeText } from "../format";
import { Header, StatusTag } from "../ui";
import type { TaskItem } from "../types";

export function Tasks() {
  const [resuming, setResuming] = useState<string>();
  const resumeTask = async (id: string, confirmMissingUploads = false) => {
    setResuming(id);
    try {
      const result = await request<{ ok: boolean; message: string }>(`/api/admin/tasks/${id}/resume`, { method: "POST", body: JSON.stringify({ confirmMissingUploads }) });
      if (result.ok) message.success(result.message); else message.warning(result.message);
      await load();
    } catch (error) { message.error(error instanceof Error ? error.message : "恢复失败"); }
    finally { setResuming(undefined); }
  };
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
      <Header title="任务队列" subtitle="查看上传、AI、网盘同步、wdbzk 入库、频道发帖等任务状态。时间均为北京时间；最后更新不代表首次失败时间。" />
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
        scroll={{ x: 1500 }}
        pagination={{ total: data.total, pageSize, current: page, showSizeChanger: false }}
        onChange={(pagination) => {
          const nextPage = Number(pagination.current || 1);
          void load(nextPage);
        }}
        columns={[
        { title: "类型", dataIndex: "type", width: 110, render: (value) => taskTypeText(value) },
        { title: "状态", dataIndex: "status", width: 90, render: (status) => <StatusTag status={status} /> },
        { title: "创建时间", dataIndex: "createdAt", width: 180, render: (value?: string) => <span style={{ whiteSpace: "nowrap" }}>{taskTime(value)}</span> },
        { title: "最后更新", dataIndex: "updatedAt", width: 180, render: (value?: string) => <span style={{ whiteSpace: "nowrap" }}>{taskTime(value)}</span> },
        { title: "进度", dataIndex: "progress", render: (value, row) => <Progress percent={value} size="small" status={row.status === "failed" ? "exception" : row.status === "success" ? "success" : "active"} /> },
        { title: "消息", dataIndex: "message" },
        { title: "提醒", render: (_, row) => row.result?.warnings?.length ? row.result.warnings.map((item) => <Tag key={item} color="gold">{item}</Tag>) : "-" },
        { title: "错误", dataIndex: "error" },
        { title: "操作", render: (_, row) => row.status === "failed" && (row.result?.resumable || row.result?.legacyConfirmation) ? (
          <Space direction="vertical">
            {row.result.resumable && <Popconfirm title={row.result.bridgeExpired ? "重新获取壁纸？" : "从已保存阶段继续？"} description={row.result.bridgeExpired ? "原桥接文件已失效，将从同一数据源重新选择并下载素材，可能更换壁纸，随后按原任务配置继续处理。" : "已完成阶段不会重跑；外部结果不明确的任务不支持此操作。"} onConfirm={() => resumeTask(row.id)}>
              <Button size="small" loading={resuming === row.id} disabled={Boolean(resuming)}>{row.result.bridgeExpired ? "重新获取壁纸" : "从失败阶段继续"}</Button>
            </Popconfirm>}
            {(row.result.legacyConfirmation || row.result.needsUploadConfirmation) && <Popconfirm title="确认失败的网盘中没有上传成功的文件？" description="使用服务器原文件重新上传，跳过已完成的步骤，随后按原任务配置处理和发帖。若文件已上传，请使用继续处理或先人工核对。" onConfirm={() => resumeTask(row.id, true)}>
              <Button size="small" loading={resuming === row.id} disabled={Boolean(resuming)}>确认未上传，重新上传</Button>
            </Popconfirm>}
          </Space>
        ) : row.result?.expired ? "恢复文件已过期" : "-" },
      ]} />
    </section>
  );
}
