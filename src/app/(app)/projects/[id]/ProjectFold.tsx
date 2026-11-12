"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Button, Space, Tooltip } from "antd";

/**
 * 企业版项目详情的模块壳（11-01 用户：「页面各模块采用可展开/收起的瀑布流布局……各功能模块采用插件化设计，便于后续独立优化调整」
 * 「收起按钮，放在整个模块的上方的最右边。且换一个图标」）。
 * 任何一张卡（自己带 Card 的组件也行）包一层就能收起：卡头最右一颗圆角小按钮，开着箭头朝上、收着朝下；收起只藏卡身、留卡头。
 * 模块自己的按钮照旧摆在卡头 extra 里，这颗按钮挨在它们右边（globals.css .proj-fold）。
 * 开 / set开 不传 = 自己记着（默认开）；沟通、卡点要跟搜索联动，由页面管。锁开 = 搜索时都摊开、按钮灰着。
 *
 * 11-12 用户「模块内的按钮格式保持一致，都以完成节点为参照」：连体 = 不摆那颗独立的收起钮，
 * 由卡头里的 FoldSplit（左半主动作、右半收起 / 展开）接手，见下面
 */
type 折叠态 = { 摊开: boolean; 锁开: boolean; 名: string; 控制?: string; 切: () => void };
const 折叠上下文 = createContext<折叠态 | null>(null);

export function ProjectFold({ id, 名, 开: 外开, set开: 外set开, 默认开 = true, 锁开 = false, 控制, 连体 = false, children }: {
  /** 落点 id（如 #project-follow）挂在这层壳上 */
  id?: string;
  名: string;
  开?: boolean;
  set开?: (v: boolean) => void;
  默认开?: boolean;
  锁开?: boolean;
  /** 卡身的 id（aria-controls） */
  控制?: string;
  /** 收起 / 展开并进卡头的连体按钮（FoldSplit）右半，不摆独立的那颗 */
  连体?: boolean;
  children: ReactNode;
}) {
  const [内开, set内开] = useState(默认开);
  const 开 = 外开 ?? 内开;
  const set开 = 外set开 ?? set内开;
  const 摊开 = 开 || 锁开;
  return (
    <折叠上下文.Provider value={{ 摊开, 锁开, 名, 控制, 切: () => set开(!开) }}>
      <div id={id} className={`proj-fold${摊开 ? "" : " is-closed"}${连体 ? " has-split" : ""}`}>
        {children}
        {!连体 && (
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
            {连体箭头}
          </button>
        )}
      </div>
    </折叠上下文.Provider>
  );
}

/** 连体按钮右半的箭头：收起钮和「完成节点 ▾」同一个图标、同一个大小 */
export const 连体箭头 = (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden focusable="false">
    <path d="M4 6.5 8 10.5 12 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * 连体按钮的色调（11-12 先这样定，改成全部同色只改这一处）：
 *   success = 完成节点（绿底白字，ProjectDetail 进程钮，样式 .proj-done-btn）
 *   brand   = 品牌蓝实心（新建沟通，它本来就是卡头主按钮）
 *   plain   = 同外形的描边款（新建待办、新建卡点）
 */
export type 连体色 = "success" | "brand" | "plain";
export const 模块钮色: Record<"沟通" | "待办" | "卡点", 连体色> = { 沟通: "brand", 待办: "plain", 卡点: "plain" };

/** 左半主动作：灰着时写原因（悬停看），点不了但右半照样能收起 */
export type 连体主钮 = { 字: string; onClick: () => void; disabled?: boolean; 原因?: string; testid?: string; 主快捷?: boolean };

/**
 * 模块卡头的连体按钮（外形照「完成节点」：左半主动作 + 右半一个小箭头），右半是这个模块的收起 / 展开（ProjectFold 连体）。
 * 左半没有可用动作（只读、没权限）就只剩右半那颗，外形不变。只能放在 <ProjectFold 连体> 里面
 */
export function FoldSplit({ 主, 色 = "plain" }: { 主?: 连体主钮 | null; 色?: 连体色 }) {
  const 折 = useContext(折叠上下文);
  if (!折) return null;
  const 型 = 色 === "brand" ? "primary" as const : undefined;
  const 类 = 色 === "success" ? "proj-done-btn" : undefined;
  const 左 = 主 && (
    <Button
      type={型}
      className={类}
      disabled={!!主.disabled || !!主.原因}
      onClick={主.onClick}
      data-testid={主.testid}
      {...(主.主快捷 ? { "data-cmd-new": "" } : {})}
    >
      {主.字}
    </Button>
  );
  return (
    <Space.Compact className={`split-btn split-${色}${主 ? "" : " split-solo"}`}>
      {左 && (主!.原因 ? <Tooltip title={主!.原因}><span className="proj-stage-tip">{左}</span></Tooltip> : 左)}
      <Button
        type={型}
        className={`split-caret${类 ? ` ${类}` : ""}`}
        icon={连体箭头}
        aria-expanded={折.摊开}
        aria-controls={折.控制}
        aria-label={`${折.摊开 ? "收起" : "展开"}${折.名}`}
        title={折.锁开 ? "搜索时都摊开" : 折.摊开 ? "收起" : "展开"}
        disabled={折.锁开}
        onClick={折.切}
      />
    </Space.Compact>
  );
}
