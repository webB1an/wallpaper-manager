import { useEffect, useState } from "react";
import { Alert, Button, Input, Select, Space, Table, Tag } from "antd";
import { request } from "../api";
import { Header } from "../ui";
import type { PaymentOrderRow } from "../types";

export function PaymentOrders() {
  const [data, setData] = useState<{ list: PaymentOrderRow[]; total: number }>({ list: [], total: 0 });
  const [keyword, setKeyword] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), keyword: search, status });
    request<{ list: PaymentOrderRow[]; total: number }>(`/api/admin/payment-orders?${query}`)
      .then((result) => { if (active) setData(result); })
      .catch(() => { if (active) { setData({ list: [], total: 0 }); setError("付费记录加载失败，请点击刷新重试"); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, search, status, refresh]);
  const statuses: Record<string, { label: string; color: string }> = {
    paid: { label: "已支付 · 待发放", color: "gold" },
    delivered: { label: "已支付 · 已发放", color: "green" },
    refunded: { label: "已退款", color: "default" },
  };
  const time = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
  const submitSearch = () => { setSearch(keyword.trim()); setPage(1); setRefresh((value) => value + 1); };
  return <section>
    <Header title="付费记录" subtitle="查看小程序用户已付款及已退款订单；不包含未支付订单。金额为原订单金额，不代表净收入。" />
    <Space className="toolbar" wrap>
      <Input placeholder="搜索订单号 / 用户 OpenID" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={submitSearch} allowClear style={{ width: 320 }} />
      <Select placeholder="全部付费状态" value={status || undefined} allowClear style={{ width: 200 }} options={Object.entries(statuses).map(([value, item]) => ({ value, label: item.label }))} onChange={(value) => { setStatus(value || ""); setPage(1); }} />
      <Button type="primary" onClick={submitSearch}>搜索</Button>
      <Button onClick={() => setRefresh((value) => value + 1)}>刷新</Button>
      <Tag>共 {data.total} 条</Tag>
    </Space>
    {error && <Alert type="error" showIcon message={error} />}
    <Table<PaymentOrderRow> rowKey="outTradeNo" loading={loading} dataSource={data.list} scroll={{ x: 1500 }}
      locale={{ emptyText: error ? "加载失败" : "暂无符合条件的付费记录" }}
      pagination={{ current: page, pageSize: 20, total: data.total, showSizeChanger: false, onChange: setPage }}
      columns={[
        { title: "订单号", dataIndex: "outTradeNo", width: 260 },
        { title: "用户 OpenID", dataIndex: "openid", width: 280 },
        { title: "商品", dataIndex: "productName", width: 180 },
        { title: "数量", dataIndex: "buyQuantity", width: 70 },
        { title: "订单金额", dataIndex: "totalFee", width: 100, render: (value: number) => `¥${(value / 100).toFixed(2)}` },
        { title: "状态", dataIndex: "status", width: 170, render: (value: string) => <Tag color={statuses[value]?.color}>{statuses[value]?.label || value}</Tag> },
        { title: "支付时间", dataIndex: "paidAt", width: 185, render: time },
        { title: "权益发放时间", dataIndex: "deliveredAt", width: 185, render: time },
        { title: "下单时间", dataIndex: "createdAt", width: 185, render: time },
      ]} />
  </section>;
}
