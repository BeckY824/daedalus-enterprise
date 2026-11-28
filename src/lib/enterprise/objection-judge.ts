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
import { getSetting, setSetting } from "@/lib/settings";
import { beijingWallIso } from "@/lib/business-clock";
import { 查完再写 } from "@/lib/check-then-write";
import { 看全部 } from "@/lib/team-scope";
import { recordAudit } from "@/lib/audit";
import { 转项目, 不跟着转的提醒 } from "@/lib/carry-over-db";
import { 换负责人待办, 待办痕, 手动转让痕, 接上待办痕, 跟着客户痕 } from "@/lib/project/carry-tasks";
import { 记换负责人 } from "@/lib/owner-log-db";
import { 企业版 } from "./switch";
import { 看已删 } from "./soft-delete-core";
import { notify } from "./notify";
import { 读组织 } from "./org";
import { 重算裁定人们 } from "./objection";
import { 客户显名, 显名列 } from "./customer-title";
import { 客户编号显示 } from "@/lib/customer-no";
import { 系统管理员们 } from "./tri-state-people";
import { 项目合并单们 } from "./project-merge-guard";
import { 拦下 } from "./customer-merge";
import { 合并撤不了的原因, 在事务里撤回项目合并, 发撤回通知 } from "./project-merge";
import { 记合并异议留痕 } from "./objection";
import { 客户状态自动 } from "./cust-status-auto-db";
import { 存沟通后重算三态 } from "./tri-state-db";
import { 事of, 合并异议类 } from "./objection-core";
import {
  异议待裁定, 异议已撤销, 异议维持, 异议撤回, 异议待手工退回, 异议已退回, 裁定说明上限, 不能自动退话, 算不能自动退, 能裁定, 台账条数上限, type 不能自动退类, type 裁定人结果,
} from "./objection-core";

type Db = Prisma.TransactionClient;

/** 随客户转的项目和转让那行客户换负责人记录差多久算「当次」：同一个事务里写的，差几毫秒；留宽一点 */
const 当次窗口毫秒 = 120_000;

export type 退回评估 =
  | { 自动: true; 还给: string; 项目: { id: string; name: string; customerId: string }[]; /** 项目合并类：自动 = 同事务撤回这张合并单 */ 合并单?: string }
  | { 自动: false; 类: 不能自动退类; 原因: string };

const 不行 = (类: 不能自动退类, 对象: string): 退回评估 => ({ 自动: false, 类, 原因: 不能自动退话(类, 对象) });

/** 一条异议撤回的话能不能自动退（撤回边界，判定页 #20）。只读，裁定页预览和真退共用 */
export async function 评估退回(db: Db, 行: Pick<EntTransferObjection, "kind" | "customerId" | "projectId" | "targetName" | "objectorUserId" | "toOwnerId" | "ownerLogId"> & { mergeId?: string | null }): Promise<退回评估> {
  const 还给 = 行.objectorUserId;
  if (行.kind === 合并异议类) {
    // 项目合并类：撤回 = 撤回这张合并单（被并项目的负责人没变，不看原负责人在不在职）；前置同 在事务里撤回项目合并，30 天不再校
    const m = 行.mergeId ? await 看全部(() => 看已删(() => db.entCustomerMerge.findUnique({ where: { id: 行.mergeId! }, select: { id: true, status: true, fromId: true, intoId: true } }))) : null;
    const 拦 = m ? await 看已删(() => 看全部(() => 合并撤不了的原因(db, m))) : "合并单不在了";
    return 拦 ? { 自动: false, 类: "合并撤不了", 原因: `「${行.targetName}」这次合并现在不能自动撤回（${拦}）；裁定撤回后由系统管理员手工撤回合并并留痕` } : { 自动: true, 还给, 项目: [], 合并单: m!.id };
  }
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
  const 日志 = await db.customerOwnerLog.findUnique({ where: { id: 行.ownerLogId ?? "" }, select: { at: true, fromOwnerId: true } });
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
async function 执行退回(tx: Db, 行: EntTransferObjection, 评估: Extract<退回评估, { 自动: true }>, 裁定人: string, 说明: string): Promise<{ 项目数: number; 退了客户: boolean; 计划数?: number; 待办数?: number }> {
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
  // 12-22 审查 M4：转让时客户上的未完成计划、待办也一起带去了接手人名下，撤回时一并退给原负责人。异议行没有存「当次带走的 id」的列（不加迁移），
  // 按条件找：这位客户 + 现在归接手人 + 没做完 + 转让时刻前就有（接手人转让后自己新建的不退）+ 转让那一刻被换过手（updatedAt ≥ 转让时刻前一点，
  // 接手人转让前就有、没被带动过的不算）；已完成的不动；转让时不跟着转的提醒待办也不动。同一事务里做
  const 日志 = await tx.customerOwnerLog.findUnique({ where: { id: 行.ownerLogId ?? "" }, select: { at: true } });
  if (!日志) return { 项目数: 评估.项目.length, 退了客户: true, 计划数: 0, 待办数: 0 };
  const 起 = new Date(日志.at.getTime() - 当次窗口毫秒);
  const 带 = { customerId: 行.customerId, ownerId: 行.toOwnerId, done: false, createdAt: { lte: 日志.at }, updatedAt: { gte: 起 } };
  const 计划们 = await tx.followPlan.findMany({ where: 带, select: { id: true } });
  // 待办没有 projectId：此刻仍归接手人的项目（随转的同事项目、接手人自己原有的、后来建的；已退给原负责人的不算）上的待办不退，
  // 认法同 转让带待办（carry-tasks.ts）：标题里点了「项目名」的（含将回收提醒头）。12-22 r4 必改 2
  const 仍归他的项目 = await tx.project.findMany({ where: { customerId: 行.customerId, ownerId: 行.toOwnerId }, select: { name: true } });
  const 待办们 = await tx.task.findMany({
    where: { ...带, AND: [...不跟着转的提醒("assign"), ...仍归他的项目.map((p) => ({ NOT: { title: { contains: `「${p.name}」` } } }))] },
    select: { id: true },
  });
  const 计划r = 计划们.length ? await tx.followPlan.updateMany({ where: { id: { in: 计划们.map((x) => x.id) }, ownerId: 行.toOwnerId, done: false }, data: { ownerId: 评估.还给 } }) : { count: 0 };
  const 待办r = 待办们.length ? await tx.task.updateMany({ where: { id: { in: 待办们.map((x) => x.id) }, ownerId: 行.toOwnerId, done: false }, data: { ownerId: 评估.还给 } }) : { count: 0 };
  return { 项目数: 评估.项目.length, 退了客户: true, 计划数: 计划r.count, 待办数: 待办r.count };
}

export type 待裁定行 = {
  id: string; 类别: "客户" | "项目" | "项目合并"; 对象: string; 客户名: string; 异议人: string; 理由: string; 转让原因: string;
  发起人: string; 接手人: string; 转让于: string; 提于: string; 状态: string;
  /** 撤回能不能自动退；不能时 说明 写为什么（页上提示，撤回照样能点，裁定后转「待手工退回」） */
  能自动退: boolean; 退回说明: string;
  /** 已裁定行（待手工退回）才有 */
  裁定说明?: string; 裁定人?: string;
  /** 待裁定行才有：按当前组织重算的裁定人（名字）；只剩发起人自己一位系统管理员时 本人发起 = true，页上写明「本人发起」 */
  现裁定人?: string; 本人发起?: boolean; 本人接手?: boolean;
  /** 待裁定行才有：我能不能裁（= 能裁定）；不能（我是发起人 / 接手人 / 异议人且还有别人可裁）页上不出维持 / 撤回，写回避 */
  能裁?: boolean;
};

async function 填行(行们: EntTransferObjection[], 看退回: boolean, 我?: string, 已评?: ReadonlyMap<string, 待裁定行>): Promise<待裁定行[]> {
  if (!行们.length) return [];
  const 人ids = [...new Set(行们.flatMap((r) => [r.objectorUserId, r.operatorUserId, r.toOwnerId, ...(r.judgedById ? [r.judgedById] : [])]))];
  const 合并ids = 行们.flatMap((r) => (r.kind === 合并异议类 && r.mergeId ? [r.mergeId] : []));
  const [人们, 日志们, 客户们, 合并们] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: 人ids } }, select: { id: true, name: true } }),
    prisma.customerOwnerLog.findMany({ where: { id: { in: 行们.flatMap((r) => (r.ownerLogId ? [r.ownerLogId] : [])) } }, select: { id: true, reason: true, at: true } }),
    看全部(() => 看已删(() => prisma.customer.findMany({ where: { id: { in: 行们.map((r) => r.customerId) } }, select: 显名列 }))),
    合并ids.length ? 看全部(() => prisma.entCustomerMerge.findMany({ where: { id: { in: 合并ids } }, select: { id: true, at: true, detail: true, fromName: true } })) : [],
  ]);
  const 名 = new Map(人们.map((u) => [u.id, u.name]));
  // 合并类行：「转让于」= 合并那一刻，「转让原因」= 一句话说清哪个并进哪个
  const 合并 = new Map(合并们.map((m) => {
    let 留下名 = ""; try { 留下名 = String((JSON.parse(m.detail) as { 留下名?: unknown }).留下名 ?? ""); } catch { /* 明细坏了留空 */ }
    return [m.id, { at: m.at, reason: `把「${m.fromName || "未命名项目"}」并入「${留下名 || "未命名项目"}」` }] as const;
  }));
  const 日志 = new Map<string, { reason: string | null; at: Date }>([...日志们.map((l) => [l.id, l] as const), ...[...合并].map(([id, m]) => [id, m] as const)]);
  const 客户名 = new Map(客户们.map((c) => [c.id, 客户显名(c)]));
  const 现裁 = await 重算裁定人们(行们.filter((r) => r.status === 异议待裁定));
  const 现裁名 = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set([...现裁.values()].flatMap((x) => x.ids))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const org = 我 ? await 读组织() : null;
  const 出: 待裁定行[] = [];
  for (const r of 行们) {
    const 裁 = 现裁.get(r.id);
    // 同一行已在别的页签算过评估就复用，不重复算
    const 旧 = 已评?.get(r.id);
    const 评 = 看退回 && !旧 ? await 评估退回(prisma, r) : null;
    出.push({
      id: r.id, 类别: r.kind === "项目" ? "项目" : r.kind === 合并异议类 ? "项目合并" : "客户", 对象: r.targetName, 客户名: 客户名.get(r.customerId) ?? "",
      异议人: 名.get(r.objectorUserId) ?? "", 理由: r.reason ?? "", 转让原因: 日志.get(r.ownerLogId ?? r.mergeId ?? "")?.reason ?? "",
      发起人: 名.get(r.operatorUserId) ?? "", 接手人: 名.get(r.toOwnerId) ?? "",
      转让于: (日志.get(r.ownerLogId ?? r.mergeId ?? "")?.at ?? r.createdAt).toISOString(), 提于: (r.submittedAt ?? r.createdAt).toISOString(), 状态: r.status,
      能自动退: 旧 ? 旧.能自动退 : !评 || 评.自动, 退回说明: 旧 ? 旧.退回说明 : 评 && !评.自动 ? 评.原因 : "",
      ...(r.judgeNote ? { 裁定说明: r.judgeNote } : {}),
      ...(r.judgedById ? { 裁定人: 名.get(r.judgedById) ?? "" } : {}),
      ...(裁 ? { 现裁定人: 裁.ids.map((x) => 现裁名.get(x) ?? "").filter(Boolean).join("、"), ...(裁.本人发起 ? { 本人发起: true } : {}), ...(裁.本人接手 ? { 本人接手: true } : {}) } : {}),
      ...(我 && r.status === 异议待裁定 ? { 能裁: !!裁 && !!org && 能裁定(org, 裁, 我, r) } : {}),
    });
  }
  return 出;
}

/** 待我裁定：待裁定且按当前组织重算后裁定人里有我（停用、调岗的不算；最早提的在前）。系统管理员兜底的看「全部待裁定」 */
export async function 待我裁定(userId: string): Promise<待裁定行[]> {
  if (!企业版()) return [];
  const 行们 = await prisma.entTransferObjection.findMany({ where: { status: 异议待裁定 }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 500 });
  const 现裁 = await 重算裁定人们(行们);
  return 填行(行们.filter((r) => 现裁.get(r.id)?.ids.includes(userId)).slice(0, 200), true, userId);
}

/** 全部待裁定：只给系统管理员看（调用方判断身份）；最早提的在前 */
export async function 全部待裁定(userId: string, 已评?: readonly 待裁定行[]): Promise<待裁定行[]> {
  if (!企业版()) return [];
  const org = await 读组织();
  if (!系统管理员们(org).includes(userId)) return [];
  const 行们 = await prisma.entTransferObjection.findMany({ where: { status: 异议待裁定 }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 200 });
  return 填行(行们, true, userId, new Map((已评 ?? []).map((r) => [r.id, r])));
}

/** 待手工退回：只给系统管理员看（调用方判断身份）；最早裁定的在前 */
export async function 待手工退回们(): Promise<待裁定行[]> {
  if (!企业版()) return [];
  const 行们 = await prisma.entTransferObjection.findMany({ where: { status: 异议待手工退回 }, orderBy: [{ judgedAt: "asc" }, { id: "asc" }], take: 200 });
  const 出 = await 填行(行们, true);
  return 出;
}

export type 特殊裁定行 = {
  id: string; 裁定于: string; 客户名: string; 客户编号: string; 项目: string; 类型: "本人发起" | "本人接手"; 发起人: string; 接手人: string; 裁定人: string;
  异议人: string; 异议理由: string; 结果: string; 裁定说明: string;
};

export { 台账条数上限 };

/** 台账「结果」列：撤回按状态细分（待手工退回 = 还没人退；已退回 = 手工退完；撤回 = 裁定时自动退了） */
const 台账结果 = (status: string): string =>
  status === 异议维持 ? "维持" : status === 异议待手工退回 ? "撤回（待手工退回）" : status === 异议已退回 ? "撤回（已退回）" : status === 异议撤回 ? "撤回（已自动退回）" : status;

/** 北京月 YYYY-MM 的起止（UTC 时刻，左闭右开） */
const 月区间 = (月: string): { gte: Date; lt: Date } | null => {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(月);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  return { gte: new Date(Date.UTC(y, mo - 1, 1) - 8 * 3_600_000), lt: new Date(Date.UTC(y, mo, 1) - 8 * 3_600_000) };
};
/**
 * 「本人裁定」：裁定人 = 发起人 或 = 接手人。不用字段引用（prisma.xxx.fields）：开着读通道时字段引用被当普通对象传下去丢了 _ref，
 * 整句 PrismaClientValidationError（#523）。改成先按时间取行、在 JS 里比
 */
const 是本人裁定 = (r: { judgedById: string | null; operatorUserId: string; toOwnerId: string }): boolean =>
  !!r.judgedById && (r.judgedById === r.operatorUserId || r.judgedById === r.toOwnerId);

/** 某个北京月里「本人裁定」的条数（每月 1 日通知用；不看身份，调用方保证只发给系统管理员） */
export async function 本月特殊裁定条数(月: string): Promise<number> {
  const 时间 = 月区间(月);
  if (!时间) return 0;
  const 行们 = await prisma.entTransferObjection.findMany({ where: { judgedAt: 时间 }, select: { judgedById: true, operatorUserId: true, toOwnerId: true } });
  return 行们.filter(是本人裁定).length;
}

/**
 * 特殊裁定台账（E-436）：列「本人发起、本人裁定」（裁定人 = 发起人）和「本人接手、本人裁定」（裁定人 = 接手人）的异议，
 * 按裁定时间倒序，月份（YYYY-MM，北京时间）可选；只给系统管理员，非系统管理员返回空（服务端判）。
 * 不另存标记列：judgedById 等于 operatorUserId / toOwnerId 就是「本人裁定」，在 JS 里比（不用字段引用，见 是本人裁定），时间回北京时间字符串。
 */
export async function 特殊裁定台账(userId: string, 月?: string | null): Promise<特殊裁定行[]> {
  if (!企业版()) return [];
  const org = await 读组织();
  if (!org || !系统管理员们(org).includes(userId)) return [];
  const 时间 = typeof 月 === "string" ? 月区间(月) : null;
  const 行们 = (await prisma.entTransferObjection.findMany({
    where: { judgedAt: 时间 ?? { not: null } },
    orderBy: [{ judgedAt: "desc" }, { id: "asc" }],
  })).filter(是本人裁定).slice(0, 台账条数上限);
  if (!行们.length) return [];
  const [人们, 客户们] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(行们.flatMap((r) => [r.operatorUserId, r.toOwnerId, r.objectorUserId]))] } }, select: { id: true, name: true } }),
    看全部(() => 看已删(() => prisma.customer.findMany({ where: { id: { in: 行们.map((r) => r.customerId) } }, select: 显名列 }))),
  ]);
  const 名 = new Map(人们.map((u) => [u.id, u.name]));
  const 客 = new Map(客户们.map((c) => [c.id, c]));
  return 行们.map((r) => {
    const c = 客.get(r.customerId);
    return {
      id: r.id, 裁定于: beijingWallIso(r.judgedAt as Date).slice(0, 16).replace("T", " "),
      客户名: c ? 客户显名(c) : "", 客户编号: c ? 客户编号显示(c) : "", 项目: r.kind !== "客户" ? r.targetName : "（客户）",
      类型: r.judgedById === r.operatorUserId ? "本人发起" as const : "本人接手" as const,
      发起人: 名.get(r.operatorUserId) ?? "", 接手人: 名.get(r.toOwnerId) ?? "", 裁定人: 名.get(r.judgedById as string) ?? "",
      异议人: 名.get(r.objectorUserId) ?? "", 异议理由: r.reason ?? "", 结果: 台账结果(r.status), 裁定说明: r.judgeNote ?? "",
    };
  });
}

/**
 * 裁定留痕里「本人裁定」那一段（E-436）：只要裁定人是发起人 / 接手人就标「本人发起 / 接手、本人裁定」，不管怎么落到他头上；
 * 「无人回避」只在算裁定人确实挑不出别的系统管理员（本人发起 / 本人接手标志）时才写，兜底裁定不带
 */
export function 本人裁定标注(是发起人: boolean, 是接手人: boolean, 裁: Pick<裁定人结果, "本人发起" | "本人接手"> | undefined): string {
  if (是发起人) return `（本人发起、本人裁定${裁?.本人发起 ? "；无人回避" : ""}）`;
  if (是接手人) return `（本人接手、本人裁定${裁?.本人接手 ? "；无人回避" : ""}）`;
  return "";
}

/**
 * 每月 1 日 08:00 起（北京；错过了 2 日以后水位不是本月就补发）给全部在职系统管理员发一条站内通知：上月有几条特殊裁定，链到台账上月。上月 0 条不发；
 * 通知去重键按月（同一人同一月只记一行），再加设置水位，钟每分钟来也不重复查库。早 8 点后才发（别半夜推飞书）
 */
export const 特殊裁定月通知水位键 = "entObjSpecialMonthNotice";
export async function 钟上特殊裁定月通知(现在: Date = new Date()): Promise<number> {
  if (!企业版()) return 0;
  const 墙 = beijingWallIso(现在);
  if (墙.slice(8, 10) === "01" && 墙.slice(11, 16) < "08:00") return 0;
  const 本月 = 墙.slice(0, 7);
  if ((await getSetting<string>(特殊裁定月通知水位键)) === 本月) return 0;
  const [y, mo] = 本月.split("-").map(Number);
  const 上月 = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
  const 条 = await 本月特殊裁定条数(上月);
  let 发了 = 0;
  if (条 > 0) {
    const org = await 读组织();
    const 管理员们 = org ? 系统管理员们(org) : [];
    if (管理员们.length) {
      await notify(管理员们, {
        kind: "异议", title: `上月有 ${条} 条特殊裁定（本人发起 / 本人接手、本人裁定），请查看台账`,
        body: `${上月} 这个月里，发起人或接手人自己裁定的转让异议共 ${条} 条，每月看一次`, link: `/objections?tab=special&month=${上月}`, key: `objection-special-month:${上月}`,
      });
      发了 = 管理员们.length;
    }
  }
  await setSetting(特殊裁定月通知水位键, 本月);
  return 发了;
}

const 话of = (r: EntTransferObjection) => `${r.kind}「${r.targetName}」`;

async function 名们of(ids: string[]): Promise<Map<string, string>> {
  return new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
}

export type 裁定结果 = { ok: true; 结果: "维持" | "撤回" | "待手工退回"; 说: string } | { ok: false; error: string };

/**
 * 裁定：只有裁定人本人；说明必填 ≤200 字；无默认（决定必须是 维持 / 撤回）；同一条只能裁一次（并发只成一次）
 */
export async function 裁定(me: { id: string; name: string; role?: string }, id: unknown, 决定: unknown, 说明: unknown, 现在: Date = new Date()): Promise<裁定结果> {
  if (!企业版()) return { ok: false, error: "这个功能只有企业版有" };
  if (typeof id !== "string" || !id) return { ok: false, error: "没找到这条异议" };
  if (决定 !== "维持" && 决定 !== "撤回") return { ok: false, error: "请选择维持或撤回" };
  const 话 = typeof 说明 === "string" ? 说明.trim() : "";
  if (!话) return { ok: false, error: "请写裁定说明（会记进变更历史）" };
  if (话.length > 裁定说明上限) return { ok: false, error: `裁定说明最多 ${裁定说明上限} 字` };
  const 行 = await prisma.entTransferObjection.findUnique({ where: { id } });
  // 按当前组织重算裁定人；系统管理员任何时候都能裁（兜底）。不是裁定人的当没有，不透露存在
  const 裁定人们 = 行 ? (await 重算裁定人们([行])).get(行.id) : undefined;
  const org = await 读组织();
  // 留痕标记直接按「裁定人是发起人或接手人」打，不依赖算裁定人的结果（台账也是这个口径）
  const 是发起人 = !!行 && me.id === 行.operatorUserId;
  const 是接手人 = !!行 && me.id === 行.toOwnerId && !是发起人;
  if (!行 || !裁定人们 || !能裁定(org, 裁定人们, me.id, 行)) return { ok: false, error: "没找到这条待裁定的异议" };
  if (行.status === 异议已撤销) return { ok: false, error: "这次转让已被撤销，异议已作废" };
  if (行.status !== 异议待裁定) return { ok: false, error: "这一条已经裁定过了，刷新看看" };

  let 终态: string = 异议维持;
  type 退了 = { 项目数: number; 退了客户: boolean; 计划数?: number; 待办数?: number };
  const 盒: { 退: 退了 | null; 合并: { 客户: string; 通知: Awaited<ReturnType<typeof 在事务里撤回项目合并>>["通知"] } | null } = { 退: null, 合并: null };
  let 手工原因 = "";
  const 开 = 行.kind === 合并异议类 ? await 客户状态自动() : false;
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
      if (评?.自动 && 评.合并单) {
        // 项目合并类：同事务撤回这张合并单（谁撤 = 裁定人；30 天不再校，其余前置在 评估退回 / 事务里再核）；这一行已是撤回态，不会被「终止」覆盖
        const m = await tx.entCustomerMerge.findUnique({ where: { id: 评.合并单 } });
        if (!m || m.status !== "已合并") throw new 裁定拦("这次合并刚被撤回，请刷新再裁定");
        try {
          const 撤 = await 看已删(() => 看全部(() => 在事务里撤回项目合并(tx, m, { ...me, role: me.role ?? "" }, 现在, 开, true, 行.id)));
          盒.合并 = { 客户: 撤.客户, 通知: 撤.通知 };
          盒.退 = { 项目数: 0, 退了客户: false };
        } catch (e) {
          if (e instanceof 拦下) throw new 裁定拦(e.message);
          throw e;
        }
      } else if (评?.自动) 盒.退 = await 执行退回(tx, 行, 评, me.id, 话);
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
  const 事 = 事of(行.kind);
  const 裁定摘要 = `${事}异议裁定：${异议人}对${话of(行)}的异议，${本人裁定标注(是发起人, 是接手人, 裁定人们)}${me.name}裁定「${决定}」${终态 === 异议待手工退回 ? (事 === "合并" ? "（不满足自动撤回，待系统管理员手工撤回合并）" : "（不满足自动退回，待系统管理员手工退回）") : ""}：${话}`;
  const 裁定明细 = { 合并单: 行.mergeId, 异议: 行.id, 换负责人记录: 行.ownerLogId, 对象: 行.targetKey, 异议理由: 行.reason, 裁定: 决定, 结果: 终态, 裁定说明: 话, ...(是发起人 ? { 类型: "本人发起", 本人发起: true, 本人裁定: true } : {}), ...(是接手人 ? { 类型: "本人接手", 本人接手: true, 本人裁定: true } : {}), ...(退 ? { 退回: 退 } : {}), ...(手工原因 ? { 待手工原因: 手工原因 } : {}) };
  if (行.kind === 合并异议类) await 记合并异议留痕(me, 行, "objection-judge", 裁定摘要, 裁定明细);
  else await recordAudit({
    user: me, action: "update", entity: "Customer", entityId: 行.customerId,
    summary: 裁定摘要,
    detail: { 异议: 行.id, 换负责人记录: 行.ownerLogId, 对象: 行.targetKey, 异议理由: 行.reason, 裁定: 决定, 结果: 终态, 裁定说明: 话, ...(是发起人 ? { 类型: "本人发起", 本人发起: true, 本人裁定: true } : {}), ...(是接手人 ? { 类型: "本人接手", 本人接手: true, 本人裁定: true } : {}), ...(退 ? { 退回: 退 } : {}), ...(手工原因 ? { 待手工原因: 手工原因 } : {}) },
  }).catch((e) => console.warn("[异议] 裁定留痕没写上：", e));

  const 链 = "/objections";
  const 裁 = `${me.name} 裁定「${决定}」`;
  if (终态 === 异议维持) {
    await notify([行.objectorUserId], { kind: "异议", title: `你对${话of(行)}的${事}异议已裁定：维持（${me.name}）${事 === "合并" ? "，合并不动" : `，仍归${接手人}`}`, body: `裁定说明：${话}`, link: 链, key: `objection-done:${行.id}:objector` });
    await notify([行.operatorUserId], { kind: "异议", title: `${异议人}对${话of(行)}的${事}异议已裁定：维持（${me.name}）`, body: `裁定说明：${话}`, link: 链, key: `objection-done:${行.id}:operator` });
    return { ok: true, 结果: "维持", 说: "已裁定：维持，已通知异议人和发起人" };
  }
  if (终态 === 异议待手工退回) {
    await notify([行.objectorUserId], { kind: "异议", title: `你对${话of(行)}的${事}异议已裁定：撤回（${me.name}），等系统管理员手工退回`, body: `裁定说明：${话}\n${手工原因}`, link: 链, key: `objection-done:${行.id}:objector` });
    await notify([行.operatorUserId], { kind: "异议", title: `${异议人}对${话of(行)}的${事}异议已裁定：撤回（${me.name}），等系统管理员手工退回`, body: `裁定说明：${话}\n${手工原因}`, link: 链, key: `objection-done:${行.id}:operator` });
    const org = await 读组织();
    await notify(org ? 系统管理员们(org) : [], {
      kind: "异议", title: `待手工退回：${话of(行)}（${发起人} 转给 ${接手人}，${异议人}提的异议已${裁}）`,
      body: `${手工原因}\n裁定说明：${话}\n${事 === "合并" ? `请手工撤回这次合并（在被并项目的合并记录里撤回）后，在「异议」页点「已手工退回」留痕。` : `请手工退回原负责人${异议人}后，在「转让异议」页点「已手工退回」留痕。`}`, link: "/objections?tab=hand", key: `objection-hand:${行.id}`,
    });
    return { ok: true, 结果: "待手工退回", 说: "已裁定：撤回。不满足自动退回的条件，已通知系统管理员手工退回" };
  }
  if (盒.合并) {
    // 合并类自动撤回：被并走的原负责人（异议人）收「已撤回合并」那条（发撤回通知），再加裁定结果；发起人、留下负责人也知会
    await 存沟通后重算三态(盒.合并.客户, 现在).catch((e) => console.warn("[异议裁定撤回合并] 三态没重算上：", e instanceof Error ? e.message : e));
    await 发撤回通知(盒.合并.通知);
    await 通知退回完(行, me.name, 话, "自动");
    return { ok: true, 结果: "撤回", 说: `已裁定：撤回，这次合并已撤回，「${行.targetName}」回到${异议人}名下，并通知各方` };
  }
  await 通知退回完(行, me.name, 话, "自动");
  return { ok: true, 结果: "撤回", 说: `已裁定：撤回，已退回${异议人}${退?.项目数 ? `（含 ${退.项目数} 个项目）` : ""}${退?.计划数 || 退?.待办数 ? `，客户上的 ${退.计划数 ?? 0} 条计划、${退.待办数 ?? 0} 条待办一并退回` : ""}，并通知各方` };
}

/** 撤回退回做完（自动或手工）：通知异议人、发起人、被退回的接手人、客户现在的负责人（判定页 #19） */
async function 通知退回完(行: EntTransferObjection, 谁: string, 说明: string, 方式: "自动" | "手工"): Promise<void> {
  const 名 = await 名们of([行.objectorUserId, 行.operatorUserId, 行.toOwnerId]);
  const c = await 看全部(() => 看已删(() => prisma.customer.findUnique({ where: { id: 行.customerId }, select: { salesOwnerId: true } })));
  const 异议人 = 名.get(行.objectorUserId) ?? "";
  const 事 = 事of(行.kind);
  const 头 = `${话of(行)}已退回${异议人}（异议裁定撤回，${方式 === "手工" ? "系统管理员手工退回" : `${谁}裁定`}）`;
  const body = `裁定说明：${说明}`;
  const 链 = "/objections";
  await notify([行.objectorUserId], { kind: "异议", title: `你对${话of(行)}的${事}异议已裁定：撤回，已退回给你`, body, link: 链, key: `objection-done:${行.id}:objector${方式 === "手工" ? ":hand" : ""}` });
  await notify([行.operatorUserId], { kind: "异议", title: `${异议人}对${话of(行)}的${事}异议已撤回，${头}`, body, link: 链, key: `objection-done:${行.id}:operator${方式 === "手工" ? ":hand" : ""}` });
  await notify([行.toOwnerId], { kind: "异议", title: `${头}，不再归你`, body, link: 链, key: `objection-done:${行.id}:taker${方式 === "手工" ? ":hand" : ""}` });
  if (c?.salesOwnerId) await notify([c.salesOwnerId], { kind: "异议", title: `${头}（你是这位客户的负责人）`, body, link: 链, key: `objection-done:${行.id}:owner${方式 === "手工" ? ":hand" : ""}` });
}

/** 改负责人时自动记成「已退回」的行（改回异议人记已退回 返回的）：事务提交后补留痕和通知，同「已手工退回」按钮那一路 */
export async function 自动记已退回后补(me: { id: string; name: string }, 行们: readonly EntTransferObjection[]): Promise<void> {
  for (const 行 of 行们) {
    try {
      const 话 = `${me.name}已把负责人改回异议人（改负责人时自动记）`;
      await recordAudit({
        user: me, action: "update", entity: "Customer", entityId: 行.customerId,
        summary: `转让异议：${话of(行)}由${me.name}手工退回${(await 名们of([行.objectorUserId])).get(行.objectorUserId) ?? ""}：${话}`,
        detail: { 异议: 行.id, 换负责人记录: 行.ownerLogId, 对象: 行.targetKey, 手工退回说明: 话, 时间: new Date().toISOString() },
      }).catch((e) => console.warn("[异议] 自动记已退回留痕没写上：", e));
      await 通知退回完(行, me.name, 话, "手工");
    } catch (e) { console.warn("[异议] 自动记已退回通知没发出：", e); }
  }
}

/** 转让被撤销、把「待裁定」的异议作废了（口径 A8）：通知异议人和裁定人。撤销把对象退回给了异议人本人，不用再裁 */
export async function 通知撤销作废异议(行们: readonly EntTransferObjection[]): Promise<void> {
  for (const 行 of 行们) {
    const 裁 = (await 重算裁定人们([行])).get(行.id)?.ids ?? [];
    const 异议人 = (await 名们of([行.objectorUserId])).get(行.objectorUserId) ?? "";
    await notify([行.objectorUserId], { kind: "异议", title: `转让已撤销：你对${话of(行)}的异议作废`, body: `${行.kind}已回到你名下，无需裁定`, link: "/objections", key: `objection-void:${行.id}:objector` });
    await notify(裁.filter((x) => x !== 行.objectorUserId), { kind: "异议", title: `转让已撤销：${异议人}对${话of(行)}的异议作废`, body: `${行.kind}已回到${异议人}名下，无需裁定`, link: "/objections", key: `objection-void:${行.id}:judge` });
  }
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
  if (行.kind === 合并异议类) {
    // 合并类：要先把合并单撤回了才能记已退回
    const m = 行.mergeId ? await 看全部(() => prisma.entCustomerMerge.findUnique({ where: { id: 行.mergeId! }, select: { status: true } })) : null;
    if (m?.status !== "已撤回") return { ok: false, error: "这次合并还没撤回，请先在被并项目的合并记录里撤回合并，再点已手工退回" };
  }
  const r = await prisma.entTransferObjection.updateMany({ where: { id: 行.id, status: 异议待手工退回 }, data: { status: 异议已退回, judgeNote: `${行.judgeNote ?? ""}${行.judgeNote ? "；" : ""}手工退回：${话}`.slice(0, 600) } });
  if (r.count !== 1) return { ok: false, error: "这一条已经有人处理了，刷新看看" };
  const 手工摘要 = `${事of(行.kind)}异议：${话of(行)}由${me.name}手工退回${(await 名们of([行.objectorUserId])).get(行.objectorUserId) ?? ""}：${话}`;
  const 手工明细 = { 异议: 行.id, 换负责人记录: 行.ownerLogId, 对象: 行.targetKey, 手工退回说明: 话, 时间: 现在.toISOString() };
  if (行.kind === 合并异议类) await 记合并异议留痕(me, 行, "objection-judge", 手工摘要, { ...手工明细, 合并单: 行.mergeId });
  else await recordAudit({ user: me, action: "update", entity: "Customer", entityId: 行.customerId, summary: 手工摘要, detail: 手工明细 }).catch((e) => console.warn("[异议] 手工退回留痕没写上：", e));
  await 通知退回完({ ...行, status: 异议已退回 }, me.name, 话, "手工");
  return { ok: true };
}
