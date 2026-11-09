import type { Prisma } from "@/generated/prisma";
import { 带走一位 } from "@/lib/carry-over-db";
import type { 留下的活 } from "./notice-sources";
import type { 组织 } from "./org-core";
import { 是市场角色, 是销售角色 } from "./permissions";

/**
 * 市场首次分给销售 = 转客户（X-18）。分配线索、自动分配、客户页新建项目、新客户向导、首页 AI 录入（走向导）都走这一份：
 * 判定同一句，落库同一段。"use server" 文件只能导出动作，所以放这里。
 */

/** 客户负责人是市场角色、客户不在公海。角色只认业务角色。弹窗隐藏「待办一起转」的勾和服务端都用这一句 */
export function 客户在市场手里(org: 组织, 客户: { salesOwnerId: string; pool: { customerId: string } | null } | null): boolean {
  return !!客户 && !客户.pool && 是市场角色(org, 客户.salesOwnerId);
}

/** 这位客户分给这个接手人，算不算转客户：客户在市场手里、接手的是另一位销售 */
export function 算市场转客户(org: 组织, 客户: { salesOwnerId: string; pool: { customerId: string } | null } | null, 接手人: string): boolean {
  return 客户在市场手里(org, 客户) && 客户?.salesOwnerId !== 接手人 && 是销售角色(org, 接手人);
}

/**
 * 客户连同名下全部项目、公海项目、联系人、进行中的商机交给销售；待办、计划还归市场（P-转-10）。
 * 被带走的项目不写分配记录（不占额度）。回 留下：分配通知据此告诉接手人客户上还有多少原负责人的活。
 * 要在事务里、放开范围调（市场转走后就看不到这位客户了）；老签约要在事务外先钉住（钉住老签约 用全局连接），刚建的客户没有签约不用钉
 */
export async function 转客户给销售(tx: Prisma.TransactionClient, customerId: string, 原: string, 接手人: string, 操作人: string, way: string): Promise<留下的活> {
  await tx.customer.update({ where: { id: customerId }, data: { salesOwnerId: 接手人 } });
  const 带走 = await 带走一位(tx, customerId, 原, 接手人, 操作人, "assign", true, { 留下待办计划: true });
  // 带过来的都有负责人了：清掉待分配，不然批量里后面几条还会被当成没分的，再分给别人
  await tx.project.updateMany({ where: { customerId, ownerId: 接手人, awaitAssignAt: { not: null } }, data: { awaitAssignAt: null } });
  // 节点必填「分配方式」靠项目上这一格（required.ts）；建的时候已选的不改
  const 带走的项目 = [...带走.项目, ...带走.公海项目];
  if (带走的项目.length) await tx.project.updateMany({ where: { id: { in: 带走的项目 }, phase: "线索", assignMode: null }, data: { assignMode: way } });
  return { customerId, 原 };
}
