/**
 * 12-22 第 2 阶段 B 段 · 异议未裁定时的拦截（判定页 #20）：这条客户 / 项目上有异议在「待裁定」（「待手工退回」不拦：它等系统管理员去改负责人手工退回，拦了就死锁，12-22 审查 M1），
 * 不能再转（改负责人、批量转让、项目转让）、不能申请合并（客户合并、项目合并）。
 * 单独一个小文件、只引 Prisma 类型：转让、合并、改项目几处都要问这里，不能把裁定本身那一串依赖带进去（会成环）。
 *   - 客户异议（kind = 客户）：挡这位客户转让 / 合并，也挡它名下归接手人的项目（连客户带当次随转的项目一起退，这些项目不能先被动走）
 *   - 项目异议（kind = 项目）：挡这个项目转让 / 合并；客户本身不挡（别的项目照常能转），但整客户转让会带走这个项目（项目在接手人手里 = 客户负责人的项目），所以客户转让也挡
 * 不是企业版一律不拦。
 */
import type { EntTransferObjection, Prisma } from "@/generated/prisma";
import { 企业版 } from "./switch";
import { 合并异议类, 未落地状态们, 未裁定拦话, 异议待手工退回, 异议已退回 } from "./objection-core";
import { 读组织 } from "./org";
import { 系统管理员们 } from "./tri-state-people";

type 读 = Pick<Prisma.TransactionClient, "entTransferObjection">;

/** 这几位客户里有没有挂着没裁定的异议（客户或其名下项目的都算）；有 → 拦话，没有 null */
export async function 客户有未裁定异议(db: 读, customerIds: readonly string[], 动作: "再转" | "合并" = "再转"): Promise<string | null> {
  if (!企业版() || !customerIds.length) return null;
  const 行 = await db.entTransferObjection.findFirst({ where: { customerId: { in: [...new Set(customerIds)] }, status: { in: [...未落地状态们] } }, select: { kind: true } });
  return 行 ? 未裁定拦话(动作, 行.kind) : null;
}

export type 待裁定行 = { projectId: string | null; kind: string; customerId: string; toOwnerId: string; createdAt: Date; submittedAt?: Date | null };

/** 一次读全部「待裁定」的异议行（超时转扫描开头读一遍、内存匹配，不用每个项目各查一次） */
export async function 读全部待裁定行(db: 读): Promise<待裁定行[]> {
  return db.entTransferObjection.findMany({
    where: { status: { in: [...未落地状态们] } },
    select: { projectId: true, kind: true, customerId: true, toOwnerId: true, createdAt: true, submittedAt: true },
  });
}

/** 内存匹配：这个项目被哪几行待裁定的异议挡着（项目自己的，或所在客户的客户异议且项目就在那次转让的接手人手里） */
export function 挡着项目的异议(行们: readonly 待裁定行[], p: { id: string; customerId: string; ownerId: string }): 待裁定行[] {
  // 只有客户异议按「客户 + 接手人」匹配；项目异议、项目合并异议都按 projectId（合并异议的 projectId = 留下项目，别的项目不受牵连）
  return 行们.filter((r) => (r.kind !== "客户" ? r.projectId === p.id : r.customerId === p.customerId && r.toOwnerId === p.ownerId));
}

/** 这几个项目有没有挂着没裁定的异议：项目自己的，或所在客户的客户异议且项目就在那次转让的接手人手里 */
export async function 项目有未裁定异议(db: 读, 项目们: readonly { id: string; customerId: string; ownerId: string }[], 动作: "再转" | "合并" = "再转"): Promise<string | null> {
  if (!企业版() || !项目们.length) return null;
  const 行们 = await db.entTransferObjection.findMany({
    where: { status: { in: [...未落地状态们] }, OR: [{ projectId: { in: 项目们.map((p) => p.id) } }, { kind: "客户", customerId: { in: [...new Set(项目们.map((p) => p.customerId))] } }] },
    select: { projectId: true, kind: true, customerId: true, toOwnerId: true, createdAt: true },
  });
  const 挡 = 项目们.flatMap((p) => 挡着项目的异议(行们, p));
  return 挡.length ? 未裁定拦话(动作, 挡.find((r) => r.kind === 合并异议类)?.kind) : null;
}

type 写 = Pick<Prisma.TransactionClient, "entTransferObjection">;

/**
 * 系统管理员把客户 / 项目改回给异议人后（12-22 审查 M1）：这条对象上、异议人 = 新负责人、状态「待手工退回」的异议顺带记成「已退回」，
 * 和「已手工退回」按钮同一个终态、同一种说明写法。不是系统管理员办的不记（要他自己去点「已手工退回」）。返回记成「已退回」的那几行（调用方在提交后补留痕和通知）
 */
export async function 改回异议人记已退回(
  db: 写, 操作人: { id: string; name?: string }, 新负责人: string, 对象: { customerId?: string; projectId?: string },
): Promise<EntTransferObjection[]> {
  if (!企业版()) return [];
  const 或: Prisma.EntTransferObjectionWhereInput[] = [];
  if (对象.customerId) 或.push({ kind: "客户", customerId: 对象.customerId });
  if (对象.projectId) 或.push({ kind: "项目", projectId: 对象.projectId });
  if (!或.length) return [];
  const org = await 读组织();
  if (!org || !系统管理员们(org).includes(操作人.id)) return [];
  const 行们 = await db.entTransferObjection.findMany({ where: { status: 异议待手工退回, objectorUserId: 新负责人, OR: 或 } });
  const 记了: EntTransferObjection[] = [];
  for (const 行 of 行们) {
    const judgeNote = `${行.judgeNote ?? ""}${行.judgeNote ? "；" : ""}手工退回：${操作人.name ?? "系统管理员"}已把负责人改回异议人（改负责人时自动记）`.slice(0, 600);
    const r = await db.entTransferObjection.updateMany({ where: { id: 行.id, status: 异议待手工退回 }, data: { status: 异议已退回, judgeNote } });
    if (r.count) 记了.push({ ...行, status: 异议已退回, judgeNote });
  }
  return 记了;
}
