"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Segmented, Table, Tooltip } from "antd";
import { fmtDateTime } from "@/lib/utils";
import { 表格空态 } from "@/components/EmptyState";
import { 卡点筛们, 卡点筛叫法, 复盘列表每页, type 卡点筛, type 复盘卡点, type 复盘卡点行 } from "@/lib/project/review-tabs";

/**
 * 复盘页「卡点」页签（P7 U-复盘-01）：项目卡点列表——项目、客户、卡点类型、影响、描述、负责人、时间，外加状态。
 * 取值全用现有卡点模型（EntBlocker，A-18）；看谁的跟页签上面的人员选择走，范围在服务端（lib/project/review-tabs.ts）。
 * 状态筛选（未解决 / 已解决 / 全部）、页码在地址栏（bs / p）；点一行去项目页，在那里认领、处理。
 * 1024 宽 + AI 栏常驻时：项目、客户、描述省略号截断，再窄在表格里横滚，不伸出页面。
 */
export default function BoardBlockers({ 数, 筛, 只看自己 }: { 数: 复盘卡点; 筛: 卡点筛; 只看自己: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [换着, start] = useTransition();

  /** 换筛选从第一页看起；replace：筛选不进历史 */
  const 改 = (k: { bs?: 卡点筛; p?: number }) => {
    const q = new URLSearchParams(sp.toString());
    if ("bs" in k) {
      if (k.bs && k.bs !== "open") q.set("bs", k.bs);
      else q.delete("bs");
    }
    if (k.p && k.p > 1) q.set("p", String(k.p));
    else q.delete("p");
    const t = q.toString();
    start(() => router.replace(`/overview${t ? `?${t}` : ""}`, { scroll: false }));
  };
  const 去 = (x: 复盘卡点行) => router.push(`/projects/${encodeURIComponent(x.projectId)}`);

  const 截 = (全: string) => (
    <Tooltip title={全} placement="topLeft" mouseEnterDelay={0.4}>
      <span>{全}</span>
    </Tooltip>
  );
  const cols = [
    { title: "时间", key: "时间", width: 132, render: (_: unknown, x: 复盘卡点行) => <span className="nowrap btodo-time">{fmtDateTime(x.createdAt)}</span> },
    { title: "项目", key: "项目", width: "16%", ellipsis: { showTitle: false }, render: (_: unknown, x: 复盘卡点行) => 截(x.项目) },
    { title: "客户", key: "客户", width: "16%", ellipsis: { showTitle: false }, render: (_: unknown, x: 复盘卡点行) => 截(x.客户) },
    {
      title: "卡点类型",
      key: "类型",
      width: 88,
      render: (_: unknown, x: 复盘卡点行) => <span className={`nowrap rblk-type${x.type === "重要卡点" ? " rblk-type-hot" : ""}`}>{x.type}</span>,
    },
    { title: "影响", key: "影响", width: 88, render: (_: unknown, x: 复盘卡点行) => <span className="nowrap">{x.impact}</span> },
    {
      title: "描述",
      key: "描述",
      ellipsis: { showTitle: false },
      render: (_: unknown, x: 复盘卡点行) => (
        <Tooltip title={`${x.code}　${x.description || "（没写描述）"}`} placement="topLeft" mouseEnterDelay={0.4}>
          <span className={x.description ? undefined : "btodo-kind"}>{x.description || "—"}</span>
        </Tooltip>
      ),
    },
    { title: "负责人", key: "负责人", width: 88, ellipsis: true, render: (_: unknown, x: 复盘卡点行) => x.负责人 },
    {
      title: "状态",
      key: "状态",
      width: 72,
      render: (_: unknown, x: 复盘卡点行) => (
        <Tooltip title={x.经手人 ? `经手：${x.经手人}` : undefined}>
          <span className={`btodo-s ${x.status === "已解决" ? "btodo-s-later" : "btodo-s-today"}`}>{x.status}</span>
        </Tooltip>
      ),
    },
  ];

  return (
    <div className="btodo-wrap">
      <section className="btodo-list" aria-label="卡点列表">
        <div className="btodo-head">
          <b className="section-title">项目卡点</b>
          <div className="btodo-head-r">
            <Segmented
              size="small"
              aria-label="卡点状态"
              value={筛}
              onChange={(v) => 改({ bs: v as 卡点筛 })}
              options={卡点筛们.map((k) => ({ value: k, label: 卡点筛叫法[k] }))}
            />
          </div>
        </div>
        <Table<复盘卡点行>
          className="btodo"
          size="small"
          rowKey="id"
          tableLayout="fixed"
          loading={换着 ? { delay: 150 } : false}
          dataSource={数.行}
          columns={cols}
          pagination={{
            current: 数.页,
            pageSize: 复盘列表每页,
            total: 数.总数,
            showSizeChanger: false,
            hideOnSinglePage: true,
            size: "small",
            showTotal: (n) => `共 ${n} 条`,
            onChange: (p) => 改({ p }),
          }}
          scroll={{ x: 最窄 }}
          rowClassName={() => "btodo-row"}
          onRow={(x) => ({
            onClick: () => 去(x),
            onKeyDown: (e) => { if (e.key === "Enter") 去(x); },
            tabIndex: 0,
            role: "link",
            "aria-label": `${x.code}，${x.项目}，${x.type}`,
          })}
          locale={表格空态({
            title: "没有卡点",
            hint: 筛 !== "all" ? "状态选「全部」看看。" : 只看自己 ? "你负责的项目上还没有卡点。" : "项目上还没有卡点。",
            demo: false,
          })}
        />
      </section>
    </div>
  );
}

/** 横滚的下限：时间 132 + 类型 88 + 影响 88 + 负责人 88 + 状态 72 + 项目、客户、描述各留 120 */
const 最窄 = 132 + 88 + 88 + 88 + 72 + 120 * 3;
