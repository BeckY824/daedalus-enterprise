"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Tooltip } from "antd";
import { 金额, 金额缩写 } from "@/lib/currency";
import { useIsNowSkin } from "@/lib/use-skin";
import { 即将逾期天数 } from "@/lib/project/home-cards";
import EmptyState from "@/components/EmptyState";
import CountUp from "@/components/CountUp";
import CustomerWorldMap from "./CustomerWorldMap";
import type { 复盘概况, 预警行, 卡点分布, 客户分布 } from "@/lib/project/review-extras";

/** 复盘页「数据 · 现在」多出来的三块（企业版按项目才传，团队版「数据」页不出）。口径见 review-extras.ts */
export type 复盘概况数 = { 概况: 复盘概况; 预警: 预警行[]; 分布: 卡点分布 };

/** 数 = 这一格背后的那个数：给了就在变化时从旧值滚到新值（PR2 外壳 g.numbers），值 是它的写法、也是服务端那一趟的样子 */
/** 小 = 数下面常显的一行小字（现状主题的阶段排用）；全 = 缩写了的金额的全值（悬停、点按看） */
export type 格 = { k: string; 值: string; 数?: number; 写法?: (n: number) => string; 注: string; 去?: string; 急?: boolean; 小?: ReactNode; 全?: string };

/** 现状主题 KPI 的整数带千分位（19,532），和漏斗个数同一写法（3703 实操：KPI 写 19532、漏斗写 21,654） */
const 千分 = (n: number) => n.toLocaleString("zh-CN");

/** 滚的半路取整（金额半路不出分），到位那一下用原数原写法，和服务端那一趟一字不差 */
function 滚动写法(终: number, 写法: (n: number) => string = String) {
  return (n: number) => (n === 终 ? 写法(终) : 写法(Math.round(n)));
}

/** 最上面那排六格：在跟项目 / 逾期任务 / 未解决卡点 / 已回款 / 待回款 / 3 天内回公海 */
/** 不算 = 待回款不算哪些结局（按企业版叫法传进来） */
export const 复盘概况排 = ReviewSummaryRow;
function ReviewSummaryRow({ 数, 本位币, 不算 = "商机丢单 / 线索流失" }: { 数: 复盘概况; 本位币: string; 不算?: string }) {
  // 现状主题：金额窄格缩写「¥ 1.68 亿」，全值进悬停 / 点按（D39，原来「¥167,599,5…」被截）
  const 新样 = useIsNowSkin();
  const 钱 = (n: number) => (新样 ? 金额缩写(n, 本位币) : 金额(n, 本位币));
  const 全 = (n: number) => (新样 ? 金额(n, 本位币) : undefined);
  const 外 = 数.外币项目 ? `；另有 ${数.外币项目} 个项目是外币，没算进来` : "";
  const 格们: 格[] = [
    { k: "在跟项目", 值: String(数.在跟), 数: 数.在跟, 注: "进行中、不在公海的", 去: "/projects" },
    { k: "逾期任务", 值: String(数.逾期任务), 数: 数.逾期任务, 注: "任务 + 跟进计划，过了时间没办", 去: "/overview?tab=todo&f=overdue", 急: 数.逾期任务 > 0 },
    { k: "未解决卡点", 值: String(数.未解决卡点), 数: 数.未解决卡点, 注: "待接受、处理中的", 去: "/overview?tab=block", 急: 数.未解决卡点 > 0 },
    { k: "已回款", 值: 钱(数.已回款), 数: 数.已回款, 写法: 钱, 注: `项目上记的回款，只合 ${本位币}${外}`, 全: 全(数.已回款) },
    { k: "待回款", 值: 钱(数.待回款), 数: 数.待回款, 写法: 钱, 注: `合同金额减已回款，${本位币} 合同，${不算}的不算${外}`, 全: 全(数.待回款) },
    数.将回公海 === null
      ? { k: `${即将逾期天数} 天内回公海`, 值: "—", 注: "组织规则里没开超时回收" }
      : { k: `${即将逾期天数} 天内回公海`, 值: String(数.将回公海), 数: 数.将回公海, 注: "按节点天数没跟进就收回", 去: "/projects?f=due-soon", 急: 数.将回公海 > 0 },
  ];
  return <KPI排 格们={格们} 名="复盘概况" 新样={新样} />;
}

/**
 * 一排 KPI（复盘概况 6 格；现状主题下阶段 4 格、本月 / 本年视图 4 格也用它，设计语言 R-B：两排同款、同号 26、不带彩色图标）。
 * 现状主题：缩写了的金额全值 + 口径进 Tooltip，悬停、触屏点按都出（D39）；可点的格悬停只换底（D30）
 */
export function KPI排({ 格们, 名, 新样 = false, 列 = 6 }: { 格们: 格[]; 名: string; 新样?: boolean; 列?: 4 | 6 }) {
  return (
    <section className={`rkpi${列 === 4 ? " rkpi-4" : ""}`} aria-label={名}>
      {格们.map((g) => {
        const 里 = (
          <>
            <span className="rkpi-k">{g.k}</span>
            <b className={`rkpi-v${g.急 ? " rkpi-v-hot" : ""}`}>
              {g.数 === undefined ? g.值 : <CountUp 值={g.数} 记号={`rkpi:${g.k}`} 只滚变化 格式={滚动写法(g.数, g.写法 ?? (新样 ? 千分 : undefined))} />}
            </b>
            {g.小 != null && <span className="rkpi-s">{g.小}</span>}
          </>
        );
        // 小字窄格里折行不截，悬停也要看得到整句（数字常在句尾）：小字是一句话就并进提示，注已经包含在小字里的不重复（R-B 审查 11-22）
        const 小字 = 新样 && typeof g.小 === "string" && g.小 !== g.注 ? g.小 : null;
        const 行们 = [g.全, 小字, 小字?.includes(g.注) ? null : g.注].filter((x): x is string => !!x);
        const 说 = 行们.length > 1 ? 行们.map((x, i) => <span key={i}>{i > 0 && <br />}{x}</span>) : 行们[0];
        return (
          // hover + focus 不用 click：触屏长按时 pointerenter 延时打开、抬起后 click 又切回关，闪一下就没（C-A1 3704 实操同一个坑）；
          // 格子有 tabIndex=0，点按即聚焦、点别处才收
          <Tooltip key={g.k} title={说} placement="bottom" mouseEnterDelay={0.3} trigger={新样 && !g.去 ? ["hover", "focus"] : undefined}>
            {g.去 ? <Link href={g.去} className="rkpi-i">{里}</Link> : <div className="rkpi-i" tabIndex={0}>{里}</div>}
          </Tooltip>
        );
      })}
    </section>
  );
}

/**
 * 数据页按导入批次筛着时（11-19，lib/project/import-batch.ts），卡点分布、超时预警、客户分布这几块不跟批次走（按人、按客户数，不是按项目批次），
 * 标题旁写一句灰字说清，数不改
 */
const 不跟批次话 = "不跟导入批次";

/** 卡点分布 + 超时预警，并排（窄了上下）。不跟批次：数据页正按导入批次筛，标题旁写一句「不跟导入批次」 */
export const 复盘提醒排 = ReviewAlertRow;
function ReviewAlertRow({ 分布, 预警, 将回公海, 不跟批次 = false }: { 分布: 卡点分布; 预警: 预警行[]; 将回公海: number | null; 不跟批次?: boolean }) {
  // 现状主题（R-新5，U-复盘-01）：卡点不再在数据页签重画一份，收成一行摘要 + 去卡点页签的链接，数不变
  const 新样 = useIsNowSkin();
  const 前三 = 分布.按主体.slice(0, 3);
  return (
    <div className="rkpi-pair">
      {新样 ? (
        <section className="btodo-list rkpi-blk" aria-label="卡点">
          <div className="btodo-head">
            <span className="rkpi-head-l">
              <b className="section-title">卡点<span className="card-count">（{分布.总数}）</span></b>
              {不跟批次 && <span className="muted rkpi-cap">{不跟批次话}</span>}
            </span>
            <Link href="/overview?tab=block" className="link-strong nowrap rkpi-blk-go">去卡点页签 ›</Link>
          </div>
          {分布.总数 === 0 ? (
            <p className="btodo-recycle-off">没有未解决的卡点</p>
          ) : (
            <p className="rkpi-blk-sum">
              未解决 <b>{分布.总数}</b> 条{前三.length > 0 && <> · 按阻碍主体前 {前三.length}：{前三.map((x) => `${x.主体} ${x.数}`).join("、")}</>}
            </p>
          )}
        </section>
      ) : (
      <section className="btodo-list" aria-label="卡点分布">
        <div className="btodo-head">
          <b className="section-title">卡点分布</b>
          <span className="muted rkpi-cap">未解决 {分布.总数} 条，按阻碍主体{不跟批次 && `，${不跟批次话}`}</span>
        </div>
        {分布.总数 === 0 ? (
          <EmptyState title="没有未解决的卡点" hint="项目上发布的卡点处理完了，这里就是空的。" demo={false} />
        ) : (
          <分布横条 们={分布.按主体.map((x) => ({ 名: x.主体, 数: x.数 }))} 单位="条" />
        )}
      </section>
      )}
      <section className="btodo-list" aria-label="超时预警">
        <div className="btodo-head">
          <span className="rkpi-head-l">
            <b className="section-title">超时预警</b>
            {不跟批次 && <span className="muted rkpi-cap">{不跟批次话}</span>}
          </span>
          {!!将回公海 && <Link href="/projects?f=due-soon" className="link-strong">看全部 {将回公海} 个 ›</Link>}
        </div>
        {将回公海 === null ? (
          <p className="btodo-recycle-off">组织规则里没开超时回收，项目不会因为没跟进自动回公海。</p>
        ) : 预警.length === 0 ? (
          <EmptyState title={`${即将逾期天数} 天内没有要回公海的项目`} hint="按节点天数没跟进的项目会出现在这里。" demo={false} />
        ) : (
          <ul className="rkpi-warn">
            {预警.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${encodeURIComponent(p.id)}`} className="rkpi-warn-a">
                  <Tooltip title={p.名} placement="topLeft" mouseEnterDelay={0.4}>
                    <span className="rkpi-warn-n">{p.名}</span>
                  </Tooltip>
                  <span className="rkpi-warn-s">{p.节点} · {p.负责人}</span>
                  <span className="rkpi-warn-d nowrap">{p.回收日} 收回</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * 客户分布（11-03）：数据页签最下面，按国家、按业务线两块；这一圈负责的客户，不含公海。
 * 按国家（同日客户又要「像地图那种的呈现」）：世界地图着色 + 前几名榜单（宽时榜单在右、窄时在下），榜单下面单写没填国家的；
 * 地图拉不下来就只留榜单
 */
export function 客户分布排({ 分布, 不跟批次 = false }: { 分布: 客户分布; 不跟批次?: boolean }) {
  const 空 = <EmptyState title="还没有客户" hint="这一圈负责的客户会按国家和业务线摆在这里。" demo={false} />;
  return (
    <div className="rkpi-pair is-stacked">
      <section className="btodo-list" aria-label="客户分布·按国家">
        <div className="btodo-head">
          <b className="section-title">客户分布 · 按国家</b>
          <span className="muted rkpi-cap">共 {分布.总数} 个客户，不含公海{不跟批次 && `，${不跟批次话}`}</span>
        </div>
        {分布.总数 === 0 ? 空 : <CountryMapAndRank 分布={分布} />}
      </section>
      <section className="btodo-list" aria-label="客户分布·按业务线">
        <div className="btodo-head">
          <b className="section-title">客户分布 · 按业务线</b>
          {不跟批次 && <span className="muted rkpi-cap">{不跟批次话}</span>}
        </div>
        {分布.总数 === 0 ? 空 : <分布横条 们={分布.按业务线} 单位="个" 最多={Infinity} />}
      </section>
    </div>
  );
}

/** 地图 + 榜单（组件名用英文：hooks 规则只认大写开头的组件） */
function CountryMapAndRank({ 分布 }: { 分布: 客户分布 }) {
  const [地图坏, set地图坏] = useState(false);
  return (
    <div className={`cmap${地图坏 ? " no-map" : ""}`}>
      {!地图坏 && <CustomerWorldMap 全部国家={分布.全部国家} 出错={() => set地图坏(true)} />}
      <div className="cmap-rank">
        {分布.按国家.length > 0 && <分布横条 们={分布.按国家} 单位="个" 最多={Infinity} />}
        {分布.未填国家 > 0 && <p className="muted cmap-unset">未填国家 {分布.未填国家} 个</p>}
      </div>
    </div>
  );
}

/** 单系列横条（数据页签的卡点分布、客户分布用；11-01 卡点页签换成卡点 v2 三栏看板后从 BoardBlockers 搬来）：默认最多摆 8 条，多的并成「其他」；已经并好的传 最多={Infinity} */
export function 分布横条({ 们, 单位, 最多 = 8 }: { 们: readonly { 名: string; 数: number }[]; 单位: string; 最多?: number }) {
  const 前 = 们.length > 最多 ? [...们.slice(0, 最多 - 1), { 名: "其他", 数: 们.slice(最多 - 1).reduce((s, x) => s + x.数, 0) }] : 们;
  const 顶 = Math.max(1, ...前.map((x) => x.数));
  return (
    <ul className="btodo-rc">
      {前.map((x, i) => (
        <Tooltip key={`${i}-${x.名}`} title={`${x.名}：${x.数} ${单位}`} placement="topLeft" mouseEnterDelay={0.2}>
          <li className="btodo-rc-row" tabIndex={0}>
            <span className="btodo-rc-k">{x.名}</span>
            <span className="btodo-rc-bar" aria-hidden><i style={{ width: `${(x.数 / 顶) * 100}%` }} /></span>
            <b className="btodo-rc-v">{x.数}</b>
          </li>
        </Tooltip>
      ))}
    </ul>
  );
}
