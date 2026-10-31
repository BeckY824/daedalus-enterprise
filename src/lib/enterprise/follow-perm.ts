/**
 * 企业版沟通记录谁能改、谁能删（2026-10-31 M-权限-09）：普通成员记完就不能改、不能删；
 * 总管理员和经理（账号是管理员 / 主管，或组织里是总管理员 / 销售管理）可以，删了照旧软删进回收站。
 * 「PLUS 成员批量删」这一版不做（A-13 待问，先按总管理员 + 经理）。改这个口径只改这里。
 *
 * 不是企业版一律 true：团队版 / 桌面端还按原来的规矩（同事的客户只读那条）。
 */
import { 企业版 } from "./switch";
import { 读组织, 管理员类别们of, type 组织 } from "./org";

export const 不能删改沟通话 = "只有总管理员和经理能改、删沟通记录";

/** 纯函数：给了组织表（没有 = 只看账号角色） */
export function 能删改沟通of(me: { id: string; role: string }, org: 组织 | null): boolean {
  if (me.role === "ADMIN" || me.role === "MANAGER") return true;
  if (!org) return false;
  const 们 = 管理员类别们of(org, me.id);
  return 们.has("总管理员") || 们.has("销售管理");
}

export async function 能删改沟通(me: { id: string; role: string }): Promise<boolean> {
  if (!企业版()) return true;
  if (me.role === "ADMIN" || me.role === "MANAGER") return true;
  return 能删改沟通of(me, await 读组织());
}
