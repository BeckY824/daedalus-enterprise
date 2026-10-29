"use client";
/**
 * 企业版项目模式首页右侧那一列指标卡（10-29 首页改版 #10）：竖排四张，点了去项目页、带上这张卡的筛选（?f=…）；
 * 今日待办去复盘页「待办」页签、选中「今天到期」。摆哪几张、口径、卡名、悬停说明、颜色都在 lib/project/home-cards.ts；数是 page.tsx 用 数首页卡() 这一刻查出来的，
 * 和点进去那一页用同一组条件，所以卡上几个、点进去就是几行。
 * 宽屏在对话右边 1/3，手机（≤767px）排到对话下面（globals.css .home-cards）
 */
import Link from "next/link";
import CountUp from "@/components/CountUp";
import { 首页摆的卡, 首页卡口径, 首页卡色, 首页卡链接, type 首页卡数 } from "@/lib/project/home-cards";

export default function HomeCards({ 数, 我 }: { 数: 首页卡数; 我?: string }) {
  return (
    <aside className="home-cards" aria-label="项目指标">
      {首页摆的卡.map((键) => {
        const { 名, 说明 } = 首页卡口径[键];
        const n = 数[键] ?? 0;
        // 有数才着色：告警类标红、正向类标绿；0 就是个灰数
        const 色 = n > 0 ? 首页卡色[键] : undefined;
        return (
          <Link
            key={键}
            href={首页卡链接(键, 我)}
            className={`home-card${色 ? ` home-card-${色}` : ""}`}
            title={说明}
            aria-label={键 === "today-todo" ? `${名} ${n} 条，去复盘页看待办` : `${名} ${n} 个，看项目`}
          >
            <span className="home-card-k">{名}</span>
            <b className="home-card-v">
              <CountUp 值={n} 记号={`home-card:${键}`} />
            </b>
          </Link>
        );
      })}
    </aside>
  );
}
