/**
 * 12-22 第 2 阶段 B 段 · 裁定与撤回（判定页 #19 #20，Even 11-27 E-414：30 天、立刻生效、撤回才退回）。
 *
 * 待我裁定：status = 待裁定 且 judgeIds 含我（A 段提异议时按「让变动生效那位的上一级」算好）。
 * 裁定：维持 / 撤回，无默认，说明必填 ≤200 字，写进 judgeNote / judgedAt / judgedById、客户操作日志与变更历史；
 *   - 维持：什么都不动，通知异议人、发起人；
 *   - 撤回：先看撤回边界（项目还在接手人手里、没被并、没结束、没进公海；客户异议再加客户还在接手人手里、没进公海、没删）——
 *       都满足 → 自动退回原负责人（项目一个个退；客户异议连客户带当次随转的在推项目一起退），状态「撤回」，通知异议人、发起人、被退回的接手人、客户负责人；
 *       有一条不满足 → 什么都不退，状态「待手工退回」，通知异议人、发起人、系统管理员；系统管理员手工退回后点「已手工退回」，
 *       状态「已退回」，再通知各方（12-22 先由系统管理员手工退并留痕，判定页 #8）。
 * 退回怎么做（复用现成的，不另造）：
 *   - 项目：carry-over-db 转项目（换负责人 + 将回收提醒跟着换人 + 转让痕 + 卡点随项目换人），待办用 carry-tasks 换负责人待办（待办跟项目走），
 *     转让痕原因以 手动转让痕 / 待办痕 开头：超时未跟进自动转（reply-overdue.ts）靠开头认「别人把这条项目分给他」= 新线索验证钟从退回那一刻起从头计时；
 *   - 客户：owner-log-db 记换负责人（kind undo，在客户变更历史显示「撤销」+ 原因），不计三态转让次数；
 *   - 提成：EntCommission 按项目存、固定后不带负责人，所以已计提的不动、未计提的随项目负责人走，这里不用另写。
 * 整个退回在一个事务里，任何一步对不上整笔回滚（不会退一半）。
 */
import type { EntTransferObjection, Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 查完再写 } from "@/lib/check-then-write";
import { 看全部 } from "@/lib/team-scope";
import { recordAudit } from "@/lib/audit";
import { 转项目 } from "@/lib/carry-over-db";
import { 换负责人待办, 待办痕, 手动转让痕, 接上待办痕, 跟着客户痕 } from "@/lib/project/carry-tasks";
import { 记换负责人 } from "@/lib/owner-log-db";
import { 企业版 } from "./switch";
import { 看已删 } from "./soft-delete-core";
import { notify } from "./notify";
import { 读组织 } from "./org";
import { 客户显名, 显名列 } from "./customer-title";
import { 系统管理员们 } from "./tri-state-people";
import { 项目合并单们 } from "./project-merge-guard";
import {
  异议待裁定, 异议维持, 异议撤回, 异议待手工退回, 异议已退回, 裁定说明上限, 不能自动退话, 算不能自动退, type 不能自动退类,
} from "./objection-core";

type Db = Prisma.TransactionClient;

/** 随客户转的项目和转让那行客户换负责人记录差多久算「当次」：同一个事务里写的，差几毫秒；留宽一点 */
const 当次窗口毫秒 = 120_000;

export type 退回评估 =
  | { 自动: true; 还给: string; 项目: { id: string; name: string; customerId: string }[] }
  | { 自动: false; 类: 不能自动退类; 原因: string };

const 不行 = (类: 不能自动退类, 对象: string): 退回评估 => ({ 自动: false, 类, 原因: 不能自动退话(类, 对象) });

/** 一条异议撤回的话能不能自动退（撤回边界，判定页 #20）。只读，裁定页预览和真退共用 */
export async function 评估退回(db: Db, 行: Pick<EntTransferObjection, "kind" | "customerId" | "projectId" | "targetName" | "objectorUserId" | "toOwnerId" | "ownerLogId">): Promise<退回评估> {
  const 还给 = 行.objectorUserId;
  const 在职 = (await db.user.findUnique({ where: { id: 还给 }, select: { active: true } }))?.active === true;
  if (!在职) return 不行("原负责人已停用", 行.targetName);
  const 读项目们 = (ids: string[]) => 看全部(() => 看已删(() => db.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, customerId: true, ownerId: true, pooledAt: true, result: true, deletedAt: true } })));
  const 现状of = async (ps: Awaited<ReturnType<typeof 读项目们>>) => {
    const 并 = await 项目合并单们(db, ps.map((p) => p.id));
    return new Map(ps.map((p) => [p.id, 算不能自动退({ 已删除: !!p.deletedAt, 被并: 并.get(p.id)?.我是 === "被并", 进公海: !!p.pooledAt, 已结束: p.result !== null, 现负责人: p.ownerId }, 行.toOwnerId)]));
  };
  if (行.kind === "项目") {
    if (!行.projectId) return 不行("已删除", 行.targetName);
    const [p] = await 读项目们([行.projectId]);
    if (!p) return 不行("已删除", 行.targetName);
    const 类 = (await 现状of([p])).get(p.id) ?? null;
    return 类 ? 不行(类, p.name) : { 自动: true, 还给, 项目: [{ id: p.id, name: p.name, customerId: p.customerId }] };
  }
  // 客户异议：客户本身 + 当次随客户转过去、转的时候还在推的项目（转的时候就已结束的是历史，留在原处不挡）
  const c = await 看全部(() => 看已删(() => db.customer.findUnique({ where: { id: 行.customerId }, select: { salesOwnerId: true, deletedAt: true, pool: { select: { customerId: true } } } })));
  if (!c || c.deletedAt) return 不行("已删除", 行.targetName);
  if (c.pool) return 不行("进公海", 行.targetName);
  if (c.salesOwnerId !== 行.toOwnerId) return 不行("已再转", 行.targetName);
  const 日志 = await db.customerOwnerLog.findUnique({ where: { id: 行.ownerLogId }, select: { at: true, fromOwnerId: true } });
  const 痕们 = 日志
    ? await db.projectNodeLog.findMany({
      where: {
        kind: { in: ["transfer", "pool-claim"] }, toOwnerId: 行.toOwnerId, fromOwnerId: 日志.fromOwnerId, reason: { startsWith: 跟着客户痕 },
        at: { gte: new Date(日志.at.getTime() - 当次窗口毫秒), lte: new Date(日志.at.getTime() + 当次窗口毫秒) }, project: { customerId: 行.customerId },
      },
      select: { projectId: true, toResult: true },
    })
    : [];
  const 当时在推 = [...new Set(痕们.filter((l) => l.toResult === null).map((l) => l.projectId))];
  const 们 = 当时在推.length ? await 读项目们(当时在推) : [];
  const 现状 = await 现状of(们);
  for (const p of 们) {
    const 类 = 现状.get(p.id);
    if (类) return 不行(类, p.name);
  }
  return { 自动: true, 还给, 项目: 们.map((p) => ({ id: p.id, name: p.name, customerId: p.customerId })) };
}

class 裁定拦 extends Error {}

/** 在事务里真退：项目一个个退（待办跟着走、验证钟从头）、客户异议再退客户本身。对不上（刚被改）抛 裁定拦，整笔回滚 */
async function 执行退回(tx: Db, 行: EntTransferObjection, 评估: Extract<退回评估, { 自动: true }>, 裁定人: string, 说明: string): Promise<{ 项目数: number; 退了客户: boolean }> {
  const 话 = `异议撤回，退回原负责人：${说明}`;
  for (const p of 评估.项目) {
    const 几条 = await 换负责人待办(tx, { id: p.id, customerId: p.customerId, name: p.name, pooledAt: null }, 行.toOwnerId, 评估.还给, true);
    const 动 = await 转项目(tx, { id: p.id, ownerId: 行.toOwnerId, pooledAt: null, result: null }, 评估.还给, 裁定人, true, 接上待办痕(待办痕(true, 几条) ?? 手动转让痕, 话));
    if (!动.length) throw new 裁定拦(`「${p.name}」刚被别人改过，这次没退，请刷新再裁定`);
  }
  if (行.kind !== "客户") return { 项目数: 评估.项目.length, 退了客户: false };
  const r = await tx.customer.updateMany({ where: { id: 行.customerId, salesOwnerId: 行.toOwnerId }, data: { salesOwnerId: 评估.还给 } });
  if (r.count !== 1) throw new 裁定拦("这位客户刚被别人改过负责人，这次没退，请刷新再裁定");
  await 记换负责人(tx, [{ customerId: 行.customerId, from: 行.toOwnerId, to: 评估.还给 }], 裁定人, "undo", new Map([[行.customerId, { 原因: 话, 最近跟进: null, 重复咨询: null }]]));
  return { 项目数: 评估.项目.length, 退了客户: true };
}

export type 待裁定行 = {
  id: string; 类别: "客户" | "项目"; 对象: string; 客户名: string; 异议人: string; 理由: string; 转让原因: string;
  发起人: string; 接手人: string; 转让于: string; 提于: string; 状态: string;
  /** 撤回能不能自动退；不能时 说明 写为什么（页上提示，撤回照样能点，裁定后转「待手工退回」） */
  能自动退: boolean; 退回说明: string;
  /** 已裁定行（待手工退回）才有 */
  裁定说明?: string; 裁定人?: string;
};

async function 填行(行们: EntTransferObjection[], 看退回: boolean): Promise<待裁定行[]> {
  if (!行们.length) return [];
  const 人ids = [...new Set(行们.flatMap((r) => [r.objectorUserId, r.operatorUserId, r.toOwnerId, ...(r.judgedById ? [r.judgedById] : [])]))];
  const [人们, 日志们, 客户们] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: 人ids } }, select: { id: true, name: true } }),
    prisma.customerOwnerLog.findMany({ where: { id: { in: 行们.map((r) => r.ownerLogId) } }, select: { id: true, reason: true, at: true } }),
    看全部(() => 看已删(() => prisma.customer.findMany({ where: { id: { in: 行们.map((r) => r.customerId) } }, select: 显名列 }))),
  ]);
  const 名 = new Map(人们.map((u) => [u.id, u.name]));
  const 日志 = new Map(日志们.map((l) => [l.id, l]));
  const 客户名 = new Map(客户们.map((c) => [c.id, 客户显名(c)]));
  const 出: 待裁定行[] = [];
  for (const r of 行们) {
    const 评 = 看退回 ? await 评估退回(prisma, r) : null;
    出.push({
      id: r.id, 类别: r.kind === "项目" ? "项目" : "客户", 对象: r.targetName, 客户名: 客户名.get(r.customerId) ?? "",
      异议人: 名.get(r.objectorUserId) ?? "", 理由: r.reason ?? "", 转让原因: 日志.get(r.ownerLogId)?.reason ?? "",
      发起人: 名.get(r.operatorUserId) ?? "", 接手人: 名.get(r.toOwnerId) ?? "",
      转让于: (日志.get(r.ownerLogId)?.at ?? r.createdAt).toISOString(), 提于: (r.submittedAt ?? r.createdAt).toISOString(), 状态: r.status,
      能自动退: !评 || 评.自动, 退回说明: 评 && !评.自动 ? 评.原因 : "",
      ...(r.judgeNote ? { 裁定说明: r.judgeNote } : {}),
      ...(r.judgedById ? { 裁定人: 名.get(r.judgedById) ?? "" } : {}),
    });
  }
  return 出;
}

/** 待我裁定：待裁定且裁定人里有我（最早提的在前） */
export async function 待我裁定(userId: string): Promise<待裁定行[]> {
  if (!企业版()) return [];
  const 行们 = await prisma.entTransferObjection.findMany({
    where: { status: 异议待裁定, judgeIds: { contains: JSON.stringify(userId) } },
    orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 200,
  });
  return 填行(行们.filter((r) => r.judgeIds && (JSON.parse(r.judgeIds) as string[]).includes(userId)), true);
}

/** 待手工退回：只给系统管理员看（调用方判断身份）；最早裁定的在前 */
export async function 待手工退回们(): Promise<待裁定行[]> {
  if (!企业版()) return [];
  const 行们 = await prisma.entTransferObjection.findMany({ where: { status: 异议待手工退回 }, orderBy: [{ judgedAt: "asc" }, { id: "asc" }], take: 200 });
  const 出 = await 填行(行们, true);
  return 出;
}

const 话of = (r: EntTransferObjection) => `${r.kind}「${r.targetName}」`;

async function 名们of(ids: string[]): Promise<Map<string, string>> {
  return new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
}

export type 裁定结果 = { ok: true; 结果: "维持" | "撤回" | "待手工退回"; 说: string } | { ok: false; error: string };

/**
 * 裁定：只有裁定人本人；说明必填 ≤200 字；无默认（决定必须是 维持 / 撤回）；同一条只能裁一次（并发只成一次）
 */
export async function 裁定(me: { id: string; name: string }, id: unknown, 决定: unknown, 说明: unknown, 现在: Date = new Date()): Promise<裁定结果> {
  if (!企业版()) return { ok: false, error: "这个功能只有企业版有" };
  if (typeof id !== "string" || !id) return { ok: false, error: "没找到这条异议" };
  if (决定 !== "维持" && 决定 !== "撤回") return { ok: false, error: "请选择维持或撤回" };
  const 话 = typeof 说明 === "string" ? 说明.trim() : "";
  if (!话) return { ok: false, error: "请写裁定说明（会记进变更历史）" };
  if (话.length > 裁定说明上限) return { ok: false, error: `裁定说明最多 ${裁定说明上限} 字` };
  const 行 = await prisma.entTransferObjection.findUnique({ where: { id } });
  const 我是裁定人 = !!行?.judgeIds && (JSON.parse(行.judgeIds) as string[]).includes(me.id);
  // 不是裁定人的当没有，不透露存在
  if (!行 || !我是裁定人) return { ok: false, error: "没找到这条待裁定的异议" };
  if (行.status !== 异议待裁定) return { ok: false, error: "这一条已经裁定过了，刷新看看" };

  let 终态: string = 异议维持;
  type 退了 = { 项目数: number; 退了客户: boolean };
  const 盒: { 退: 退了 | null } = { 退: null };
  let 手工原因 = "";
  try {
    await 查完再写(async (tx) => {
      let 状态: string = 异议维持;
      let 评: 退回评估 | null = null;
      if (决定 === "撤回") {
        评 = await 评估退回(tx, 行);
        状态 = 评.自动 ? 异议撤回 : 异议待手工退回;
      }
      // 并发：只有第一个把「待裁定」改掉的成，后到的命中 0 行、整笔回滚
      const r = await tx.entTransferObjection.updateMany({
        where: { id: 行.id, status: 异议待裁定 },
        data: { status: 状态, judgeNote: 话, judgedAt: 现在, judgedById: me.id },
      });
      if (r.count !== 1) throw new 裁定拦("这一条已经裁定过了，刷新看看");
      终态 = 状态;
      if (评?.自动) 盒.退 = await 执行退回(tx, 行, 评, me.id, 话);
      else if (评) 手工原因 = 评.原因;
    }, { timeout: 30_000 });
  } catch (e) {
    if (e instanceof 裁定拦) return { ok: false, error: e.message };
    throw e;
  }

  const 退 = 盒.退;
  const 名 = await 名们of([行.objectorUserId, 行.operatorUserId, 行.toOwnerId]);
  const 异议人 = 名.get(行.objectorUserId) ?? "";
  const 发起人 = 名.get(行.operatorUserId) ?? "";
  const 接手人 = 名.get(行.toOwnerId) ?? "";
  await recordAudit({
    user: me, action: "update", entity: "Customer", entityId: 行.customerId,
    summary: `转让异议裁定：${异议人}对${话of(行)}的异议，${me.name}裁定「${决定}」${终态 === 异议待手工退回 ? "（不满足自动退回，待系统管理员手工退回）" : ""}：${话}`,
    detail: { 异议: 行.id, 换负责人记录: 行.ownerLogId, 对象: 行.targetKey, 异议理由: 行.reason, 裁定: 决定, 结果: 终态, 裁定说明: 话, ...(退 ? { 退回: 退 } : {}), ...(手工原因 ? { 待手工原因: 手工原因 } : {}) },
  }).catch((e) => console.warn("[异议] 裁定留痕没写上：", e));

  const 链 = "/objections";
  const 裁 = `${me.name} 裁定「${决定}」`;
  if (终态 === 异议维持) {
    await notify([行.objectorUserId], { kind: "异议", title: `你对${话of(行)}的转让异议已裁定：维持（${me.name}），仍归${接手人}`, body: `裁定说明：${话}`, link: 链, key: `objection-done:${行.id}:objector` });
    await notify([行.operatorUserId], { kind: "异议", title: `${异议人}对${话of(行)}的转让异议已裁定：维持（${me.name}）`, body: `裁定说明：${话}`, link: 链, key: `objection-done:${行.id}:operator` });
    return { ok: true, 结果: "维持", 说: "已裁定：维持，已通知异议人和发起人" };
  }
  if (终态 === 异议待手工退回) {
    await notify([行.objectorUserId], { kind: "异议", title: `你对${话of(行)}的转让异议已裁定：撤回（${me.name}），等系统管理员手工退回`, body: `裁定说明：${话}\n${手工原因}`, link: 链, key: `objection-done:${行.id}:objector` });
    await notify([行.operatorUserId], { kind: "异议", title: `${异议人}对${话of(行)}的转让异议已裁定：撤回（${me.name}），等系统管理员手工退回`, body: `裁定说明：${话}\n${手工原因}`, link: 链, key: `objection-done:${行.id}:operator` });
    const org = await 读组织();
    await notify(org ? 系统管理员们(org) : [], {
      kind: "异议", title: `待手工退回：${话of(行)}（${发起人} 转给 ${接手人}，${异议人}提的异议已${裁}）`,
      body: `${手工原因}\n裁定说明：${话}\n请手工退回原负责人${异议人}后，在「转让异议」页点「已手工退回」留痕。`, link: "/objections?tab=hand", key: `objection-hand:${行.id}`,
    });
    return { ok: true, 结果: "待手工退回", 说: "已裁定：撤回。不满足自动退回的条件，已通知系统管理员手工退回" };
  }
  await 通知退回完(行, me.name, 话, "自动");
  return { ok: true, 结果: "撤回", 说: `已裁定：撤回，已退回${异议人}${退?.项目数 ? `（含 ${退.项目数} 个项目）` : ""}，并通知各方` };
}

/** 撤回退回做完（自动或手工）：通知异议人、发起人、被退回的接手人、客户现在的负责人（判定页 #19） */
async function 通知退回完(行: EntTransferObjection, 谁: string, 说明: string, 方式: "自动" | "手工"): Promise<void> {
  const 名 = await 名们of([行.objectorUserId, 行.operatorUserId, 行.toOwnerId]);
  const c = await 看全部(() => 看已删(() => prisma.customer.findUnique({ where: { id: 行.customerId }, select: { salesOwnerId: true } })));
  const 异议人 = 名.get(行.objectorUserId) ?? "";
  const 头 = `${话of(行)}已退回${异议人}（异议裁定撤回，${方式 === "手工" ? "系统管理员手工退回" : `${谁}裁定`}）`;
  const body = `裁定说明：${说明}`;
  const 链 = "/objections";
  await notify([行.objectorUserId], { kind: "异议", title: `你对${话of(行)}的转让异议已裁定：撤回，已退回给你`, body, link: 链, key: `objection-done:${行.id}:objector${方式 === "手工" ? ":hand" : ""}` });
  await notify([行.operatorUserId], { kind: "异议", title: `${异议人}对${话of(行)}的转让异议已撤回，${头}`, body, link: 链, key: `objection-done:${行.id}:operator${方式 === "手工" ? ":hand" : ""}` });
  await notify([行.toOwnerId], { kind: "异议", title: `${头}，不再归你`, body, link: 链, key: `objection-done:${行.id}:taker${方式 === "手工" ? ":hand" : ""}` });
  if (c?.salesOwnerId) await notify([c.salesOwnerId], { kind: "异议", title: `${头}（你是这位客户的负责人）`, body, link: 链, key: `objection-done:${行.id}:owner${方式 === "手工" ? ":hand" : ""}` });
}

/** 系统管理员手工退回做完：写留痕、状态变「已退回」、通知各方。手工退回本身在别处做（改项目负责人 / 转让客户），这里只记「做完了」 */
export async function 标记已手工退回(me: { id: string; name: string }, id: unknown, 说明: unknown, 现在: Date = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!企业版()) return { ok: false, error: "这个功能只有企业版有" };
  if (typeof id !== "string" || !id) return { ok: false, error: "没找到这条异议" };
  const org = await 读组织();
  if (!org || !系统管理员们(org).includes(me.id)) return { ok: false, error: "只有系统管理员能记手工退回" };
  const 话 = typeof 说明 === "string" ? 说明.trim() : "";
  if (!话) return { ok: false, error: "请写一句手工退回的说明（退给了谁、在哪里改的），会记进变更历史" };
  if (话.length > 裁定说明上限) return { ok: false, error: `说明最多 ${裁定说明上限} 字` };
  const 行 = await prisma.entTransferObjection.findUnique({ where: { id } });
  if (!行 || 行.status !== 异议待手工退回) return { ok: false, error: "这一条不在待手工退回里了，刷新看看" };
  const r = await prisma.entTransferObjection.updateMany({ where: { id: 行.id, status: 异议待手工退回 }, data: { status: 异议已退回, judgeNote: `${行.judgeNote ?? ""}${行.judgeNote ? "；" : ""}手工退回：${话}`.slice(0, 600) } });
  if (r.count !== 1) return { ok: false, error: "这一条已经有人处理了，刷新看看" };
  await recordAudit({
    user: me, action: "update", entity: "Customer", entityId: 行.customerId,
    summary: `转让异议：${话of(行)}由${me.name}手工退回${(await 名们of([行.objectorUserId])).get(行.objectorUserId) ?? ""}：${话}`,
    detail: { 异议: 行.id, 换负责人记录: 行.ownerLogId, 对象: 行.targetKey, 手工退回说明: 话, 时间: 现在.toISOString() },
  }).catch((e) => console.warn("[异议] 手工退回留痕没写上：", e));
  await 通知退回完({ ...行, status: 异议已退回 }, me.name, 话, "手工");
  return { ok: true };
}
