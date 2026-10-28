"use client";

import { useMemo } from "react";
import { Card, Row, Col, Table, Typography } from "antd";
import { FunnelPlotOutlined, ProjectOutlined, ShoppingOutlined, WarningOutlined, PlusCircleOutlined, RiseOutlined, TrophyOutlined, StopOutlined } from "@ant-design/icons";
import Link from "next/link";
import type { EChartsCoreOption } from "echarts/core";
import Chart from "@/components/Chart";
import { StatCard } from "@/components/ui";
import EmptyState, { 表格空态 } from "@/components/EmptyState";
import { palette, categorical } from "@/lib/palette";
import { 金额 } from "@/lib/currency";
import type { 项目现在, 项目一段, 人行现在, 人行一段 } from "./project-stats";

/**
 * 企业版只用项目时「数据」页的正文（10-26 用户：「「数据」页改成按项目统计」）。
 * 现在 = 此刻各阶段、各节点手上有多少；本月 / 本年 = 这一段新建、转商机、转订单、交付了多少。
 * 页头和三视图切换还是 DataShell 那一套。
 */

const 阶段色: Record<string, string> = { 线索: categorical.cyan, 商机: palette.brand, 订单: categorical.green };

const tooltip = {
  backgroundColor: palette.panel,
  borderColor: palette.lineSoft,
  textStyle: { color: palette.inkSoft, fontSize: 12 },
  extraCssText: "box-shadow:0 6px 20px rgba(16,43,77,.12);border-radius:8px;",
};
const 轴字 = { color: palette.textMuted, fontSize: 12 };

/** 外币提醒：金额只算本位币 */
function 外币提示({ n, 本位币, 说 }: { n: number; 本位币: string; 说: string }) {
  return n > 0 ? <p className="muted">另有 {n} 个{说}不是 {本位币}，金额没算进来（不换汇）。</p> : null;
}

/** 名字列：点了去项目列表按这个人筛（线索阶段的去新线索）。
 *  名字不截断；同名的「王芳（邮箱）」拆两行，邮箱小字放下面，表格不用左右拖 */
const 名字列 = (去: (id: string) => string) => ({
  title: "负责人",
  dataIndex: "name",
  render: (v: string, r: { id: string }) => {
    const m = /^(.*)（(.+@.+)）$/.exec(v);
    return (
      <Link href={去(r.id)} className="link-strong stat-who" title={v}>
        {m ? m[1] : v}
        {m && <span className="stat-who-sub">{m[2]}</span>}
      </Link>
    );
  },
});

export function ProjectNowView({ 数, 本位币, 单人 }: { 数: 项目现在; 本位币: string; 单人: boolean }) {
  const money = (n: number) => 金额(n, 本位币);
  const 段 = Object.fromEntries(数.阶段.map((s) => [s.phase, s]));
  const 异常 = 数.结局.find((r) => r.result === "异常状态")?.count ?? 0;
  const 有项目 = 数.阶段.some((s) => s.count > 0);

  // 横着画：14 个节点名竖着排，窄屏也放得下，不用斜着字
  const 节点option: EChartsCoreOption = useMemo(() => {
    const 倒 = [...数.节点].reverse();
    return {
      tooltip: {
        ...tooltip,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (ps: { dataIndex: number }[]) => {
          const n = 倒[ps[0]?.dataIndex ?? 0];
          return n ? `${n.phase} · ${n.node}<br/>${n.count} 个${n.phase === "线索" ? "" : ` · ${金额(n.amount, 本位币)}`}` : "";
        },
      },
      grid: { left: 8, right: 24, top: 8, bottom: 4, containLabel: true },
      xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: palette.lineSoft } }, axisLabel: 轴字 },
      yAxis: {
        type: "category",
        data: 倒.map((n) => n.node),
        axisLine: { lineStyle: { color: palette.lineSoft } },
        axisTick: { show: false },
        axisLabel: 轴字,
      },
      series: [
        {
          name: "项目数",
          type: "bar",
          barMaxWidth: 18,
          data: 倒.map((n) => ({ value: n.count, itemStyle: { color: 阶段色[n.phase], borderRadius: [0, 4, 4, 0] } })),
          label: { show: true, position: "right", color: palette.textMuted, fontSize: 12, formatter: (p: { value: number }) => (p.value ? String(p.value) : "") },
        },
      ],
    };
  }, [数.节点, 本位币]);

  const cols = [
    名字列((id) => `/projects?ownerId=${encodeURIComponent(id)}`),
    { title: "线索", dataIndex: "线索", width: 72, sorter: (a: 人行现在, b: 人行现在) => a.线索 - b.线索,
      render: (v: number, r: 人行现在) => (v ? <Link href={`/leads?ownerId=${encodeURIComponent(r.id)}`}>{v}</Link> : 0) },
    { title: "商机", dataIndex: "商机", width: 72, sorter: (a: 人行现在, b: 人行现在) => a.商机 - b.商机 },
    { title: "订单", dataIndex: "订单", width: 72, sorter: (a: 人行现在, b: 人行现在) => a.订单 - b.订单 },
    { title: "商机金额", dataIndex: "商机金额", width: 140, align: "right" as const, sorter: (a: 人行现在, b: 人行现在) => a.商机金额 - b.商机金额, render: (v: number) => <span className="nowrap">{money(v)}</span> },
    { title: "订单金额", dataIndex: "订单金额", width: 140, align: "right" as const, sorter: (a: 人行现在, b: 人行现在) => a.订单金额 - b.订单金额, render: (v: number) => <span className="nowrap">{money(v)}</span> },
  ];

  return (
    <>
      <外币提示 n={数.外币} 本位币={本位币} 说="进行中的项目" />
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <StatCard icon={<FunnelPlotOutlined />} color={阶段色.线索} label="新线索" value={段.线索?.count ?? 0} note="线索阶段、还没流失的" href="/leads" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard icon={<ProjectOutlined />} color={阶段色.商机} label="商机" value={段.商机?.count ?? 0} note={money(段.商机?.amount ?? 0)} href="/projects" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard icon={<ShoppingOutlined />} color={阶段色.订单} label="订单" value={段.订单?.count ?? 0} note={money(段.订单?.amount ?? 0)} href="/projects" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard icon={<WarningOutlined />} color={categorical.orange} label="异常状态" value={异常} note={数.公海 ? `公海里还有 ${数.公海} 个进行中的` : "订单阶段停住的"} href="/projects" />
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} xxl={单人 ? 24 : 12}>
          <Card title={<span className="section-title">各节点的项目</span>} extra={<Typography.Text type="secondary" style={{ fontSize: 13 }}>只数进行中的</Typography.Text>}>
            {有项目 ? (
              <Chart option={节点option} height={数.节点.length * 24 + 24} />
            ) : (
              <EmptyState title="还没有进行中的项目" hint="新建一条线索，或者从飞书 / Excel 导入，这里会按节点数出来。" demo={false} />
            )}
          </Card>
        </Col>
        {!单人 && (
          <Col xs={24} xxl={12}>
            <Card title={<span className="section-title">按负责人</span>} extra={<Typography.Text type="secondary" style={{ fontSize: 13 }}>进行中的，公海里的不算</Typography.Text>} styles={{ body: { paddingTop: 8 } }}>
              <Table<人行现在>
                size="small"
                rowKey="id"
                dataSource={数.按人}
                columns={cols}
                pagination={false}
                // 窄了在卡片里横滚：1024 宽 + AI 栏常驻时卡片只剩三百多，五列数字 496 就放不下，不给就伸出卡片（排版闸门 10-28）。
                // 给数字不给 max-content：名字照旧能折行，宽的时候不会无端横滚。616 = 名字留 120 + 72×3 + 140×2
                scroll={{ x: 616 }}
                locale={表格空态({ title: "还没有人手上有项目", hint: "分了线索、建了项目之后这里按人拆。", demo: false })}
              />
            </Card>
          </Col>
        )}
      </Row>

      <p className="muted" style={{ marginTop: 12 }}>
        已经结束的：{数.结局.filter((r) => r.result !== "异常状态").map((r) => `${r.result} ${r.count}`).join(" · ")}
      </p>
    </>
  );
}

export function ProjectPeriodView({ 数, 本位币, 口径, 单人 }: { 数: 项目一段; 本位币: string; 口径: string; 单人: boolean }) {
  const money = (n: number) => 金额(n, 本位币);
  const t = 数.合计;
  const 有事 = t.新建 + t.转商机 + t.转订单 + t.成功交付 > 0;

  const 趋势option: EChartsCoreOption = useMemo(() => {
    const 系列 = [
      { k: "新建", c: 阶段色.线索 },
      { k: "转商机", c: 阶段色.商机 },
      { k: "转订单", c: categorical.violet },
      { k: "成功交付", c: 阶段色.订单 },
    ] as const;
    return {
      tooltip: { ...tooltip, trigger: "axis" },
      legend: { top: 0, right: 0, textStyle: 轴字, itemWidth: 12, itemHeight: 8 },
      grid: { left: 8, right: 12, top: 34, bottom: 4, containLabel: true },
      xAxis: { type: "category", data: 数.trend.map((b) => b.label), axisLine: { lineStyle: { color: palette.lineSoft } }, axisTick: { show: false }, axisLabel: 轴字 },
      yAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: palette.lineSoft } }, axisLabel: 轴字 },
      series: 系列.map((s) => ({ name: s.k, type: "bar", barMaxWidth: 14, itemStyle: { color: s.c, borderRadius: [3, 3, 0, 0] }, data: 数.trend.map((b) => b[s.k]) })),
    };
  }, [数.trend]);

  const 数列 = (k: "新建" | "转商机" | "转订单" | "成功交付" | "没成", title: string = k) => ({
    title, dataIndex: k, width: 76, sorter: (a: 人行一段, b: 人行一段) => a[k] - b[k],
  });
  const cols = [
    名字列((id) => `/projects?ownerId=${encodeURIComponent(id)}`),
    数列("新建"), 数列("转商机"), 数列("转订单"), 数列("成功交付", "交付"),
    { title: "交付金额", dataIndex: "交付金额", width: 140, align: "right" as const, defaultSortOrder: "descend" as const,
      sorter: (a: 人行一段, b: 人行一段) => a.交付金额 - b.交付金额, render: (v: number) => <span className="nowrap" style={{ fontWeight: 500 }}>{money(v)}</span> },
    数列("没成", "流失 / 丢单"),
  ];

  return (
    <>
      <外币提示 n={数.外币} 本位币={本位币} 说="这一段交付的项目" />
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <StatCard icon={<PlusCircleOutlined />} color={阶段色.线索} label="新建项目" value={t.新建} note={口径} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard icon={<RiseOutlined />} color={阶段色.商机} label="转商机" value={t.转商机} note={`转订单 ${t.转订单}`} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard icon={<TrophyOutlined />} color={阶段色.订单} label="成功交付" value={t.成功交付} note={money(t.交付金额)} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          {/* 没成 = 流失 + 丢单；异常还在处理，不算没成。原来三个数并排写，看着像加不平（10-27） */}
          <StatCard icon={<StopOutlined />} color={categorical.orange} label="没成" value={t.线索流失 + t.丢单} note={`线索流失 ${t.线索流失} · 丢单 ${t.丢单}${t.异常状态 ? `；另有异常 ${t.异常状态}，不算在没成里` : ""}`} />
        </Col>
      </Row>

      <Card style={{ marginTop: 16 }} title={<span className="section-title">项目走势</span>} extra={<Typography.Text type="secondary" style={{ fontSize: 13 }}>一个项目来回改节点只数一次</Typography.Text>}>
        {有事 ? (
          <Chart option={趋势option} height={320} />
        ) : (
          <EmptyState title="这一段项目没有动静" hint="新建、转商机、转订单、交付了，这里会按时间画出来。换一个时间段看看。" demo={false} />
        )}
      </Card>

      {!单人 && (
        <Card style={{ marginTop: 16 }} title={<span className="section-title">按负责人</span>} extra={<Typography.Text type="secondary" style={{ fontSize: 13 }}>按项目现在的负责人算</Typography.Text>} styles={{ body: { paddingTop: 8 } }}>
          <Table<人行一段>
            size="small"
            rowKey="id"
            dataSource={数.按人}
            columns={cols}
            pagination={false}
            // 同上：窄了在卡片里横滚，不伸出。640 = 名字留 120 + 76×5 + 140
            scroll={{ x: 640 }}
            locale={表格空态({ title: "这一段还没有人动过项目", hint: "换一个时间段看看。", demo: false })}
          />
        </Card>
      )}
    </>
  );
}
