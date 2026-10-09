import { useEffect, useState } from "react";
import { Button, Form, Input, InputNumber, Select, Space, Switch, message } from "antd";
import { request } from "../api";
import { Header } from "../ui";
import type { ChannelAccount, SystemSettings } from "../types";

export function Settings() {
  const [form] = Form.useForm<SystemSettings>();
  const [loading, setLoading] = useState(false);
  const [defaultChannelReady, setDefaultChannelReady] = useState(false);
  useEffect(() => {
    Promise.all([
      request<SystemSettings>("/api/admin/settings"),
      request<ChannelAccount[]>("/api/admin/channels"),
    ]).then(([settings, accounts]) => {
      const hasDefaultChannel = accounts.some((account) => account.isDefault);
      setDefaultChannelReady(hasDefaultChannel);
      form.setFieldsValue({
        ...settings,
        defaultAutoPublish: settings.defaultAutoPublish && hasDefaultChannel,
      });
    });
  }, [form]);
  return (
    <section>
      <Header title="系统设置" subtitle="设置上传和发布流程的默认行为；上传时仍可针对当前批次临时调整。" />
      <Form
        form={form}
        layout="vertical"
        className="form-grid"
        onFinish={async (values) => {
          if (values.defaultAutoPublish && !defaultChannelReady) {
            message.warning("先配置默认腾讯频道账号，再开启默认自动发帖");
            return;
          }
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
          <Switch disabled={!defaultChannelReady} />
        </Form.Item>
        {!defaultChannelReady ? <span className="form-hint">未配置默认腾讯频道账号</span> : null}
        <Form.Item
          label="多图上传发帖方式"
          name="uploadMultiPostMode"
        >
          <Select options={[
            { value: "merge", label: "合并为一帖（每帖最多 18 张）" },
            { value: "separate", label: "每张图片单独发帖" },
          ]} />
        </Form.Item>
        <Form.Item
          label="单张发帖随机间隔（秒）"
          tooltip="每张图片单独发帖时，相邻帖子之间随机等待；单图任务发帖也使用这个范围。填 0 表示不等待"
        >
          <Space>
            <Form.Item name="separatePostGapMinSeconds" noStyle rules={[{ required: true, message: "填写最小间隔" }]}>
              <InputNumber min={0} max={300} precision={0} placeholder="最小" style={{ width: 120 }} />
            </Form.Item>
            <span>至</span>
            <Form.Item name="separatePostGapMaxSeconds" noStyle rules={[{ required: true, message: "填写最大间隔" }]}>
              <InputNumber min={0} max={300} precision={0} placeholder="最大" style={{ width: 120 }} />
            </Form.Item>
          </Space>
        </Form.Item>
        <Form.Item
          label="批次发帖随机间隔（秒）"
          tooltip="相邻批次之间随机等待，避免连续批次发帖过于频繁。填 0 表示不等待"
        >
          <Space>
            <Form.Item name="batchPostGapMinSeconds" noStyle rules={[{ required: true, message: "填写最小间隔" }]}>
              <InputNumber min={0} max={300} precision={0} placeholder="最小" style={{ width: 120 }} />
            </Form.Item>
            <span>至</span>
            <Form.Item name="batchPostGapMaxSeconds" noStyle rules={[{ required: true, message: "填写最大间隔" }]}>
              <InputNumber min={0} max={300} precision={0} placeholder="最大" style={{ width: 120 }} />
            </Form.Item>
          </Space>
        </Form.Item>
        <Form.Item label="激励视频下载模式" name="rewardDownloadType">
          <Select options={[
            { value: "daily10", label: "当天 10 次" },
            { value: "unlimited", label: "无限次" },
          ]} />
        </Form.Item>
        <Form.Item label="永久会员每月免费求图次数" name="memberRequestMonthlyLimit" tooltip="填 0 可暂停新求图">
          <InputNumber min={0} max={100} precision={0} style={{ width: "100%" }} />
        </Form.Item>
        <div className="form-field settings-wide-field">
          <div className="form-label">虚拟支付商品</div>
          <Form.List name="virtualPaymentProducts">
            {(fields, { add, remove }) => (
              <div className="payment-product-list">
                {fields.map((field, index) => (
                  <div key={field.key} className="payment-product-card">
                    <div className="payment-product-card-head">
                      <strong>商品 {index + 1}</strong>
                      <Space>
                        <Form.Item name={[field.name, "enabled"]} valuePropName="checked" noStyle><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
                        <Button size="small" danger type="text" onClick={() => remove(field.name)}>删除</Button>
                      </Space>
                    </div>
                    <div className="payment-product-grid">
                      <Form.Item label="业务标识" name={[field.name, "key"]} rules={[{ required: true }, { pattern: /^[a-z][a-z0-9_-]{2,63}$/, message: "小写字母开头，可用数字、-、_" }]}>
                        <Input placeholder="例如 download_lifetime" />
                      </Form.Item>
                      <Form.Item label="微信道具 ID" name={[field.name, "productId"]} rules={[{ required: true }]}>
                        <Input placeholder="须与微信后台完全一致" />
                      </Form.Item>
                      <Form.Item label="商品名称" name={[field.name, "name"]} rules={[{ required: true }]}>
                        <Input placeholder="用户可见名称" />
                      </Form.Item>
                      <Form.Item label="价格（分）" name={[field.name, "goodsPrice"]} rules={[{ required: true }]}>
                        <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                      </Form.Item>
                      <Form.Item label="权益类型" name={[field.name, "entitlementType"]} rules={[{ required: true }]}>
                        <Select options={[
                          { value: "unlimited_permanent", label: "永久不限次下载" },
                          { value: "unlimited_days", label: "限时不限次下载" },
                          { value: "single_download", label: "单次下载次数" },
                          { value: "remove_ads_days", label: "限时去广告" },
                        ]} />
                      </Form.Item>
                      <Form.Item label="权益数值" name={[field.name, "entitlementValue"]} tooltip="限时权益填写天数；永久权益填 0；单次下载通常填 1">
                        <InputNumber min={0} precision={0} style={{ width: "100%" }} />
                      </Form.Item>
                      <Form.Item label="微信购买数量" name={[field.name, "buyQuantity"]}>
                        <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                      </Form.Item>
                      <Form.Item className="payment-product-description" label="商品说明" name={[field.name, "description"]} rules={[{ required: true }]}>
                        <Input.TextArea rows={2} placeholder="说明购买后获得的内容" />
                      </Form.Item>
                    </div>
                  </div>
                ))}
                <Button type="dashed" onClick={() => add({ key: "", productId: "", name: "", description: "", goodsPrice: 100, buyQuantity: 1, entitlementType: "single_download", entitlementValue: 1, enabled: true })}>+ 添加虚拟支付商品</Button>
              </div>
            )}
          </Form.List>
          <div className="form-hint">先在微信后台创建并发布道具，再在这里填写完全一致的道具 ID 和价格。保存后立即生效，不需要修改服务器环境变量或重启。</div>
        </div>
        <Form.Item label="启用 WallMuse 文章与公众号合集" name="wallMuseEnabled" valuePropName="checked" extra="保存后生效，无需重启。关闭后暂停后续文章处理并隐藏公开合集内容，已有文章和素材保留；已开始的处理步骤会完成。">
          <Switch />
        </Form.Item>
        <Form.Item label="仅在空闲时段自动处理上传" name="processIdleEnabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <div className="form-field">
          <div className="form-label">空闲时段（仅这些时段自动处理上传的壁纸）</div>
          <Form.List name="processIdleWindows">
            {(fields, { add, remove }) => (
              <div className="openid-list">
                {fields.map((field) => (
                  <div key={field.key} className="openid-row">
                    <Form.Item name={[field.name, "start"]} noStyle rules={[{ pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "HH:mm" }]}>
                      <Input placeholder="开始 00:00" style={{ width: 110 }} />
                    </Form.Item>
                    <span className="form-hint">至</span>
                    <Form.Item name={[field.name, "end"]} noStyle rules={[{ pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "HH:mm" }]}>
                      <Input placeholder="结束 09:00" style={{ width: 110 }} />
                    </Form.Item>
                    <Button size="small" danger type="text" onClick={() => remove(field.name)}>删除</Button>
                  </div>
                ))}
                <Button size="small" type="dashed" onClick={() => add({ start: "00:00", end: "09:00" })}>+ 添加时段</Button>
              </div>
            )}
          </Form.List>
          <div className="form-hint">需要 AI 识别的上传任务会等待下一个空闲时段；手动填写标题的资源不受此限制，直接进入处理队列。混合批次仍按 AI 时段处理。格式 HH:mm，结束填 00:00 表示次日零点。</div>
        </div>
        <div className="form-field">
          <div className="form-label">永久下载权益交付资源</div>
          <Form.List name="permanentDeliveryResources">
            {(fields, { add, remove }) => (
              <div className="delivery-resource-list">
                {fields.map((field) => (
                  <div key={field.key} className="delivery-resource-row">
                    <Form.Item name={[field.name, "name"]} noStyle rules={[{ required: true, message: "请填写资源名称" }]}>
                      <Input placeholder="资源名称" />
                    </Form.Item>
                    <Form.Item name={[field.name, "provider"]} noStyle rules={[{ required: true }]}>
                      <Select options={[{ value: "baidu", label: "百度网盘" }, { value: "quark", label: "夸克网盘" }]} />
                    </Form.Item>
                    <Form.Item name={[field.name, "url"]} noStyle rules={[{ required: true, type: "url", message: "请填写有效链接" }]}>
                      <Input placeholder="https://..." />
                    </Form.Item>
                    <Form.Item name={[field.name, "passcode"]} noStyle>
                      <Input placeholder="提取码（可选）" />
                    </Form.Item>
                    <Button size="small" danger type="text" onClick={() => remove(field.name)}>删除</Button>
                  </div>
                ))}
                <Button size="small" type="dashed" onClick={() => add({ name: "", provider: "baidu", url: "", passcode: "" })}>+ 添加交付资源</Button>
              </div>
            )}
          </Form.List>
          <div className="form-hint">购买永久下载权益后展示给用户，可配置任意数量；保存顺序即小程序展示顺序。</div>
        </div>
        <div className="form-field">
          <div className="form-label">小程序管理员 openid（白名单）</div>
          <Form.List name="miniAdminOpenids">
            {(fields, { add, remove }) => (
              <div className="openid-list">
                {fields.map((field) => (
                  <div key={field.key} className="openid-row">
                    <Form.Item {...field} noStyle>
                      <Input placeholder="用户 openid" />
                    </Form.Item>
                    <Button size="small" danger type="text" onClick={() => remove(field.name)}>删除</Button>
                  </div>
                ))}
                <Button size="small" type="dashed" onClick={() => add("")}>+ 添加</Button>
              </div>
            )}
          </Form.List>
          <div className="form-hint">这些用户在小程序「我的」页会出现上传壁纸入口、详情页可下架壁纸，无需配置服务器环境变量。</div>
        </div>
        <Button htmlType="submit" type="primary" loading={loading}>保存设置</Button>
      </Form>
    </section>
  );
}
