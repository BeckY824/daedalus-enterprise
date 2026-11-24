"use client";

/**
 * 客户详情「历史变更」（11-24，用户审过原型 原型-历史变更-20261124.html，入口选「B 小方框」）。
 *
 * 入口：客户名下「状态 · 客户来源」那一行末尾一个小方框「🕘 历史变更 N · 最近」，N = 我看得到的客户 + 项目变更条数（页面给好，一句 SQL）。
 * 点开是弹窗：电脑居中、手机从底部升起；Esc 关、焦点回入口。打开时才取数（history-actions.ts），每页 30 条，「更早的」往下接。
 *   - 客户：建档一格 + 按天倒序的变更，类型筛选（全部 / 负责人 / 状态 / 资料修改 / 同号录入），系统批量修正同一天同一批折一行、点开看明细
 *   - 项目：我看得到的项目一节一节（当前打开的项目默认展开），各自建档一格 + 变更；看不到的只写个数
 * 原来项目区右栏「项目进程变更」卡、卡里「客户状态」一段、没项目时左栏的状态留痕，都挪到这里
 */
import "./history-changes.css";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Drawer, Grid, Modal } from "antd";
import { ClockCircleOutlined, DownOutlined, RightOutlined } from "@ant-design/icons";
import { dayjs, fmtDateTime, smartTime } from "@/lib/utils";
import { 动作出错话 } from "@/lib/stale-deploy";
import { 历史筛选们, type 历史筛选, type 历史行, type 历史事件, type 历史游标, type 建档格, type 项目概要, type 历史摘要 } from "./history-types";
import { 读客户历史, 读项目历史, 读项目历史们 } from "./history-actions";

const 读不到话 = "没读到历史变更，请稍后再试";
/** 只用来认「水合完了没有」（同 CustomersView 已水合）：入口上的「· 最近」是相对时间，按浏览器的钟算，服务端和首帧不画，免得水合对不上 */
const 无订阅 = () => () => {};

type Props = { customerId: string; 摘要: 历史摘要; 当前项目: string | null; 客户名: string };

export default function HistoryChanges({ customerId, 摘要, 当前项目, 客户名 }: Props) {
  const 屏 = Grid.useBreakpoint();
  // md 还没算出来（首屏）按电脑；≤767 从底部升起
  const 手机 = 屏.md === false;
  const [开, set开] = useState(false);
  const 钮 = useRef<HTMLButtonElement>(null);
  const 条数 = 摘要.客户 + 摘要.项目;
  const 已水合 = useSyncExternalStore(无订阅, () => true, () => false);
  const 最近 = 已水合 && 摘要.最近 ? smartTime(摘要.最近) : null;
  // 关掉焦点回入口：antd 6 的 Drawer 带 destroyOnHidden 时不回 afterOpenChange，焦点会掉到 body 上，所以关的那一下记一笔、渲染后自己放回
  const 刚关 = useRef(false);
  const 关 = () => { 刚关.current = true; set开(false); };
  const 回焦点 = () => 钮.current?.focus();
  useEffect(() => {
    if (开 || !刚关.current) return;
    刚关.current = false;
    钮.current?.focus();
  }, [开]);
  const 标题 = (
    <span className="hist-title">
      <span className="hist-title-t" id="hist-title">历史变更</span>
      {客户名 && <span className="hist-title-who" title={客户名}>{客户名}</span>}
    </span>
  );
  const 身 = 开 ? <HistoryBody customerId={customerId} 摘要={摘要} 当前项目={当前项目} /> : null;
  return (
    <>
      <button
        ref={钮}
        type="button"
        className="hist-entry"
        data-testid="history-entry"
        aria-haspopup="dialog"
        aria-expanded={开}
        aria-label={`历史变更，共 ${条数} 条${最近 ? `，最近一条 ${最近}` : ""}`}
        title={!摘要.最近 ? "还没有变更记录" : 已水合 ? `最近一条：${fmtDateTime(摘要.最近)}` : undefined}
        onClick={() => set开(true)}
      >
        <ClockCircleOutlined className="hist-entry-i" aria-hidden />
        <span className="hist-entry-l">历史变更</span>
        {条数 > 0 && <span className="hist-entry-n">{条数}</span>}
        {最近 && <span className="hist-entry-ago">· {最近}</span>}
      </button>
      {手机 ? (
        <Drawer open={开} placement="bottom" height="auto" onClose={关} title={标题} rootClassName="hist-sheet" destroyOnHidden>
          {身}
        </Drawer>
      ) : (
        <Modal open={开} onCancel={关} footer={null} width={760} title={标题} className="hist-modal" destroyOnHidden afterClose={回焦点}>
          {身}
        </Modal>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- 弹窗里面 */

function HistoryBody({ customerId, 摘要, 当前项目 }: Omit<Props, "客户名">) {
  const [页签, set页签] = useState<"客户" | "项目">("客户");
  const [看过项目, set看过项目] = useState(false);
  const 切 = (t: "客户" | "项目") => { set页签(t); if (t === "项目") set看过项目(true); };
  const 键 = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const 到 = 页签 === "客户" ? "项目" : "客户";
      切(到);
      document.getElementById(`hist-tab-${到}`)?.focus();
    }
  };
  return (
    <div className="hist-body">
      <div className="hist-seg" role="tablist" aria-label="历史变更分块" onKeyDown={键}>
        {(["客户", "项目"] as const).map((t) => (
          <button key={t} type="button" role="tab" id={`hist-tab-${t}`} aria-selected={页签 === t} aria-controls={`hist-panel-${t}`} tabIndex={页签 === t ? 0 : -1} onClick={() => 切(t)}>
            {t}<span className="hist-seg-c">{t === "客户" ? 摘要.客户 : `${摘要.项目数} 个`}</span>
          </button>
        ))}
      </div>
      <div id="hist-panel-客户" role="tabpanel" aria-labelledby="hist-tab-客户" hidden={页签 !== "客户"} className="hist-panel">
        <CustomerPanel customerId={customerId} 有状态={摘要.状态} />
      </div>
      {看过项目 && (
        <div id="hist-panel-项目" role="tabpanel" aria-labelledby="hist-tab-项目" hidden={页签 !== "项目"} className="hist-panel">
          <ProjectsPanel customerId={customerId} 当前项目={当前项目} />
        </div>
      )}
    </div>
  );
}

/** 翻页接上：上一页最后几组和这一页开头同一天同一批的批量修正并成一组 */
function 接上(旧: 历史行[], 新: 历史行[]): 历史行[] {
  const 出 = [...旧];
  for (const r of 新) {
    const 同 = r.种 === "批量" ? 出.findIndex((x) => x.种 === "批量" && x.键 === r.键) : -1;
    if (同 >= 0) {
      const g = 出[同] as Extract<历史行, { 种: "批量" }>;
      出[同] = { ...g, 事件们: [...g.事件们, ...(r as Extract<历史行, { 种: "批量" }>).事件们] };
    } else 出.push(r);
  }
  return 出;
}

type 一列 = { 建档: 建档格 | null; 行们: 历史行[]; 更早: 历史游标 | null };

function CustomerPanel({ customerId, 有状态 }: { customerId: string; 有状态: boolean }) {
  const [筛, set筛] = useState<历史筛选>("全部");
  const [数据, set数据] = useState<一列 | null>(null);
  // 打开就在取第一页：一开始就是忙的
  const [忙, set忙] = useState(true);
  const [错, set错] = useState<string | null>(null);
  // 快速换筛选时只认最后一次的回包
  const 第几次 = useRef(0);
  /** 原筛 = 换筛选前那个：这次没取成就把「筛」退回去（列表还是原来那一类的），再报没取成 */
  const 取 = useCallback(async (这筛: 历史筛选, 游标: 历史游标 | null, 原筛?: 历史筛选) => {
    const 次 = ++第几次.current;
    const 没取成 = (话: string) => {
      if (原筛) { set筛(原筛); set错(`没换成「${这筛}」，还是看「${原筛}」：${话}`); }
      else set错(话);
    };
    try {
      const r = await 读客户历史(customerId, 这筛, 游标);
      if (次 !== 第几次.current) return;
      if (!r.ok) { 没取成(r.error); return; }
      set数据((旧) => (游标 && 旧 ? { 建档: 旧.建档, 行们: 接上(旧.行们, r.行们), 更早: r.更早 } : { 建档: r.建档 ?? 旧?.建档 ?? null, 行们: r.行们, 更早: r.更早 }));
    } catch (e) {
      if (次 === 第几次.current) 没取成(动作出错话(e, 读不到话));
    } finally {
      if (次 === 第几次.current) set忙(false);
    }
  }, [customerId]);
  // 打开时取第一页（「全部」）；之后换筛选、往下翻都在点的那一下取
  useEffect(() => {
    const 次 = ++第几次.current;
    读客户历史(customerId, "全部", null).then((r) => {
      if (次 !== 第几次.current) return;
      if (!r.ok) set错(r.error);
      else set数据({ 建档: r.建档, 行们: r.行们, 更早: r.更早 });
      set忙(false);
    }).catch((e) => {
      if (次 !== 第几次.current) return;
      set错(动作出错话(e, 读不到话));
      set忙(false);
    });
  }, [customerId]);
  const 换筛 = (t: 历史筛选) => {
    if (t === 筛) return;
    const 原 = 筛;
    set筛(t); set忙(true); set错(null);
    void 取(t, null, 原);
  };
  const 往下 = () => {
    if (!数据?.更早) return;
    set忙(true); set错(null);
    void 取(筛, 数据.更早);
  };
  return (
    <>
      {数据?.建档 && <BornCell 格={数据.建档} />}
      <div className="hist-flt" role="group" aria-label="按类型看">
        {历史筛选们.filter((t) => 有状态 || t !== "状态").map((t) => (
          <button key={t} type="button" aria-pressed={筛 === t} onClick={() => 换筛(t)}>{t}</button>
        ))}
      </div>
      <Timeline 数据={数据} 忙={忙} 错={错} 空话={筛 === "全部" ? "还没有变更记录" : "这一类还没有变更"} 更早={往下} />
    </>
  );
}

function ProjectsPanel({ customerId, 当前项目 }: { customerId: string; 当前项目: string | null }) {
  const [概要, set概要] = useState<{ 项目们: 项目概要[]; 看不到: number } | null>(null);
  const [各, set各] = useState<Record<string, 一列>>({});
  const [开着, set开着] = useState<Set<string>>(new Set());
  const [忙于, set忙于] = useState<Set<string>>(new Set());
  const [错, set错] = useState<string | null>(null);
  const [项目错, set项目错] = useState<Record<string, string>>({});
  useEffect(() => {
    let 还在 = true;
    读项目历史们(customerId, 当前项目).then((r) => {
      if (!还在) return;
      if (!r.ok) { set错(r.error); return; }
      set概要({ 项目们: r.项目们, 看不到: r.看不到 });
      if (r.展开) {
        const { id, ...列 } = r.展开;
        set各({ [id]: 列 });
        set开着(new Set([id]));
      }
    }).catch((e) => { if (还在) set错(动作出错话(e, 读不到话)); });
    return () => { 还在 = false; };
  }, [customerId, 当前项目]);
  const 取 = async (id: string, 游标: 历史游标 | null) => {
    set忙于((s) => new Set(s).add(id));
    set项目错((m) => { const { [id]: _, ...余 } = m; return 余; });
    try {
      const r = await 读项目历史(customerId, id, 游标);
      if (!r.ok) { set项目错((m) => ({ ...m, [id]: r.error })); return; }
      set各((m) => {
        const 旧 = m[id];
        return { ...m, [id]: 游标 && 旧 ? { 建档: 旧.建档, 行们: 接上(旧.行们, r.行们), 更早: r.更早 } : { 建档: r.建档, 行们: r.行们, 更早: r.更早 } };
      });
    } catch (e) {
      set项目错((m) => ({ ...m, [id]: 动作出错话(e, 读不到话) }));
    } finally {
      set忙于((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  };
  const 切 = (id: string) => {
    const 开 = !开着.has(id);
    set开着((s) => { const n = new Set(s); if (开) n.add(id); else n.delete(id); return n; });
    if (开 && !各[id] && !忙于.has(id)) void 取(id, null);
  };
  if (错) return <p role="alert" className="hist-err">{错}</p>;
  if (!概要) return <p className="hist-empty" aria-live="polite">正在读取…</p>;
  return (
    <>
      {概要.项目们.length === 0 && !概要.看不到 && <p className="hist-empty">这位客户名下还没有项目</p>}
      {概要.项目们.map((p) => {
        const 开 = 开着.has(p.id);
        const 列 = 各[p.id];
        return (
          <section key={p.id} className="hist-sec" data-open={开} data-testid="history-project">
            <button type="button" className="hist-sec-h" aria-expanded={开} aria-controls={`hist-sec-${p.id}`} onClick={() => 切(p.id)}>
              <span className="hist-sec-n" title={p.名}>{p.名}</span>
              <span className="hist-sec-sub" title={p.阶段}>{p.阶段}{p.id === 当前项目 ? " · 当前项目" : ""}</span>
              <span className="hist-sec-c">{p.条数} 条</span>
              {开 ? <DownOutlined className="hist-car" aria-hidden /> : <RightOutlined className="hist-car" aria-hidden />}
            </button>
            {开 && (
              <div className="hist-sec-b" id={`hist-sec-${p.id}`}>
                {列?.建档 && <BornCell 格={列.建档} />}
                <Timeline 数据={列 ?? null} 忙={忙于.has(p.id)} 错={项目错[p.id] ?? null} 空话="这个项目还没有变更" 更早={() => 列?.更早 && void 取(p.id, 列.更早)} />
              </div>
            )}
          </section>
        );
      })}
      {概要.看不到 > 0 && <p className="hist-lock" data-testid="history-hidden">还有 {概要.看不到} 个同事在推的项目你看不到，变更不显示。</p>}
    </>
  );
}

function BornCell({ 格 }: { 格: 建档格 }) {
  const 行们 = [{ 键: "建档时间", 值: fmtDateTime(格.时间) }, ...格.行们];
  return (
    <div className="hist-born-w">
      <p className="hist-born-t">建档</p>
      <dl className="hist-born">
        {行们.map((r) => (
          <div key={r.键} className="hist-born-r">
            <dt>{r.键}</dt>
            <dd title={r.值}>{r.值}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 某一天的叫法：今天 / 昨天 / 11 月 22 日 / 跨年带年份（同全站相对时间写法） */
function 日标(at: string): string {
  const t = dayjs(at), now = dayjs();
  if (t.isSame(now, "day")) return "今天";
  if (t.isSame(now.subtract(1, "day"), "day")) return "昨天";
  return t.isSame(now, "year") ? t.format("M 月 D 日") : t.format("YYYY 年 M 月 D 日");
}
const 标色: Record<string, string> = { 负责人: "own", 公海: "own", 转让: "own", 领取: "own", 状态: "st", 节点: "node", 线索验证: "node" };

function Timeline({ 数据, 忙, 错, 空话, 更早 }: { 数据: 一列 | null; 忙: boolean; 错: string | null; 空话: string; 更早: () => void }) {
  const [开的批, set开的批] = useState<Set<string>>(new Set());
  if (!数据) return 错 ? <p role="alert" className="hist-err">{错}</p> : <p className="hist-empty" aria-live="polite">正在读取…</p>;
  let 上一天 = "";
  const 块: React.ReactNode[] = [];
  for (const r of 数据.行们) {
    const at = r.种 === "事件" ? r.事件.at : r.事件们[0].at;
    const 天 = dayjs(at).format("YYYY-MM-DD");
    if (天 !== 上一天) { 块.push(<p key={`d-${天}-${块.length}`} className="hist-day">{日标(at)}</p>); 上一天 = 天; }
    if (r.种 === "事件") { 块.push(<EventRow key={r.事件.id} e={r.事件} />); continue; }
    const 开 = 开的批.has(r.键);
    const 话 = `系统批量修正 ${r.事件们.length} 处：${r.说明}`;
    块.push(
      <div key={`b-${r.键}`} className="hist-fold-w">
        <button type="button" className="hist-fold" aria-expanded={开} title={话} data-testid="history-batch"
          onClick={() => set开的批((s) => { const n = new Set(s); if (开) n.delete(r.键); else n.add(r.键); return n; })}>
          {开 ? <DownOutlined className="hist-car" aria-hidden /> : <RightOutlined className="hist-car" aria-hidden />}
          <span className="hist-fold-t">{话}</span>
        </button>
        {开 && <div className="hist-fold-b">{r.事件们.map((e) => <EventRow key={e.id} e={e} />)}</div>}
      </div>,
    );
  }
  return (
    <div className="hist-tl">
      {块.length ? 块 : !忙 && !错 && <p className="hist-empty">{空话}</p>}
      {错 && <p role="alert" className="hist-err">{错}</p>}
      {数据.更早 && (
        <button type="button" className="hist-more" disabled={忙} onClick={更早}>{忙 ? "正在读取…" : "更早的"} {!忙 && <DownOutlined aria-hidden />}</button>
      )}
    </div>
  );
}

function EventRow({ e }: { e: 历史事件 }) {
  return (
    <div className="hist-ev" data-testid="history-event">
      <span className="hist-ev-tm" title={fmtDateTime(e.at)}>{dayjs(e.at).format("HH:mm")}</span>
      <span className={`hist-ev-k${标色[e.标] ? ` is-${标色[e.标]}` : ""}`}>{e.标}</span>
      <span className="hist-ev-w">
        <span className="hist-ev-l" title={`${e.文} · ${e.谁}`}>{e.文} <span className="hist-ev-by">· {e.谁}</span></span>
        {e.因.map((x, i) => <span key={i} className="hist-ev-why" title={x}>{x}</span>)}
      </span>
    </div>
  );
}
