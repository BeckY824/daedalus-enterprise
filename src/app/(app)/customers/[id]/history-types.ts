/**
 * 客户详情「历史变更」浏览器、服务端共用的类型和常量（11-24）：不碰库，HistoryChanges.tsx 直接 import；取数在 history-data.ts
 */
export const 历史每页 = 30;

/** 客户块的类型筛选（原型：全部 / 负责人 / 状态 / 资料修改 / 同号录入）；进出公海归在「负责人」里（换了谁在管） */
export const 历史筛选们 = ["全部", "负责人", "状态", "资料修改", "同号录入"] as const;
export type 历史筛选 = (typeof 历史筛选们)[number];
export const 是历史筛选 = (v: unknown): v is 历史筛选 => typeof v === "string" && (历史筛选们 as readonly string[]).includes(v);

/** 一条变更：标 = 左边那枚小标（负责人 / 公海 / 状态 / 资料修改 / 同号录入 / 节点 / 转让 / 领取 / 线索验证 / 卡点）；因 = 下面灰字几行 */
export type 历史事件 = { id: string; at: string; 标: string; 文: string; 谁: string; 因: string[] };
/** 列表里一行：单条，或同一天同一批的系统批量修正折成的一组（键 = 北京日 | 批次，翻页接上时同键的并成一组） */
export type 历史行 = { 种: "事件"; 事件: 历史事件 } | { 种: "批量"; 键: string; 说明: string; 事件们: 历史事件[] };
export type 历史游标 = { at: string; id: string };
export type 建档格 = { 时间: string; 行们: { 键: string; 值: string }[] };
export type 历史页 = { 行们: 历史行[]; 更早: 历史游标 | null };

/** 项目块里一节的头：名字、阶段 · 节点、这一节一共几条 */
export type 项目概要 = { id: string; 名: string; 阶段: string; 条数: number };
/** 入口小方框上的数（页面首屏一句 SQL）：我看得到的客户 / 项目变更条数、看得到的项目个数、最近一条的时刻 */
/** 状态 = 三态开着（关着不数客户状态留痕、筛选里不摆「状态」） */
export type 历史摘要 = { 客户: number; 项目: number; 项目数: number; 最近: string | null; 状态: boolean };
