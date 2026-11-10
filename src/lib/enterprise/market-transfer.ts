import type { Prisma } from "@/generated/prisma";
import { 带走一位, type 带走的 } from "@/lib/carry-over-db";
import { 随客户痕 } from "@/lib/project/carry-tasks";
import type { 留下的活, 同事待分配条 } from "./notice-sources";
import type { 组织 } from "./org-core";
import { 是市场角色, 是销售角色 } from "./permissions";

/**
 * 市场首次分给销售 = 转客户（X-18）。分配线索、自动分配、客户页新建项目、新客户向导、首页 AI 录入（走向导）都走这一份：
 * 判定同一句，落库同一段。"use server" 文件只能导出动作，所以放这里。
 * 客户层转让（批量转、确认交接、客户页改负责人）也是这一份（X-45，11-09）：见 carry-over-db 的 带走并记下。
 */

/** 客户层没有「分配方式」这一格可选，转给销售就是指定了人（同 新客户向导 没选方式时的兜底） */
export const 客户层分配方式 = "指定分配";

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
 * 客户连同原负责人自己的项目、公海项目、同事待分配的项目、联系人、进行中的商机交给销售；同事的别的项目负责人不变（P-转-07）；待办、计划还归市场（P-转-10）。
 * 被带走的项目不写分配记录（不占额度），转让痕记 随客户痕，「我分出去的」靠它显示。
 * 换负责人记录记 market-assign（「分配」）：这是分配不是转客户，不计转客户次数（P-转-03、P-公海-11）。
 * 要在事务里、放开范围调（市场转走后就看不到这位客户了）；老签约要在事务外先钉住（钉住老签约 用全局连接），刚建的客户没有签约不用钉。
 * 调用前客户要已经归 接手人：这里不写客户负责人。项目入口由 转客户给销售 在同一笔事务里写；
 * 客户层是外层先改好，带走并记下 进事务后核对还归接手人才调（中间被人改走的，写在这里就把人家的改动盖掉了）。
 * 回带走了什么，连同清掉的待分配、补上的分配方式：客户层撤销按它原样还（还待分配状态）
 */
export async function 市场转一位(tx: Prisma.TransactionClient, customerId: string, 原: string, 接手人: string, 操作人: string, way: string) {
  const 带走 = await 带走一位(tx, customerId, 原, 接手人, 操作人, "assign", true, { 留下待办计划: true, 项目痕: 随客户痕, 记录种类: "market-assign" });
  // 带过来的都有负责人了：清掉待分配，不然批量里后面几条还会被当成没分的，再分给别人
  const 待分配 = await tx.project.findMany({ where: { customerId, ownerId: 接手人, awaitAssignAt: { not: null } }, select: { id: true, awaitAssignAt: true } });
  if (待分配.length) await tx.project.updateMany({ where: { id: { in: 待分配.map((p) => p.id) } }, data: { awaitAssignAt: null } });
  // 节点必填「分配方式」靠项目上这一格（required.ts）；建的时候已选的不改
  const 带走的项目 = [...带走.项目, ...带走.公海项目];
  const 补方式 = 带走的项目.length ? (await tx.project.findMany({ where: { id: { in: 带走的项目 }, phase: "线索", assignMode: null }, select: { id: true } })).map((p) => p.id) : [];
  if (补方式.length) await tx.project.updateMany({ where: { id: { in: 补方式 } }, data: { assignMode: way } });
  return { ...带走, 清待分配: [...带走.清待分配, ...待分配.map((p) => ({ id: p.id, at: p.awaitAssignAt!.toISOString() }))], 补方式 };
}

/**
 * 项目入口用：回 留下，分配通知据此告诉接手人客户上还有多少原负责人的活；
 * 同事待分配 = 随客户换了负责人的同事待分配项目，调用方事务提交后发 同事待分配随客户通知（P-转-19）
 */
export async function 转客户给销售(tx: Prisma.TransactionClient, customerId: string, 原: string, 接手人: string, 操作人: string, way: string): Promise<{ 留下: 留下的活; 同事待分配: 同事待分配条[] }> {
  await tx.customer.update({ where: { id: customerId }, data: { salesOwnerId: 接手人 } });
  const 带走 = await 市场转一位(tx, customerId, 原, 接手人, 操作人, way);
  return { 留下: { customerId, 原 }, 同事待分配: 带走.同事待分配 };
}

/**
 * 撤销客户层转让时还 市场转一位 动过的两格（P-撤销-01 按原样回滚）。要在 还项目 之前调：
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
}
