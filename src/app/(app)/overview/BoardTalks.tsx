"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Segmented, Table, Tooltip } from "antd";
import { fmtDateTime } from "@/lib/utils";
import { 表格空态 } from "@/components/EmptyState";
import { 沟通段们, 沟通段叫法, 复盘列表每页, type 沟通段, type 复盘沟通, type 复盘沟通行 } from "@/lib/project/review-tabs";

/**
 * 复盘页「沟通」页签（P7 U-复盘-01）：项目上的跟进记录，时间倒序。
 * 按负责人筛 = 页签上面的人员选择（几个页签共用）；按时间筛 = 右上角分段（近 7 / 30 / 90 天、全部），在地址栏 t=。
 * 只读列表，点一行去项目页（这里不给删改，A-13）。1024 宽时项目、客户、内容省略号截断，再窄在表格里横滚。
 */
export default function BoardTalks({ 数, 段, 只看自己 }: { 数: 复盘沟通; 段: 沟通段; 只看自己: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [换着, start] = useTransition();

  const 改 = (k: { t?: 沟通段; p?: number }) => {
    const q = new URLSearchParams(sp.toString());
    if ("t" in k) {
      if (k.t && k.t !== "all") q.set("t", k.t);
      else q.delete("t");
    }
    if (k.p && k.p > 1) q.set("p", String(k.p));
    else q.delete("p");
    const t = q.toString();
    start(() => router.replace(`/overview${t ? `?${t}` : ""}`, { scroll: false }));
  };
  const 去 = (x: 复盘沟通行) => router.push(`/projects/${encodeURIComponent(x.projectId)}`);

  const cols = [
    { title: "时间", key: "时间", width: 132, render: (_: unknown, x: 复盘沟通行) => <span className="nowrap btodo-time">{fmtDateTime(x.时间)}</span> },
    {
      title: "项目",
      key: "项目",
      width: "20%",
      ellipsis: { showTitle: false },
      render: (_: unknown, x: 复盘沟通行) => (
        <Tooltip title={`${x.项目} · ${x.节点}`} placement="topLeft" mouseEnterDelay={0.4}>
          <span>
            {x.项目}
            <span className="btodo-proj"> · {x.节点}</span>
          </span>
        </Tooltip>
      ),
    },
    {
      title: "客户",
      key: "客户",
      width: "16%",
      ellipsis: { showTitle: false },
      render: (_: unknown, x: 复盘沟通行) => (
        <Tooltip title={x.客户} placement="topLeft" mouseEnterDelay={0.4}>
          <span>{x.客户}</span>
        </Tooltip>
      ),
    },
    { title: "方式", key: "方式", width: 88, ellipsis: true, render: (_: unknown, x: 复盘沟通行) => <span className="btodo-kind">{x.方式}</span> },
    {
      title: "内容",
      key: "内容",
      ellipsis: { showTitle: false },
      render: (_: unknown, x: 复盘沟通行) => {
        const 全 = x.内容 && x.内容 !== x.标题 ? `${x.标题}：${x.内容}` : x.标题;
        return (
          <Tooltip title={<span className="rtalk-tip">{全}</span>} placement="topLeft" mouseEnterDelay={0.4}>
            <span>{全 || "—"}</span>
          </Tooltip>
        );
      },
    },
    { title: "负责人", key: "负责人", width: 88, ellipsis: true, render: (_: unknown, x: 复盘沟通行) => x.负责人 },
  ];

  return (
    <div className="btodo-wrap">
      <section className="btodo-list" aria-label="沟通记录列表">
        <div className="btodo-head">
          <b className="section-title">项目沟通</b>
          <div className="btodo-head-r">
            <Segmented
              size="small"
              aria-label="时间范围"
              value={段}
              onChange={(v) => 改({ t: v as 沟通段 })}
              options={沟通段们.map((k) => ({ value: k, label: 沟通段叫法[k] }))}
            />
          </div>
        </div>
        <Table<复盘沟通行>
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
            "aria-label": `${x.项目}，${x.标题}`,
          })}
          locale={表格空态({
            title: "没有沟通记录",
            hint: 段 !== "all" ? "时间选「全部」看看。" : 只看自己 ? "你还没在项目上记过沟通。" : "项目上还没有沟通记录。",
            demo: false,
          })}
        />
      </section>
    </div>
  );
}

/** 横滚的下限：时间 132 + 方式 88 + 负责人 88 + 项目、客户、内容各留 130 */
const 最窄 = 132 + 88 + 88 + 130 * 3;
