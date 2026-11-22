"use client";

import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Checkbox, Input, Segmented, Table, Tooltip } from "antd";
import { showUndo } from "@/components/UndoBar";
import SaveButton from "@/components/SaveButton";
import { useFormDraft } from "@/components/FormDraft";
import BusinessDatePicker from "@/components/BusinessDatePicker";
import { 记项目沟通Action } from "../projects/actions";
import { 自动推进话of } from "@/lib/project/auto-advance-text";
import FollowMethodSelect, { useHabitDefault } from "@/components/FollowMethodSelect";
import { 跟进类型们 } from "@/lib/constants";
import type { 预警行 } from "@/lib/project/review-extras";
import { dayjs, fmtDateTime } from "@/lib/utils";
import { 到期字 } from "../dashboard/todo-time";

import { useIsNowSkin } from "@/lib/use-skin";
import EmptyState, { 表格空态 } from "@/components/EmptyState";
import CountUp from "@/components/CountUp";
import { useMotionTheme } from "@/components/MotionTheme";
import { 动画行上限 } from "@/components/FlipRows";
import { 少动 } from "@/lib/reduced-motion";
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
export default function BoardTodos({ 数, 看板, 卡, 布局 = "list", 回收, 回收项目 = [], 只看自己, 看全员, 只读 = false }: {
  /** 表格那份（列表时给） */
  数?: 复盘待办;
  /** 三列看板那份（全部待办、没选列表时给）；给了就摆看板、不摆表 */
  看板?: 复盘看板;
  卡: 待办卡;
  布局?: 待办布局;
  /** 回收提醒；不给就不摆这块 */
  回收?: 回收提醒;
  /** 3 天内要回公海的那几个项目（同 将回公海of 的 预警，回收日早的在前、最多 8 个）：回收提醒点开节点就列它们，原地记沟通 */
  回收项目?: 预警行[];
  只看自己: boolean; 看全员: boolean;
  /** 只读角色（业务角色只读管理员 / 销售教练，lib/enterprise/permissions.ts 只读角色）：不摆行首的勾——点了服务端也拒（3703 实操：只读管理员能点） */
  只读?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  // 设计语言 R-B（R1）：现状主题卡头写计数、到期用带钟点的 smartTime（同首页待办，dashboard/todo-time）、空态「还没有待办」；换皮主题照旧
  const 新样 = useIsNowSkin();
  const [刚完成, set刚完成] = useState<string[]>([]);
  /** 没完成成的原因：就地写在列表标题旁（g.save），不弹顶部提示、不提示成功 */
  const [错, set错] = useState<string | null>(null);
  const [换着, start] = useTransition();
  const { 时长 } = useMotionTheme();
  /**
   * ov.view「改后」：看板 ↔ 列表，同一批待办从卡片的位置移到行的位置（反过来一样），不像重新加载。
   * 点切换时记下每张卡 / 每一行在屏上的位置（按待办的 key），新样子画出来之后（数据照旧由服务端按 lay 给，一次只取一种，口径不动），
   * 每个对得上的从旧位置滑到新位置；对不上的（看板每列只摆前几条、列表一页 N 条）淡入。
   * 等新数据那一会儿：旧样子不变灰、表格不转圈——人看到的是「变过去」，不是「刷一遍」。
   * 减弱动态、件数超过 动画行上限：直接换，不位移。
   */
  const 变形起点 = useRef<Map<string, DOMRect> | null>(null);
  const 包 = useRef<HTMLDivElement>(null);
  /** 点了要换成哪种（还没到 = 正在变过去）；到了以后和 现在布局 一样，自然就不算在换 */
  const [换布局到, set换布局到] = useState<待办布局 | null>(null);
  const 现在布局: 待办布局 = 看板 ? "board" : "list";
  // 新样子到了：清掉（渲染时就清，React 推荐的「随 props 调整 state」写法），以后别的原因换了样子不算变形
  if (换布局到 !== null && 换布局到 === 现在布局) set换布局到(null);
  const 变形中 = 换布局到 !== null && 换布局到 !== 现在布局;
  const 量件们 = () => {
    const m = new Map<string, DOMRect>();
    包.current?.querySelectorAll<HTMLElement>("[data-morph-key], tr[data-row-key]").forEach((el) => {
      const k = el.dataset.morphKey ?? el.dataset.rowKey;
      if (k) m.set(k, el.getBoundingClientRect());
    });
    return m;
  };
  useLayoutEffect(() => {
    const 起 = 变形起点.current;
    变形起点.current = null;
    const 根 = 包.current;
    if (!起 || !根 || 少动()) return;
    const 件们 = [...根.querySelectorAll<HTMLElement>("[data-morph-key], tr[data-row-key]")];
    if (件们.length > 动画行上限) return;
    // WAAPI 认不了 var()：从 <html> 上读当前主题的 --ease-morph（同 FlipRows），读不到退回线性
    const ease = getComputedStyle(document.documentElement).getPropertyValue("--ease-morph").trim() || "linear";
    const 时 = { duration: 时长.morph * 1000, easing: ease };
    for (const el of 件们) {
      const 旧 = 起.get(el.dataset.morphKey ?? el.dataset.rowKey ?? "");
      const 新 = el.getBoundingClientRect();
      if (旧) el.animate?.([{ transform: `translate(${Math.round(旧.left - 新.left)}px, ${Math.round(旧.top - 新.top)}px)` }, { transform: "none" }], 时);
      else el.animate?.([{ opacity: 0 }, { opacity: 1 }], 时);
    }
  }, [现在布局, 时长]);

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
      // 只换样子（同一张卡、第一页）才变形；「看全部 N 条」那种同时换了卡，是去另一张表，照旧
      if (!("f" in k) && k.lay) {
        变形起点.current = 量件们();
        set换布局到(k.lay);
      }
    }
    if (k.p && k.p > 1) q.set("p", String(k.p));
    else q.delete("p");
    const t = q.toString();
    start(() => router.replace(`/overview${t ? `?${t}` : ""}`, { scroll: false }));
  };

  /**
   * ov.todo：勾一下直接完成（画勾、划线、收起），计数跟着减一；底部撤销条可撤（撤销 = 改回未完成）。
   * 被挡：勾退回去，原因写在列表标题旁，不提示成功。
   */
  async function 完成(x: 复盘待办行) {
    set错(null);
    set刚完成((v) => [...v, x.key]);
    const r = x.kind === "plan" ? await completePlan(x.id) : await toggleTask(x.id, true);
    if (!r.ok) {
      set刚完成((v) => v.filter((k) => k !== x.key));
      set错("error" in r && r.error ? r.error : "没完成成，刷新看看");
      return;
    }
    showUndo({
      话: `已完成「${x.内容}」`,
      毫秒: 6000,
      撤销: async () => {
        const u = x.kind === "plan" ? await completePlan(x.id, false) : await toggleTask(x.id, false);
        if (u.ok) { void window.desktopReminders?.刷新(); router.refresh(); }
        return u;
      },
    });
    void window.desktopReminders?.刷新();
    // 同计划页：留位 600ms 再让它消失，下面的行不立刻跳上来
    setTimeout(() => {
      set刚完成((v) => v.filter((k) => k !== x.key));
      router.refresh();
    }, 600);
  }

  const 去 = (x: 复盘待办行) => { if (x.去) router.push(x.去); };

  const cols = [
    ...(只读 ? [] : [{
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
    }]),
    {
      title: "到期",
      key: "时间",
      // 现状主题 148：最长的写法是跨年短写「2025-10-26 09:30」（实量约 125，格子内边距左右各 8），132 只剩 116 放不下（R-B 审查 11-22）
      width: 新样 ? 148 : 132,
      render: (_: unknown, x: 复盘待办行) => <span className="nowrap btodo-time" title={x.时间 ? fmtDateTime(x.时间) : undefined} suppressHydrationWarning>{x.时间 ? (新样 ? 到期字(x.时间, x.明确钟点) : fmtDateTime(x.时间)) : "没定日期"}</span>,
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
    <div className="btodo-wrap" ref={包}>
      {/* 四张卡就是筛选：选中的那张描主色边、底色淡一档；逾期有数才红（是 0 就是个灰数） */}
      <div className="btodo-cards" role="group" aria-label="按到期筛选">
        {待办卡们.map((k) => {
          const n = 计数[k];
          const 选中 = 卡 === k;
          return (
            <button
              key={k}
              type="button"
              className={`home-card btodo-card${选中 ? " is-on" : ""}${k === "overdue" && n > 0 ? " home-card-warn" : ""}${k === "overdue" && n === 0 ? " is-zero" : ""}`}
              aria-pressed={选中}
              onClick={() => { if (!选中) 改({ f: k }); }}
            >
              <span className="home-card-k">{待办卡叫法[k]}</span>
              {/* 数变了（打完一条、换了筛选）从旧数滚到新数，等宽不跳（PR2 外壳 g.numbers）；第一次进来直接是数 */}
              <b className="home-card-v"><CountUp 值={n} 记号={`btodo:${k}`} 只滚变化 /></b>
            </button>
          );
        })}
      </div>
      <section className="btodo-list" aria-label="待办列表">
        <div className="btodo-head">
          <b className="section-title">{待办卡叫法[卡]}{新样 && <span className="card-count">（{计数[卡]}）</span>}</b>
          {错 && <span className="ov-todo-err" role="alert" title={错}>{错}</span>}
          <div className="btodo-head-r">
            {卡 === "all" && (
              <Segmented
                size="small"
                aria-label="看板还是列表"
                className="btodo-lay"
                // 点下去滑块先到，不等数据（数据到了样子再变过去）
                value={变形中 && 换布局到 ? 换布局到 : 看板 ? "board" : 布局}
                onChange={(v) => 改({ lay: v as 待办布局 })}
                options={[{ value: "board", label: "看板" }, { value: "list", label: "列表" }]}
              />
            )}
          </div>
        </div>
        {看板 && 计数.all === 0 ? (
          <EmptyState title={新样 ? "还没有待办" : "没有待办"} hint={空提示} demo={false} />
        ) : 看板 ? (
          <div className={`btodo-board${换着 && !变形中 ? " is-pending" : ""}`}>
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
                        <li key={x.key} data-morph-key={x.key}>
                          <待办卡片 x={x} 完成中={刚完成.includes(x.key)} 看全员={看全员} 新样={新样} 只读={只读} 完成={() => void 完成(x)} />
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
          loading={换着 && !变形中 ? { delay: 150 } : false}
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
          rowClassName={(x) => `btodo-row${刚完成.includes(x.key) ? " btodo-row-done" : ""}${x.组 === "逾期" ? " btodo-row-late" : ""}${x.去 ? "" : " btodo-row-nolink"}`}
          onRow={(x) => x.去 ? {
            onClick: () => 去(x),
            onKeyDown: (e) => { if (e.key === "Enter") 去(x); },
            tabIndex: 0,
            role: "link",
            "aria-label": `${x.内容}，${x.customerName}`,
          } : {}}
          locale={表格空态({ title: 新样 ? "还没有待办" : "没有待办", hint: 空提示, demo: false })}
        />
        )}
      </section>
      {回收 && <RecycleBlock 回收={回收} 项目={回收项目} />}
    </div>
  );
}

/** 看板上的一张卡：项目（没有写客户）+ 级别、内容、到期 + 逾几天、负责人（看全员时）、「去跟进」；左边的勾直接完成 */
function 待办卡片({ x, 完成中, 看全员, 新样 = false, 只读 = false, 完成 }: { x: 复盘待办行; 完成中: boolean; 看全员: boolean; 新样?: boolean; 只读?: boolean; 完成: () => void }) {
  const 名 = x.projectName ?? x.customerName;
  const 全名 = x.projectName ? `${x.customerName} · ${x.projectName}` : x.customerName;
  const 级 = 企业级别(x.projectLevel);
  const 逾 = x.组 === "逾期" ? 逾天数(x.时间, dayjs()) : 0;
  return (
    <article className={`btodo-k${完成中 ? " btodo-row-done" : ""}${x.组 === "逾期" ? " btodo-k-late" : ""}`}>
      {!只读 && <Checkbox aria-label={`完成「${x.内容}」`} checked={完成中} disabled={完成中} onChange={完成} />}
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
          <span className="btodo-time nowrap" title={x.时间 ? fmtDateTime(x.时间) : undefined} suppressHydrationWarning>{x.时间 ? (新样 ? 到期字(x.时间, x.明确钟点) : fmtDateTime(x.时间)) : "没定日期"}</span>
          {逾 > 0 && <span className="btodo-k-over nowrap" suppressHydrationWarning>逾 {逾} 天</span>}
          {看全员 && <span className="btodo-k-owner">{x.ownerName}</span>}
          {x.去 && <Link href={x.去} className="btodo-k-go nowrap">去跟进 ›</Link>}
        </div>
      </div>
    </article>
  );
}

/**
 * 回收提醒：按节点一条横条，「<节点> · N 天没跟进收回」，条长 = 3 天内要回公海的项目数（同首页卡口径）。
 * PR5b ov.recycle：点一条原地展开这一节点快到期的项目（还剩几天），每个项目「记一条沟通」原地长出一个小表单，
 * 记上了（记项目沟通Action，同项目详情）回收的钟就重新走；成败都在保存键里（SaveButton），不弹顶部提示、不整页跳。
 */
function RecycleBlock({ 回收, 项目 }: { 回收: 回收提醒; 项目: 预警行[] }) {
  const 最多 = Math.max(1, ...回收.条.map((c) => c.数));
  const [开着, set开着] = useState<string | null>(null);
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
          {回收.条.map((c) => {
            const 键 = `${c.阶段}-${c.节点}`;
            const 开 = 开着 === 键;
            const 这节点 = 项目.filter((p) => p.节点 === c.节点);
            return (
              <li key={键} className={`ov-rc-item${开 ? " is-open" : ""}`}>
                <Tooltip title={`${c.阶段} · ${c.节点}：${c.天数} 天没跟进收回公海，${即将逾期天数} 天内要收回 ${c.数} 个`} placement="topLeft" mouseEnterDelay={0.2}>
                  <button type="button" className="btodo-rc-row ov-rc-head" aria-expanded={开} disabled={c.数 === 0} onClick={() => set开着(开 ? null : 键)}>
                    <span className="btodo-rc-k">{c.节点} · {c.天数} 天没跟进收回</span>
                    <span className="btodo-rc-bar" aria-hidden><i style={{ width: `${(c.数 / 最多) * 100}%` }} /></span>
                    <b className="btodo-rc-v">{c.数}</b>
                    <span className="ov-rc-ar" aria-hidden>›</span>
                  </button>
                </Tooltip>
                {开 && (
                  <ul className="ov-rc-list" aria-label={`${c.节点} 快到期的项目`}>
                    {这节点.map((p) => <RecycleProjectRow key={p.id} p={p} />)}
                    {c.数 > 这节点.length && (
                      <li className="ov-rc-more">
                        <Link href="/projects?f=due-soon" className="link-strong">还有 {c.数 - 这节点.length} 个 · 去项目页看 ›</Link>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** 展开后的一行：项目名、还剩几天；「记一条沟通」原地长出小表单（内容 + 下一步 + 下一步时间，默认 3 天后，P-界面-34） */
function RecycleProjectRow({ p }: { p: 预警行 }) {
  const router = useRouter();
  const [记, set记] = useState(false);
  const [内容, set内容] = useState("");
  const [下一步, set下一步] = useState("");
  const [下一步时间, set下一步时间] = useState(() => dayjs().add(3, "day"));
  /** 记上了、顺带按必填把节点推了一格：框收起后在这一行下面说推到哪（不悄悄推，11-20）；再点「记一条沟通」清掉 */
  const [推话, set推话] = useState<string | null>(null);
  /** 沟通方式由人选（同项目详情 / 完成计划小框那一套），不替人写死；打开时按个人习惯默认（11-18），人改过的不盖 */
  const [类型, set类型] = useState("PHONE");
  const [方式, set方式] = useState<string | null>(null);
  const 人改了方式 = useHabitDefault(记, (x) => { set类型(x.type); set方式(x.method); });
  // 打了没记的字留草稿（复盘第 1 类：刷新、发版后再点「记一条沟通」带回）；记上了、点取消就删。方式、日期不进草稿
  const 稿 = useFormDraft({ 键: `回收预警沟通:${p.id}`, 开: 记, 值: { 内容, 下一步 }, 带回: (v) => { if (v.内容 !== undefined) set内容(v.内容); if (v.下一步 !== undefined) set下一步(v.下一步); } });
  const 剩 = Math.max(0, dayjs(p.回收日).startOf("day").diff(dayjs().startOf("day"), "day"));
  async function 存() {
    if (!内容.trim()) return { ok: false, error: "先写几句沟通内容" };
    if (!下一步.trim()) return { ok: false, error: "写一句下一步计划" };
    const r = await 记项目沟通Action(p.id, {
      type: 类型, method: 方式 ?? undefined, content: 内容, occurredAt: new Date().toISOString(),
      阶段: p.阶段, 下一步, 下一步时间: 下一步时间 ? 下一步时间.format("YYYY-MM-DD") : null,
    });
    if (!r.ok) return { ok: false, error: "error" in r ? r.error : "没记上，请刷新后重试" };
    set推话(自动推进话of(r));
    return { ok: true };
  }
  return (
    <li className="ov-rc-p">
      <div className="ov-rc-prow">
        <Link href={`/projects/${p.id}`} className="ov-rc-name" title={p.名}>{p.名}</Link>
        <span className={`ov-rc-left${剩 <= 1 ? " is-late" : ""}`}>{剩 === 0 ? "今天收回" : `还剩 ${剩} 天`}</span>
        {!记 && (
          <button type="button" className="ov-rc-log" onClick={() => { set推话(null); set记(true); }}>记一条沟通</button>
        )}
      </div>
      {!记 && 推话 && <div role="status" className="ov-rc-pushed">{推话}</div>}
      {记 && (
        <div className="ov-rc-form">
          {稿.提示}
          <FollowMethodSelect
            aria-label="沟通方式"
            type={类型}
            method={方式}
            类型们={跟进类型们(false).filter((t) => t.value !== "TASK" && t.value !== "REMIND")}
            onChange={(v) => { 人改了方式(); set类型(v.type); set方式(v.method); }}
          />
          <Input.TextArea aria-label={`和「${p.名}」沟通了什么`} placeholder="沟通了什么" autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} value={内容} onChange={(e) => set内容(e.target.value)} />
          <div className="ov-rc-next">
            <Input aria-label="下一步计划" placeholder="下一步计划（一句话）" maxLength={200} value={下一步} onChange={(e) => set下一步(e.target.value)} />
            <BusinessDatePicker aria-label="下一步时间" value={下一步时间} onChange={(v) => v && set下一步时间(v)} allowClear={false} />
          </div>
          <div className="ov-rc-act">
            <SaveButton 做={存} 成了={() => { 稿.存好了(); set记(false); set内容(""); set下一步(""); router.refresh(); }}>记下</SaveButton>
            <button type="button" className="ov-rc-cancel" onClick={() => { 稿.丢掉(); set记(false); }}>取消</button>
          </div>
        </div>
      )}
    </li>
  );
}

/** 横滚的下限：勾 44 + 到期 132 + 负责人 88 + 状态 60 + 内容、客户各留 140 */
const 最窄 = 44 + 132 + 88 + 60 + 140 + 140;
