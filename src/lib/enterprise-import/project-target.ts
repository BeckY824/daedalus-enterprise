/**
 * 企业版只用项目时，导入的「商机」行落成项目（2026-10-26 用户：「把线索，商机，订单都放到项目里，是三大阶段」）。
 *
 * 对照表、冲突、报告都还按 opportunity 这一类记，只是目标 id 指向 Project：
 *   - 比对字段沿用商机那几格：stage = 项目节点、status = 结局（没结局 = "OPEN"）；probability 项目没有，恒为空；expectedDealAt 落项目上的预计成交日期（10-27 从客户挪过来）；
 *     另带项目的成交需求 / 合同金额 / 定金金额五格（迁移 097，原表空着的格子不带）
 *   - 读现值 / 改 / 撤回 先找商机、找不到再找项目，所以不用知道当时是不是项目模式
 *   - 原系统的节点名先认 2.0 的节点和结局，再认新版的叫法（旧名 表，草案，待对方确认）
 * 导入只认原系统：节点可以往回走（包括已转商机的退回线索），这一点和手动改节点不同；异常状态导进来没有类别。
 */
import type { Prisma } from "@/generated/prisma";
import { 是结局, 本套名, 企业版字典, type 阶段 } from "../project/nodes";
import { 公海无负责人 } from "../project/pool-owner";
import { 回收原因前缀 } from "../project/timeout";
import { 规, 写不进, type 值表, type 标量 } from "./apply";
import { 节点所在阶段 } from "./project-values";
export { 项目阶段值, 项目节点对值, 节点所在阶段, 结局默认节点 } from "./project-values";

type Tx = Prisma.TransactionClient;

/**
 * 导入时没负责人、进公海记的理由（11-02，客户公海和项目公海同一句）。带上「回收原因：」前缀，统一公海的入池原因那一格才显示后半句
 * （lib/enterprise/unified-pool.ts 拆退回原因）；出公海、撤回放行也认这一句，别的原因进公海的不碰
 */
export const 无主入池理由 = `${回收原因前缀}导入时没有负责人`;

/** 比对格子 → 项目上的 phase / node / result */
function 位置(v: 值表): { phase: 阶段; node: string; result: string | null } {
  const result = 是结局(v.status) ? String(v.status) : null;
  const node = String(v.stage ?? "");
  const phase = 节点所在阶段(node);
  if (!phase) throw new 写不进(`「${node}」不是项目的进程`);
  return { phase, node, result };
}

const 日 = (v: 标量): Date | null => (v ? new Date(String(v)) : null);
const 串 = (v: 标量): string | null => (v === null ? null : String(v));
const 数 = (v: 标量): number | null => (v === null || v === "" ? null : Number(v));

/** 项目现在的样子，换成商机那几格 */
export async function 读项目(tx: Tx, id: string): Promise<值表 | null> {
  const p = await tx.project.findUnique({
    where: { id },
    select: {
      name: true,
      amount: true,
      node: true,
      result: true,
      closedAt: true,
      ownerId: true,
      remark: true,
      customerId: true,
      expectedDealAt: true,
      dealDemand: true,
      contractAmount: true,
      contractCurrency: true,
      depositAmount: true,
      depositCurrency: true,
    },
  });
  if (!p) return null;
  return Object.fromEntries(
    Object.entries({
      name: p.name,
      amount: p.amount,
      stage: p.node,
      status: p.result ?? "OPEN",
      probability: null,
      expectedDealAt: p.expectedDealAt,
      closedAt: p.result ? p.closedAt : null,
      ownerId: p.ownerId,
      remark: p.remark,
      customerId: p.customerId,
      dealDemand: p.dealDemand,
      contractAmount: p.contractAmount,
      contractCurrency: p.contractCurrency,
      depositAmount: p.depositAmount,
      depositCurrency: p.depositCurrency,
    }).map(([k, x]) => [k, 规(x)]),
  );
}

export async function 是项目(tx: Tx, id: string): Promise<boolean> {
  return !!(await tx.project.findUnique({ where: { id }, select: { id: true } }));
}

/** 进公海那条留痕（同手动放回的 pool-release）。历史负责人按 fromOwnerId 认，导入时就没负责人的是 null，谁都能领 */
function 无主留痕(p: { phase: string; node: string; result: string | null }, id: string, 记谁: string, 从: string | null, 现在: string) {
  return {
    projectId: id,
    userId: 记谁,
    kind: "pool-release",
    reason: 无主入池理由,
    fromOwnerId: 从,
    toOwnerId: null,
    fromPhase: p.phase,
    fromNode: p.node,
    fromResult: p.result,
    toPhase: p.phase,
    toNode: p.node,
    toResult: p.result,
    at: new Date(现在),
  };
}

/** 刚建的项目没负责人：进公海 + 留痕。负责人写空串，同放回公海（lib/project/pool-owner.ts），导入只有企业版 */
export async function 无主项目进公海(tx: Tx, id: string, 操作人: string, 现在: string): Promise<void> {
  const p = await tx.project.update({
    where: { id },
    data: { ownerId: 公海无负责人, pooledAt: new Date(现在) },
    select: { phase: true, node: true, result: true },
  });
  await tx.projectNodeLog.create({ data: 无主留痕(p, id, 操作人, null, 现在) });
}

/**
 * 新建项目 + 一条起点日志；创建人记成负责人（导入的人不一定是负责人，项目页「我创建的」按它算）。
 * 没负责人（11-02，apply.ts 落值）：创建人和日志记导入的人（操作人），项目直接进公海
 */
export async function 建项目(tx: Tx, v: 值表, 现在: string, 业务线?: string, 操作人?: string): Promise<string> {
  const 位 = 位置(v);
  const 负责人 = 串(v.ownerId ?? null);
  const ownerId = 负责人 || 公海无负责人;
  const 记谁 = 负责人 || 操作人 || "";
  const p = await tx.project.create({
    data: {
      name: String(v.name),
      customerId: String(v.customerId),
      ownerId,
      creatorId: 记谁,
      amount: Number(v.amount ?? 0),
      phase: 位.phase,
      node: 位.node,
      result: 位.result,
      remark: 串(v.remark),
      expectedDealAt: 日(v.expectedDealAt),
      closedAt: 位.result ? (日(v.closedAt) ?? new Date(现在)) : null,
      dealDemand: 串(v.dealDemand ?? null),
      contractAmount: 数(v.contractAmount ?? null),
      contractCurrency: 串(v.contractCurrency ?? null),
      depositAmount: 数(v.depositAmount ?? null),
      depositCurrency: 串(v.depositCurrency ?? null),
      ...(业务线 ? { bizLine: 业务线 } : {}),
    },
    select: { id: true },
  });
  await tx.projectNodeLog.create({ data: { projectId: p.id, userId: 记谁, toPhase: 位.phase, toNode: 位.node, toResult: 位.result } });
  if (!负责人) await 无主项目进公海(tx, p.id, 记谁, 现在);
  return p.id;
}

/** 改项目的这几格；节点或结局变了记一条节点日志（谁改的记负责人） */
export async function 改项目(tx: Tx, id: string, 改动: 值表, 现值: 值表, 现在: string): Promise<void> {
  const 有 = (k: string) => k in 改动;
  const data: Prisma.ProjectUncheckedUpdateInput = {};
  if (有("name")) data.name = String(改动.name);
  if (有("ownerId")) data.ownerId = 串(改动.ownerId) || 公海无负责人; // 撤回、采用原系统改回「没负责人」是空的，别写成字符串 null
  if (有("amount")) data.amount = Number(改动.amount ?? 0);
  if (有("remark")) data.remark = 串(改动.remark);
  if (有("expectedDealAt")) data.expectedDealAt = 日(改动.expectedDealAt);
  // 成交需求 / 合同金额 / 定金金额（迁移 097）：清洗时金额和币种成对带，这里照落
  if (有("dealDemand")) data.dealDemand = 串(改动.dealDemand);
  if (有("contractAmount")) data.contractAmount = 数(改动.contractAmount);
  if (有("contractCurrency")) data.contractCurrency = 串(改动.contractCurrency);
  if (有("depositAmount")) data.depositAmount = 数(改动.depositAmount);
  if (有("depositCurrency")) data.depositCurrency = 串(改动.depositCurrency);
  // 换了客户，原来选的联系人就不是这家的了
  if (有("customerId")) Object.assign(data, { customerId: String(改动.customerId), contactId: null });
  const 原 = await tx.project.findUnique({ where: { id }, select: { phase: true, node: true, result: true, closedAt: true, ownerId: true, creatorId: true, pooledAt: true } });
  if (!原) throw new 写不进("项目不在了");
  const 新 = 位置({ stage: 有("stage") ? 改动.stage : 现值.stage, status: 有("status") ? 改动.status : 现值.status });
  // 库里存着旧名（10-31 改名前的 明确需求、成功交付…）的先对到新名再比：同一个节点不算改，不白记一条节点变更
  const 原结局 = 原.result ? 本套名(原.result, 企业版字典) : null;
  if (新.node !== 本套名(原.node, 企业版字典) || 新.result !== 原结局) {
    Object.assign(data, { phase: 新.phase, node: 新.node, result: 新.result });
    if (新.result !== "异常状态") Object.assign(data, { exceptionCategoryId: null, exceptionReason: null });
    await tx.projectNodeLog.create({
      data: {
        projectId: id,
        userId: String(data.ownerId || 原.ownerId || 原.creatorId), // 公海项目负责人是空的，记创建人
        fromPhase: 原.phase,
        fromNode: 原.node,
        fromResult: 原.result,
        toPhase: 新.phase,
        toNode: 新.node,
        toResult: 新.result,
      },
    });
  }
  if (!新.result) data.closedAt = null;
  else if (新.result !== 原结局 || 有("closedAt")) data.closedAt = 日(有("closedAt") ? 改动.closedAt : 现值.closedAt) ?? 原.closedAt ?? new Date(现在);
  // 负责人从有到无、从无到有，公海跟着走（11-02）：指定默认负责人再导一遍就出公海，撤回、采用原系统改回没负责人就回公海
  const 进 = 有("ownerId") && data.ownerId === 公海无负责人 && !原.pooledAt;
  const 出 = 有("ownerId") && data.ownerId !== 公海无负责人 && 原.ownerId === 公海无负责人 && !!原.pooledAt;
  if (进) data.pooledAt = new Date(现在);
  if (出) data.pooledAt = null;
  if (Object.keys(data).length) await tx.project.update({ where: { id }, data });
  const 位 = { phase: String(data.phase ?? 原.phase), node: String(data.node ?? 原.node), result: "result" in data ? (data.result as string | null) : 原.result };
  if (进) await tx.projectNodeLog.create({ data: 无主留痕(位, id, 原.ownerId || 原.creatorId, 原.ownerId || null, 现在) });
  if (出) {
    await tx.projectNodeLog.create({
      data: { projectId: id, userId: String(data.ownerId), kind: "transfer", fromOwnerId: null, toOwnerId: String(data.ownerId), fromPhase: 位.phase, fromNode: 位.node, fromResult: 位.result, toPhase: 位.phase, toNode: 位.node, toResult: 位.result, at: new Date(现在) },
    });
  }
}

/* ───────────────────────── 撤回用 ───────────────────────── */

async function 导入进的公海没动过(tx: Tx, id: string, ownerId: string): Promise<boolean> {
  if (ownerId !== 公海无负责人) return false;
  const 痕 = await tx.projectNodeLog.findMany({ where: { projectId: id, kind: { in: ["pool-release", "pool-claim", "transfer"] } }, select: { kind: true, reason: true } });
  return 痕.length === 1 && 痕[0].kind === "pool-release" && 痕[0].reason === 无主入池理由;
}

/**
 * 这一批建的项目还能不能删：被人接着用过 → 拦的原因；没有 = null。
 * 这一批自己挂上的跟进这时已经先退掉了（倒着退），还挂着的就是外面的
 */
export async function 项目挂件(tx: Tx, id: string, 批次Id: string): Promise<string | null> {
  const p = await tx.project.findUnique({
    where: { id },
    select: {
      contactId: true,
      ownerId: true,
      pooledAt: true,
      nextStepAt: true,
      nextStepText: true,
      balanceSettled: true,
      acceptancePassed: true,
      exceptionCategoryId: true,
      _count: { select: { followUps: true, members: true } },
    },
  });
  if (!p) return null;
  if (p._count.followUps) return "项目下面有这一批以外的跟进";
  if (p._count.members) return "项目拉了成员";
  if (await tx.entLeadAssign.findFirst({ where: { projectId: id }, select: { id: true } })) return "项目分配过";
  // 这一批没负责人直接进的公海（11-02）、之后没人动过，不算被接着用：只有那一条进公海留痕，没人领过、转过
  if (p.pooledAt && !(await 导入进的公海没动过(tx, id, p.ownerId))) return "项目在公海里";
  // 导入的线索建项目时挂的是同一批建的联系人（apply.ts 线索落项目），那不算导入后补的
  const 自己的联系人 =
    !!p.contactId && !!(await tx.entImportRow.findFirst({ where: { batchId: 批次Id, entity: "contact", targetId: p.contactId, kind: "create" }, select: { id: true } }));
  if ((p.contactId && !自己的联系人) || p.nextStepAt || p.nextStepText || p.exceptionCategoryId) return "导入之后又补过项目（联系人、下一步、异常类别）";
  if (p.balanceSettled || p.acceptancePassed) return "项目勾过尾款结清或验收通过";
  return null;
}

/** 撤回前存一份：项目本身 + 节点日志（跟进挂项目那条跟着跟进存） */
export async function 项目快照(tx: Tx, id: string): Promise<Record<string, unknown> | null> {
  const p = await tx.project.findUnique({ where: { id }, include: { logs: true } });
  return p ? { ...p, __项目: true } : null;
}

export async function 建回项目(tx: Tx, data: Record<string, unknown>): Promise<void> {
  const { logs, __项目: _, ...主 } = data as { logs?: Prisma.ProjectNodeLogCreateManyInput[]; __项目?: boolean } & Prisma.ProjectUncheckedCreateInput;
  await tx.project.create({ data: 主 });
  if (logs?.length) await tx.projectNodeLog.createMany({ data: logs });
}
