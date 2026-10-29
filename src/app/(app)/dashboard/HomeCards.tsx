"use client";
/**
 * 企业版项目模式首页右侧那一列指标卡（10-29 首页改版 #10）：竖排四张，点了去项目页、带上这张卡的筛选（?f=…）。
 * 口径、卡名、悬停说明都在 lib/project/home-cards.ts；数是 page.tsx 用 数首页卡() 这一刻查出来的，
 * 和点进去那一页用同一组条件，所以卡上几个、点进去就是几行。
 * 宽屏在对话右边 1/3，手机（≤767px）排到对话下面（globals.css .home-cards）
 */
import Link from "next/link";
import CountUp from "@/components/CountUp";
import { 首页卡键们, 首页卡口径, type 首页卡数 } from "@/lib/project/home-cards";

/** 这几张有数就该先看：数字标成提醒色（另两张只是个量） */
const 要先看 = new Set(["no-follow", "due-soon"]);

export default function HomeCards({ 数 }: { 数: 首页卡数 }) {
  return (
    <aside className="home-cards" aria-label="项目指标">
      {首页卡键们.map((键) => {
        const { 名, 说明 } = 首页卡口径[键];
        const n = 数[键];
        return (
          <Link
            key={键}
            href={`/projects?f=${键}`}
            className={`home-card${要先看.has(键) && n > 0 ? " home-card-warn" : ""}`}
            title={说明}
            aria-label={`${名} ${n} 个，看项目`}
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
