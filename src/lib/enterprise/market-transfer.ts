import type { Prisma } from "@/generated/prisma";
import { 带走一位, 数进手的持有项目, type 带走的 } from "@/lib/carry-over-db";
import { 看全部 } from "@/lib/team-scope";
import { 随客户痕 } from "@/lib/project/carry-tasks";
import type { 留下的活, 同事待分配条 } from "./notice-sources";
import type { 组织 } from "./org-core";
import { 是市场角色, 是销售角色 } from "./permissions";
import { 企业版 } from "./switch";
import { 补客户分配, 还补的客户分配 } from "./customer-assign-way";
import { 客户分配序号, 分配方式叫法 } from "./dict";
import { 市场分配进线索验证, 推回潜客培育 } from "./market-assign-node";

/**
 * 市场首次分给销售 = 转客户（X-18）。分配线索、自动分配、客户页新建项目、新客户向导、首页 AI 录入（走向导）都走这一份：
 * 判定同一句，落库同一段。"use server" 文件只能导出动作，所以放这里。
 * 客户层转让（批量转、确认交接、客户页改负责人）也是这一份（X-45，11-09）：见 carry-over-db 的 带走并记下。
 */

/** 客户层没有「分配方式」这一格可选，转给销售就是指定了人（同 新客户向导 没选方式时的兜底） */
export const 客户层分配方式 = "指定分配";

/**
 * 「暂不分配」的线索分出去之后，项目「分配方式」写成这次实际的方式（审核 11-18 第 11 项）：口径表（V-分配方式、P-转-03、X-90）
 * 只说暂不分配 = 留在建的人名下、潜客培育，没说分出去还留着「暂不分配」。认暂不分配按字典当前叫法再认原名（同 cust-auto-assign 暂不分配项目of）
 */
export async function 暂不分配叫法们(db: Prisma.TransactionClient): Promise<string[]> {
  return [...new Set([await 分配方式叫法(3, db), "暂不分配"])];
}
/** 系统替人写进去的分出方式（指定 / 自动 / 公海捞取的当前叫法，加客户层兜底名）：撤销时只还还是这几种之一的，被人手改过的不动 */
async function 分出方式叫法们(db: Prisma.TransactionClient): Promise<string[]> {
  return [...new Set([await 分配方式叫法(0, db), await 分配方式叫法(1, db), await 分配方式叫法(2, db), 客户层分配方式])];
}
/** 撤销：这次从暂不分配改成分出方式的项目还成暂不分配（字典当前叫法）；where 由调用方给（还归接手人、还在线索……） */
export async function 还成暂不分配(tx: Prisma.TransactionClient, ids: string[], where: Prisma.ProjectWhereInput): Promise<void> {
  if (!ids.length) return;
  await tx.project.updateMany({ where: { ...where, id: { in: ids }, assignMode: { in: await 分出方式叫法们(tx) } }, data: { assignMode: await 分配方式叫法(3, tx) } });
}

/**
 * 客户负责人有市场角色且没有销售角色、客户不在公海；兼任的按销售算（用户 11-09）。角色只认业务角色。
 * 弹窗隐藏「待办一起转」的勾和服务端都用这一句
 */
export function 客户在市场手里(org: 组织, 客户: { salesOwnerId: string; pool: { customerId: string } | null } | null): boolean {
  return !!客户 && !客户.pool && 是市场角色(org, 客户.salesOwnerId) && !是销售角色(org, 客户.salesOwnerId);
}

/** 这位客户分给这个接手人，算不算转客户：客户在市场手里、接手的是另一位销售 */
export function 算市场转客户(org: 组织, 客户: { salesOwnerId: string; pool: { customerId: string } | null } | null, 接手人: string): boolean {
  return 客户在市场手里(org, 客户) && 客户?.salesOwnerId !== 接手人 && 是销售角色(org, 接手人);
}

/**
 * 公海项目给销售时客户还在市场手里，算不算转客户（P-公海-11、X-60，11-10）：同 算市场转客户；
 * 销售自己领的还要客户创建人是市场（有市场角色、没有销售角色；兼任按销售算），没有创建人那一行的不算。管理分配不看创建人
 */
export function 公海项目算市场转(
  org: 组织,
  客户: { salesOwnerId: string; pool: { customerId: string } | null; creator: { userId: string } | null } | null,
  接手人: string,
  自己领: boolean,
): boolean {
  if (!算市场转客户(org, 客户, 接手人)) return false;
  if (!自己领) return true;
  const 建 = 客户?.creator?.userId;
  return !!建 && 是市场角色(org, 建) && !是销售角色(org, 建);
}

/**
 * 公海项目（线索公海、项目公海）领 / 分给销售之前读客户、放开范围判 公海项目算市场转：算的回原负责人和随客户另进手的持有项目数（拦持有上限用，同 分配线索）。
 * 事务外（钉住老签约 前）传全局连接、事务里传 tx；不是企业版回 null
 */
export async function 公海项目市场转(
  db: Pick<Prisma.TransactionClient, "customer" | "project" | "customerOwnerLog" | "user">,
  org: 组织,
  p: { id: string; customerId: string },
  接手人: string,
  自己领: boolean,
): Promise<{ 原: string; 另进: number } | null> {
  if (!企业版()) return null;
  const 客户 = await 看全部(() => db.customer.findUnique({ where: { id: p.customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } }, creator: { select: { userId: true } } } }));
  if (!客户 || !公海项目算市场转(org, 客户, 接手人, 自己领)) return null;
  return { 原: 客户.salesOwnerId, 另进: await 数进手的持有项目([p.customerId], 接手人, { 同事待分配: true, 除了: [p.id] }, db) };
}

/**
 * 客户连同原负责人自己的项目、公海项目、同事待分配的项目、联系人交给销售；同事的别的项目负责人不变（P-转-07）；待办、计划还归市场（P-转-10）。
 * 被带走的项目不写分配记录（不占额度），转让痕记 随客户痕，「我分出去的」靠它显示。
 * 换负责人记录记 market-assign（「分配」）：这是分配不是转客户，不计转客户次数（P-转-03、P-公海-11）。
 * 要在事务里、放开范围调（市场转走后就看不到这位客户了）；老签约要在事务外先钉住（钉住老签约 用全局连接），刚建的客户没有签约不用钉。
 * 调用前客户要已经归 接手人：这里不写客户负责人。项目入口由 转客户给销售 在同一笔事务里写；
 * 客户层是外层先改好，带走并记下 进事务后核对还归接手人才调（中间被人改走的，写在这里就把人家的改动盖掉了）。
 * 回带走了什么，连同清掉的待分配、补上的分配方式：客户层撤销按它原样还（还待分配状态）。
 * 客户档案上的「客户分配」空着就补「非自持」（市场交给销售，11-17），补了的记在 补分配，撤销还成空；已有值的不改。
 * 推节点（审核 11-18，market-assign-node.ts）：原负责人（市场）自己的、同事待分配的项目停在潜客培育的，进线索验证，记在 推节点，撤销推回；
 * 同事在推的（P-转-07 一起带过来的，可能是销售自己建的）不推。公海领取 / 公海分配传 false，不推
 */
export async function 市场转一位(tx: Prisma.TransactionClient, customerId: string, 原: string, 接手人: string, 操作人: string, way: string, 推节点 = true) {
  const 带走 = await 带走一位(tx, customerId, 原, 接手人, 操作人, "assign", true, { 留下待办计划: true, 项目痕: 随客户痕, 记录种类: "market-assign" });
  // 带过来的都有负责人了：清掉待分配，不然批量里后面几条还会被当成没分的，再分给别人
  const 待分配 = await tx.project.findMany({ where: { customerId, ownerId: 接手人, awaitAssignAt: { not: null } }, select: { id: true, awaitAssignAt: true } });
  if (待分配.length) await tx.project.updateMany({ where: { id: { in: 待分配.map((p) => p.id) } }, data: { awaitAssignAt: null } });
  // 节点必填「分配方式」靠项目上这一格（required.ts）；建的时候已选的不改
  const 带走的项目 = [...带走.项目, ...带走.公海项目];
  const 补方式 = 带走的项目.length ? (await tx.project.findMany({ where: { id: { in: 带走的项目 }, phase: "线索", assignMode: null }, select: { id: true } })).map((p) => p.id) : [];
  if (补方式.length) await tx.project.updateMany({ where: { id: { in: 补方式 } }, data: { assignMode: way } });
  // 随客户带过去的「暂不分配」线索：改成这次的方式（客户层兜底名换成字典当前的指定分配叫法），记在 转方式，撤销还回暂不分配
  const 转方式 = 带走的项目.length ? (await tx.project.findMany({ where: { id: { in: 带走的项目 }, phase: "线索", assignMode: { in: await 暂不分配叫法们(tx) } }, select: { id: true } })).map((p) => p.id) : [];
  if (转方式.length) await tx.project.updateMany({ where: { id: { in: 转方式 } }, data: { assignMode: way === 客户层分配方式 ? await 分配方式叫法(0, tx) : way } });
  const 补分配 = (await 补客户分配(tx, customerId, 客户分配序号.非自持)) ? [customerId] : [];
  const 同事在推 = new Set(带走.同事待分配.filter((x) => x.在推).map((x) => x.id));
  const 推了 = 推节点 ? await 市场分配进线索验证(tx, 带走.项目.filter((id) => !同事在推.has(id)), 接手人, 操作人) : [];
  return { ...带走, 清待分配: [...带走.清待分配, ...待分配.map((p) => ({ id: p.id, at: p.awaitAssignAt!.toISOString() }))], 补方式, 转方式, 补分配, 推节点: 推了 };
}

/**
 * 项目入口用：回 留下，分配通知据此告诉接手人客户上还有多少原负责人的活；
 * 同事待分配 = 随客户换了负责人的同事待分配项目，调用方事务提交后发 同事待分配随客户通知（P-转-19）
 */
export async function 转客户给销售(tx: Prisma.TransactionClient, customerId: string, 原: string, 接手人: string, 操作人: string, way: string, 推节点 = true): Promise<{ 留下: 留下的活; 同事待分配: 同事待分配条[]; 带过来: 带走的 }> {
  await tx.customer.update({ where: { id: customerId }, data: { salesOwnerId: 接手人 } });
  const 带走 = await 市场转一位(tx, customerId, 原, 接手人, 操作人, way, 推节点);
  // 带过来：撤销自动分配（auto-assign-undo.ts）整批还原用，同客户层撤销的 带过来
  const { 计划, 待办, 商机, 项目, 公海项目, 清待分配, 补方式, 转方式, 补分配 } = 带走;
  return { 留下: { customerId, 原 }, 同事待分配: 带走.同事待分配, 带过来: { 计划, 待办, 商机, 项目, 公海项目, 清待分配, 补方式, 转方式, 补分配, 推节点: 带走.推节点 } };
}

/**
 * 撤销客户层转让时还 市场转一位 动过的几格（P-撤销-01 按原样回滚）：待分配时刻、项目分配方式（补的还成空、从暂不分配改的还成暂不分配）、客户分配、推进线索验证的节点。要在 还项目 之前调：
 * 只还「现在还归接手人」的，撤销之前被人分走、推进了的不动。时刻是前端传回来的，不是合法时间的跳过。
 * 一批客户一起还：同一个时刻的一次改（一批转出去的多半是同一刻进的待分配）
 */
export async function 还待分配状态(tx: Prisma.TransactionClient, 带过来: 带走的, customerId: string | string[], 接手人: string) {
  const 还归他 = { customerId: { in: typeof customerId === "string" ? [customerId] : customerId }, ownerId: 接手人, phase: "线索" };
  const 按时刻 = new Map<number, string[]>();
  for (const { id, at } of 带过来.清待分配 ?? []) {
    const t = new Date(at).getTime();
    if (!Number.isNaN(t)) 按时刻.set(t, [...(按时刻.get(t) ?? []), id]);
  }
  for (const [t, ids] of 按时刻) await tx.project.updateMany({ where: { id: { in: ids }, ...还归他, result: null, pooledAt: null, awaitAssignAt: null }, data: { awaitAssignAt: new Date(t) } });
  if (带过来.补方式?.length) await tx.project.updateMany({ where: { id: { in: 带过来.补方式 }, ...还归他, assignMode: 客户层分配方式 }, data: { assignMode: null } });
  await 还成暂不分配(tx, 带过来.转方式 ?? [], 还归他);
  await 还补的客户分配(tx, 带过来.补分配, 还归他.customerId.in);
  // 推节点：只认 市场分配进线索验证 那一行还是最后一次节点变更的（推回潜客培育 自己核），撤销之前被人推过、判过的不动
  if (带过来.推节点?.length) await 推回潜客培育(tx, 带过来.推节点, 接手人);
}
