"use client";

import type { ReactNode } from "react";
import { Card } from "antd";
import { useIsNowSkin } from "@/lib/use-skin";
import EmptyState from "@/components/EmptyState";
import { 转化率字, type 漏斗格 } from "./funnel";

/**
 * 复盘页的全周期项目漏斗（定稿 #15）：四条横条往下递减，条长 = 这一段占第一段的比例。
 * 个数直接写在条上，转化率（相对上一段）写在右边；含义靠字，不靠颜色区分，暗色主题下字色跟着 --ink 走。
 * 纯展示，数在 funnel.ts 算好、随复盘页一次取回来。
 * 矮（P15）：和右边的线索瀑布并排摆，条矮一点、不带上边距（外面那一行给），卡片撑满行高、两张等高。
 */
export default function ProjectFunnel({ 漏斗, 说明, 空, 矮 = false, 脚 }: {
  漏斗: 漏斗格[]; 说明: string; 空: { title: string; hint: string }; 矮?: boolean;
  /** 现状主题：卡底一行（「已经结束的：…」并进漏斗卡，R-新13）；换皮主题外面照旧摆在卡外 */
  脚?: ReactNode;
}) {
  // 设计语言 R-B（D39 后半）：现状主题个数放条右侧外面固定一列，不压条、不被短条挤出去
  const 新样 = useIsNowSkin();
  const 头 = 漏斗[0]?.count ?? 0;
  return (
    <Card
      style={矮 ? undefined : { marginTop: 16 }}
      className={["rb-mod-card", 矮 ? "pfun-card" : "", 新样 ? "pfun-now" : ""].filter(Boolean).join(" ")}
      title={<span className="section-title">全周期漏斗</span>}
    >
      {/* 说明放正文里不放 extra：这句偏长，手机宽度下塞在卡片头右边会挤出去 */}
      <p className="pfun-note">{说明}</p>
      {头 > 0 ? (
        <ol className={`pfun${矮 ? " pfun-low" : ""}`} aria-label="项目漏斗：线索、商机、订单、交付">
          {漏斗.map((g, i) => {
            const 前 = i > 0 ? 漏斗[i - 1].段 : null;
            const 率 = 转化率字(g.转化率);
            return (
              <li
                key={g.段}
                className="pfun-row"
                aria-label={`${g.段} ${g.count} 个${前 ? `，${前}到${g.段}转化 ${率 === "—" ? "无" : 率}` : ""}`}
              >
                <span className="pfun-name" aria-hidden="true">{g.段}</span>
                <span className="pfun-track" aria-hidden="true">
                  <span className={`pfun-bar${g.count ? "" : " pfun-bar-0"}`} style={{ width: `${(g.count / 头) * 100}%` }}>
                    {!新样 && <b className="pfun-n">{g.count}</b>}
                  </span>
                </span>
                {新样 && <b className="pfun-n pfun-n-out" aria-hidden="true">{g.count.toLocaleString("zh-CN")}</b>}
                <span className="pfun-rate" aria-hidden="true">
                  {前 ? (
                    <>
                      <span className="pfun-rate-v">{率}</span>
                      <span className="pfun-rate-k">较{前}</span>
                    </>
                  ) : (
                    <span className="pfun-rate-k">起点</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState title={空.title} hint={空.hint} demo={false} />
      )}
      {新样 && 脚 && <p className="pfun-foot">{脚}</p>}
    </Card>
  );
}
