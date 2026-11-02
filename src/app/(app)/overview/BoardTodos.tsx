"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { App, Button, Checkbox, Segmented, Table, Tooltip } from "antd";
import { dayjs, fmtDateTime } from "@/lib/utils";
import EmptyState, { 表格空态 } from "@/components/EmptyState";
import { toggleTask, completePlan } from "../customers/[id]/actions";
import {
  待办卡们, 待办卡叫法, 状态of, 复盘待办每页,
  看板列们, 看板列叫法, 看板列的卡, 逾天数,
  type 待办卡, type 待办布局, type 复盘待办, type 复盘待办行, type 复盘看板,
} from "@/lib/project/board-todos";
import { 企业级别, 企业级别说明 } from "@/lib/enterprise/customer-v2";
import type { 回收提醒 } from "@/lib/project/review-extras";
import { 即将逾期天数 } from "@/lib/project/home-cards";

/**
 * 复盘页「待办」页签（P15，10-29 用户定）：没做完的跟进计划（FollowPlan）+ 待办事项（Task）。
 * 顶上四张指标卡（逾期 / 今天到期 / 本周到期 / 全部待办）本身就是筛选。
 * 卡、页码都在地址栏（f / p），条数、先后、分页在服务端排好（lib/project/board-todos.ts），这里只换地址。
 * 行首的勾直接完成（复用客户页 / 计划页那两个动作，带撤销）；点一行去项目页，客户没有进行中的项目去客户页。
 * 1024 宽 + AI 栏常驻时这块只剩四五百：内容、客户名省略号截断，再窄在表格里横滚，不伸出页面。
 *
 * 11-01 参考复盘稿融合：「全部待办」默认摆三列看板（逾期 / 今天到期 / 待跟进，给了 看板 就摆），
 * 右上角「看板 / 列表」切换（lay=list 回到上面那张表）；点逾期 / 今天 / 本周那几张卡照旧是筛过的表。
 * 看板下面是「回收提醒」：按节点一条，天数从组织规则读，条长 = 这一圈 3 天内要回公海的项目数。
 */
export default function BoardTodos({ 数, 看板, 卡, 布局 = "list", 回收, 只看自己, 看全员 }: {
  /** 表格那份（列表时给） */
  数?: 复盘待办;
  /** 三列看板那份（全部待办、没选列表时给）；给了就摆看板、不摆表 */
  看板?: 复盘看板;
  卡: 待办卡;
  布局?: 待办布局;
  /** 回收提醒；不给就不摆这块 */
  回收?: 回收提醒;
  只看自己: boolean; 看全员: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const { message } = App.useApp();
  const [刚完成, set刚完成] = useState<string[]>([]);
  const [换着, start] = useTransition();

  /** 换卡从第一页看起；翻页只改 p。replace：筛选不进历史，返回键回到进复盘页之前那一页 */
  const 改 = (k: { f?: 待办卡; lay?: 待办布局; p?: number }) => {
    const q = new URLSearchParams(sp.toString());
    q.delete("kind"); // 旧链接带的类型筛选，按钮组 11-02 删了
    if ("f" in k) {
      if (k.f && k.f !== "all") q.set("f", k.f);
      else q.delete("f");
    }
    if ("lay" in k) {
      if (k.lay === "list") q.set("lay", "list");
      else q.delete("lay");
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

  const 计数 = (看板 ?? 数)?.计数 ?? { overdue: 0, today: 0, week: 0, all: 0 };
  const 空提示 = 卡 !== "all" ? "换一张卡看看。" : 只看自己 ? "你名下的跟进计划和待办都做完了。" : "跟进计划和待办都做完了，这里就空着。";

  return (
    <div className="btodo-wrap">
      {/* 四张卡就是筛选：选中的那张描主色边、底色淡一档；逾期有数才红（是 0 就是个灰数） */}
      <div className="btodo-cards" role="group" aria-label="按到期筛选">
        {待办卡们.map((k) => {
          const n = 计数[k];
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
            {卡 === "all" && (
              <Segmented
                size="small"
                aria-label="看板还是列表"
                className="btodo-lay"
                value={看板 ? "board" : 布局}
                onChange={(v) => 改({ lay: v as 待办布局 })}
                options={[{ value: "board", label: "看板" }, { value: "list", label: "列表" }]}
              />
            )}
          </div>
        </div>
        {看板 && 计数.all === 0 ? (
          <EmptyState title="没有待办" hint={空提示} demo={false} />
        ) : 看板 ? (
          <div className={`btodo-board${换着 ? " is-pending" : ""}`}>
            {看板列们.map((c) => {
              const 列 = 看板.列[c];
              return (
                <section key={c} className={`btodo-col btodo-col-${c}`} aria-label={`${看板列叫法[c]}，${列.总数} 条`}>
                  <header className="btodo-col-h">
                    <i className="btodo-col-dot" aria-hidden />
                    <b>{看板列叫法[c]}</b>
                    <span className="btodo-col-n">{列.总数}</span>
                  </header>
                  {列.行.length ? (
                    <ul className="btodo-col-list">
                      {列.行.map((x) => (
                        <li key={x.key}>
                          <待办卡片 x={x} 完成中={刚完成.includes(x.key)} 看全员={看全员} 完成={() => void 完成(x)} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="btodo-col-empty">{c === "overdue" ? "没有逾期的" : c === "today" ? "今天没有到期的" : "没有排着的"}</p>
                  )}
                  {列.总数 > 列.行.length && (
                    <button type="button" className="btodo-col-more" onClick={() => 改({ f: 看板列的卡[c], lay: "list" })}>
                      看全部 {列.总数} 条 ›
                    </button>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
        <Table<复盘待办行>
          className="btodo"
          size="small"
          rowKey="key"
          tableLayout="fixed"
          loading={换着 ? { delay: 150 } : false}
          dataSource={数?.行 ?? []}
          columns={cols}
          pagination={{
            current: 数?.页 ?? 1,
            pageSize: 复盘待办每页,
            total: 数?.总数 ?? 0,
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
          locale={表格空态({ title: "没有待办", hint: 空提示, demo: false })}
        />
        )}
      </section>
      {回收 && <回收提醒块 回收={回收} />}
    </div>
  );
}

/** 看板上的一张卡：项目（没有写客户）+ 级别、内容、到期 + 逾几天、负责人（看全员时）、「去跟进」；左边的勾直接完成 */
function 待办卡片({ x, 完成中, 看全员, 完成 }: { x: 复盘待办行; 完成中: boolean; 看全员: boolean; 完成: () => void }) {
  const 名 = x.projectName ?? x.customerName;
  const 全名 = x.projectName ? `${x.customerName} · ${x.projectName}` : x.customerName;
  const 级 = 企业级别(x.projectLevel);
  const 逾 = x.组 === "逾期" ? 逾天数(x.时间, dayjs()) : 0;
  return (
    <article className={`btodo-k${完成中 ? " btodo-row-done" : ""}${x.组 === "逾期" ? " btodo-k-late" : ""}`}>
      <Checkbox aria-label={`完成「${x.内容}」`} checked={完成中} disabled={完成中} onChange={完成} />
      <div className="btodo-k-main">
        <div className="btodo-k-top">
          <Tooltip title={全名} placement="topLeft" mouseEnterDelay={0.4}>
            <span className="btodo-k-proj">{名}</span>
          </Tooltip>
          {级 && <span className={`cust-level cust-level-${级}`} title={`项目级别 ${企业级别说明[级]}`} aria-label={`项目级别 ${企业级别说明[级]}`}>{级}</span>}
        </div>
        <Tooltip title={x.内容} placement="topLeft" mouseEnterDelay={0.4}>
          <span className="btodo-k-t btodo-t">{x.内容}</span>
        </Tooltip>
        <div className="btodo-k-meta">
          <span className="btodo-time nowrap">{x.时间 ? fmtDateTime(x.时间) : "没定日期"}</span>
          {逾 > 0 && <span className="btodo-k-over nowrap" suppressHydrationWarning>逾 {逾} 天</span>}
          {看全员 && <span className="btodo-k-owner">{x.ownerName}</span>}
          <Link href={x.去} className="btodo-k-go nowrap">去跟进 ›</Link>
        </div>
      </div>
    </article>
  );
}

/** 回收提醒：按节点一条横条，「<节点> · N 天没跟进收回」，条长 = 3 天内要回公海的项目数（同首页卡口径） */
function 回收提醒块({ 回收 }: { 回收: 回收提醒 }) {
  const 最多 = Math.max(1, ...回收.条.map((c) => c.数));
  return (
    <section className="btodo-list btodo-recycle" aria-label="回收提醒">
      <div className="btodo-head">
        <b className="section-title">回收提醒</b>
        <div className="btodo-head-r">
          {回收.开 && <span className="btodo-recycle-sum nowrap">{即将逾期天数} 天内回公海 <b>{回收.总数}</b> 个</span>}
          <Link href="/projects?f=due-soon" className="link-strong nowrap">去看 ›</Link>
        </div>
      </div>
      {!回收.开 ? (
        <p className="btodo-recycle-off">组织规则里没开超时回收，项目不会因为没跟进自动回公海。</p>
      ) : 回收.条.length === 0 ? (
        <p className="btodo-recycle-off">线索、商机的节点都没设回收天数。</p>
      ) : (
        <ul className="btodo-rc">
          {回收.条.map((c) => (
            <Tooltip key={`${c.阶段}-${c.节点}`} title={`${c.阶段} · ${c.节点}：${c.天数} 天没跟进收回公海，${即将逾期天数} 天内要收回 ${c.数} 个`} placement="topLeft" mouseEnterDelay={0.2}>
              <li className="btodo-rc-row" tabIndex={0}>
                <span className="btodo-rc-k">{c.节点} · {c.天数} 天没跟进收回</span>
                <span className="btodo-rc-bar" aria-hidden><i style={{ width: `${(c.数 / 最多) * 100}%` }} /></span>
                <b className="btodo-rc-v">{c.数}</b>
              </li>
            </Tooltip>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 横滚的下限：勾 44 + 到期 132 + 负责人 88 + 状态 60 + 内容、客户各留 140 */
const 最窄 = 44 + 132 + 88 + 60 + 140 + 140;
