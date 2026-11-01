"use client";

import { useState, type ReactNode } from "react";

/**
 * 企业版项目详情的模块壳（11-01 用户：「页面各模块采用可展开/收起的瀑布流布局……各功能模块采用插件化设计，便于后续独立优化调整」
 * 「收起按钮，放在整个模块的上方的最右边。且换一个图标」）。
 * 任何一张卡（自己带 Card 的组件也行）包一层就能收起：卡头最右一颗圆角小按钮，开着箭头朝上、收着朝下；收起只藏卡身、留卡头。
 * 模块自己的按钮照旧摆在卡头 extra 里，这颗按钮挨在它们右边（globals.css .proj-fold）。
 * 开 / set开 不传 = 自己记着（默认开）；沟通、卡点要跟搜索联动，由页面管。锁开 = 搜索时都摊开、按钮灰着。
 */
export function ProjectFold({ id, 名, 开: 外开, set开: 外set开, 默认开 = true, 锁开 = false, 控制, children }: {
  /** 落点 id（如 #project-follow）挂在这层壳上 */
  id?: string;
  名: string;
  开?: boolean;
  set开?: (v: boolean) => void;
  默认开?: boolean;
  锁开?: boolean;
  /** 卡身的 id（aria-controls） */
  控制?: string;
  children: ReactNode;
}) {
  const [内开, set内开] = useState(默认开);
  const 开 = 外开 ?? 内开;
  const set开 = 外set开 ?? set内开;
  const 摊开 = 开 || 锁开;
  return (
    <div id={id} className={`proj-fold${摊开 ? "" : " is-closed"}`}>
      {children}
      <button
        type="button"
        className="proj-fold-btn"
        aria-expanded={摊开}
        aria-controls={控制}
        aria-label={`${摊开 ? "收起" : "展开"}${名}`}
        title={锁开 ? "搜索时都摊开" : 摊开 ? "收起" : "展开"}
        disabled={锁开}
        onClick={() => set开(!开)}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
          <path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
