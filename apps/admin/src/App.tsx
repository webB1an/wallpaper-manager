import { useState } from "react";
import { ConfigProvider, Layout, Menu } from "antd";
import zhCN from "antd/locale/zh_CN";
import { Activity, CloudUpload, GalleryVerticalEnd, HardDrive, Home, ListChecks, RadioTower, Search, Settings as SettingsIcon, TrendingUp, UploadCloud } from "lucide-react";
import { Analytics } from "./pages/Analytics";
import { Channels } from "./pages/Channels";
import { Dashboard } from "./pages/Dashboard";
import { Diagnostics } from "./pages/Diagnostics";
import { Library } from "./pages/Library";
import { Login } from "./pages/Login";
import { MemberRequests } from "./pages/MemberRequests";
import { OldImport } from "./pages/OldImport";
import { PaymentOrders } from "./pages/PaymentOrders";
import { SearchLogs } from "./pages/SearchLogs";
import { Settings } from "./pages/Settings";
import { StorageAccounts } from "./pages/StorageAccounts";
import { Tasks } from "./pages/Tasks";
import { Uploader } from "./pages/Uploader";
import type { LibraryPreset } from "./types";

export function App() {
  const [authed, setAuthed] = useState(Boolean(localStorage.getItem("wm_token")));
  const [active, setActive] = useState("overview");
  const [libraryPreset, setLibraryPreset] = useState<LibraryPreset | null>(null);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  const openLibrary = (preset?: LibraryPreset) => {
    setLibraryPreset(preset ? { ...preset, nonce: Date.now() } : null);
    setActive("library");
  };

  return (
    <ConfigProvider locale={zhCN} theme={{ token: { borderRadius: 8, colorPrimary: "#C05621", colorLink: "#C05621", colorInfo: "#C05621" } }}>
      <Layout className="app-shell">
        <Layout.Sider width={240} className="sider">
          <div className="brand">
            <div className="brand-mark"><GalleryVerticalEnd size={22} /></div>
            <div>
              <strong>Wallpaper Ops</strong>
              <span>wdbzk 内容中台</span>
            </div>
          </div>
          <Menu
            mode="inline"
            selectedKeys={[active]}
            onClick={(event) => {
              if (event.key === "library") setLibraryPreset(null);
              setActive(event.key);
            }}
            items={[
              { key: "overview", icon: <Home size={18} />, label: "概览" },
              { key: "library", icon: <GalleryVerticalEnd size={18} />, label: "资源库" },
              { key: "upload", icon: <UploadCloud size={18} />, label: "批量上传" },
              { key: "tasks", icon: <ListChecks size={18} />, label: "任务队列" },
              { key: "searchLogs", icon: <Search size={18} />, label: "搜索日志" },
              { key: "memberRequests", icon: <Search size={18} />, label: "会员求图" },
              { key: "paymentOrders", icon: <ListChecks size={18} />, label: "付费记录" },
              { key: "analytics", icon: <TrendingUp size={18} />, label: "运营分析" },
              { key: "import", icon: <CloudUpload size={18} />, label: "老封面迁移" },
              { key: "storageAccounts", icon: <HardDrive size={18} />, label: "网盘账号" },
              { key: "channels", icon: <RadioTower size={18} />, label: "腾讯频道" },
              { key: "settings", icon: <SettingsIcon size={18} />, label: "系统设置" },
              { key: "diagnostics", icon: <Activity size={18} />, label: "上线诊断" },
            ]}
          />
        </Layout.Sider>
        <Layout.Content className="content">
          {active === "overview" && <Dashboard onNavigate={setActive} onOpenLibrary={openLibrary} />}
          {active === "library" && <Library preset={libraryPreset} />}
          {active === "upload" && <Uploader />}
          {active === "tasks" && <Tasks />}
          {active === "searchLogs" && <SearchLogs />}
          {active === "memberRequests" && <MemberRequests />}
          {active === "paymentOrders" && <PaymentOrders />}
          {active === "analytics" && <Analytics />}
          {active === "import" && <OldImport />}
          {active === "storageAccounts" && <StorageAccounts />}
          {active === "channels" && <Channels />}
          {active === "settings" && <Settings />}
          {active === "diagnostics" && <Diagnostics onNavigate={setActive} onOpenLibrary={openLibrary} />}
        </Layout.Content>
      </Layout>
    </ConfigProvider>
  );
}
