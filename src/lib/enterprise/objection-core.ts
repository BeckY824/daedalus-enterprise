/**
 * 12-22 第 2 阶段 · 转让异议 · 纯函数（不碰库）：异议期、理由上限、裁定人怎么算（判定页 #18，终审 1）。
 *
 * 裁定人 = 让这次变动生效的那个人的上一级：
 *   实线上级办的 → 条线总管理（客户业务线那条线的；那条线没有就系统管理员，同 找条线总管理）；
 *   条线总管理办的 → 系统管理员；
 *   系统管理员办的 → 其他系统管理员（只有他一位时只能是他自己，🔍 判定页没覆盖，照实记「系统管理员」、通知他本人）。
 * 异议人本人不当裁定人（自己的异议不自己裁）；去掉后没人就退到系统管理员里别的人，再没有才回空（调用方拦并说清）。
 */
import { 是系统管理员of, type 组织 } from "./org-core";
import { 条线的线 } from "./line-viewer";
import { 找条线总管理, 系统管理员们 } from "./tri-state-people";

/** 异议期：转让生效起 30 天（判定页 三-1，E-380:12、E-414） */
export const 异议期天数 = 30;
/** 理由字数上限（判定页 #18，必填 ≤200 字） */
export const 异议理由上限 = 200;
export const 异议可提 = "可提";
export const 异议待裁定 = "待裁定";

export type 裁定人结果 = { ids: string[]; 角色: "条线总管理" | "系统管理员" };

export function 算裁定人(org: 组织, 操作人: string, 客户线: string | null | undefined, 原负责人: string, 异议人: string): 裁定人结果 {
  const 去自己 = (ids: string[]) => [...new Set(ids)].filter((id) => id !== 异议人);
  const 管理员们 = 系统管理员们(org);
  const 管理员办的 = 是系统管理员of(org, 操作人) || !!条线的线(org, 操作人);
  if (管理员办的) {
    // 系统管理员办的：别的系统管理员；就他一位的话只能他自己（🔍）
    const 别人 = 去自己(管理员们.filter((id) => id !== 操作人));
    return { ids: 别人.length ? 别人 : 去自己(管理员们), 角色: "系统管理员" };
  }
  // 条线总管理办的由系统管理员裁定，实线上级办的由条线总管理裁定（操作人已停用 / 不在组织里按实线上级办的算）
  const 线上 = 去自己(找条线总管理(org, 客户线, 原负责人));
  if (线上.length) return { ids: 线上, 角色: 线上.some((id) => 条线的线(org, id)) ? "条线总管理" : "系统管理员" };
  return { ids: 去自己(管理员们), 角色: "系统管理员" };
}

/** 转让生效的这一刻起的最后一天 */
export const 异议截止 = (转让时刻: Date): Date => new Date(转让时刻.getTime() + 异议期天数 * 86_400_000);

/** 一条异议入口的链接：只一条直接带上，几条去列表 */
export const 异议链接 = (ids: readonly string[]): string => (ids.length === 1 ? `/objections?o=${ids[0]}` : "/objections");
