import { useEffect, useState } from "react";
import { Button, Input, Space, Table, Tag } from "antd";
import { request } from "../api";
import { Header } from "../ui";
import type { SearchLogItem } from "../types";

export function SearchLogs() {
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
