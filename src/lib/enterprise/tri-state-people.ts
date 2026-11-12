/**
 * 客户三态 · 找人（纯函数，不碰库）：提醒发给谁（tri-state-notice.ts）和谁能裁决 / 待回收时谁能写理由继续持有（permissions.ts）用同一套，
 * 收到提醒的人一定点得了（M-公海-17、M-公海-24、X-37）。
 *
 *   条线总管理：客户业务线（内贸 / 外贸）那条线的条线总管理；客户没填 / 暂不分配按负责人的线（负责人停用了按他停用前的线也读不到，直接兜底）；
 *              那条线没有条线总管理、或两边都没有线 → 系统管理员
 *   直属上级：负责人的实线直属上级；负责人停用了按他停用前手填的上级（还在职才算，同 org-core.ts 离职直属上级）；
 *            都没有 → 往上一级 = 条线总管理（再没有就系统管理员）
 *   本人：负责人在职才发（停用了不发）
 */
import { 直属上级of, 是系统管理员of, type 组织 } from "./org-core";
import { 条线的线 } from "./line-viewer";

const 是线 = (x: string | null | undefined): x is "内贸" | "外贸" => x === "内贸" || x === "外贸";

export const 系统管理员们 = (org: 组织): string[] => [...org.成员.keys()].filter((id) => 是系统管理员of(org, id));

/** 找哪几位条线总管理（M-公海-24）：客户业务线 → 负责人的线 → 系统管理员 */
export function 找条线总管理(org: 组织, 客户线: string | null | undefined, ownerId: string): string[] {
  const 线 = 是线(客户线) ? 客户线 : org.成员.get(ownerId)?.line ?? null;
  const 们 = 线 ? [...org.成员.keys()].filter((id) => 条线的线(org, id) === 线) : [];
  return 们.length ? 们 : 系统管理员们(org);
}

/** 负责人在职就是直属上级；停用了按停用前手填的上级（在职才算） */
function 上级(org: 组织, ownerId: string): string | null {
  if (org.成员.has(ownerId)) return 直属上级of(org, ownerId);
  const 上 = org.离职上级?.get(ownerId);
  return 上 && org.成员.has(上) ? 上 : null;
}

/** 直属上级那一级（X-37）：没有 / 停用了往上一级找条线总管理，都没有给系统管理员 */
export function 找直属上级(org: 组织, 客户线: string | null | undefined, ownerId: string): string[] {
  const 上 = 上级(org, ownerId);
  return 上 ? [上] : 找条线总管理(org, 客户线, ownerId);
}

/** 「已回公海」第 2 次起抄谁（M-公海-28）：原负责人的直属上级，停用了按停用前的上级；不往总管理兜底 */
export const 原负责人上级 = (org: 组织, ownerId: string): string | null => 上级(org, ownerId);

/** 负责人本人那一级：在职才发 */
export const 本人在职 = (org: 组织, ownerId: string): boolean => org.成员.has(ownerId);
