import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, Space, Statistic, Table, Tabs } from "antd";
import { Search } from "lucide-react";
import { request } from "../api";
import { Header, StatusTag } from "../ui";
import type { ImportPreview, ImportRecord, ImportStats } from "../types";

export function OldImport() {
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
