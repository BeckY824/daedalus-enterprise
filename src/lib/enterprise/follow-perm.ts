/**
 * 企业版沟通记录谁能改、谁能删（2026-10-31 M-权限-09，11-02 再定，11-09 按 M-权限-09 原口径收紧）：
 * - 管理（销售管理 / 市场管理 / 总管理）以下都算普通用户，负责人本人也算：单条沟通不能改、不能删。界面不给入口，服务端也拒。
 * - 改 = 负责人（这条沟通挂的项目的负责人，或客户的负责人；项目、客户在公海里不算），且是管理：
 *   负责人要有销售 / 销售管理 / 渠运角色（同 负责人能改of），再要有管理角色。管理员（admin）只读。
 * - 删 = 系统管理员，或负责人本人（V3.5.1，同 permissions.ts 能删除）且是管理。删了照旧软删进回收站。
 *   本人刚记的不再能自己撤（P-沟通-01，11-09）；只有 AI 卡片「撤销」、完成小框「撤销记一笔」按 卡片刚记的能撤 单独放行。
 * - 批量删（PLUS 成员）不在这里。
 * 账号是管理员 / 主管不算，只认业务角色。改这个口径只改这里。
 *
 * 不是企业版一律 true：团队版 / 桌面端还按原来的规矩（同事的客户只读那条）。
 */
import { 企业版 } from "./switch";
import { 权限组织, type 组织 } from "./org";
import { 能删除, 有业务角色, 只读角色, 只读角色话, 没设业务角色, 能改客户 } from "./permissions";
import { defaultClient, prisma } from "@/lib/prisma";
import { 限定的我 } from "@/lib/team-scope";
import { 看得到的客户 } from "@/lib/project/db";
import { 全进程上下文 } from "@/lib/process-als";

export const 不能改沟通话 = "沟通记录只有管理（销售管理、市场管理、总管理）能改";
export const 不能删沟通话 = "沟通记录只有管理（销售管理、市场管理、总管理）或系统管理员能删";

type 谁 = { id: string; role: string };

/**
 * 纯函数：是不是负责人（负责人们里有自己、有销售 / 销售管理 / 渠运角色、不是只读角色）。
 * 客户事项挡（待办、计划、联系人）照这个；沟通的改、删还要再是管理（能改沟通of / 能删沟通of）
 */
export function 负责人能改of(me: 谁, 负责人们: readonly (string | null | undefined)[], org: 组织 | null): boolean {
  if (!org || 只读角色(me, org)) return false;
  return 负责人们.includes(me.id) && 有业务角色(me, org, "sales", "sales_mgr", "channel_ops");
}

/** 纯函数：管理（销售管理 / 市场管理 / 总管理）。M-权限-09：这以下的人单条沟通不能改、不能删 */
export function 管沟通的(me: 谁, org: 组织 | null): boolean {
  return 有业务角色(me, org, "sales_mgr", "marketing_mgr", "director");
}

/** 纯函数：改 = 负责人且是管理。负责人们 = 这条沟通挂的项目负责人、客户负责人（在公海的不给）。企业版 org 没给 = 拒 */
export function 能改沟通of(me: 谁, 负责人们: readonly (string | null | undefined)[], org: 组织 | null): boolean {
  return 管沟通的(me, org) && 负责人能改of(me, 负责人们, org);
}

/** 纯函数：删 = 系统管理员，或负责人们里有自己且是管理（负责人们同 能改沟通of） */
export function 能删沟通of(me: 谁, 负责人们: readonly (string | null | undefined)[], org: 组织 | null): boolean {
  return 管沟通的(me, org) && [null, ...负责人们].some((x) => 能删除(me, org, x));
}

/** AI 卡片「撤销」、完成小框「撤销记一笔」能撤的窗口（P-沟通-01：本人撤销沟通去掉了，这两处单独判定） */
export const 卡片撤销窗口分钟 = 10;
export const 卡片撤销过时话 = `只能撤销自己刚记的（${卡片撤销窗口分钟} 分钟内），这条撤不了了`;

/** 纯函数：AI 卡片撤销 / 撤销记一笔——本人记的、记下 卡片撤销窗口分钟 以内。普通删沟通不认它 */
export function 卡片刚记的能撤(me: { id: string }, f: { ownerId: string | null; createdAt: Date }, now: Date = new Date()): boolean {
  if (!f.ownerId || f.ownerId !== me.id) return false;
  return now.getTime() - f.createdAt.getTime() <= 卡片撤销窗口分钟 * 60_000;
}

/*
 * AI 卡片撤销走 deleteFollowUp（软删、审计、最近跟进重算都在里面），但 deleteFollowUp 是谁都能调的服务端动作，
 * 不能凭「本人刚记的」放行（那就是去掉的本人撤销）。只有 undoProposal 在这里面调的那一条才放行；这个文件不是服务端动作文件，前端调不到
 */
const 卡片撤销中 = 全进程上下文<string>("ai-card-undo");
export function 卡片撤销放行<T>(followUpId: string, fn: () => Promise<T>): Promise<T> {
  return 卡片撤销中.run(followUpId, fn);
}
export function 在卡片撤销里(followUpId: string): boolean {
  return 卡片撤销中.getStore() === followUpId;
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

/** 能不能删这条沟通（服务端用）：不给 f = 页面级（这位客户 / 项目下的沟通），按客户负责人判；不是企业版 true */
export async function 能删沟通(me: 谁, f: { customerId: string; id?: string }): Promise<boolean> {
  if (!企业版()) return true;
  return 能删沟通of(me, await 沟通负责人们(f.customerId, f.id), await 权限组织());
}

export const 没业务角色话 = "你还没有业务角色，不能改数据，请找总管理设置";
export const 不能改客户事项话 = "只有负责人能改这位客户的待办、计划和联系人";

/**
 * 企业版客户详情上跟着客户走的小事（待办、下次计划、联系人移出 / 挂回，11-02）：同沟通——客户负责人或这位客户下项目的负责人改，
 * 没业务角色、管理员、公海里的拒；上级、总管理只看。不是企业版 null（团队版限定层照旧）
 */
export async function 客户事项挡(me: 谁, customerId: string | null | undefined): Promise<string | null> {
  if (!企业版()) return null;
  const org = await 权限组织();
  if (!org || 没设业务角色(org, me.id)) return 没业务角色话;
  if (只读角色(me, org)) return 只读角色话;
  if (!customerId) return null;
  const c = await defaultClient.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
  if (!c) return null; // 不在了：后面照原样报
  if (c.pool) return "这位客户在公海里，先领取再改";
  if (能改客户(me, { salesOwnerId: c.salesOwnerId, 在公海: false }, org)) return null;
  const 项目 = await defaultClient.project.findMany({ where: { customerId, pooledAt: null }, select: { ownerId: true } });
  return 负责人能改of(me, 项目.map((x) => x.ownerId), org) ? null : 不能改客户事项话;
}

/**
 * 勾完成 / 取消完成自己名下的待办、计划（11-09，P-转-10）：市场把客户分给销售后这些活还归他，人已经不是负责人，
 * 只放开「不是负责人」这一条。没业务角色、只读角色、公海里的照旧拒；编辑、删除不走这里
 */
export async function 本人勾完成挡(me: 谁, customerId: string | null | undefined, ownerId: string | null | undefined): Promise<string | null> {
  const 挡 = await 客户事项挡(me, customerId);
  return 挡 === 不能改客户事项话 && ownerId === me.id ? null : 挡;
}

/**
 * 计划页上我看得到的事项有哪些够不着（11-09）：限定层放行自己和下属名下的待办、计划，客户却可能进不去（只负责项目的人，
 * 市场分出去后活还归他 P-转-10；上级看下属留下的这些也一样）。只管页面上给不给入口，谁能看、谁能改的范围不在这里定。
 * - 进不了：客户详情开不了，也记不了沟通（saveFollowUp 走限定层）。客户名不给链接，计划点完成不弹记沟通的小框
 * - 改不了：进不了里头，这位客户下也没有我负责的项目，客户事项挡 不让改删。改、删按钮不给
 * 不限定的（个人版、团队版不走这里，老板、没开按组织看的）两样都空
 */
export async function 名下事项够不着(me: 谁): Promise<{ 进不了: string[]; 改不了: string[] }> {
  if (!企业版() || !(await 限定的我(defaultClient))) return { 进不了: [], 改不了: [] };
  const [计划们, 待办们] = await Promise.all([
    prisma.followPlan.findMany({ distinct: ["customerId"], select: { customerId: true } }),
    prisma.task.findMany({ distinct: ["customerId"], select: { customerId: true } }),
  ]);
  const 事项的客户 = [...new Set([...计划们, ...待办们].map((x) => x.customerId))];
  const 进得去 = await 看得到的客户(事项的客户);
  const 进不了 = 事项的客户.filter((c) => !进得去.has(c));
  if (!进不了.length) return { 进不了: [], 改不了: [] };
  const org = await 权限组织();
  // 同 客户事项挡：项目负责人要有销售一类角色、项目不在公海、已结束的也算
  const 我的项目 = 负责人能改of(me, [me.id], org)
    ? await defaultClient.project.findMany({ where: { ownerId: me.id, pooledAt: null, customerId: { in: 进不了 } }, distinct: ["customerId"], select: { customerId: true } })
    : [];
  const 能改 = new Set(我的项目.map((x) => x.customerId));
  return { 进不了, 改不了: 进不了.filter((c) => !能改.has(c)) };
}
