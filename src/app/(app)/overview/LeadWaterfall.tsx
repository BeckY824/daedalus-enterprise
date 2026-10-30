"use client";

import { useMemo } from "react";
import { Card } from "antd";
import type { EChartsCoreOption } from "echarts/core";
import Chart from "@/components/Chart";
import EmptyState from "@/components/EmptyState";
import { palette, categorical } from "@/lib/palette";
import type { 线索节点格 } from "./project-stats";

/**
 * 复盘页 · 线索瀑布（P15；10-29 定稿：横向瀑布要看得出每个节点流出去多少）：和左边的漏斗并排。
 * 线索阶段各节点（潜客培育 → 线索验证 → 线索推进，节点名取 nodes.ts）横着一条接一条往右垒，每条拆成四段：
 * 还停着的、线索流失、判无效、退回公海（口径见 project-stats.ts 线索节点of）；再垒一条「已转商机」，最后一条是线索合计。
 * 底座是一段透明的柱子（echarts 瀑布图的常规画法）；提示框报这一条各段几个，条尾写这一条一共几个。
 */
const 轴字 = { color: palette.textMuted, fontSize: 12 };
const tooltip = {
  backgroundColor: palette.panel,
  borderColor: palette.lineSoft,
  textStyle: { color: palette.inkSoft, fontSize: 12 },
  extraCssText: "box-shadow:var(--shadow-pop);border-radius:8px;",
};

/** 每条拆成哪几段、什么颜色：停着的是中性色，流出去的三样按轻重给红 / 橙 / 灰，转商机是好出口给绿，合计用品牌色 */
const 段们 = [
  { 键: "count", 名: "停在这里", 色: categorical.cyan },
  { 键: "流失", 名: "线索流失", 色: palette.danger },
  { 键: "判无效", 名: "判无效", 色: palette.warning },
  { 键: "退回公海", 名: "放回公海", 色: palette.textFaint },
] as const;

export default function LeadWaterfall({ 节点, 转商机, 说明 }: { 节点: 线索节点格[]; 转商机: number; 说明: string }) {
  const 条数 = useMemo(() => 节点.map((n) => 段们.reduce((s, d) => s + n[d.键], 0)), [节点]);
  const 合计 = 条数.reduce((s, v) => s + v, 0) + 转商机;

  const option: EChartsCoreOption = useMemo(() => {
    const 名 = [...节点.map((n) => n.node), "已转商机阶段", "线索合计"];
    const 末 = [...条数, 转商机, 合计];
    // 每条的底座 = 前面几条加起来；合计从 0 起
    const 底 = [...条数.map((_, i) => 条数.slice(0, i).reduce((s, v) => s + v, 0)), 条数.reduce((s, v) => s + v, 0), 0];
    const 列 = (vs: number[], 色: string, name: string) => ({
      name,
      type: "bar",
      stack: "瀑布",
      barMaxWidth: 18,
      itemStyle: { color: 色 },
      emphasis: { focus: "series" },
      data: vs,
    });
    const 补 = (vs: number[]) => [...vs, 0, 0];
    return {
      tooltip: {
        ...tooltip,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0;
          if (i >= 节点.length) return `${名[i]}<br/>${末[i]} 个`;
          const n = 节点[i];
          const 行 = 段们.filter((d) => d.键 === "count" || n[d.键] > 0).map((d) => `${d.名} ${n[d.键]} 个`);
          return `${名[i]} · 共 ${末[i]} 个<br/>${行.join("<br/>")}`;
        },
      },
      legend: { top: 0, left: 0, itemWidth: 10, itemHeight: 10, textStyle: 轴字, data: [...段们.map((d) => d.名), "已转商机阶段"] },
      grid: { left: 8, right: 36, top: 30, bottom: 4, containLabel: true },
      xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: palette.lineSoft } }, axisLabel: 轴字 },
      yAxis: {
        type: "category",
        inverse: true,
        data: 名,
        axisLine: { lineStyle: { color: palette.lineSoft } },
        axisTick: { show: false },
        axisLabel: 轴字,
      },
      series: [
        { name: "底", type: "bar", stack: "瀑布", silent: true, itemStyle: { color: "transparent" }, data: 底, tooltip: { show: false } },
        ...段们.map((d) => 列(补(节点.map((n) => n[d.键])), d.色, d.名)),
        列([...节点.map(() => 0), 转商机, 0], palette.success, "已转商机阶段"),
        列([...节点.map(() => 0), 0, 合计], palette.brand, "线索合计"),
        // 条尾的数：一段看不见的 0 长柱子，只负责把这一条一共几个写在右边
        {
          name: "共",
          type: "bar",
          stack: "瀑布",
          silent: true,
          itemStyle: { color: "transparent" },
          data: 末.map(() => 0),
          tooltip: { show: false },
          label: { show: true, position: "right", color: palette.textMuted, fontSize: 12, formatter: (p: { dataIndex: number }) => String(末[p.dataIndex]) },
        },
      ],
    };
  }, [节点, 条数, 转商机, 合计]);

  return (
    <Card className="pfun-card" title={<span className="section-title">线索瀑布</span>}>
      <p className="pfun-note">{说明}</p>
      {合计 > 0 ? (
        <Chart option={option} height={(节点.length + 2) * 30 + 42} />
      ) : (
        <EmptyState title="没有线索阶段的项目" hint="新建一条线索，这里按潜客培育、线索验证、线索推进垒出来，流失、判无效、放回公海也拆开看。" demo={false} />
      )}
    </Card>
  );
}
