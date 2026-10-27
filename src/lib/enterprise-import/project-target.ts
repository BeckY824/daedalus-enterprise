/**
 * 企业版只用项目时，导入的「商机」行落成项目（2026-10-26 用户：「把线索，商机，订单都放到项目里，是三大阶段」）。
 *
 * 对照表、冲突、报告都还按 opportunity 这一类记，只是目标 id 指向 Project：
 *   - 比对字段沿用商机那几格：stage = 项目节点、status = 结局（没结局 = "OPEN"）；probability 项目没有，恒为空；expectedDealAt 落项目上的预计成交日期（10-27 从客户挪过来）
 *   - 读现值 / 改 / 撤回 先找商机、找不到再找项目，所以不用知道当时是不是项目模式
 *   - 原系统的节点名先认 2.0 的节点和结局，再认新版的叫法（旧名 表，草案，待对方确认）
 * 导入只认原系统：节点可以往回走（包括已转商机的退回线索），这一点和手动改节点不同；异常状态导进来没有类别。
 */
import type { Prisma } from "@/generated/prisma";
import { 是结局, type 阶段 } from "../project/nodes";
import { 规, 写不进, type 值表, type 标量 } from "./apply";
import { 节点所在阶段 } from "./project-values";
export { 项目阶段值, 项目节点对值, 节点所在阶段, 结局默认节点 } from "./project-values";

type Tx = Prisma.TransactionClient;

/** 比对格子 → 项目上的 phase / node / result */
function 位置(v: 值表): { phase: 阶段; node: string; result: string | null } {
  const result = 是结局(v.status) ? String(v.status) : null;
  const node = String(v.stage ?? "");
  const phase = 节点所在阶段(node);
  if (!phase) throw new 写不进(`「${node}」不是项目的节点`);
  return { phase, node, result };
}

const 日 = (v: 标量): Date | null => (v ? new Date(String(v)) : null);
const 串 = (v: 标量): string | null => (v === null ? null : String(v));

/** 项目现在的样子，换成商机那几格 */
export async function 读项目(tx: Tx, id: string): Promise<值表 | null> {
  const p = await tx.project.findUnique({
    where: { id },
    select: { name: true, amount: true, node: true, result: true, closedAt: true, ownerId: true, remark: true, customerId: true, expectedDealAt: true },
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
    }).map(([k, x]) => [k, 规(x)]),
  );
}

export async function 是项目(tx: Tx, id: string): Promise<boolean> {
  return !!(await tx.project.findUnique({ where: { id }, select: { id: true } }));
}

/** 新建项目 + 一条起点日志；创建人记成负责人（导入的人不一定是负责人，项目页「我创建的」按它算） */
export async function 建项目(tx: Tx, v: 值表, 现在: string): Promise<string> {
  const 位 = 位置(v);
  const ownerId = String(v.ownerId);
  const p = await tx.project.create({
    data: {
      name: String(v.name),
      customerId: String(v.customerId),
      ownerId,
      creatorId: ownerId,
      amount: Number(v.amount ?? 0),
      phase: 位.phase,
      node: 位.node,
      result: 位.result,
      remark: 串(v.remark),
      expectedDealAt: 日(v.expectedDealAt),
      closedAt: 位.result ? (日(v.closedAt) ?? new Date(现在)) : null,
    },
    select: { id: true },
  });
  await tx.projectNodeLog.create({ data: { projectId: p.id, userId: ownerId, toPhase: 位.phase, toNode: 位.node, toResult: 位.result } });
  return p.id;
}

/** 改项目的这几格；节点或结局变了记一条节点日志（谁改的记负责人） */
export async function 改项目(tx: Tx, id: string, 改动: 值表, 现值: 值表, 现在: string): Promise<void> {
  const 有 = (k: string) => k in 改动;
  const data: Prisma.ProjectUncheckedUpdateInput = {};
  if (有("name")) data.name = String(改动.name);
  if (有("ownerId")) data.ownerId = String(改动.ownerId);
  if (有("amount")) data.amount = Number(改动.amount ?? 0);
  if (有("remark")) data.remark = 串(改动.remark);
  if (有("expectedDealAt")) data.expectedDealAt = 日(改动.expectedDealAt);
  // 换了客户，原来选的联系人就不是这家的了
  if (有("customerId")) Object.assign(data, { customerId: String(改动.customerId), contactId: null });
  const 原 = await tx.project.findUnique({ where: { id }, select: { phase: true, node: true, result: true, closedAt: true, ownerId: true } });
  if (!原) throw new 写不进("项目不在了");
  const 新 = 位置({ stage: 有("stage") ? 改动.stage : 现值.stage, status: 有("status") ? 改动.status : 现值.status });
  if (新.node !== 原.node || 新.result !== 原.result) {
    Object.assign(data, { phase: 新.phase, node: 新.node, result: 新.result });
    if (新.result !== "异常状态") Object.assign(data, { exceptionCategoryId: null, exceptionReason: null });
    await tx.projectNodeLog.create({
      data: {
        projectId: id,
        userId: String(data.ownerId ?? 原.ownerId),
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
  else if (新.result !== 原.result || 有("closedAt")) data.closedAt = 日(有("closedAt") ? 改动.closedAt : 现值.closedAt) ?? 原.closedAt ?? new Date(现在);
  if (Object.keys(data).length) await tx.project.update({ where: { id }, data });
}

/* ───────────────────────── 撤回用 ───────────────────────── */

/**
 * 这一批建的项目还能不能删：被人接着用过 → 拦的原因；没有 = null。
 * 这一批自己挂上的跟进这时已经先退掉了（倒着退），还挂着的就是外面的
 */
export async function 项目挂件(tx: Tx, id: string): Promise<string | null> {
  const p = await tx.project.findUnique({
    where: { id },
    select: {
      contactId: true,
      pooledAt: true,
      nextStepAt: true,
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
  if (p.pooledAt) return "项目在公海里";
  if (p.contactId || p.nextStepAt || p.exceptionCategoryId) return "导入之后又补过项目（联系人、下一步、异常类别）";
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
