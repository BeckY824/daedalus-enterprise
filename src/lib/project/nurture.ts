/**
 * 新客户至少带 1 个「潜客培育」项目（M-公海-14 / A-15，10-31 会议）：企业版开了项目模式时，客户进系统就不再是零项目客户。
 *
 * saveCustomer 新建那一笔事务的最后调一次：建档向导（接着建）已经建了项目的不再补；
 * 只管新建，老的零项目客户不补（A-15 先问，动客户库要备份 + 点头）。导入、线索转化各有自己建项目的路，不走这里。
 * 项目名用客户名（截到项目名上限），负责人 = 客户负责人，联系人挂主要联系人（有的话），落在第一个节点、记一行节点变更，
 * 金额币种留默认——和线索转化建出来的项目一样（from-lead.ts），到项目里再填。
 * 调用方判断开关：不是企业版、没开项目模式时不进这里，什么都不建。
 */
import type { Prisma } from "@/generated/prisma";
import { 默认币种 } from "../currency";
import { 第一个节点 } from "./nodes";
import { 项目名上限 } from "./wizard";
import { 新项目默认值 } from "./proj-fields";

/** 要不要补：企业版且开了项目模式才补（纯判断，方便单测钉住「没开项目模式时不建」） */
export function 要补潜客培育(企业: boolean, 项目模式: boolean | undefined): boolean {
  return 企业 && 项目模式 === true;
}

/** 这位客户一个项目都没有就建一个潜客培育项目，返回新项目 id；已经有项目（向导刚建的）返回 null */
export async function 补潜客培育(
  tx: Pick<Prisma.TransactionClient, "contact" | "project" | "projectNodeLog">,
  a: { customerId: string; 客户名: string; ownerId: string; creatorId: string },
): Promise<string | null> {
  if (await tx.project.count({ where: { customerId: a.customerId } })) return null;
  const 联系人 = await tx.contact.findFirst({ where: { customerId: a.customerId, isPrimary: true }, select: { id: true } });
  const 项目 = await tx.project.create({
    data: {
      name: a.客户名.trim().slice(0, 项目名上限) || "潜客培育", customerId: a.customerId, contactId: 联系人?.id ?? null,
      ownerId: a.ownerId, creatorId: a.creatorId, amount: 0, currency: 默认币种,
      phase: 第一个节点.phase, node: 第一个节点.node,
      ...新项目默认值(true),
    },
  });
  await tx.projectNodeLog.create({ data: { projectId: 项目.id, userId: a.creatorId, toPhase: 第一个节点.phase, toNode: 第一个节点.node } });
  return 项目.id;
}
