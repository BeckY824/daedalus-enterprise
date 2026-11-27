/**
 * 12-22 第 2 阶段 B 段 · 异议未裁定时的拦截（判定页 #20）：这条客户 / 项目上有异议在「待裁定」或「待手工退回」，
 * 不能再转（改负责人、批量转让、项目转让）、不能申请合并（客户合并、项目合并）。
 * 单独一个小文件、只引 Prisma 类型：转让、合并、改项目几处都要问这里，不能把裁定本身那一串依赖带进去（会成环）。
 *   - 客户异议（kind = 客户）：挡这位客户转让 / 合并，也挡它名下归接手人的项目（连客户带当次随转的项目一起退，这些项目不能先被动走）
 *   - 项目异议（kind = 项目）：挡这个项目转让 / 合并；客户本身不挡（别的项目照常能转），但整客户转让会带走这个项目（项目在接手人手里 = 客户负责人的项目），所以客户转让也挡
 * 不是企业版一律不拦。
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "./switch";
import { 未落地状态们, 未裁定拦话 } from "./objection-core";

type 读 = Pick<Prisma.TransactionClient, "entTransferObjection">;

/** 这几位客户里有没有挂着没裁定的异议（客户或其名下项目的都算）；有 → 拦话，没有 null */
export async function 客户有未裁定异议(db: 读, customerIds: readonly string[], 动作: "再转" | "合并" = "再转"): Promise<string | null> {
  if (!企业版() || !customerIds.length) return null;
  const n = await db.entTransferObjection.count({ where: { customerId: { in: [...new Set(customerIds)] }, status: { in: [...未落地状态们] } } });
  return n ? 未裁定拦话(动作) : null;
}

/** 这几个项目有没有挂着没裁定的异议：项目自己的，或所在客户的客户异议且项目就在那次转让的接手人手里 */
export async function 项目有未裁定异议(db: 读, 项目们: readonly { id: string; customerId: string; ownerId: string }[], 动作: "再转" | "合并" = "再转"): Promise<string | null> {
  if (!企业版() || !项目们.length) return null;
  const 行们 = await db.entTransferObjection.findMany({
    where: { status: { in: [...未落地状态们] }, OR: [{ projectId: { in: 项目们.map((p) => p.id) } }, { kind: "客户", customerId: { in: [...new Set(项目们.map((p) => p.customerId))] } }] },
    select: { projectId: true, kind: true, customerId: true, toOwnerId: true },
  });
  const 挡 = 行们.some((r) => 项目们.some((p) => (r.kind === "项目" ? r.projectId === p.id : r.customerId === p.customerId && r.toOwnerId === p.ownerId)));
  return 挡 ? 未裁定拦话(动作) : null;
}
