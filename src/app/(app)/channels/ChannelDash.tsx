"use client";

/**
 * 渠道页的总览看板（11-03，企业版）：摆在筛选栏和列表之间，渠道们 = 列表筛出来的那一批（同一个 筛渠道()），
 * 右上角切 本月 / 本季 / 全部 / 自定义。数怎么算全在 lib/enterprise/channel-dash.ts，这里只摆。
 * 三个预设三份底数都在手上，切了不回服务端；「自定义」写地址栏 view=自定义&from=&to=（读法同数据页，lib/custom-date-range.ts），
 * 服务端按那一段多算一份。市场成员 / 市场管理多一段「进公海」（P-界面-09），只读、不跳公海。
 * 颜色都取主题变量；字一律正文色 / 次要色，不拿系列色写字。
 */
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Segmented, Tooltip } from "antd";
import { 合计文字, 合计缩写 } from "@/lib/currency";
import CustomRangePicker from "@/components/CustomRangePicker";
import { 读日期段, type 日期段 } from "@/lib/custom-date-range";
import { beijingDay } from "@/lib/business-clock";
import {
  周期们, 周期起点, 算看板, 判够占比, 预警线索下限, 自定义, 算进公海, 进公海明细, 原因最多, 看板时段, 榜链接, 榜最多,
  type 档, type 看板底数, type 看板渠道, type 看板公海,
} from "@/lib/enterprise/channel-dash";
import { 名单段 } from "@/lib/enterprise/channel-stats";
import Link from "next/link";
import { LinkPending } from "@/components/NavProgress";
import { RosterNote } from "./RosterNote";
import CountUp from "@/components/CountUp";
import Skeleton from "@/components/Skeleton";
import FilterSelect from "@/components/FilterSelect";

/** 一位小数的百分比；算不了是「—」 */
function 百分(r: number | null): string {
  if (r == null) return "—";
  if (r > 0 && r < 0.001) return "<0.1%";
  return `${(Math.round(r * 1000) / 10).toLocaleString("zh-CN")}%`;
}
const 数 = (n: number) => n.toLocaleString("zh-CN");
/** ch.dash：换周期数字从旧值滚到新值（CountUp 只滚变化：第一次直接是数，不从 0 滚） */
const 滚数 = (值: number, 记号: string) => <CountUp 值={值} 记号={`ch-dash:${记号}`} 格式={(n) => 数(Math.round(n))} 只滚变化 />;
/** 上一层到这一层少了多少（比例超过 1 就是多了） */
const 差 = (r: number | null) => (r == null ? "—" : r > 1 ? `+${百分(r - 1)}` : `−${百分(1 - r)}`);

/** 环形图各段的颜色类（globals.css .chan-c0…3 = 主题变量 --brand / --cat-green / --cat-amber / --cat-violet），超出的并成「其他」用浅色 .chan-c-other */
const 环色数 = 4;
const 环类 = (名: string, i: number) => (名 === "其他" ? "chan-c-other" : `chan-c${i % 环色数}`);
/** 条宽按 5% 一档给类（.chan-w0…100），不写行内样式 */
const 宽类 = (比: number) => `chan-w${Math.min(100, Math.max(比 > 0 ? 5 : 0, Math.round(比 * 20) * 5))}`;
/**
 * 金额窄格（设计语言 D39）：缩写，每个币种一段不拆行；全值用 Tooltip（悬停、触屏点按都出，规范「悬停 / 长按看全值」），
 * 不只靠 title（触屏看不到）。触发用 hover + focus，不用 click：触屏按下时 pointerenter 延时打开、抬起后的 click 又切回关（闪一下就没）；
 * 格子有 tabIndex=0，点按即聚焦、点别处失焦才收
 */
const 缩写格 = (合计: { 币种: string; 合计: number }[]) => (
  <Tooltip title={合计文字(合计)} trigger={["hover", "focus"]}>
    <span className="chan-dash-kv chan-dash-kv-tip" tabIndex={0} aria-label={合计文字(合计)}>{缩写段(合计)}</span>
  </Tooltip>
);
/** 金额窄格：缩写，每个币种一段不拆行 */
const 缩写段 = (合计: { 币种: string; 合计: number }[]) =>
  合计缩写(合计).split(" · ").map((x, i) => <span key={i} className="chan-amt">{i ? " · " : ""}{x}</span>);

export default function ChannelDash({
  渠道们,
  底数,
  段 = null,
  期: 外期,
  改期,
  改忙,
  公海 = null,
  筛了负责人,
  能录,
  看详情,
  口径,
}: {
  渠道们: 看板渠道[];
  底数: 看板底数;
  /** 地址栏带着「自定义」时服务端读好的那一段；null = 没选自定义 */
  段?: 日期段 | null;
  /** 当前档由外面管（2D：渠道列表的统计跟看板同一档）；不给就自己管（老用法、单测） */
  期?: 档;
  改期?: (v: 档) => void;
  /** 地址栏在换（自定义那一段服务端现算）时告诉外面，列表一起出骨架（2D） */
  改忙?: (忙: boolean) => void;
  /** 进公海那段（只给市场成员 / 市场管理）；null 不摆 */
  公海?: 看板公海 | null;
  筛了负责人: boolean;
  能录: boolean;
  看详情: (id: string, 录?: boolean) => void;
  /** 「按子渠道 / 按主渠道」口径切换摆进看板头（设计语言 C-A1 C-新1）；不给就不摆 */
  口径?: ReactNode;
}) {
  // 窄屏（看板宽 ≤560）：次要卡默认收成卡头一行，把列表提上来（C-新4）；宽屏不收（钮也不出，见 globals.css）
  const [展开, set展开] = useState<Record<string, boolean>>({});
  const 收类 = (名: string) => (!展开[名] ? " is-fold" : "");
  const 收钮 = (名: string, 标: string) => (
    <button type="button" className="chan-fold" aria-expanded={!!展开[名]} aria-label={`${展开[名] ? "收起" : "展开"}${标}`} onClick={() => set展开((x) => ({ ...x, [名]: !x[名] }))}>
      {展开[名] ? "收起" : "展开"}
    </button>
  );
  const router = useRouter();
  const 路径 = usePathname();
  const 参数 = useSearchParams();
  const [换着, start] = useTransition();
  useEffect(() => { 改忙?.(换着); }, [换着, 改忙]);
  const [内期, set内期] = useState<档>(段 ? 自定义 : "全部");
  const 期 = 外期 ?? 内期;
  const set期 = 改期 ?? set内期;
  // 刚点「自定义」、那一份还在路上：先摆本月 1 号到今天（同服务端默认），数先空着、看板压暗
  const 显段 = 段 ?? 读日期段();
  const 期底 = useMemo(() => (期 === 自定义 ? 底数.自定义 ?? {} : 底数[期]), [期, 底数]);
  const k = useMemo(() => 算看板(渠道们, 期底, 筛了负责人), [渠道们, 期底, 筛了负责人]);
  const 起 = 期 === 自定义 ? null : 周期起点(期, new Date());
  const 等自定义 = 期 === 自定义 && 换着;
  /** 改地址栏的 view / from / to，别的参数原样留着；不滚动、不进历史 */
  const 写地址 = (改: { view?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams(参数.toString());
    for (const key of ["view", "from", "to"] as const) {
      const v = 改[key];
      if (v) q.set(key, v);
      else q.delete(key);
    }
    const qs = q.toString();
    start(() => router.replace(qs ? `${路径}?${qs}` : 路径, { scroll: false }));
  };
  const 换档 = (v: 档) => {
    set期(v);
    if (v === 自定义) 写地址({ view: 自定义, from: 显段.from, to: 显段.to });
    // 回到预设：去掉地址栏的那一段（预设三份本来就在手上，不用等服务端）
    else if (参数.get("view")) 写地址({});
  };
  const [创建人, set创建人] = useState("");
  const 进公海们 = useMemo(
    () => (公海 ? 算进公海(渠道们, 期 === 自定义 ? 公海.底[自定义] : 公海.底[期], 创建人) : []),
    [公海, 渠道们, 期, 创建人],
  );
  const 进合计 = 进公海们.reduce((s, r) => s + r.进, 0);
  const 转商机分母 = k.转商机.分母 === "有效线索" ? "到商机 ÷ 有效线索" : "到商机 ÷ 线索";
  const 投入空 = k.投入.length === 0;
  const 环合计 = k.环?.段.reduce((s, x) => s + x.数, 0) ?? 0;
  const 榜顶 = k.榜[0]?.线索 ?? 0;
  // 线索榜默认 TOP5，「展开全部」摆这一档、这批渠道（看得到的范围）里有新线索的全部渠道（员工反馈 #5）；切档不收起
  const [榜全开, set榜全开] = useState(false);
  const 榜能展开 = k.榜.length > 榜最多;
  const 榜摆 = 榜全开 && 榜能展开 ? k.榜 : k.榜.slice(0, 榜最多);
  // TOP5 点进去带的创建时间段（北京日）：和这一档数线索的那一段一样
  const 时段 = 看板时段(期, new Date(), 显段);
  /** 卡片上「含公海 M 条」：带了名单才写数，没带只写口径 */
  const 含公海 = (m: number | undefined) => (m === undefined ? "含公海" : `含公海 ${数(m)} 条`);

  // 右侧写到这一层的转化率（P-渠道-19/20/21，和 KPI、三层转化率同一个数），流失率进悬停（C-新2）；比例算法不动
  const 漏斗 = [
    { 名: "总线索", 值: 数(k.线索), 旁: null as string | null, 说: null as string | null, 比: null as number | null },
    { 名: "有效线索", 值: k.已判定 ? 数(k.有效) : "—", 旁: `有效率 ${百分(k.有效率)}`, 说: `有效线索 ÷ 已判定（已判定 ${数(k.已判定)} 条）`, 比: k.已判定 ? k.有效率 : null },
    { 名: "商机", 值: 数(k.商机), 旁: 差(k.转商机.比例), 说: `按 ${转商机分母} 算，只看从线索起步的（导入时就是商机、订单的不算）`, 比: k.转商机.比例 },
    { 名: "订单", 值: 数(k.订单), 旁: 差(k.转订单), 说: "按 订单 ÷ 商机 算", 比: k.转订单 },
  ];
  const 预警头数 = k.预警.length ? <span className="chan-count">（{k.预警.length}）</span> : null;
  const 时段钮 = (
    <>
      <Segmented size="small" value={期} onChange={(v) => 换档(v as 档)} options={[...周期们, 自定义]} aria-label="统计周期" />
      {期 === 自定义 && <CustomRangePicker size="small" 段={显段} 改={(d) => 写地址({ view: 自定义, from: d.from, to: d.to })} />}
    </>
  );
  const 说明 = (
    <span className="chan-dash-hint">
      按筛选出的 {k.渠道数} 个渠道算{起 ? ` · ${beijingDay(起)} 起` : ""}
    </span>
  );

  return (
    <section className={`chan-dash${换着 ? " chan-dash-busy" : ""}`} aria-label="渠道总览" aria-busy={换着 || undefined}>
      {/* 小节头一行「总览 · 口径 · 时段」+ 右侧「按筛选出的 N 个渠道算」（C2，C-新1） */}
      <div className="chan-dash-bar">
        <span className="chan-dash-when">
          <h2 className="chan-dash-title">总览</h2>
          {口径}
          {时段钮}
        </span>
        {说明}
      </div>

      {/* ch.dash：自定义那一段还在路上（服务端现算）先出骨架，不拿旧数压暗了冒充；三个预设本来就在手上，切了直接滚 */}
      {等自定义 ? (
        <Skeleton 行={5} 高={16} 说法="正在算这一段" className="ch-dash-skel" />
      ) : (
      <>
      <div className="chan-dash-kpi">
        <div className="chan-dash-k">
          <span className="chan-dash-kk">总线索</span>
          <span className="chan-dash-kv">{滚数(k.线索, "线索")}</span>
          {/* 跨渠道的合计：项目列表按渠道只能单选，只带时间段的链接会混进别的渠道、没渠道的项目，所以这里不链（TOP5 每行能点） */}
          <span className="chan-dash-ks">按项目创建时间，{含公海(k.公海?.线索)}</span>
        </div>
        <div className="chan-dash-k">
          <span className="chan-dash-kk">MQL 有效线索</span>
          <span className="chan-dash-kv">{k.已判定 ? 滚数(k.有效, "有效") : "—"}</span>
          <span className="chan-dash-ks">{k.已判定 ? `有效率 ${百分(k.有效率)} · ` : ""}已判定 {数(k.已判定)} 条</span>
        </div>
        <div className="chan-dash-k">
          <span className="chan-dash-kk">
            商机
            <Tooltip trigger={["hover", "focus"]} title={`按头一回到商机（或直接到订单）的时间数，${含公海(k.公海?.商机)}。项目列表只能按创建时间筛，时间口径对不上，所以不链`}>
              <span className="chan-dash-q" tabIndex={0} aria-label="商机怎么数">?</span>
            </Tooltip>
          </span>
          <span className="chan-dash-kv">{滚数(k.商机, "商机")}</span>
          <span className="chan-dash-ks">线索→商机 {百分(k.转商机.比例)}</span>
        </div>
        <div className="chan-dash-k">
          <span className="chan-dash-kk">
            订单
            <Tooltip trigger={["hover", "focus"]} title={`按头一回进订单的时间数，${含公海(k.公海?.订单)}。项目列表只能按创建时间筛，时间口径对不上，所以不链`}>
              <span className="chan-dash-q" tabIndex={0} aria-label="订单怎么数">?</span>
            </Tooltip>
          </span>
          <span className="chan-dash-kv">{滚数(k.订单, "订单")}</span>
          <span className="chan-dash-ks">商机→订单 {百分(k.转订单)}</span>
        </div>
        <div className="chan-dash-k">
          <span className="chan-dash-kk">成交额</span>
          {缩写格(k.成交)}
          <span className="chan-dash-ks">按进订单的时间</span>
        </div>
        <div className={`chan-dash-k${投入空 ? " chan-dash-k-empty" : ""}`}>
          <span className="chan-dash-kk">投入 / ROI</span>
          {!投入空 ? 缩写格(k.投入) : <span className="chan-dash-kv">—</span>}
          <span className="chan-dash-ks">{投入空 ? "待录入" : k.产出比 !== null ? `ROI ${k.产出比}` : k.产出比说明}</span>
          {/* 「投入数据待录入」并进这一格（C2f），不再单占一条虚线框；「去补录 ›」只给能录的（P-渠道-16） */}
          {k.未录投入 > 0 && (
            <span className="chan-dash-ks chan-dash-todo">
              {k.未录投入} 个渠道没录
              {能录 && k.首个未录 && (
                <> · <button type="button" className="link-plain chan-todo-go" onClick={() => 看详情(k.首个未录!, true)}>去补录 ›</button></>
              )}
            </span>
          )}
        </div>
      </div>

      <div className={`chan-dash-row2${k.环 ? "" : " chan-dash-row2-two"}`}>
        <div className="chan-dash-cell">
          <div className="chan-dash-h">转化漏斗</div>
          <ol className="chan-dash-fun">
            {漏斗.map((x, i) => (
              <li key={x.名}>
                <span className={`chan-dash-fun-bar chan-fun-l${i}`}>
                  {x.名} <b>{x.值}</b>
                </span>
                {x.旁 && (
                  <Tooltip trigger={["hover", "focus"]} title={x.比 == null ? x.说 : `${x.说}；流失 ${百分(Math.max(0, 1 - x.比))}`}>
                    <span className="chan-dash-fun-side" tabIndex={0}>→ {百分(x.比)}</span>
                  </Tooltip>
                )}
              </li>
            ))}
          </ol>
        </div>

        {k.环 && (
          <div className={`chan-dash-cell${收类("环")}`}>
            <div className="chan-dash-h">{k.环.按 === "属性" ? "按属性分布" : "按负责人分布"}{收钮("环", k.环.按 === "属性" ? "按属性分布" : "按负责人分布")}</div>
            {环合计 === 0 ? (
              <p className="chan-dash-none">这段时间没有新线索</p>
            ) : (
              <div className="chan-dash-donut">
                <svg viewBox="0 0 42 42" width="88" height="88" aria-hidden>
                  <circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--line-soft)" strokeWidth="7" />
                  {(() => {
                    let 已 = 0;
                    return k.环.段.map((s, i) => {
                      const 份 = (s.数 / 环合计) * 100;
                      const el = (
                        <circle key={s.名} cx="21" cy="21" r="15.9" fill="none" pathLength={100} strokeWidth="7"
                          className={环类(s.名, i)}
                          strokeDasharray={`${份} ${100 - 份}`} strokeDashoffset={-已} transform="rotate(-90 21 21)" />
                      );
                      已 += 份;
                      return el;
                    });
                  })()}
                </svg>
                <ul className="chan-dash-legend">
                  {k.环.段.map((s, i) => (
                    <li key={s.名}>
                      <i className={环类(s.名, i)} />
                      <span className="chan-dash-ell" title={s.名}>{s.名}</span>
                      <b>{数(s.数)}</b>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="chan-dash-cell">
          <div className="chan-dash-h">
            低效渠道预警{预警头数}
            <Tooltip trigger={["hover", "focus"]} title={`线索不少于 ${预警线索下限} 条，且转商机率或有效率不到全员的一半、或转商机为 0；最多列 3 个，线索多的在前`}>
              <span className="chan-dash-q" tabIndex={0} aria-label="预警规则">?</span>
            </Tooltip>
          </div>
          {k.预警.length === 0 ? (
            <p className="chan-dash-none">没有低效渠道</p>
          ) : (
            <ul className="chan-dash-warn">
              {k.预警.map((w) => (
                <li key={w.id}>
                  {/* 普通卡 + 行首橙色圆点（要人处理），不再整块黄底（C-新3，P-渠道-22 门槛不变） */}
                  <i className="chan-dot is-warn" aria-hidden />
                  <button type="button" className="link-plain chan-dash-ell" title={w.name} onClick={() => 看详情(w.id)}>{w.name}</button>
                  <span className="chan-dash-warn-v">
                    {数(w.线索)} 线索 · {w.项.map((x) => `${x.指标} ${x.值}`).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="chan-dash-row3">
        <div className={`chan-dash-cell${收类("层")}`}>
          <div className="chan-dash-h">三层转化率{收钮("层", "三层转化率")}</div>
          <div className="chan-dash-tiers">
            <div className="chan-dash-tier">
              <b>{百分(k.有效率)}</b>
              <span>MQL 有效率</span>
              <small>有效线索 ÷ 已判定 {数(k.已判定)} 条</small>
            </div>
            <div className="chan-dash-tier">
              <b>{百分(k.转商机.比例)}</b>
              <span>线索→商机</span>
              <small>
                {转商机分母}
                {k.转商机.分母 === "总线索" ? `（已判定不到 ${Math.round(判够占比 * 100)}%）` : ""}
              </small>
            </div>
            <div className="chan-dash-tier">
              <b>{百分(k.转订单)}</b>
              <span>商机→订单</span>
              <small>订单 ÷ 商机</small>
            </div>
          </div>
        </div>
        <div className={`chan-dash-cell${收类("榜")}`}>
          <div className="chan-dash-h">{榜全开 && 榜能展开 ? `线索排行（全部 ${k.榜.length} 个渠道）` : "线索 TOP5"}{收钮("榜", "线索 TOP5")}</div>
          {k.榜.length === 0 ? (
            <p className="chan-dash-none">这段时间没有新线索</p>
          ) : (
            <>
            <ul className={榜全开 && 榜能展开 ? "chan-dash-top chan-dash-top-all" : "chan-dash-top"} data-testid="chan-dash-top">
              {榜摆.map((x) => {
                // 数字点进去：这个渠道 + 同一段创建时间（11-11）；项目列表里一条没有、全在公海的直接去公海页。对不上的悬停里拆开说
                const 链 = { 列表: 榜链接(x.id, 时段, "列表"), 公海: 榜链接(x.id, 时段, "公海") };
                const 去 = x.名单 && x.名单.列表 === 0 && x.名单.公海 > 0 ? 链.公海 : 链.列表;
                const 数字 = <Link href={去} className="chan-dash-top-n"><b>{数(x.线索)}</b><LinkPending /></Link>;
                return (
                  <li key={x.id}>
                    <button type="button" className="link-plain chan-dash-ell" title={x.name} onClick={() => 看详情(x.id)}>{x.name}</button>
                    {/* 条宽：按 5% 一档给类 */}
                    <span className="chan-dash-top-bar"><i className={宽类(榜顶 ? x.线索 / 榜顶 : 0)} /></span>
                    {名单段(x.线索, x.名单) ? <Tooltip title={<RosterNote 总数={x.线索} 名单={x.名单} channelId={x.id} 链={链} />}>{数字}</Tooltip> : 数字}
                  </li>
                );
              })}
            </ul>
            {榜能展开 && (
              <button type="button" className="link-plain chan-dash-top-more" aria-expanded={榜全开} onClick={() => set榜全开((x) => !x)} data-testid="chan-dash-top-more">
                {榜全开 ? "收起" : `展开全部（共 ${k.榜.length} 个渠道）`}
              </button>
            )}
            </>
          )}
        </div>
      </div>
      </>
      )}

      {公海 && (
        <div className={`chan-dash-cell chan-dash-pool${收类("海")}`}>
          <div className="chan-dash-h">
            进公海
            <Tooltip
              trigger={["hover", "focus"]}
              title={`数${公海.视角 === "市场管理" ? "本人和实线下属" : "自己"}创建的线索：这段时间进公海、现在还在公海的条数（一条只算一次，按最近那回的方式；被领走、分走了就不算）`
                + `÷ 同期在这个渠道新建的线索；导入时就没负责人的不算。回收站 = 删进回收站、还没恢复的；判无效 = 还在公海、被标了无效；`
                + `验证判无效 = 线索验证最终判了无效（记线索流失，不进公海）。被退回、判无效、验证判无效各列最多 ${原因最多} 个原因。只看数，不进公海`}
            >
              <span className="chan-dash-q" tabIndex={0} aria-label="进公海怎么算">?</span>
            </Tooltip>
            {进合计 > 0 && <span className="chan-count">（{数(进合计)}）</span>}
            {公海.视角 === "市场管理" && (
              // D37：显示选中值「全部创建人」（墨色），不靠占位字
              <FilterSelect
                size="small"
                className="chan-dash-pool-who"
                aria-label="创建人"
                value={创建人}
                onChange={(v: string) => set创建人(v ?? "")}
                options={[{ value: "", label: "全部创建人" }, ...公海.创建人们.map((u) => ({ value: u.id, label: u.name }))]}
                popupMatchSelectWidth={false}
              />
            )}
            {收钮("海", "进公海")}
          </div>
          {进公海们.length === 0 ? (
            <p className="chan-dash-none">这段时间没有进公海的线索</p>
          ) : (
            <ul className="chan-dash-pool-list">
              {进公海们.map((r) => {
                const 明细 = 进公海明细(r);
                const 头 = `进 ${数(r.进)} · 占 ${百分(r.占)}`;
                return (
                  <li key={r.id}>
                    <span className="chan-dash-ell" title={r.name}>{r.name}</span>
                    <b title={`${r.name}：同期新建 ${数(r.线索)} 条线索，进公海 ${数(r.进)} 条`}>{头}</b>
                    <span className="chan-dash-ell chan-dash-pool-d" title={明细 || undefined}>{明细 || "—"}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

    </section>
  );
}
