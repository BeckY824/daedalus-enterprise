"use client";
/**
 * 企业版项目模式首页右侧那一列指标卡（10-29 首页改版 #10；10-29 定稿：本月新增、重点项目、暂未跟进、3 天内回公海）：
 * 摆哪几张、口径、卡名、颜色都在 lib/project/home-cards.ts；口径直接写在卡下面一行小字里（10-30 交互审核规则 C）；
 * 数是 page.tsx 用 数首页卡() 这一刻查出来的，和点进去那一页用同一组条件、同一圈人，所以卡上几个、点进去就是几行。
 * 宽屏在对话右边 1/3，手机（≤767px）排到对话下面（globals.css .home-cards）
 *
 * 2026-11 PR5b（原型 home.kpi「点卡原地展开，不再整页骨架」）：点卡不再整页跳 /projects（原来要等 loading.tsx 那一整页骨架），
 * 而是这张卡原地长开：写全「几个、什么口径」，下面一颗「看这 N 个项目 ›」才去项目页。
 * 名单本身首页手上没有（卡上只有数），要在这里列名单得另起一条查询——这一版不加，名单还是在项目页看。
 * 同一时刻只展开一张；Esc / 再点一下 / 「收起」收回。
 *
 * 设计语言 H-A（11-21，H-新2）：卡右上一个 ›（展开时转成朝下），告诉人「点得开」；悬停只换底色、不上浮、数字不变蓝（globals.css）。
 */
import { useState } from "react";
import Link from "next/link";
import CountUp from "@/components/CountUp";
import { 首页摆的卡, 首页卡口径, 首页卡色, 首页卡链接, type 首页卡数 } from "@/lib/project/home-cards";

export default function HomeCards({ 数 }: { 数: 首页卡数 }) {
  const [开着, set开着] = useState<string | null>(null);
  return (
    <aside className="home-cards" aria-label="项目指标" onKeyDown={(e) => { if (e.key === "Escape") set开着(null); }}>
      {首页摆的卡.map((键) => {
        const { 名, 说明 } = 首页卡口径[键];
        const n = 数[键] ?? 0;
        // 有数才着色：快要处理的标橙、正向类标绿；0 就是个灰数。红色只留给已经过期的，这几张都没有
        const 色 = n > 0 ? 首页卡色[键] : undefined;
        const 开 = 开着 === 键;
        return (
          <div key={键} className={`home-card home-kpi-card${色 ? ` home-card-${色}` : ""}${开 ? " is-open" : ""}`}>
            <button
              type="button"
              className="home-kpi-head"
              aria-expanded={开}
              aria-label={`${名} ${n} 个，${开 ? "收起" : "展开"}`}
              onClick={() => set开着(开 ? null : 键)}
            >
              <span className="home-card-k">{名}</span>
              <b className={`home-card-v${色 === "soon" ? " home-kpi-soon" : ""}`}>
                <CountUp 值={n} 记号={`home-card:${键}`} />
              </b>
              <span className="muted home-kpi-note">{说明}</span>
              <span className="home-kpi-chev" aria-hidden>›</span>
            </button>
            {开 && (
              <div className="home-kpi-body">
                <Link href={首页卡链接(键)} className="link-strong home-kpi-go">
                  {n > 0 ? `看这 ${n} 个项目 ›` : "去项目页 ›"}
                </Link>
                <button type="button" className="home-kpi-close" onClick={() => set开着(null)}>收起</button>
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}
