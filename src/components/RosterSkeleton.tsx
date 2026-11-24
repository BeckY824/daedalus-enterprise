"use client";

import { useEffect, useLayoutEffect } from "react";
import { useMiddlePane } from "@/lib/middle-pane";
import { 对话列表把手 } from "@/components/WidthHandle";

/**
 * 中栏还在路上时摆的骨架栏（客户 / 项目名单、首页对话列表）。
 *
 * **单独一个小文件**（跳转优化 PR-A 审查补）：壳里的 <槽位> → SlotSkeleton 会进每一页的首屏包，
 * 原来骨架写在 CustomerRoster.tsx 里，连着名单的 Drawer、dayjs、分组那一大套一起被带进去。这里只引 lib/middle-pane（壳本来就有）。
 *
 * 和真栏同一个判法：栏收在抽屉里（窄窗、人自己收起、手机）时什么都不摆，只在整栏露着时摆同宽的一栏——
 * 栏的底色和边线立刻就有（正文不左右跳），里面的灰条照 --skel-delay 晚 180ms 才淡入，快的看不见
 */
function 灰条们({ 行 = 8 }: { 行?: number }) {
  return (
    <div className="roster-skel" data-testid="roster-skeleton">
      <div className="skel-bar roster-skel-h" />
      {Array.from({ length: 行 }, (_, i) => (
        <div key={i} className="roster-skel-row">
          <div className="roster-skel-av" />
          <div className="roster-skel-m">
            <div className="skel-bar" />
            <div className="skel-bar" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 客户详情 / 项目详情的名单骨架（@pane/{customers,projects}/(detail)/layout.tsx 的 Suspense、SlotSkeleton 的中栏）。
 * 项目名单同一副，栏的类名照 ProjectRoster
 */
export function CustomerRosterSkeleton({ 项目 = false }: { 项目?: boolean }) {
  const 中栏 = useMiddlePane("roster");
  if (!中栏.露着) return null;
  return (
    <aside className={项目 ? "pane pane-roster" : "pane pane-roster pane-roster-cust"} aria-busy="true" aria-label="正在载入名单">
      <灰条们 />
    </aside>
  );
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * 首页对话列表的骨架栏（审查补：冷切到首页时中栏原来不画，对话列表晚到一拍才把正文往右推 232px）。
 * 宽度 = --chat-w：人拖过的宽度平时由对话列表里的把手（WidthHandle）挂到 <html> 上，没挂过（这一趟还没开过首页）就先照存档挂上
 */
export function ChatPaneSkeleton() {
  const 中栏 = useMiddlePane("chat");
  useIsoLayoutEffect(() => {
    const { 变量, 存档键, 最窄, 最宽 } = 对话列表把手;
    const root = document.documentElement;
    if (root.style.getPropertyValue(变量)) return;
    try {
      const 存的 = Number(localStorage.getItem(存档键));
      if (存的 >= 最窄 && 存的 <= 最宽) root.style.setProperty(变量, `${存的}px`);
    } catch {
      // 读不到存档就用默认宽
    }
  }, []);
  if (!中栏.露着) return null;
  return (
    <aside className="pane pane-chat" aria-busy="true" aria-label="正在载入对话列表">
      <灰条们 行={6} />
    </aside>
  );
}
