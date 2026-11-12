"use client";
import { dayjs } from "@/lib/utils";
import Shortcut from "./Shortcut";

import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Tag, Drawer } from "antd";
import { SearchOutlined, TableOutlined } from "@ant-design/icons";
import { FOLLOW_STATUS_COLOR } from "@/lib/constants";
import { 名单分组, 客户状态分组, 未填写组 } from "@/lib/roster-groups";
import { 客户状态色 } from "@/lib/enterprise/cust-status-color";
import { avatarColor, initial, smartTime, AVATAR_TEXT } from "@/lib/utils";
import { useBusiness } from "@/lib/business-client";
import { statusLabel } from "@/lib/business-config";
import { 开名单, 关名单, 登记换一位, DockOpenContext, DOCK_W } from "@/lib/roster";
import { 名单回车去处 } from "@/lib/cmdk";
import { useMiddlePane, usePaneShortcut } from "@/lib/middle-pane";
import PaneToggle from "@/components/PaneToggle";
import { useLocalPref } from "@/lib/local-pref";
import { RowLink } from "@/components/ui";
import { 名单可到, 名单宽变量, 名单默认宽, 名单最窄, 夹名单宽, 存名单宽, 读名单宽 } from "@/lib/roster-width";

export type CustomerRosterData = {
  total: number;
  rows: {
    id: string;
    name: string;
    followStatus: string;
    /** 企业版客户状态（字典 custStatus）；别的版本不给 */
    custStatus?: string | null;
    lastFollowAt: string | null;
    ownerName: string;
    lastNote: string | null;
    /** 我名下的（「我的」页签） */
    mine?: boolean;
    /** 卡片第一行：桌面端是从哪儿来（渠道 / 转介绍 / 最近一次怎么联系的）；企业版是客户所在国家地区（11-04），见 @pane/panes.tsx */
    source?: string | null;
    /** 最近一条还没做的计划：「本周要跟」和右下角圆点看它 */
    nextPlanAt?: string | null;
  }[];
  /**
   * 「我的」页签：自己负责的最近 50 位，另取（不是从 rows 那 50 位里再筛，11-11 实点：「全部」都是别人的时「我的」成了空的）。
   * 不给就照旧从 rows 里筛 mine
   */
  mineRows?: CustomerRosterData["rows"];
  /**
   * 企业版：按客户状态分组（10-29）。顺序 = 字典里启用的几项按字典排，颜色按字典项给（lib/enterprise/cust-status-color.ts）。
   * 别的版本不给，照旧按跟进状态分
   */
  客户状态?: { 顺序: string[]; 颜色: Record<string, string> } | null;
};

/** 名单里搜：不分大小写，英文名搜「john」也得找到「John」（第六轮疑似） */
function 搜名单(xs: CustomerRosterData["rows"], q: string) {
  const k = q.trim().toLowerCase();
  return xs.filter((r) => !k || r.name.toLowerCase().includes(k) || (r.lastNote ?? "").toLowerCase().includes(k));
}

/**
 * 记录页左边的窄名单：最近跟进过的 50 位，点一行就换人看。
 *
 * **它只在记录页出现，列表页没有**（批 2）。列表页已经是一张全宽的表，
 * 旁边再挂一条同样内容的名单，是把同一件事画两遍；而记录页缺的恰恰是
 * 「换一个人」这条路——原来从林夏切到陈航要退回列表再进去。
 *
 * 窄到放不下（或人自己点了收起）时它收成抽屉，由记录页页头最左边那颗侧栏图标开（见 lib/middle-pane.ts）：
 * 名单 220 + 档案 264 + 时间线 + AI 340 在 164 的左栏旁边，1440 是下限。
 *
 * 只装最近 50 位；搜索和状态筛选在这 50 位里做，要翻全量按回车去表格。
 */
export default function CustomerRoster({ data }: { data: CustomerRosterData }) {
  const b = useBusiness();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  // 窗口太窄、或者人自己点了收起：名单收成抽屉（lib/middle-pane.ts）
  const 中栏 = useMiddlePane("roster");
  const 抽屉里 = !中栏.露着;
  const 抽屉开着 = 中栏.抽屉开着;
  usePaneShortcut(中栏.切换);
  const 搜索框 = useRef<HTMLInputElement>(null);
  const activeId = pathname.startsWith("/customers/") ? pathname.split("/")[2] : "";

  const rows = useMemo(() => 搜名单(data.rows, q), [data.rows, q]);
  const 我的rows = useMemo(() => (data.mineRows ? 搜名单(data.mineRows, q) : null), [data.mineRows, q]);

  /*
    按跟进状态分组、组可以折叠（2026-10-02，学 MonoCode 的会话列表）：50 位挤成一列时，
    「哪些人在谈、哪些人睡着了」得一位位看标签才分得出；分了组，组头带人数，不想看的那组一收。
    只在没搜、没筛的时候分组——搜和筛本身就是在挑人，再分组是叠床架屋。折叠记在这台电脑上。
  */
  const [收起的, set收起的] = useLocalPref<string[]>("roster.collapsed", []);
  /*
    页签（照毛玻璃原型）：全部 / 我的 / 本周要跟。「我的」只在名单里真有别人的客户时才出现——
    桌面端就你一个人，「全部」和「我的」是同一张单子，摆两个一样的页签是让人找不同。
    「本周要跟」= 计划排在七天之内的，已经过期没做的也算（那更该跟）。
  */
  const [页签, set页签] = useState<"全部" | "我的" | "本周">("全部");
  const 有别人的 = data.rows.some((r) => r.mine === false);
  const 七天后 = dayjs().add(7, "day").endOf("day");
  const 当前页签 = 页签 === "我的" && !有别人的 ? "全部" : 页签;
  const 页签里 = useMemo(
    () =>
      当前页签 === "我的" && 我的rows
        ? 我的rows
        : rows.filter((r) =>
            当前页签 === "我的" ? r.mine !== false : 当前页签 === "本周" ? Boolean(r.nextPlanAt && dayjs(r.nextPlanAt).isBefore(七天后)) : true,
          ),
    // 七天后 每次渲染都新算，按天变就够了，不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, 我的rows, 当前页签],
  );
  const 分组 = !q.trim();
  // 分组规则在 lib/roster-groups.ts：预设外的单独成组、空串归「未填写」，一个人都不能消失（2026-10-04 L-072）
  const 按客户状态 = data.客户状态 ?? null;
  const 组们 = useMemo(() => (按客户状态 ? 客户状态分组(页签里, 按客户状态.顺序) : 名单分组(页签里)), [页签里, 按客户状态]);
  /** 行上标签、组头说的那个状态：企业版是客户状态，别的版本是跟进状态（按业务叫法） */
  const 状态名 = (s: string) => (按客户状态 ? s : statusLabel(b, s));
  const 状态色 = (s: string) =>
    按客户状态 ? (按客户状态.颜色[s] ?? (s === 未填写组 ? "default" : 客户状态色({ name: s }))) : (FOLLOW_STATUS_COLOR[s] ?? "default");
  const 切组 = (s: string) => set收起的(收起的.includes(s) ? 收起的.filter((x) => x !== s) : [...收起的, s]);


  /**
   * ⌘K：光标进搜索框（窄屏时先把抽屉打开）。记录页上「换一个人」是最常用的动作，值得一个快捷键。
   * 键本身由 CommandBar 听，这里只登记「⌘K 在这一页是什么意思」（lib/roster.ts 的 登记换一位，审查 M8）
   */
  useEffect(
    () =>
      登记换一位(() => {
        if (抽屉里) return 开名单();
        搜索框.current?.focus();
        搜索框.current?.select();
      }),
    [抽屉里],
  );

  // 抽屉一打开就把光标放进搜索框——打开它就是为了找人
  useEffect(() => {
    if (抽屉开着) setTimeout(() => 搜索框.current?.focus(), 80);
  }, [抽屉开着]);

  /**
   * 一行三层（照毛玻璃原型）：从哪儿来 · 时间 / 名字 / 最近一句 · 圆点。
   * 圆点只有三种：橙 = 计划到期了（今天或更早），灰 = 一个月没动静，绿 = 正常。
   * 分组时状态已经写在组头上，行里不再挂标签；搜索时没有组头，标签补回来。
   */
  const 今天末 = dayjs().endOf("day");
  const 点 = (r: CustomerRosterData["rows"][number]) =>
    r.nextPlanAt && dayjs(r.nextPlanAt).isBefore(今天末)
      ? { cls: "due", 说: "计划的跟进到期了" }
      : !r.lastFollowAt || dayjs().diff(dayjs(r.lastFollowAt), "day") >= 30
        ? { cls: "cold", 说: "一个月没跟进了" }
        : { cls: "ok", 说: "最近跟进过" };
  const 行状态 = (r: CustomerRosterData["rows"][number]) => (按客户状态 ? r.custStatus : r.followStatus)?.trim() || 未填写组;
  const 一行 = (r: CustomerRosterData["rows"][number], 带状态: boolean) => {
    const d = 点(r);
    return (
      <RowLink
        key={r.id}
        href={`/customers/${r.id}`}
        className={`roster-row${activeId === r.id ? " on" : ""}`}
        onClick={() => 抽屉开着 && 关名单()}
      >
        <span className="roster-av" style={{ background: avatarColor(r.name), color: AVATAR_TEXT }}>
          {initial(r.name)}
        </span>
        <span className="roster-m">
          <span className="roster-l0">
            <span className="roster-src" title={r.source ?? undefined}>
              {带状态 && (
                <Tag color={状态色(行状态(r))} style={{ margin: "0 6px 0 0", fontSize: 12, lineHeight: "18px", padding: "0 5px" }}>
                  {状态名(行状态(r))}
                </Tag>
              )}
              {r.source ?? ""}
            </span>
            <span className="roster-t">{r.lastFollowAt ? smartTime(r.lastFollowAt) : ""}</span>
          </span>
          <span className="roster-n">{r.name}</span>
          <span className="roster-l2">
            {/* 名字一行、放不下省略号，悬停看全（11-04）；最近一句是辅助，最多两行 */}
            <span className="roster-note" title={r.lastNote ?? undefined}>{r.lastNote ?? `还没跟进 · ${r.ownerName}`}</span>
            <span className={`roster-dot ${d.cls}`} title={d.说} aria-label={d.说} />
          </span>
        </span>
      </RowLink>
    );
  };

  const 内容 = (
    <>
      <div className="pane-h">
        <span className="pane-t">
          {b.customer}
          <span className="pane-n">{data.total}</span>
        </span>
        <Link href="/customers" className="pane-ib" aria-label={`${b.customer}表格`} title="表格视图">
          <TableOutlined />
        </Link>
        <PaneToggle 栏="roster" 位置="中栏" />
      </div>
      <div className="roster-tabs" role="tablist" aria-label={`${b.customer}名单`}>
        {(有别人的 ? (["全部", "我的", "本周"] as const) : (["全部", "本周"] as const)).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={当前页签 === t} className={`roster-tab${当前页签 === t ? " on" : ""}`} onClick={() => set页签(t)}>
            {t === "本周" ? "本周要跟" : t}
          </button>
        ))}
      </div>
      <div className="pane-search">
        <SearchOutlined style={{ color: "var(--text-muted)" }} />
        <input
          ref={搜索框}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜姓名、最近一句"
          aria-label={`搜索${b.customer}`}
          onKeyDown={(e) => {
            // 回车：搜出来的第一位直接进（11-03 C1-2）；名单里一位都没有的，去全量表格里搜（lib/cmdk.ts）
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            const 去 = 名单回车去处(q, 页签里, rows.length, "/customers");
            if (!去) return;
            e.preventDefault();
            if (抽屉开着) 关名单();
            router.push(去);
          }}
        />
        <kbd className="pane-kbd"><Shortcut>⌘K</Shortcut></kbd>
      </div>
      {/* 原来这里有一排状态筛选（全部 / 待跟进 / 跟进中…）。分组以后它和组头说的是同一件事，
          想只看一种就把别的组收起来——同一个功能摆两套入口是在让人选一个不存在的区别（2026-10-02） */}
      <div className="pane-rows">
        {页签里.length === 0 && (
          <div className="pane-empty">
            {q
              ? "这 50 位里没有，回车去全量里搜"
              : 当前页签 === "本周"
                ? "这一周没有排好的跟进"
                : 当前页签 === "我的"
                  ? `名下还没有${b.customer}`
                  : /* 一条都没有 ≠ 搜完没有。空库时说「没搜到」是句错话 */
                    `还没有${b.customer}`}
          </div>
        )}
        {分组
          ? 组们.map((g) => {
              const 开 = !收起的.includes(g.s);
              return (
                <div key={g.s} className="roster-group">
                  <button type="button" className="roster-sec" aria-expanded={开} onClick={() => 切组(g.s)}>
                    <span className="roster-car" aria-hidden="true">▾</span>
                    {状态名(g.s)}
                    <span className="roster-cnt">{g.rows.length}</span>
                  </button>
                  {开 && g.rows.map((r) => 一行(r, false))}
                </div>
              );
            })
          : 页签里.map((r) => 一行(r, true))}
        {data.total > data.rows.length && (
          <Link href="/customers" className="pane-more">
            这里只有最近 {data.rows.length} 位，全部 {data.total} 位在表格里 ›
          </Link>
        )}
      </div>
    </>
  );

  if (抽屉里) {
    return (
      <Drawer
        placement="left"
        open={抽屉开着}
        onClose={关名单}
        closable={false}
        /* antd 6 里 Drawer 的 width 废了，宽度改在 wrapper 上给 */
        styles={{ wrapper: { width: 300 }, body: { padding: 0, display: "flex", flexDirection: "column" } }}
        rootClassName="pane-drawer"
      >
        {内容}
      </Drawer>
    );
  }

  return (
    <aside className="pane pane-roster pane-roster-cust">
      {内容}
      <RosterResizer />
    </aside>
  );
}

/** 服务端没有 layout 阶段，退回 useEffect（只为不报警告；宽度首帧前已由 外观预设脚本 挂好） */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * 名单右边缘的拖条（11-12 用户「这一栏要可调节宽度」）：悬停出一道细高亮线、光标 col-resize；
 * 拖动实时改 <html> 上的 --roster-cust-w，松手存 localStorage；双击回默认；
 * 键盘：聚焦后左右键每次 16px、Home / End 到最窄 / 最宽。最宽随窗口收紧（lib/roster-width.ts 名单可到）。
 * 用 pointer capture：拖出名单、拖过卡片 / iframe 也收得到松手；拖的时候整页不选字。名单收成抽屉时不摆它
 */
function RosterResizer() {
  const [宽, set宽] = useState(名单默认宽);
  const [上限, set上限] = useState(420);
  const 拖 = useRef<{ x: number; w: number; id: number } | null>(null);
  const 挂 = (w: number) => document.documentElement.style.setProperty(名单宽变量, `${w}px`);
  // 右边 AI 面板开着时正文少了 DOCK_W：上限一起扣掉（CSS .shell-dock-open 下的 max-width 同样收紧）
  const 面板开着 = useContext(DockOpenContext);
  const 量上限 = () => 名单可到(window.innerWidth - (面板开着 ? DOCK_W : 0), document.querySelector(".rail")?.getBoundingClientRect().width ?? 0);
  // 拖到一半名单被卸掉（切页、收成抽屉）：别把整页的 col-resize 光标、禁选字留在 <html> 上
  useEffect(() => () => document.documentElement.classList.remove("roster-resizing"), []);
  useIsoLayoutEffect(() => {
    const 量 = () => {
      const 顶 = 量上限();
      set上限(顶);
      const w = 夹名单宽(读名单宽(), 顶);
      set宽(w);
      挂(w);
    };
    量();
    window.addEventListener("resize", 量);
    return () => window.removeEventListener("resize", 量);
    // 量上限 读的是这一轮的 面板开着；面板开合时重量一次
  }, [面板开着]);
  const 定 = (w: number, 存 = true) => {
    const v = 夹名单宽(w, 上限);
    set宽(v);
    挂(v);
    if (存) 存名单宽(v);
  };
  const 按下 = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    拖.current = { x: e.clientX, w: 宽, id: e.pointerId };
    document.documentElement.classList.add("roster-resizing");
  };
  const 移 = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = 拖.current;
    if (!d || d.id !== e.pointerId) return;
    定(d.w + e.clientX - d.x, false);
  };
  const 松 = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = 拖.current;
    if (!d || d.id !== e.pointerId) return;
    拖.current = null;
    document.documentElement.classList.remove("roster-resizing");
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    定(d.w + e.clientX - d.x);
  };
  const 键 = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const 到 = e.key === "ArrowLeft" ? 宽 - 16 : e.key === "ArrowRight" ? 宽 + 16 : e.key === "Home" ? 名单最窄 : e.key === "End" ? 上限 : null;
    if (到 == null) return;
    e.preventDefault();
    定(到);
  };
  return (
    <div
      className="pane-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="调整客户名单宽度"
      title="拖动调整宽度，双击恢复默认"
      aria-valuenow={宽}
      aria-valuemin={名单最窄}
      aria-valuemax={上限}
      tabIndex={0}
      onPointerDown={按下}
      onPointerMove={移}
      onPointerUp={松}
      onPointerCancel={松}
      onDoubleClick={() => 定(名单默认宽)}
      onKeyDown={键}
    />
  );
}
