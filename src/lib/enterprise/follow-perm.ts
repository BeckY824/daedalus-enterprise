/**
 * 企业版沟通记录谁能改、谁能删（2026-10-31 M-权限-09）：普通成员记完就不能改、不能删；
 * 11-01 起只认业务角色、只有总管理能删（C3）：改、删都只给总管理（director；管理员 admin 只读），销售管理不再能删改；
 * 账号是管理员 / 主管不算。删了照旧软删进回收站。改这个口径只改这里。
 *
 * 不是企业版一律 true：团队版 / 桌面端还按原来的规矩（同事的客户只读那条）。
 */
import { 企业版 } from "./switch";
import { 权限组织, type 组织 } from "./org";
import { 能删除 } from "./permissions";

export const 不能删改沟通话 = "只有总管理能改、删沟通记录";

/** 纯函数：企业版 org 没给 = 拒 */
export function 能删改沟通of(me: { id: string; role: string }, org: 组织 | null): boolean {
  return 能删除(me, org);
}

/**
 * 刚记下的本人可以撤销（删）：AI 卡片确认后的「撤销」、记错了马上撤，都走 deleteFollowUp。
 * 只认本人记的、记下 撤销窗口分钟 以内的；过了这个时间就和别的沟通一样，普通成员删不了
 */
export const 撤销窗口分钟 = 10;
export function 刚记的能撤(me: { id: string }, f: { ownerId: string | null; createdAt: Date }, now: Date = new Date()): boolean {
  return f.ownerId === me.id && now.getTime() - f.createdAt.getTime() <= 撤销窗口分钟 * 60_000;
}

export async function 能删改沟通(me: { id: string; role: string }): Promise<boolean> {
  if (!企业版()) return true;
  return 能删改沟通of(me, await 权限组织());
}
