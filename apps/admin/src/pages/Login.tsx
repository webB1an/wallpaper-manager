import { useState } from "react";
import { Button, Form, Input, message } from "antd";
import { request } from "../api";

export function Login({ onLogin }: { onLogin: () => void }) {
  const [loading, setLoading] = useState(false);
  return (
    <div className="login-page">
      <section className="login-panel">
        <div className="login-art">
          <span>WDBZK</span>
          <h1>壁纸内容运营台</h1>
          <p>上传、识别、审核、同步与频道发布，从这里收束。</p>
        </div>
        <Form layout="vertical" onFinish={async (values) => {
          setLoading(true);
          try {
            const data = await request<{ token: string }>("/api/admin/auth/login", {
              method: "POST",
              body: JSON.stringify(values),
            });
            localStorage.setItem("wm_token", data.token);
            onLogin();
          } catch (error) {
            message.error((error as Error).message);
          } finally {
            setLoading(false);
          }
        }}>
          <Form.Item label="账号" name="username" rules={[{ required: true }]}>
            <Input size="large" autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true }]}>
            <Input.Password size="large" autoComplete="current-password" />
          </Form.Item>
          <Button htmlType="submit" type="primary" size="large" loading={loading} block>登录</Button>
        </Form>
      </section>
    </div>
  );
}
