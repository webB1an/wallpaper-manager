import { useEffect, useState } from "react";
import { Button, Form, Image, Input, Modal, Select, Space, Table, Tag, message } from "antd";
import { RefreshCw } from "lucide-react";
import { request } from "../api";
import { requestStatusLabel } from "../format";
import { Header } from "../ui";
import type { MemberWallpaperRequest } from "../types";

export function MemberRequests() {
  const [items, setItems] = useState<MemberWallpaperRequest[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<MemberWallpaperRequest | null>(null);
  const [form] = Form.useForm();
  const load = async (nextStatus = status) => {
    setLoading(true);
    try {
      setItems(await request<MemberWallpaperRequest[]>(`/api/admin/wallpaper-requests${nextStatus ? `?status=${nextStatus}` : ""}`));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(""); }, []);
  const openEdit = (item: MemberWallpaperRequest) => {
    setEditing(item);
    form.setFieldsValue({ status: item.status, adminNote: item.adminNote || "", wallpaperId: item.wallpaperId || "" });
  };
  return (
    <section>
      <Header title="会员求图" subtitle="处理永久下载权益用户提交的免费求图需求；找到后关联已上架壁纸。" />
      <Space className="toolbar">
        <Select value={status} style={{ width: 150 }} onChange={(value) => { setStatus(value); void load(value); }} options={[
          { value: "", label: "全部状态" }, { value: "pending", label: "待处理" }, { value: "searching", label: "查找中" },
          { value: "fulfilled", label: "已收录" }, { value: "not_found", label: "暂未找到" }, { value: "closed", label: "已关闭" },
        ]} />
        <Button icon={<RefreshCw size={15} />} loading={loading} onClick={() => load()}>刷新</Button>
      </Space>
      <Table rowKey="id" loading={loading} dataSource={items} pagination={{ pageSize: 20 }} columns={[
        { title: "提交时间", dataIndex: "createdAt", width: 170, render: (value: string) => new Date(value).toLocaleString("zh-CN") },
        { title: "用户", dataIndex: "userId", width: 180, ellipsis: true },
        { title: "主题", dataIndex: "subject", width: 180 },
        { title: "需求", dataIndex: "description", ellipsis: true, render: (value: string) => value || "（见参考图）" },
        { title: "参考图", width: 150, render: (_: unknown, item: MemberWallpaperRequest) => item.referenceImages?.length ? <Image.PreviewGroup>{item.referenceImages.map((url) => <Image key={url} src={url} width={42} height={42} style={{ objectFit: "cover", marginRight: 6, borderRadius: 4 }} />)}</Image.PreviewGroup> : "-" },
        { title: "规格", width: 130, render: (_: unknown, item: MemberWallpaperRequest) => `${item.wallpaperType} / ${item.orientation}` },
        { title: "状态", dataIndex: "status", width: 110, render: (value: string) => <Tag>{requestStatusLabel(value)}</Tag> },
        { title: "关联壁纸", width: 160, render: (_: unknown, item: MemberWallpaperRequest) => item.wallpaper?.title || "-" },
        { title: "操作", width: 90, render: (_: unknown, item: MemberWallpaperRequest) => <Button size="small" onClick={() => openEdit(item)}>处理</Button> },
      ]} />
      <Modal title="处理求图需求" open={Boolean(editing)} onCancel={() => setEditing(null)} onOk={() => form.submit()} destroyOnHidden>
        {editing?.referenceImages?.length ? <div style={{ marginBottom: 16 }}><div style={{ marginBottom: 8 }}>用户参考图</div><Image.PreviewGroup>{editing.referenceImages.map((url) => <Image key={url} src={url} width={88} height={88} style={{ objectFit: "cover", marginRight: 8, borderRadius: 6 }} />)}</Image.PreviewGroup></div> : null}
        <Form form={form} layout="vertical" onFinish={async (values) => {
          if (!editing) return;
          await request(`/api/admin/wallpaper-requests/${editing.id}`, { method: "PATCH", body: JSON.stringify(values) });
          message.success("求图状态已更新");
          setEditing(null);
          await load();
        }}>
          <Form.Item label="处理状态" name="status" rules={[{ required: true }]}>
            <Select options={[{ value: "pending", label: "待处理" }, { value: "searching", label: "查找中" }, { value: "fulfilled", label: "已收录" }, { value: "not_found", label: "暂未找到" }, { value: "closed", label: "已关闭" }]} />
          </Form.Item>
          <Form.Item label="关联壁纸 ID" name="wallpaperId" tooltip="标记已收录时必填，且壁纸必须已经上架"><Input /></Form.Item>
          <Form.Item label="给用户的处理说明" name="adminNote"><Input.TextArea rows={4} maxLength={500} showCount /></Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
