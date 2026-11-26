"use client";

/**
 * 合并客户第一批（11-25，docs/合并客户-第一批-落地.md 第四节）：客户详情里三个入口点了要开哪只框。
 *
 * 入口在 RecordView（「更多操作 ▾」里的「合并客户」「换客户」、联系人「⋯」里的「和另一位合成」），
 * 框在 MergeHost（page.tsx 当槽递进来，同「历史变更」）。RecordView 不直接引框：框里调 merge-actions（服务端动作），
 * 客户详情那二十几个界面测试打包 RecordView 时不用各自再桩一份。这里只放请求的形状和一个 context，什么都不引
 */
import { createContext } from "react";

/** 联系人「⋯」里「和另一位合成」置灰的原因（12-02，RecordView 合成灰因；电脑悬停、手机灰项下面一行小字） */
export { 挂靠联系人不能合成, 只有一位联系人不能合成 } from "@/lib/enterprise/merge-hints";

export type 合成候选人 = { id: string; name: string; 职务: string | null; 关键: boolean; 号: string | null };

export type 合并请求 =
  /** 预选：并进来那家已经定了（疑似重复清单），框一开就读预览；形状同 merge-actions 的 合并候选 */
  | { 种: "客户"; 预选?: { id: string; name: string; 编号: string | null; 负责人: string | null; 要申请?: boolean } }
  | { 种: "联系人"; 留: 合成候选人; 们: 合成候选人[] }
  | { 种: "项目"; projectId: string; 名: string }
  /** 并进另一个项目（第二批 2a）：从这个项目（被并掉的）出发，框里选留下的那个；客户页、项目详情页都从这里开 */
  | { 种: "并项目"; projectId: string; 名: string };

/** 次 = 点的那一下的序号：同一个入口连点两次（关了再开）也认成新的一次 */
export type 合并桥值 = { 请求: (合并请求 & { 次: number }) | null; 收: () => void };

export const 合并桥 = createContext<合并桥值>({ 请求: null, 收: () => {} });
