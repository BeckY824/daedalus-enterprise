"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pagination, Segmented, Tooltip } from "antd";
import { dayjs, fmtDateTime } from "@/lib/utils";
import { 有值, 空显 } from "@/lib/empty-value";
import EmptyState from "@/components/EmptyState";
import { 卡点筛们, 卡点筛叫法, 复盘列表每页, type 卡点筛, type 复盘卡点, type 复盘卡点行 } from "@/lib/project/review-tabs";
import { 卡点状态序, 卡点状态叫法, type 卡点分布 } from "@/lib/project/review-extras";
import { 逾天数 } from "@/lib/project/board-todos";

/**
 * 复盘页「卡点」页签（P7 U-复盘-01；11-01 参考复盘稿融合改成卡片）：项目卡点——编号、卡点类型、描述、影响 · 项目 · 客户、阻碍主体、经手人 / 负责人、截止。
 * 取值全用现有卡点模型（EntBlocker，A-18）；看谁的跟页签上面的人员选择走，范围在服务端（lib/project/review-tabs.ts 的 卡点条件，这里不动）。
 * 状态筛选（未解决 / 已解决 / 全部）、页码在地址栏（bs / p）；一页里按状态分组（待接受 / 处理中 / 没人接 / 已解决）。
 * 点卡片去项目页，在那里认领、处理（这里不摆认领按钮）。上面一条「卡点分布」：同一个筛选范围，按阻碍主体的横条 + 按状态计数。
 * 1024 宽 + AI 栏常驻时：卡片自动排一到三列，描述、项目、客户省略号截断，悬停看全文。
 */
export default function BoardBlockers({ 数, 筛, 只看自己, 分布 }: { 数: 复盘卡点; 筛: 卡点筛; 只看自己: boolean; 分布?: 卡点分布 }) {
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

  // 本页按状态分组：认得的四种按固定顺序，认不出的排后面
  const 状态们 = [...卡点状态序, ...new Set(数.行.map((x) => x.status).filter((s) => !(卡点状态序 as readonly string[]).includes(s)))];
  const 组们 = 状态们.map((s) => ({ 状态: s, 行: 数.行.filter((x) => x.status === s) })).filter((g) => g.行.length);
  const now = dayjs();

  return (
    <div className="btodo-wrap">
      {分布 && 分布.总数 > 0 && <卡点分布条 分布={分布} 筛={筛} />}
      <section className={`btodo-list${换着 ? " is-pending" : ""}`} aria-label="卡点列表" aria-busy={换着}>
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
        {数.行.length === 0 ? (
          <EmptyState
            title="没有卡点"
            hint={筛 !== "all" ? "状态选「全部」看看。" : 只看自己 ? "你负责的项目上还没有卡点。" : "项目上还没有卡点。"}
            demo={false}
          />
        ) : (
          组们.map((g) => (
            <section key={g.状态} className="rblk-group" aria-label={`${卡点状态叫法[g.状态] ?? g.状态}，本页 ${g.行.length} 条`}>
              <h3 className="rblk-group-h">
                <i className={`rblk-dot rblk-dot-${状态类(g.状态)}`} aria-hidden />
                {卡点状态叫法[g.状态] ?? g.状态}
                <span className="btodo-col-n">{g.行.length}</span>
              </h3>
              <div className="rblk-cards">
                {g.行.map((x) => <卡点卡片 key={x.id} x={x} now={now} 去={() => 去(x)} />)}
              </div>
            </section>
          ))
        )}
        {数.总数 > 复盘列表每页 && (
          <Pagination
            className="rblk-pager"
            size="small"
            current={数.页}
            pageSize={复盘列表每页}
            total={数.总数}
            showSizeChanger={false}
            showTotal={(n) => `共 ${n} 条`}
            onChange={(p) => 改({ p })}
          />
        )}
      </section>
    </div>
  );
}

const 状态类 = (s: string) => (s === "已解决" ? "done" : s === "处理中" ? "doing" : s === "看板" ? "idle" : "wait");

function 卡点卡片({ x, now, 去 }: { x: 复盘卡点行; now: ReturnType<typeof dayjs>; 去: () => void }) {
  const 超 = x.status !== "已解决" ? 逾天数(x.dueAt, now) : 0;
  const 描述 = 有值(x.description) ? x.description : "（没写描述）";
  const 归属 = `${x.impact} · ${x.项目} · ${x.客户}`;
  return (
    <article
      className="rblk-k"
      tabIndex={0}
      role="link"
      aria-label={`${x.code}，${x.项目}，${x.type}`}
      onClick={去}
      onKeyDown={(e) => { if (e.key === "Enter") 去(); }}
    >
      <div className="rblk-k-top">
        <span className="rblk-code">{x.code}</span>
        <span className={`rblk-type${x.type === "重要卡点" ? " rblk-type-hot" : ""}`}>{x.type}</span>
        <span className={`rblk-due nowrap${超 > 0 ? " rblk-due-late" : ""}`} suppressHydrationWarning>
          {超 > 0 ? `超 ${超} 天` : `截止 ${dayjs(x.dueAt).format("M-D")}`}
        </span>
      </div>
      <Tooltip title={`${x.code}　${描述}`} placement="topLeft" mouseEnterDelay={0.4}>
        <div className={`rblk-k-t${有值(x.description) ? "" : " btodo-kind"}`}>{空显(x.description)}</div>
      </Tooltip>
      <Tooltip title={归属} placement="topLeft" mouseEnterDelay={0.4}>
        <div className="rblk-k-sub">{归属}</div>
      </Tooltip>
      <div className="rblk-k-meta">
        {有值(x.obstacle) && <span className="rblk-tag" title={`阻碍主体：${x.obstacle}`}>{x.obstacle}</span>}
        <span className="rblk-who" title={`经手人：${x.经手人 ?? "还没人接"}；项目负责人：${x.负责人}`}>
          {x.经手人 ? `经手 ${x.经手人}` : "没人接"} · 负责 {x.负责人}
        </span>
        <span className="rblk-at nowrap">{fmtDateTime(x.createdAt)}</span>
      </div>
    </article>
  );
}

/** 卡点分布：按阻碍主体一条横条（条长 = 条数，一种颜色、单轴），右边按状态计数；范围同下面的列表筛选 */
function 卡点分布条({ 分布, 筛 }: { 分布: 卡点分布; 筛: 卡点筛 }) {
  return (
    <section className="btodo-list rblk-dist" aria-label="卡点分布">
      <div className="btodo-head">
        <b className="section-title">卡点分布</b>
        <div className="btodo-head-r rblk-dist-st">
          {分布.按状态.map((s) => (
            <span key={s.状态} className="rblk-dist-chip nowrap">
              <i className={`rblk-dot rblk-dot-${状态类(s.状态)}`} aria-hidden />
              {卡点状态叫法[s.状态] ?? s.状态} <b>{s.数}</b>
            </span>
          ))}
        </div>
      </div>
      <p className="rblk-dist-cap">按阻碍主体 · {卡点筛叫法[筛]} {分布.总数} 条</p>
      <分布横条 们={分布.按主体.map((x) => ({ 名: x.主体, 数: x.数 }))} 单位="条" />
    </section>
  );
}

/** 单系列横条（卡点分布在卡点页签、数据页签都用）：最多摆 8 条，多的并成「其他」 */
export function 分布横条({ 们, 单位 }: { 们: readonly { 名: string; 数: number }[]; 单位: string }) {
  const 前 = 们.length > 8 ? [...们.slice(0, 7), { 名: "其他", 数: 们.slice(7).reduce((s, x) => s + x.数, 0) }] : 们;
  const 最多 = Math.max(1, ...前.map((x) => x.数));
  return (
    <ul className="btodo-rc">
      {前.map((x, i) => (
        <Tooltip key={`${i}-${x.名}`} title={`${x.名}：${x.数} ${单位}`} placement="topLeft" mouseEnterDelay={0.2}>
          <li className="btodo-rc-row" tabIndex={0}>
            <span className="btodo-rc-k">{x.名}</span>
            <span className="btodo-rc-bar" aria-hidden><i style={{ width: `${(x.数 / 最多) * 100}%` }} /></span>
            <b className="btodo-rc-v">{x.数}</b>
          </li>
        </Tooltip>
      ))}
    </ul>
  );
}
