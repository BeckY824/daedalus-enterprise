/**
 * 市场分给销售，项目进线索验证（审核 11-18；客户 11-18：市场分过来的客户，销售看到时就应该在线索验证这一环）。
 * M-线索-01：市场分配后由销售判有效 / 无效，这一步在线索验证上做；停在潜客培育，销售连判无效都判不了（lead-verify.ts 只认线索验证）。
 *
 * 规则：市场成员（业务角色有市场、不兼销售，org-core 是市场成员of）把线索 / 客户交给销售（指定、自动、批量、定时、待分配补分、
 * 客户层转给销售、市场建档时直接给销售），交过去的项目在「线索·潜客培育」、没结局、不在公海、不在待分配的，推到「线索·线索验证」：
 *   - 记一行节点变更（操作人 = 分配的人，理由 = 市场分配进验证理由）。不走「前两个节点要先有沟通」的闸门（db.ts 企业版推进关）：
 *     这不是负责人往前推，市场培育期可能确实没有沟通；推过线索验证的有效沟通闸门照旧管（再往后推还要填需求）。
 *   - 下一步（文字、时间）不清：同分配（11-03 A2-3，下一步跟着项目走）。
 *   - 撤销分配时推回潜客培育、删掉这一行（推回潜客培育）。
 * 不推：销售自建自持（创建人是销售、分之前就在他手里）、公海领取 / 公海分配（market-transfer 推节点 = false）、
 * 销售管理 / 总管理之间转让（交出去的人不是市场成员）、暂不分配（没交给销售）。
 * 调用点只加一两行，判定和落库都在这里（11-18：几个热修分支也在改 assign-actions.ts / projects/actions.ts，收在一处方便合并）。
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "./switch";
import { 是市场成员of, type 组织 } from "./org-core";
import { 是销售角色 } from "./permissions";

/** 从哪进哪：企业版、团队版字典里线索阶段前两个节点同名（stage-dict.ts） */
export const 市场分配从 = "潜客培育";
export const 市场分配到 = "线索验证";
/** 记在节点变更 reason 上，撤销认它 */
export const 市场分配进验证理由 = "市场分配给销售，进线索验证";

/**
 * 这一下算不算「市场分给销售」（项目层：分配线索、自动分配、客户页指定给销售）：
 * 接手人是销售；客户在市场手里转给销售（市场转客户），或分的人 / 分之前的负责人是市场成员。
 * 销售自建自持（创建人是销售、分之前就在他手里）不算——市场管理改派销售自己的线索不替他推。
 */
export function 算市场分给销售(
  org: 组织,
  a: { 分配人: string; 原: string | null | undefined; 接手人: string; 创建人?: string | null; 市场转客户?: boolean },
): boolean {
  if (!是销售角色(org, a.接手人) || a.原 === a.接手人) return false;
  if (a.创建人 && a.原 === a.创建人 && 是销售角色(org, a.创建人)) return false;
  return !!a.市场转客户 || 是市场成员of(org, a.分配人) || 是市场成员of(org, a.原);
}

/** 建的时候就给了销售（新建客户页、建档向导选了销售当负责人）：建的人是市场成员、负责人是销售 */
export function 算市场建给销售(org: 组织, 建的人: string, 负责人: string): boolean {
  return 建的人 !== 负责人 && 是市场成员of(org, 建的人) && 是销售角色(org, 负责人);
}

/**
 * 在分配的那笔事务里调：ids 里现在归 接手人、停在线索·潜客培育、没结局、不在公海、不在待分配的，推到线索验证，各记一行节点变更。
 * 回推了的 id（撤销用，见 带走的.推节点）。不是企业版一行不动
 */
export async function 市场分配进线索验证(
  tx: Pick<Prisma.TransactionClient, "project" | "projectNodeLog">,
  ids: readonly (string | null | undefined)[], 接手人: string, 操作人: string,
): Promise<string[]> {
  if (!企业版()) return [];
  const 们 = [...new Set(ids.filter((x): x is string => !!x))];
  if (!们.length) return [];
  const 推: string[] = [];
  for (let i = 0; i < 们.length; i += 500) {
    const ps = await tx.project.findMany({
      where: { id: { in: 们.slice(i, i + 500) }, ownerId: 接手人, phase: "线索", node: 市场分配从, result: null, pooledAt: null, awaitAssignAt: null },
      select: { id: true },
    });
    if (!ps.length) continue;
    const 这批 = ps.map((p) => p.id);
    // 条件再带一遍：读和写之间被人动过的不碰
    await tx.project.updateMany({ where: { id: { in: 这批 }, phase: "线索", node: 市场分配从, result: null }, data: { node: 市场分配到 } });
    await tx.projectNodeLog.createMany({
      data: 这批.map((projectId) => ({
        projectId, userId: 操作人, kind: "node", reason: 市场分配进验证理由,
        fromPhase: "线索", fromNode: 市场分配从, fromResult: null, toPhase: "线索", toNode: 市场分配到, toResult: null,
      })),
    });
    推.push(...这批);
  }
  return 推;
}

/**
 * 新建客户那笔事务里（saveCustomer）：市场成员建给销售的，这位新客户名下我刚建的项目（补的潜客培育、只建客户带的那个）进线索验证
 */
export async function 新客户项目进线索验证(
  tx: Pick<Prisma.TransactionClient, "project" | "projectNodeLog">, customerId: string, 接手人: string, 操作人: string,
): Promise<string[]> {
  if (!企业版()) return [];
  const ps = await tx.project.findMany({ where: { customerId, creatorId: 操作人 }, select: { id: true } });
  return 市场分配进线索验证(tx, ps.map((p) => p.id), 接手人, 操作人);
}

/**
 * 撤销分配时还原：ids 里还归 接手人、还在线索验证、没结局、不在公海，并且最后一行节点变更就是这次推进来的那行（理由对得上、从潜客培育来），
 * 推回潜客培育、删掉那一行。之后又被人推过、判过、退过的不动（P-撤销-01 只还自己那一下）。
 * 不早于：那一行要在这个时刻之后（单个项目撤销时传分配那行转让痕的时刻，免得还了更早一次分配推的）；操作人：给了就只认他推的
 */
export async function 推回潜客培育(
  tx: Pick<Prisma.TransactionClient, "project" | "projectNodeLog">,
  ids: readonly string[] | undefined, 接手人: string, 选项: { 不早于?: Date; 操作人?: string } = {},
): Promise<string[]> {
  if (!企业版() || !ids?.length) return [];
  const 们 = [...new Set(ids.filter((x) => typeof x === "string" && x))].slice(0, 500);
  if (!们.length) return [];
  const ps = await tx.project.findMany({
    where: { id: { in: 们 }, ownerId: 接手人, phase: "线索", node: 市场分配到, result: null, pooledAt: null },
    select: { id: true },
  });
  const 还了: string[] = [];
  for (const p of ps) {
    const 末 = await tx.projectNodeLog.findFirst({
      where: { projectId: p.id, kind: "node" },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { id: true, reason: true, fromNode: true, toNode: true, userId: true, at: true },
    });
    if (!末 || 末.reason !== 市场分配进验证理由 || 末.fromNode !== 市场分配从 || 末.toNode !== 市场分配到) continue;
    if (选项.操作人 && 末.userId !== 选项.操作人) continue;
    if (选项.不早于 && 末.at.getTime() < 选项.不早于.getTime()) continue;
    const 改 = await tx.project.updateMany({ where: { id: p.id, node: 市场分配到, result: null }, data: { node: 市场分配从 } });
    if (改.count !== 1) continue;
    await tx.projectNodeLog.delete({ where: { id: 末.id } });
    还了.push(p.id);
  }
  return 还了;
}
