"use client";

/**
 * 渠道页的总览看板（11-03，企业版）：摆在筛选栏和列表之间，渠道们 = 列表筛出来的那一批（同一个 筛渠道()），
 * 右上角切 本月 / 本季 / 全部 / 自定义。数怎么算全在 lib/enterprise/channel-dash.ts，这里只摆。
 * 三个预设三份底数都在手上，切了不回服务端；「自定义」写地址栏 view=自定义&from=&to=（读法同数据页，lib/custom-date-range.ts），
 * 服务端按那一段多算一份。市场成员 / 市场管理多一段「进公海」（P-界面-09），只读、不跳公海。
 * 颜色都取主题变量；字一律正文色 / 次要色，不拿系列色写字。
 */
import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Segmented, Select, Tooltip } from "antd";
import { 合计文字 } from "@/lib/currency";
import CustomRangePicker from "@/components/CustomRangePicker";
import { 读日期段, type 日期段 } from "@/lib/custom-date-range";
import { beijingDay } from "@/lib/business-clock";
import {
  周期们, 周期起点, 算看板, 判够占比, 预警线索下限, 自定义, 算进公海, 进公海明细, 原因最多, 看板时段, 榜链接,
  type 档, type 看板底数, type 看板渠道, type 看板公海,
} from "@/lib/enterprise/channel-dash";
import { 名单段 } from "@/lib/enterprise/channel-stats";
import Link from "next/link";
import { RosterNote } from "./RosterNote";

/** 一位小数的百分比；算不了是「—」 */
function 百分(r: number | null): string {
  if (r == null) return "—";
  if (r > 0 && r < 0.001) return "<0.1%";
  return `${(Math.round(r * 1000) / 10).toLocaleString("zh-CN")}%`;
}
const 数 = (n: number) => n.toLocaleString("zh-CN");
/** 上一层到这一层少了多少（比例超过 1 就是多了） */
const 差 = (r: number | null) => (r == null ? "—" : r > 1 ? `+${百分(r - 1)}` : `−${百分(1 - r)}`);

/** 环形图各段的颜色（主题变量），超出的并成「其他」用浅色 */
const 环色 = ["var(--brand)", "var(--cat-green)", "var(--cat-amber)", "var(--cat-violet)"];
const 其他色 = "var(--line-strong)";

export default function ChannelDash({
  渠道们,
  底数,
  段 = null,
  公海 = null,
  筛了负责人,
  能录,
  看详情,
}: {
  渠道们: 看板渠道[];
  底数: 看板底数;
  /** 地址栏带着「自定义」时服务端读好的那一段；null = 没选自定义 */
  段?: 日期段 | null;
  /** 进公海那段（只给市场成员 / 市场管理）；null 不摆 */
  公海?: 看板公海 | null;
  筛了负责人: boolean;
  能录: boolean;
  看详情: (id: string, 录?: boolean) => void;
}) {
  const router = useRouter();
  const 路径 = usePathname();
  const 参数 = useSearchParams();
  const [换着, start] = useTransition();
  const [期, set期] = useState<档>(段 ? 自定义 : "全部");
  // 刚点「自定义」、那一份还在路上：先摆本月 1 号到今天（同服务端默认），数先空着、看板压暗
  const 显段 = 段 ?? 读日期段();
  const 期底 = useMemo(() => (期 === 自定义 ? 底数.自定义 ?? {} : 底数[期]), [期, 底数]);
  const k = useMemo(() => 算看板(渠道们, 期底, 筛了负责人), [渠道们, 期底, 筛了负责人]);
  const 起 = 期 === 自定义 ? null : 周期起点(期, new Date());
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
  // TOP5 点进去带的创建时间段（北京日）：和这一档数线索的那一段一样
  const 时段 = 看板时段(期, new Date(), 显段);
  /** 卡片上「含公海 M 条」：带了名单才写数，没带只写口径 */
  const 含公海 = (m: number | undefined) => (m === undefined ? "含公海" : `含公海 ${数(m)} 条`);

  const 漏斗 = [
    { 名: "总线索", 值: 数(k.线索), 旁: null as string | null, 说: null as string | null },
    { 名: "有效线索", 值: k.已判定 ? 数(k.有效) : "—", 旁: `有效率 ${百分(k.有效率)}`, 说: `有效线索 ÷ 已判定（已判定 ${数(k.已判定)} 条）` },
    { 名: "商机", 值: 数(k.商机), 旁: 差(k.转商机.比例), 说: `按 ${转商机分母} 算，只看从线索起步的（导入时就是商机、订单的不算）` },
    { 名: "订单", 值: 数(k.订单), 旁: 差(k.转订单), 说: "按 订单 ÷ 商机 算" },
  ];

  return (
    <section className={`chan-dash${换着 ? " chan-dash-busy" : ""}`} aria-label="渠道总览" aria-busy={换着 || undefined}>
      <div className="chan-dash-bar">
        <span className="chan-dash-hint">
          按筛选出的 {k.渠道数} 个渠道算{起 ? ` · ${beijingDay(起)} 起` : ""}
        </span>
        <span className="chan-dash-when">
          <Segmented size="small" value={期} onChange={(v) => 换档(v as 档)} options={[...周期们, 自定义]} aria-label="统计周期" />
          {期 === 自定义 && <CustomRangePicker size="small" 段={显段} 改={(d) => 写地址({ view: 自定义, from: d.from, to: d.to })} />}
        </span>
      </div>

      <div className="chan-dash-kpi">
        <div className="chan-dash-k">
          <span className="chan-dash-kk">总线索</span>
          <span className="chan-dash-kv">{数(k.线索)}</span>
          {/* 跨渠道的合计：项目列表按渠道只能单选，只带时间段的链接会混进别的渠道、没渠道的项目，所以这里不链（TOP5 每行能点） */}
          <span className="chan-dash-ks">按项目创建时间，{含公海(k.公海?.线索)}</span>
        </div>
        <div className="chan-dash-k">
          <span className="chan-dash-kk">MQL 有效线索</span>
          <span className="chan-dash-kv">{k.已判定 ? 数(k.有效) : "—"}</span>
          <span className="chan-dash-ks">{k.已判定 ? `有效率 ${百分(k.有效率)} · ` : ""}已判定 {数(k.已判定)} 条</span>
        </div>
        <div className="chan-dash-k">
          <span className="chan-dash-kk">
            商机
            <Tooltip title={`按头一回到商机（或直接到订单）的时间数，${含公海(k.公海?.商机)}。项目列表只能按创建时间筛，时间口径对不上，所以不链`}>
              <span className="chan-dash-q" tabIndex={0} aria-label="商机怎么数">?</span>
            </Tooltip>
          </span>
          <span className="chan-dash-kv">{数(k.商机)}</span>
          <span className="chan-dash-ks">线索→商机 {百分(k.转商机.比例)}</span>
        </div>
        <div className="chan-dash-k">
          <span className="chan-dash-kk">
            订单
            <Tooltip title={`按头一回进订单的时间数，${含公海(k.公海?.订单)}。项目列表只能按创建时间筛，时间口径对不上，所以不链`}>
              <span className="chan-dash-q" tabIndex={0} aria-label="订单怎么数">?</span>
            </Tooltip>
          </span>
          <span className="chan-dash-kv">{数(k.订单)}</span>
          <span className="chan-dash-ks">商机→订单 {百分(k.转订单)}</span>
        </div>
        <div className="chan-dash-k">
          <span className="chan-dash-kk">成交额</span>
          <span className="chan-dash-kv" title={合计文字(k.成交)}>{合计文字(k.成交)}</span>
          <span className="chan-dash-ks">按进订单的时间</span>
        </div>
        <div className={`chan-dash-k${投入空 ? " chan-dash-k-empty" : ""}`}>
          <span className="chan-dash-kk">投入 / ROI</span>
          <span className="chan-dash-kv" title={投入空 ? undefined : 合计文字(k.投入)}>{投入空 ? "—" : 合计文字(k.投入)}</span>
          <span className="chan-dash-ks">{投入空 ? "待录入" : k.产出比 !== null ? `ROI ${k.产出比}` : k.产出比说明}</span>
        </div>
      </div>

      <div className={`chan-dash-row2${k.环 ? "" : " chan-dash-row2-two"}`}>
        <div className="chan-dash-cell">
          <div className="chan-dash-h">转化漏斗</div>
          <ol className="chan-dash-fun">
            {漏斗.map((x, i) => (
              <li key={x.名}>
                <span className="chan-dash-fun-bar" style={{ width: `${100 - i * 20}%`, background: `color-mix(in srgb, var(--brand) ${34 - i * 7}%, var(--panel))` }}>
                  {x.名} <b>{x.值}</b>
                </span>
                {x.旁 && (
                  <Tooltip title={x.说}>
                    <span className="chan-dash-fun-side">{x.旁}</span>
                  </Tooltip>
                )}
              </li>
            ))}
          </ol>
        </div>

        {k.环 && (
          <div className="chan-dash-cell">
            <div className="chan-dash-h">{k.环.按 === "属性" ? "按属性分布" : "按负责人分布"}</div>
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
                          style={{ stroke: s.名 === "其他" ? 其他色 : 环色[i % 环色.length] }}
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
                      <i style={{ background: s.名 === "其他" ? 其他色 : 环色[i % 环色.length] }} />
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
            低效渠道预警
            <Tooltip title={`线索不少于 ${预警线索下限} 条，且转商机率或有效率不到全员的一半、或转商机为 0；最多列 3 个，线索多的在前`}>
              <span className="chan-dash-q" tabIndex={0} aria-label="预警规则">?</span>
            </Tooltip>
          </div>
          {k.预警.length === 0 ? (
            <p className="chan-dash-none">没有低效渠道</p>
          ) : (
            <ul className="chan-dash-warn">
              {k.预警.map((w) => (
                <li key={w.id}>
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
        <div className="chan-dash-cell">
          <div className="chan-dash-h">三层转化率</div>
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
        <div className="chan-dash-cell">
          <div className="chan-dash-h">线索 TOP5</div>
          {k.榜.length === 0 ? (
            <p className="chan-dash-none">这段时间没有新线索</p>
          ) : (
            <ul className="chan-dash-top">
              {k.榜.map((x) => {
                // 数字点进去：这个渠道 + 同一段创建时间（11-11）；项目列表里一条没有、全在公海的直接去公海页。对不上的悬停里拆开说
                const 链 = { 列表: 榜链接(x.id, 时段, "列表"), 公海: 榜链接(x.id, 时段, "公海") };
                const 去 = x.名单 && x.名单.列表 === 0 && x.名单.公海 > 0 ? 链.公海 : 链.列表;
                const 数字 = <Link href={去} className="chan-dash-top-n"><b>{数(x.线索)}</b></Link>;
                return (
                  <li key={x.id}>
                    <button type="button" className="link-plain chan-dash-ell" title={x.name} onClick={() => 看详情(x.id)}>{x.name}</button>
                    <span className="chan-dash-top-bar"><i style={{ width: `${(x.线索 / 榜顶) * 100}%` }} /></span>
                    {名单段(x.线索, x.名单) ? <Tooltip title={<RosterNote 总数={x.线索} 名单={x.名单} channelId={x.id} 链={链} />}>{数字}</Tooltip> : 数字}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {公海 && (
        <div className="chan-dash-cell chan-dash-pool">
          <div className="chan-dash-h">
            进公海
            <Tooltip
              title={`数${公海.视角 === "市场管理" ? "本人和实线下属" : "自己"}创建的线索：这段时间进公海、现在还在公海的条数（一条只算一次，按最近那回的方式；被领走、分走了就不算）`
                + `÷ 同期在这个渠道新建的线索；导入时就没负责人的不算。回收站 = 删进回收站、还没恢复的；判无效 = 还在公海、被标了无效；`
                + `验证判无效 = 线索验证最终判了无效（记线索流失，不进公海）。被退回、判无效、验证判无效各列最多 ${原因最多} 个原因。只看数，不进公海`}
            >
              <span className="chan-dash-q" tabIndex={0} aria-label="进公海怎么算">?</span>
            </Tooltip>
            {进合计 > 0 && <span className="chan-dash-pool-sum">共 {数(进合计)} 条</span>}
            {公海.视角 === "市场管理" && (
              <Select
                size="small"
                className="chan-dash-pool-who"
                aria-label="创建人"
                placeholder="全部创建人"
                allowClear
                showSearch={{ optionFilterProp: "label" }}
                value={创建人 || undefined}
                onChange={(v?: string) => set创建人(v ?? "")}
                options={公海.创建人们.map((u) => ({ value: u.id, label: u.name }))}
                popupMatchSelectWidth={false}
              />
            )}
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

      {k.未录投入 > 0 && (
        <div className="chan-dash-empty">
          <span>投入数据待录入（{k.未录投入}/{k.渠道数}）</span>
          {能录 && k.首个未录 && (
            <button type="button" className="link-plain link-strong" onClick={() => 看详情(k.首个未录!, true)}>去补录 →</button>
          )}
        </div>
      )}
    </section>
  );
}
