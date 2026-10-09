import { useEffect, useState } from "react";
import { Alert, Button, Form, Input, Select, Space, Switch, Tag, Upload, message } from "antd";
import type { UploadFile, UploadProps } from "antd";
import { UploadCloud } from "lucide-react";
import { API, request } from "../api";
import { copyText, providerText, sensitiveFlagText, uploadErrorMessage } from "../format";
import { Header } from "../ui";
import type { ChannelAccount, StorageAccount, SystemSettings, Wallpaper } from "../types";

export function Uploader() {
  const [autoProcess, setAutoProcess] = useState(true);
  const [autoPublish, setAutoPublish] = useState(false);
  const [defaultChannelReady, setDefaultChannelReady] = useState(false);
  const [channelAccounts, setChannelAccounts] = useState<ChannelAccount[]>([]);
  const [channelAccountId, setChannelAccountId] = useState<string>();
  const [storageAccounts, setStorageAccounts] = useState<StorageAccount[]>([]);
  const [quarkAccountId, setQuarkAccountId] = useState<string>();
  const [baiduAccountId, setBaiduAccountId] = useState<string>();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [batchUploading, setBatchUploading] = useState(false);
  const [manualTags, setManualTags] = useState<string[]>([]);
  const [manualTitle, setManualTitle] = useState("");
  useEffect(() => {
    Promise.all([
      request<SystemSettings>("/api/admin/settings"),
      request<ChannelAccount[]>("/api/admin/channels"),
      request<StorageAccount[]>("/api/admin/storage-accounts"),
    ])
      .then(([settings, accounts, storage]) => {
        const hasDefaultChannel = accounts.some((account) => account.isDefault);
        const preferredChannel = accounts.find((account) => account.isDefault) || accounts[0];
        setDefaultChannelReady(hasDefaultChannel);
        setAutoProcess(settings.defaultAutoProcess);
        setAutoPublish(settings.defaultAutoPublish && Boolean(preferredChannel));
        setChannelAccounts(accounts);
        setChannelAccountId(preferredChannel?.id);
        setStorageAccounts(storage);
      })
      .catch(() => undefined);
  }, []);
  const autoPublishDisabled = !autoProcess || !channelAccounts.length;
  const quarkAccounts = storageAccounts.filter((account) => account.provider === "quark");
  const baiduAccounts = storageAccounts.filter((account) => account.provider === "baidu");
  const hasAnyStorageAccount = Boolean(quarkAccounts.length || baiduAccounts.length);
  const uploadDisabled = autoProcess && !hasAnyStorageAccount;
  const selectedStorageData = {
    autoProcess: String(autoProcess),
    autoPublish: String(autoPublish),
    tags: manualTags.join(","),
    title: manualTitle.trim(),
    ...(autoPublish && channelAccountId ? { channelAccountId } : {}),
    ...(quarkAccountId ? { quarkAccountId } : {}),
    ...(baiduAccountId ? { baiduAccountId } : {}),
  };
  const props: UploadProps = {
    name: "files",
    multiple: true,
    accept: "image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,video/webm",
    action: `${API}/api/admin/uploads`,
    headers: { Authorization: `Bearer ${localStorage.getItem("wm_token") || ""}` },
    data: selectedStorageData,
    disabled: uploadDisabled,
    fileList,
    listType: "picture",
    beforeUpload: () => false,
    onChange({ fileList: next }) {
      setFileList(next);
      if (next.length && next.every((item) => item.status === "done" || item.status === "error")) {
        window.setTimeout(() => setFileList([]), 1500);
      }
    },
  };
  const sendOneRequest = async (sendFiles: UploadFile[]) => {
    const form = new FormData();
    for (const file of sendFiles) {
      if (file.originFileObj) form.append("files", file.originFileObj);
    }
    for (const [key, value] of Object.entries(selectedStorageData)) {
      form.append(key, value);
    }
    const response = await fetch(`${API}/api/admin/uploads`, {
      method: "POST",
      headers: { Authorization: `Bearer ${localStorage.getItem("wm_token") || ""}` },
      body: form,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.code !== 200) {
      throw new Error(uploadErrorMessage(body));
    }
    return body;
  };
  const uploadFiles = async (files: UploadFile[]) => {
    if (!files.length) return;
    const ids = files.map((file) => file.uid);
    setFileList((prev) => prev.map((item) => ids.includes(item.uid) ? { ...item, status: "uploading", percent: 0 } : item));
    setBatchUploading(true);
    let success = 0;
    try {
      const imageFiles = files.filter((file) => (file.originFileObj as File | undefined)?.type?.startsWith?.("image/"));
      const videoFiles = files.filter((file) => !imageFiles.includes(file));
      // 静态图整批一次提交（合并发帖）
      if (imageFiles.length) {
        const created = (await sendOneRequest(imageFiles)).data as Array<{ id: string }> | undefined;
        success += Array.isArray(created) ? created.length : imageFiles.length;
      }
      // 动态壁纸逐张单独提交（各自发帖，也避免大视频挤进一个超大的请求）
      for (const videoFile of videoFiles) {
        await sendOneRequest([videoFile]);
        success += 1;
      }
      message.success(autoProcess ? `已上传 ${success} 张并加入处理队列` : `已上传 ${success} 张为草稿`);
      setFileList((prev) => prev.map((item) => ids.includes(item.uid) ? { ...item, status: "done", response: null } : item));
    } catch (error) {
      message.error(`上传失败：${error instanceof Error ? error.message : "请求失败"}`);
      setFileList((prev) => prev.map((item) => ids.includes(item.uid) ? { ...item, status: "error", error } : item));
    } finally {
      setBatchUploading(false);
    }
  };
  const startUpload = () => {
    const pending = fileList.filter((file) => file.originFileObj && file.status !== "done" && file.status !== "error" && file.status !== "uploading");
    void uploadFiles(pending);
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
      <div className="upload-options upload-tags-options">
        <span>手动标签（可选，AI 标签将追加在其后）</span>
        <Select
          mode="tags"
          placeholder="输入标签后回车，多个以逗号分隔"
          value={manualTags}
          onChange={setManualTags}
          tokenSeparators={[",", "，"]}
          maxTagCount={8}
          style={{ width: 320 }}
          allowClear
        />
      </div>
      <div className="upload-options upload-tags-options">
        <span>手动标题（可选，填写后跳过 AI 识别，直接同步网盘/发帖/上架）</span>
        <Input
          placeholder="例如：春日樱花少女"
          value={manualTitle}
          onChange={(event) => setManualTitle(event.target.value)}
          allowClear
          maxLength={40}
          style={{ width: 320 }}
        />
      </div>
      <div className="upload-options">
        <span>处理成功后自动发腾讯频道</span>
        <Switch
          checked={autoPublish}
          onChange={setAutoPublish}
          disabled={autoPublishDisabled}
        />
        {!channelAccounts.length ? <Tag color="gold">未配置频道账号</Tag> : !defaultChannelReady ? <Tag color="gold">未设置默认频道账号</Tag> : null}
      </div>
      <div className="upload-options">
        <span>本次发帖频道账号</span>
        <Select
          allowClear
          placeholder={channelAccounts.length ? "使用默认频道账号" : "未配置频道账号"}
          value={channelAccountId}
          onChange={setChannelAccountId}
          disabled={!autoPublish || !channelAccounts.length}
          options={channelAccounts.map((account) => ({
            value: account.id,
            label: `${account.label}${account.isDefault ? " · 默认" : ""}${account.channelName ? ` · ${account.channelName}` : ""}`,
          }))}
        />
      </div>
      <div className="upload-storage-options">
        <div>
          <span>本次夸克同步账号</span>
          <Select
            allowClear
            placeholder={quarkAccounts.length ? "使用默认夸克账号" : "未配置夸克账号"}
            value={quarkAccountId}
            onChange={setQuarkAccountId}
            disabled={!autoProcess || !quarkAccounts.length}
            options={quarkAccounts.map((account) => ({
              value: account.id,
              label: `${account.label}${account.isDefault ? " · 默认" : ""}${account.accountName ? ` · ${account.accountName}` : ""}`,
            }))}
          />
        </div>
        <div>
          <span>本次百度同步账号</span>
          <Select
            allowClear
            placeholder={baiduAccounts.length ? "使用默认百度账号" : "未配置百度账号"}
            value={baiduAccountId}
            onChange={setBaiduAccountId}
            disabled={!autoProcess || !baiduAccounts.length}
            options={baiduAccounts.map((account) => ({
              value: account.id,
              label: `${account.label}${account.isDefault ? " · 默认" : ""}${account.accountName ? ` · ${account.accountName}` : ""}`,
            }))}
          />
        </div>
      </div>
      {!quarkAccounts.length || !baiduAccounts.length ? (
        <Alert
          className="page-alert"
          type={hasAnyStorageAccount ? "warning" : "error"}
          showIcon
          message={hasAnyStorageAccount ? "网盘默认账号未配置完整" : "未配置网盘账号"}
          description={hasAnyStorageAccount
            ? "上传处理会继续执行；缺少对应网盘账号时会在任务提醒里记录同步失败。请到“网盘账号”补齐授权和默认账号配置。"
            : "自动处理至少需要一个百度或夸克账号。请先到“网盘账号”新增并授权，或关闭自动处理后先上传为草稿。"}
        />
      ) : null}
      <Upload.Dragger {...props} className="upload-dragger">
        <UploadCloud size={42} />
        <h2>拖拽壁纸文件到这里</h2>
        <p>支持 JPG、PNG、WebP、GIF、AVIF、MP4、MOV、WebM；默认单文件上限 300MB。</p>
      </Upload.Dragger>
      <div className="upload-actions">
        <Button
          type="primary"
          icon={<UploadCloud size={16} />}
          disabled={!fileList.length || batchUploading || fileList.some((file) => file.status === "uploading")}
          loading={batchUploading}
          onClick={startUpload}
        >
          开始上传{fileList.length ? `（${fileList.length}）` : ""}
        </Button>
      </div>
    </section>
  );
}

export function AiReviewCell({ wallpaper }: { wallpaper: Wallpaper }) {
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

export function StorageLinkEditor({ wallpaper, reload }: { wallpaper: Wallpaper; reload: () => void }) {
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
