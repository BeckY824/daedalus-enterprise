"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { App, Button, Checkbox, Segmented, Table, Tooltip } from "antd";
import { fmtDateTime } from "@/lib/utils";
import { 表格空态 } from "@/components/EmptyState";
import { toggleTask, completePlan } from "../customers/[id]/actions";
import {
  待办卡们, 待办卡叫法, 待办类型们, 待办类型叫法, 状态of, 计划页链接, 复盘待办每页,
  type 待办卡, type 待办类型, type 复盘待办, type 复盘待办行,
} from "@/lib/project/board-todos";

/**
 * 复盘页「待办」页签（P15，10-29 用户定）：没做完的跟进计划（FollowPlan）+ 待办事项（Task）。
 * 顶上四张指标卡（逾期 / 今天到期 / 本周到期 / 全部待办）本身就是筛选；列表上方右侧是待办类型（全部 / 任务 / 跟进计划）。
 * 卡、类型、页码都在地址栏（f / kind / p），条数、先后、分页在服务端排好（lib/project/board-todos.ts），这里只换地址。
 * 行首的勾直接完成（复用客户页 / 计划页那两个动作，带撤销）；点一行去项目页，客户没有进行中的项目去客户页。
 * 1024 宽 + AI 栏常驻时这块只剩四五百：内容、客户名省略号截断，再窄在表格里横滚，不伸出页面。
 */
export default function BoardTodos({ 数, 卡, 类型, 只看自己, 看全员 }: {
  数: 复盘待办; 卡: 待办卡; 类型: 待办类型; 只看自己: boolean; 看全员: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const { message } = App.useApp();
  const [刚完成, set刚完成] = useState<string[]>([]);
  const [换着, start] = useTransition();

  /** 换卡、换类型从第一页看起；翻页只改 p。replace：筛选不进历史，返回键回到进复盘页之前那一页 */
  const 改 = (k: { f?: 待办卡; kind?: 待办类型; p?: number }) => {
    const q = new URLSearchParams(sp.toString());
    for (const key of ["f", "kind"] as const) {
      if (!(key in k)) continue;
      const v = k[key];
      if (v && v !== "all") q.set(key, v);
      else q.delete(key);
    }
    if (k.p && k.p > 1) q.set("p", String(k.p));
    else q.delete("p");
    const t = q.toString();
    start(() => router.replace(`/overview${t ? `?${t}` : ""}`, { scroll: false }));
  };

  async function 完成(x: 复盘待办行) {
    set刚完成((v) => [...v, x.key]);
    const r = x.kind === "plan" ? await completePlan(x.id) : await toggleTask(x.id, true);
    if (!r.ok) {
      set刚完成((v) => v.filter((k) => k !== x.key));
      message.error("error" in r && r.error ? r.error : "没完成成，刷新看看");
      router.refresh();
      return;
    }
    const key = `btodo-${x.key}`;
    message.success({
      key,
      duration: 6,
      content: (
        <span>
          「{x.内容}」已完成
          <Button type="link" size="small" onClick={() => { message.destroy(key); void 撤销(x); }}>
            撤销
          </Button>
        </span>
      ),
    });
    void window.desktopReminders?.刷新();
    // 同计划页：留位 600ms 再让它消失，下面的行不立刻跳上来
    setTimeout(() => {
      set刚完成((v) => v.filter((k) => k !== x.key));
      router.refresh();
    }, 600);
  }

  async function 撤销(x: 复盘待办行) {
    if (x.kind === "plan") await completePlan(x.id, false);
    else await toggleTask(x.id, false);
    set刚完成((v) => v.filter((k) => k !== x.key));
    message.success(`「${x.内容}」已改回未完成`);
    void window.desktopReminders?.刷新();
    router.refresh();
  }

  const 去 = (x: 复盘待办行) => router.push(x.去);

  const cols = [
    {
      key: "勾",
      width: 44,
      render: (_: unknown, x: 复盘待办行) => (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Checkbox
            aria-label={`完成「${x.内容}」`}
            checked={刚完成.includes(x.key)}
            disabled={刚完成.includes(x.key)}
            onChange={() => void 完成(x)}
          />
        </span>
      ),
    },
    {
      title: "到期",
      key: "时间",
      width: 132,
      render: (_: unknown, x: 复盘待办行) => <span className="nowrap btodo-time">{x.时间 ? fmtDateTime(x.时间) : "没定日期"}</span>,
    },
    {
      title: "类型",
      key: "类型",
      width: 84,
      render: (_: unknown, x: 复盘待办行) => <span className="nowrap btodo-kind">{x.kind === "plan" ? "跟进计划" : "任务"}</span>,
    },
    {
      title: "内容",
      key: "内容",
      ellipsis: { showTitle: false },
      render: (_: unknown, x: 复盘待办行) => (
        <Tooltip title={x.内容} placement="topLeft" mouseEnterDelay={0.4}>
          <span className="btodo-t">{x.内容}</span>
        </Tooltip>
      ),
    },
    {
      title: "客户",
      key: "客户",
      width: "26%",
      ellipsis: { showTitle: false },
      render: (_: unknown, x: 复盘待办行) => {
        const 全 = x.projectName ? `${x.customerName} · ${x.projectName}` : x.customerName;
        return (
          <Tooltip title={全} placement="topLeft" mouseEnterDelay={0.4}>
            <span>
              {x.customerName}
              {x.projectName && <span className="btodo-proj"> · {x.projectName}</span>}
            </span>
          </Tooltip>
        );
      },
    },
    { title: "负责人", key: "负责人", width: 88, ellipsis: true, render: (_: unknown, x: 复盘待办行) => x.ownerName },
    {
      title: "状态",
      key: "状态",
      width: 60,
      render: (_: unknown, x: 复盘待办行) => {
        const s = 状态of(x.组);
        return <span className={`btodo-s btodo-s-${s === "逾期" ? "late" : s === "今天" ? "today" : "later"}`}>{s}</span>;
      },
    },
  ];

  return (
    <div className="btodo-wrap">
      {/* 四张卡就是筛选：选中的那张描主色边、底色淡一档；逾期有数才红（是 0 就是个灰数） */}
      <div className="btodo-cards" role="group" aria-label="按到期筛选">
        {待办卡们.map((k) => {
          const n = 数.计数[k];
          const 选中 = 卡 === k;
          return (
            <button
              key={k}
              type="button"
              className={`home-card btodo-card${选中 ? " is-on" : ""}${k === "overdue" && n > 0 ? " home-card-warn" : ""}`}
              aria-pressed={选中}
              onClick={() => { if (!选中) 改({ f: k }); }}
            >
              <span className="home-card-k">{待办卡叫法[k]}</span>
              <b className="home-card-v">{n}</b>
            </button>
          );
        })}
      </div>
      <section className="btodo-list" aria-label="待办列表">
        <div className="btodo-head">
          <b className="section-title">{待办卡叫法[卡]}</b>
          <div className="btodo-head-r">
            <Segmented
              size="small"
              aria-label="待办类型"
              value={类型}
              onChange={(v) => 改({ kind: v as 待办类型 })}
              options={待办类型们.map((k) => ({ value: k, label: 待办类型叫法[k] }))}
            />
            <Link href={计划页链接(看全员 ? "全员" : "自己")} className="link-strong nowrap">去计划页</Link>
          </div>
        </div>
        <Table<复盘待办行>
          className="btodo"
          size="small"
          rowKey="key"
          tableLayout="fixed"
          loading={换着 ? { delay: 150 } : false}
          dataSource={数.行}
          columns={cols}
          pagination={{
            current: 数.页,
            pageSize: 复盘待办每页,
            total: 数.总数,
            showSizeChanger: false,
            hideOnSinglePage: true,
            size: "small",
            showTotal: (n) => `共 ${n} 条`,
            onChange: (p) => 改({ p }),
          }}
          // 窄了在表格里横滚，不伸出页面；宽的时候内容、客户名照常省略
          scroll={{ x: 最窄 }}
          rowClassName={(x) => `btodo-row${刚完成.includes(x.key) ? " btodo-row-done" : ""}${x.组 === "逾期" ? " btodo-row-late" : ""}`}
          onRow={(x) => ({
            onClick: () => 去(x),
            onKeyDown: (e) => { if (e.key === "Enter") 去(x); },
            tabIndex: 0,
            role: "link",
            "aria-label": `${x.内容}，${x.customerName}`,
          })}
          locale={表格空态({ title: "没有待办", hint: 卡 !== "all" || 类型 !== "all" ? "换一张卡、或者类型选「全部」看看。" : 只看自己 ? "你名下的跟进计划和待办都做完了。" : "跟进计划和待办都做完了，这里就空着。", demo: false })}
        />
      </section>
    </div>
  );
}

/** 横滚的下限：勾 44 + 到期 132 + 类型 84 + 负责人 88 + 状态 60 + 内容、客户各留 140 */
const 最窄 = 44 + 132 + 84 + 88 + 60 + 140 + 140;
