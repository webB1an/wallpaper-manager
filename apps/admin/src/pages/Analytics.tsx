import { useEffect, useState } from "react";
import { Button, Space, Statistic, Table, Tag } from "antd";
import { RefreshCw } from "lucide-react";
import { request } from "../api";
import { taskTypeText } from "../format";
import { Header, RankList, TagCloud, TrendBars } from "../ui";
import type { AnalyticsData } from "../types";

export function Analytics() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const load = async (nextDays = days) => {
    setLoading(true);
    try {
      setData(await request<AnalyticsData>(`/api/admin/analytics?days=${nextDays}`));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);
  const metric = (title: string, values: number[]) => (
    <div className="ops-panel">
      <h2 className="ops-panel-title">{title}（近 {days} 天）</h2>
      <TrendBars labels={data?.trends.labels || []} values={values || []} />
    </div>
  );
  return (
    <section>
      <Header title="运营分析" subtitle="内容趋势、热度排行、搜索洞察与发布健康度。" />
      <Space className="toolbar">
        {[7, 30].map((value) => <Button key={value} type={days === value ? "primary" : "default"} onClick={() => { setDays(value); void load(value); }}>{value} 天</Button>)}
        <Button icon={<RefreshCw size={16} />} loading={loading} onClick={() => void load()}>刷新</Button>
        <Tag color="gold">统计口径：已上架壁纸 / 点击 / 下载 / 收藏</Tag>
      </Space>
      <div className="overview-grid">
        {metric("新增上架", data?.trends.published || [])}
        {metric("浏览", data?.trends.views || [])}
        {metric("下载", data?.trends.downloads || [])}
        {metric("收藏", data?.trends.favorites || [])}
        {metric("搜索量", data?.trends.searches || [])}
      </div>

      <div className="overview-grid">
        <div className="ops-panel">
          <h2 className="ops-panel-title">当日热门</h2>
          <RankList items={data?.hotWallpapers.daily || []} />
        </div>
        <div className="ops-panel">
          <h2 className="ops-panel-title">近 7 天热门</h2>
          <RankList items={data?.hotWallpapers.weekly || []} />
        </div>
        <div className="ops-panel">
          <h2 className="ops-panel-title">近 30 天热门</h2>
          <RankList items={data?.hotWallpapers.monthly || []} />
        </div>
      </div>

      <div className="overview-grid">
        <div className="ops-panel">
          <h2 className="ops-panel-title">近期热门标签</h2>
          <div className="hot-tag-cloud">
            {data?.hotTags.map((tag) => <Tag key={tag.name} className="hot-tag">{tag.name} · {tag.heat}</Tag>)}
          </div>
        </div>
        <div className="ops-panel">
          <h2 className="ops-panel-title">搜索洞察</h2>
          <div className="stat-grid">
            <Statistic title="搜索次数" value={data?.search.total ?? "--"} />
            <Statistic title="命中率" value={data?.search.hitRate ?? "--"} suffix="%" />
          </div>
          <div className="ops-subtitle">搜索词 Top</div>
          <TagCloud items={data?.search.topTerms || []} gap={false} />
          <div className="ops-subtitle">有搜索、没结果（内容缺口）</div>
          <TagCloud items={data?.search.gaps || []} gap />
        </div>
        <div className="ops-panel">
          <h2 className="ops-panel-title">发布与审核健康度</h2>
          <div className="stat-grid">
            <Statistic title="AI 已识别" value={data?.publish.ai.analyzed ?? "--"} />
            <Statistic title="AI 拦截" value={data?.publish.ai.blocked ?? "--"} />
            <Statistic title="拦截率" value={data?.publish.ai.blockRate ?? "--"} suffix="%" />
            <Statistic title="发帖成功率" value={data?.publish.publishSuccessRate ?? "--"} suffix="%" />
          </div>
          <div className="ops-subtitle">近期失败任务</div>
          <div className="hot-tag-cloud">
            {data?.publish.taskFailures.map((item) => <Tag key={item.type} color="red">{taskTypeText(item.type)} · {item.count}</Tag>)}
            {data && data.publish.taskFailures.length === 0 ? <span className="muted">无</span> : null}
          </div>
          <div className="ops-subtitle">自动发帖板块</div>
          <Table
            rowKey={(board) => `${board.guildName}-${board.channelName}-${board.source}`}
            size="small"
            dataSource={data?.publish.boards || []}
            pagination={false}
            columns={[
              { title: "板块", render: (_, board) => `${board.guildName || "?"} / ${board.channelName || "?"}` },
              { title: "来源", dataIndex: "source" },
              { title: "状态", dataIndex: "enabled", render: (value: boolean) => value ? <Tag color="green">开启</Tag> : <Tag>关闭</Tag> },
              { title: "最近", dataIndex: "lastMessage", ellipsis: true },
            ]}
          />
        </div>
      </div>
    </section>
  );
}
