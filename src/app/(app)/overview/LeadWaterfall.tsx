"use client";

import { useMemo } from "react";
import { Card } from "antd";
import type { EChartsCoreOption } from "echarts/core";
import Chart from "@/components/Chart";
import EmptyState from "@/components/EmptyState";
import { palette, categorical } from "@/lib/palette";
import type { 线索节点格 } from "./project-stats";

/**
 * 复盘页 · 线索瀑布（P15）：和左边的漏斗并排。线索阶段各节点（潜客培育 → 线索验证 → 线索推进，节点名取 nodes.ts）
 * 横着一条接一条往右垒，最后一条是线索合计。每条接在上一条的末尾，一眼看出合计是哪几段垒起来的、哪一段最厚。
 * 底座是一段透明的柱子（echarts 瀑布图的常规画法），提示框只报这一段的数。
 */
const 轴字 = { color: palette.textMuted, fontSize: 12 };
const tooltip = {
  backgroundColor: palette.panel,
  borderColor: palette.lineSoft,
  textStyle: { color: palette.inkSoft, fontSize: 12 },
  extraCssText: "box-shadow:var(--shadow-pop);border-radius:8px;",
};

export default function LeadWaterfall({ 节点, 说明 }: { 节点: 线索节点格[]; 说明: string }) {
  const 合计 = 节点.reduce((s, n) => s + n.count, 0);

  const option: EChartsCoreOption = useMemo(() => {
    const 名 = [...节点.map((n) => n.node), "线索合计"];
    // 每条的底座 = 前面几条加起来
    const 底 = 节点.map((_, i) => 节点.slice(0, i).reduce((s, n) => s + n.count, 0));
    const 段 = [...节点.map((n) => n.count), 合计];
    return {
      tooltip: {
        ...tooltip,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (ps: { dataIndex: number }[]) => {
          const i = ps[0]?.dataIndex ?? 0;
          return `${名[i]}<br/>${段[i]} 个`;
        },
      },
      grid: { left: 8, right: 32, top: 4, bottom: 4, containLabel: true },
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
        { name: "底", type: "bar", stack: "瀑布", silent: true, itemStyle: { color: "transparent" }, data: [...底, 0], tooltip: { show: false } },
        {
          name: "个数",
          type: "bar",
          stack: "瀑布",
          barMaxWidth: 18,
          data: 段.map((v, i) => ({
            value: v,
            itemStyle: { color: i === 节点.length ? palette.brand : categorical.cyan, borderRadius: 4 },
          })),
          label: { show: true, position: "right", color: palette.textMuted, fontSize: 12, formatter: (p: { value: number }) => String(p.value) },
        },
      ],
    };
  }, [节点, 合计]);

  return (
    <Card className="pfun-card" title={<span className="section-title">线索瀑布</span>}>
      <p className="pfun-note">{说明}</p>
      {合计 > 0 ? (
        <Chart option={option} height={(节点.length + 1) * 30 + 12} />
      ) : (
        <EmptyState title="没有在线索阶段的项目" hint="新建一条线索，这里按潜客培育、线索验证、线索推进垒出来。" demo={false} />
      )}
    </Card>
  );
}
