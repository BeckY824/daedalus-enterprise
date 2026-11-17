/**
 * 导入 / 同步 / 冲突处理 / 整批撤回与恢复里，无主客户出入公海时的潜客培育项目（M-公海-14，11-17）。记在这一批的 EntImportRow 上（entity = 培育行）：
 *   - 出公海（占位账号换成真负责人）：先记一行 kind = 待补（apply.ts 改 里），整批行都处理完再在一个事务里补（补待补的）——
 *     同一批后面的商机行给这位客户建了项目，就不再多补；补了的那行改成 kind = create、targetId = 新项目，没补的那行删掉
 *   - 回公海（整批撤回 / 恢复把负责人改回占位账号）：这一批补过的潜客培育项目，没动过（nurture.ts 潜客培育动没动）就删、连那行一起删；
 *     动过的留在原负责人名下、那行记 undo = 留下，名字回给调用方列进撤回结果（P-撤销-01 原样还）
 * 整批撤回 / 恢复只按 实体顺序 里的实体逐行退，不碰这几行
 */
import type { Prisma } from "@/generated/prisma";
import { 看全部 } from "../team-scope";
import { 零项目客户补潜客培育, 潜客培育动没动 } from "../project/nurture";

type Tx = Prisma.TransactionClient;

export const 培育行 = "nurture";
const 待补 = "pending";

/** 这位客户在这一批里出了公海：记一行待补（同一批记过就不再记） */
export async function 记出公海待补(tx: Tx, 批次Id: string, customerId: string): Promise<void> {
  if (await tx.entImportRow.findFirst({ where: { batchId: 批次Id, entity: 培育行, kind: 待补, externalId: customerId }, select: { id: true } })) return;
  await tx.entImportRow.create({ data: { batchId: 批次Id, entity: 培育行, kind: 待补, externalId: customerId, targetId: customerId, written: "{}" } });
}

/** 整批行都处理完：把这一批待补的客户一次补完（还是零项目、不在公海的才补），返回补了几个 */
export async function 补待补的(tx: Tx, 批次Id: string, 操作人: string): Promise<number> {
  const 行们 = await tx.entImportRow.findMany({ where: { batchId: 批次Id, entity: 培育行, kind: 待补 }, select: { id: true, externalId: true } });
  if (!行们.length) return 0;
  const 补了 = await 零项目客户补潜客培育(tx, 行们.map((r) => r.externalId), 操作人);
  for (const r of 行们) {
    const pid = 补了.get(r.externalId);
    if (pid) await tx.entImportRow.update({ where: { id: r.id }, data: { kind: "create", targetId: pid } });
    else await tx.entImportRow.delete({ where: { id: r.id } });
  }
  return 补了.size;
}

/**
 * 这位客户回了公海：这一批给他补过的潜客培育项目没动过就删（负责人 = 回公海前客户的负责人）；动过的留下、返回项目名。
 * 还没补的待补行一起删掉
 */
export async function 回公海收回培育(tx: Tx, 批次Id: string, customerId: string, 原负责人: string): Promise<string[]> {
  await tx.entImportRow.deleteMany({ where: { batchId: 批次Id, entity: 培育行, kind: 待补, externalId: customerId } });
  const 行们 = await tx.entImportRow.findMany({ where: { batchId: 批次Id, entity: 培育行, kind: "create", externalId: customerId, undo: null }, select: { id: true, targetId: true } });
  const 留下: string[] = [];
  for (const r of 行们) {
    const 状 = await 潜客培育动没动(tx, r.targetId, { customerId, 负责人: 原负责人 });
    if (状 === "动过") {
      await tx.entImportRow.update({ where: { id: r.id }, data: { undo: "留下" } });
      留下.push((await 看全部(() => tx.project.findUnique({ where: { id: r.targetId }, select: { name: true } })))?.name ?? r.targetId);
      continue;
    }
    if (状 === "没动过") await 看全部(() => tx.project.deleteMany({ where: { id: r.targetId } }));
    await tx.entImportRow.delete({ where: { id: r.id } });
  }
  return 留下;
}
