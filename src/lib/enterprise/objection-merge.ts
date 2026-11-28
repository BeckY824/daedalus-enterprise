/**
 * 阶段 4 · 项目合并类异议：合并被撤回时的收尾（E-484 第 3 条）。单独一个文件，只引 objection-core / objection / notify，
 * 免得 project-merge.ts（撤回在那里）和 objection-judge.ts（裁定撤回调撤回）互相引成环。
 *
 * 在撤回的同一事务里调 终止合并异议：这张合并单下「待裁定」的异议行 → 因撤回终止（judgeNote「因撤回终止」、judgedAt = 现在、judgedById = 撤回人），
 * 「可提」的行 → 已撤销（入口作废）；正被裁定的那一行（裁定自己走撤回态）排除。事务提交后调 通知合并异议终止：异议人、裁定人各一条。
 */
import type { EntTransferObjection, Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { notify } from "./notify";
import { 合并异议类, 异议可提, 异议待裁定, 异议已撤销, 异议因撤回终止, 终止说明 } from "./objection-core";
import { 重算裁定人们 } from "./objection";

type Tx = Prisma.TransactionClient;

export type 合并异议终止 = { 终止: EntTransferObjection[]; 撤销: EntTransferObjection[] };

export async function 终止合并异议(tx: Tx, mergeId: string, 撤回人: { id: string; name: string }, 现在: Date, 排除id?: string): Promise<合并异议终止> {
  const 行们 = await tx.entTransferObjection.findMany({ where: { mergeId, kind: 合并异议类, status: { in: [异议待裁定, 异议可提] }, ...(排除id ? { id: { not: 排除id } } : {}) } });
  const 出: 合并异议终止 = { 终止: [], 撤销: [] };
  for (const 行 of 行们) {
    const 待 = 行.status === 异议待裁定;
    const r = await tx.entTransferObjection.updateMany({
      where: { id: 行.id, status: 行.status },
      data: 待 ? { status: 异议因撤回终止, judgeNote: 终止说明, judgedAt: 现在, judgedById: 撤回人.id } : { status: 异议已撤销, judgeNote: "合并已撤回，异议入口作废" },
    });
    if (!r.count) continue;
    (待 ? 出.终止 : 出.撤销).push(行);
    // 留痕：被并项目和留下项目各一行
    const 话 = 待 ? `合并已撤回，对「${行.targetName}」合并的异议因撤回终止（${撤回人.name}撤回）` : `合并已撤回，对「${行.targetName}」合并的异议入口作废（${撤回人.name}撤回）`;
    await tx.auditLog.createMany({
      data: [...new Set([行.targetKey, 行.projectId].filter((x): x is string => !!x))].map((id) => ({
        userId: 撤回人.id, userName: 撤回人.name, action: "merge-objection-end", entity: "Project", entityId: id, at: 现在, summary: 话, detail: JSON.stringify({ 异议: 行.id, mergeId, 结果: 待 ? 异议因撤回终止 : 异议已撤销 }),
      })),
    });
  }
  return 出;
}

/** 事务提交后：因撤回终止的异议，通知异议人（带上撤回结果，和「已撤回合并回到你名下」并一条文案）和裁定人（作废）；notify 从不抛 */
export async function 通知合并异议终止(终止: readonly EntTransferObjection[], 谁撤: string): Promise<void> {
  if (!终止.length) return;
  const 现裁 = await 重算裁定人们(终止);
  const 异议人们 = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(终止.map((r) => r.objectorUserId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  for (const 行 of 终止) {
    const 异议人 = 异议人们.get(行.objectorUserId) ?? "";
    const 裁 = (现裁.get(行.id)?.ids ?? (行.judgeIds ? (JSON.parse(行.judgeIds) as string[]) : [])).filter((x) => x !== 行.objectorUserId && x !== undefined);
    await notify(裁, { kind: "异议", title: `合并已撤回：${异议人}对${行.kind}「${行.targetName}」的合并异议因撤回终止`, body: `${谁撤}撤回了这次合并，无需再裁定`, link: "/objections", key: `objection-void:${行.id}:judge` });
  }
}
