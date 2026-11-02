/**
 * 企业版沟通记录谁能改、谁能删（2026-10-31 M-权限-09，11-02 再定）：
 * - 改 = 负责人（11-02「负责人都可以对其中的内容进行编辑」）：这条沟通挂的项目的负责人，或客户的负责人；
 *   负责人要有销售 / 销售管理角色，项目、客户在公海里不算，管理员（admin）只读。上级、总管理只看、只转让（11-01），不改。
 * - 删 = 只有总管理（「删除的权限是只对总管理」，C3）；本人刚记的 撤销窗口分钟 以内能撤。删了照旧软删进回收站。
 * 账号是管理员 / 主管不算，只认业务角色。改这个口径只改这里。
 *
 * 不是企业版一律 true：团队版 / 桌面端还按原来的规矩（同事的客户只读那条）。
 */
import { 企业版 } from "./switch";
import { 权限组织, type 组织 } from "./org";
import { 能删除, 有业务角色, 只读角色 } from "./permissions";
import { defaultClient } from "@/lib/prisma";

export const 不能改沟通话 = "只有负责人能改沟通记录";
export const 不能删沟通话 = "只有总管理能删沟通记录";

type 谁 = { id: string; role: string };

/** 纯函数：负责人们 = 这条沟通挂的项目负责人、客户负责人（在公海的不给）。企业版 org 没给 = 拒 */
export function 能改沟通of(me: 谁, 负责人们: readonly (string | null | undefined)[], org: 组织 | null): boolean {
  if (!org || 只读角色(me, org)) return false;
  return 负责人们.includes(me.id) && 有业务角色(me, org, "sales", "sales_mgr");
}

/** 纯函数：删 = 总管理 */
export function 能删沟通of(me: 谁, org: 组织 | null): boolean {
  return 能删除(me, org);
}

/**
 * 刚记下的本人可以撤销（删）：AI 卡片确认后的「撤销」、记错了马上撤，都走 deleteFollowUp。
 * 只认本人记的、记下 撤销窗口分钟 以内的；过了这个时间就和别的沟通一样，只有总管理能删
 */
export const 撤销窗口分钟 = 10;
export function 刚记的能撤(me: { id: string }, f: { ownerId: string | null; createdAt: Date }, now: Date = new Date()): boolean {
  return f.ownerId === me.id && now.getTime() - f.createdAt.getTime() <= 撤销窗口分钟 * 60_000;
}

/** 这条沟通的负责人们：客户负责人（客户不在公海）+ 挂的项目的负责人（项目不在公海） */
export async function 沟通负责人们(customerId: string, followUpId?: string): Promise<string[]> {
  const c = await defaultClient.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
  const 们: string[] = [];
  if (c?.salesOwnerId && !c.pool) 们.push(c.salesOwnerId);
  if (followUpId) {
    const 挂 = await defaultClient.followUpProject.findMany({ where: { followUpId }, select: { project: { select: { ownerId: true, pooledAt: true } } } });
    for (const x of 挂) if (x.project && !x.project.pooledAt) 们.push(x.project.ownerId);
  }
  return 们;
}

/** 能不能改这条沟通（服务端用）：不是企业版 true */
export async function 能改这条沟通(me: 谁, f: { customerId: string; id?: string }): Promise<boolean> {
  if (!企业版()) return true;
  return 能改沟通of(me, await 沟通负责人们(f.customerId, f.id), await 权限组织());
}

export async function 能删沟通(me: 谁): Promise<boolean> {
  if (!企业版()) return true;
  return 能删沟通of(me, await 权限组织());
}
