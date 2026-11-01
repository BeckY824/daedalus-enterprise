"use server";
/**
 * 企业版线索分配的写操作（2026-10-24）：分配线索、设每人每月配额、看我分出去的线索、看本月分配情况。
 *
 * 生效条件 = 企业版() 且规则「线索分配和配额」开着（lib/enterprise/rules.ts），否则一律拒。
 * 企业版只用项目（10-26「线索也要去项目里面作为三阶段」）：分的是线索阶段的项目，传 projectId；老的 Lead 传 leadId，两条路配额、留痕一样。
 * 规则判断（谁能分、能分给谁、算不算数）都在 lib/enterprise/lead-assign.ts 的纯函数里，这里读库、写库、留痕。
 */
import { revalidatePath } from "next/cache";
import { prisma, defaultClient } from "@/lib/prisma";
import { requireUser, type SessionUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { getSetting, setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则, 规则开着 } from "@/lib/enterprise/rules";
import { 读组织, type 组织 } from "@/lib/enterprise/org";
import { 能改后台设置 } from "@/lib/enterprise/permissions";
import { 查完再写 } from "@/lib/check-then-write";
import { 读改权限, 谁能改的话 } from "@/lib/enterprise/edit-perm";
import { 企业版 } from "@/lib/enterprise/switch";
import { 分配方式叫法, 挡分配方式 } from "@/lib/enterprise/dict";
import { 发满额提醒, 读满额提醒, 关掉满额提醒, type 满额提醒 } from "@/lib/enterprise/lead-full-notice";
import { 企业版只用项目 } from "@/lib/enterprise/project-only";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 超上限, 记转让 } from "@/lib/project/db";
import { 单项目客户跟着领 } from "@/lib/enterprise/pool-link";
import { 项目业务线, 线部门key, 规整线部门, 线勾了部门, 按部门候选, 两条线, 是业务线, type 线部门, type 项目线 } from "@/lib/enterprise/assign-line";
import { 历史负责人 } from "@/lib/project/pool-owner";
import {
  企划线索计数key, 我分出去的, 月份, 本月已分, 本月加额们, 生效配额, 满了, 接手问题, 能分配, 能设配额, 能改参与, 线索种类, 计不计数, 配额of, 挑接手人, 挑的理由, 自动分配不参与key,
  认参与状态, 参与状态of, 是参与状态, type 参与状态, 不设配额key, 自动候选人们,
  type 分出去的线索, type 线,
} from "@/lib/enterprise/lead-assign";

type 结果 = { ok: true } | { ok: false; error: string };
/** 分哪一条：老的线索表，或者企业版「新线索」= 线索阶段的项目 */
type 目标 = { leadId: string; projectId?: undefined } | { projectId: string; leadId?: undefined };
const 目标of = (x: { leadId?: unknown; projectId?: unknown }): 目标 | null =>
  typeof x.projectId === "string" && x.projectId ? { projectId: x.projectId } : typeof x.leadId === "string" && x.leadId ? { leadId: x.leadId } : null;
const 没开: { ok: false; error: string } = { ok: false, error: `规则「${规则.线索分配.名}」没开：总管理在 设置 → 组织架构 里打开` };

/** 规则开着才放行；共享试用区不让分 */
async function 进门() {
  if (!(await 规则开着("线索分配"))) return null;
  const me = await requireUser();
  const { 当前是共享区 } = await import("@/lib/shared-ws/current");
  if (await 当前是共享区()) return null;
  return me;
}

const 是线 = (x: unknown): x is 线 => x === "内贸" || x === "外贸";
/** 能点分配的人（A7 / A9，lead-assign 的 能分配） */
const 能分配的话 = "只有总管理员、市场管理、销售管理能分配线索";
/** 手动指派新线索时挑的人不在可选范围里（11-01 16:1x：只列正常参与、业务线对得上的销售） */
const 不能指派的话 = "只能指派给正常参与自动分配、业务线对得上的销售：他暂停 / 禁止了，或者不在这条线上";
/** 业务线选了「暂不分配」的新线索不进自动分配 */
const 暂不分配不自动 = "这条新线索的业务线是「暂不分配」：不自动分，请手动指派";
/** 乐观锁没对上（QA #4）：打开弹窗 / 点按钮时看到的负责人，写库时已经变了 = 别人先分走了，不覆盖 */
const 已被分配的话 = "这条线索已被分配：刚才有人先分走了，刷新看看现在在谁名下";
/**
 * 界面交来的「我看到的负责人」：字符串 = 那个人，null / 空 = 看到的时候没有负责人；别的（没传、乱传）= undefined，不按它比
 */
const 认原负责人 = (x: unknown): string | null | undefined => (x === null || x === "" ? null : typeof x === "string" ? x : undefined);

/** 后台设的「各条线参与自动分配的部门」（A4 / A5）；没设 = 两条线都没勾 */
async function 读线部门(): Promise<线部门> {
  return 规整线部门(await getSetting<unknown>(线部门key));
}

/**
 * 分给某条线时还查不查接手人的内贸 / 外贸标记：这条线勾了部门 = 不查（人是按部门挑的，标记可能没填）；没勾 = 照旧查
 */
function 查哪条线(org: 组织, 设: 线部门, line: 线 | null): 线 | null {
  return line && 线勾了部门(org, 设, line) ? null : line;
}

/**
 * 新线索（项目）手动指派时能挑的人（11-01 16:1x，A9）：当前「正常」参与自动分配的销售，按项目业务线过滤——
 * 内贸 / 外贸 = 这条线的人（勾了部门按部门，没勾按成员标记，同自动分配的候选）；暂不分配 = 全部正常参与的销售。
 * 暂停、禁止的都不列
 */
async function 指派可选(org: 组织, 线: 项目线): Promise<string[]> {
  const [设, 不参与] = await Promise.all([读线部门(), 不参与名单()]);
  const 不 = new Set(不参与);
  const 人们 = 是业务线(线) ? 按部门候选(org, null, 线, 设, 自动候选人们) : 自动候选人们(org, null, null);
  return 人们.filter((id) => !不.has(id));
}

/**
 * 规则里的「不设配额（人人参与、不限额）」开着没（10-30）：开着时配额整个不起作用。
 * 11-01 拍板（清单 A10 / A11）：默认不限额——没存过 = 开着；只有在设置里明确改回「按配额分配」（存了 false）才查配额
 */
async function 不设配额开着(): Promise<boolean> {
  return (await getSetting<boolean>(不设配额key)) !== false;
}

/**
 * 手动指派。原负责人 = 界面上看到的负责人（乐观锁，QA #4）：写库时负责人已经不是他了 = 被别人先分走，回「已被分配」不覆盖
 */
export async function 分配线索(input: { leadId?: string; projectId?: string; toUserId: string; line?: 线 | null; kind?: 线索种类; 原负责人?: string | null }): Promise<结果 | { ok: false; error: string; 已被分配: true }> {
  const me = await 进门();
  if (!me) return 没开;
  const 哪条 = 目标of(input ?? {});
  if (!哪条) return { ok: false, error: "要分哪一条？刷新看看" };
  const line = input.line ?? null;
  const kind = input.kind ?? "营销";
  if (line !== null && !是线(line)) return { ok: false, error: "业务线只能是内贸或外贸" };
  if (!线索种类.includes(kind)) return { ok: false, error: "线索种类只能是营销或营销企划" };
  const 看到的 = 认原负责人(input.原负责人);
  try {
    const org = await 读组织();
    if (!能分配(org, me)) return { ok: false, error: 能分配的话 };
    // 还要看分配方式字典的「谁能用」（assign-use.ts）：指定分配
    const 方式挡 = await 挡分配方式(me, 0);
    if (方式挡) return { ok: false, error: 方式挡 };
    // 新线索（项目）走哪条线看项目业务线（A1：三选一，老项目按负责人的线、再没有按内贸），不认界面传来的；
    // 只能指派给正常参与、业务线对得上的销售（暂不分配 = 全部正常参与的销售）
    if (哪条.projectId !== undefined) {
      const 看 = await 分前看(哪条, org);
      if (!看.ok) return 看;
      if (!(await 指派可选(org, 看.线 ?? "暂不分配")).includes(input.toUserId)) {
        // 不是销售、停用了这类更具体的原因先说
        return { ok: false, error: 接手问题(org, input.toUserId, null) ?? 不能指派的话 };
      }
      const 用线 = 是业务线(看.线) ? 看.线 : null;
      // 人已经按线（部门 / 标记）筛过了，这里不再查标记
      // 界面没交看到的负责人（老页面）：按这次请求开头读到的比
      const 原负责人 = 看到的 === undefined ? 看.实际负责人 : 看到的;
      const r = await 分给(me, org, { ...哪条, toUserId: input.toUserId, line: 用线, 查线: null, kind, 自动: false, 原负责人 });
      return r.ok ? r : r.已被分配 ? 已被分配 : { ok: false, error: r.error };
    }
    const r = await 分给(me, org, { ...哪条, toUserId: input.toUserId, line, kind, 自动: false, 原负责人: 看到的 });
    return r.ok ? r : r.已被分配 ? 已被分配 : { ok: false, error: r.error };
  } catch (e) {
    return 不在了(e);
  }
}

/**
 * 分配线索()、自动分配线索() 共用的那一段：进门、能不能分已经查过。
 * 配额检查和写入在同一个事务里（查完再写）：两个人同时把线索分给同一个人，后到的那个查的时候先到的已经写完，不会超配额。
 * 分满了（配额满、或项目的持有上限到了）带 满: true，自动分配据此顺延到下一个人。
 * 乐观锁（QA #4）：原负责人 = 分的人看到的负责人（undefined = 不比）；事务里读到的负责人不是他、或写的时候负责人已经变了，
 * 都回 已被分配: true，不覆盖别人刚分的
 */
type 分给结果 = { ok: true } | { ok: false; error: string; 满?: true; 已被分配?: true };
const 已被分配: { ok: false; error: string; 已被分配: true } = { ok: false, error: 已被分配的话, 已被分配: true };

async function 分给(
  me: SessionUser, org: 组织, input: 目标 & { toUserId: string; line: 线 | null; kind: 线索种类; 自动: boolean; 查线?: 线 | null; 原负责人?: string | null },
): Promise<分给结果> {
  // 查线：核对接手人内贸 / 外贸标记用的线；这条线勾了部门时传 null（按部门挑，不看标记）。没传 = 就用 line
  const 问题 = 接手问题(org, input.toUserId, input.查线 === undefined ? input.line : input.查线);
  if (问题) return { ok: false, error: 问题 };
  // 分配方式（10-27，字典「分配方式」前两项的叫法）：事务外读好，记进分配记录和审计
  const way = await 分配方式叫法(input.自动 ? 1 : 0);
  if (input.projectId !== undefined) return 分项目给(me, { ...input, projectId: input.projectId, way });

  // 走限定过的连接：「按组织架构看客户」开着时，看不到的线索当不在
  const lead = await prisma.lead.findFirst({ where: { id: input.leadId }, select: { id: true, name: true } });
  if (!lead) return { ok: false, error: "这条线索已经不在了（或者你看不到它），刷新看看" };

  const counted = 计不计数(input.kind, await getSetting<boolean>(企划线索计数key));
  // 不设配额开着：照样记数（算不算数不变），只是不查满额
  const 查额 = counted && !(await 不设配额开着());
  const 月 = 月份();
  const 落库 = await 查完再写(async (tx): Promise<{ ok: true; fromUserId: string | null } | Exclude<分给结果, { ok: true }>> => {
    // 负责人、状态在事务里再读一次：同一条线索两边同时分，后到的看到的是先到的写完的
    const 现在 = await tx.lead.findUnique({ where: { id: lead.id }, select: { ownerId: true, status: true } });
    if (!现在) return { ok: false, error: "这条线索已经不在了（或者你看不到它），刷新看看" };
    if (input.原负责人 !== undefined && 现在.ownerId !== input.原负责人) return 已被分配;
    if (现在.status === "已转化") return { ok: false, error: "已转化的线索不用再分" };
    if (现在.ownerId === input.toUserId) return { ok: false, error: "这条线索已经在他名下了" };
    if (查额) {
      const 已分 = await 本月已分(input.toUserId, 月, tx);
      const 配额 = await 配额of(input.toUserId, tx);
      if (满了(已分, 配额)) return { ok: false, 满: true, error: `他这个月已经分了 ${已分} 条，配额 ${配额} 条，分满了：找他的上级调配额，或者分给别人` };
    }
    // 写的时候 where 带上刚读到的负责人：中间被别人改了就一行都不动
    const 改 = await tx.lead.updateMany({ where: { id: lead.id, ownerId: 现在.ownerId }, data: { ownerId: input.toUserId } });
    if (改.count !== 1) return 已被分配;
    await tx.entLeadAssign.create({
      data: { leadId: lead.id, toUserId: input.toUserId, fromUserId: 现在.ownerId, byUserId: me.id, line: input.line, kind: input.kind, counted, month: 月, way },
    });
    return { ok: true, fromUserId: 现在.ownerId };
  });
  if (!落库.ok) return 落库;

  const { line } = input;
  const 接手 = await prisma.user.findUnique({ where: { id: input.toUserId }, select: { name: true } });
  await recordAudit({
    user: me, action: "update", entity: "Lead", entityId: lead.id,
    summary: `分配线索「${lead.name}」给 ${接手?.name ?? input.toUserId}${line ? `（${line}）` : ""}${counted ? "" : "，不计数"}`,
    detail: { toUserId: input.toUserId, fromUserId: 落库.fromUserId, line, kind: input.kind, counted, month: 月, 分配方式: way },
  });
  revalidatePath("/leads");
  return { ok: true };
}

const 项目不在 = "这条新线索已经不在了（或者你看不到它），刷新看看";

/**
 * 分配线索阶段的项目（企业版「新线索」）：转了商机、线索流失的不用再分；配额同老线索（默认不限额），手动分另外还要过持有上限（超上限）；
 * 自动分配不看持有上限（11-01 清单 A10 / A11：不限额）。
 * 换负责人 = 转让：清下一步时间（超时回收从接手那天重新算），在公海里的出公海、待分配的清掉待分配，记一行转让痕。
 */
async function 分项目给(
  me: SessionUser, input: { projectId: string; toUserId: string; line: 线 | null; kind: 线索种类; way: string; 自动?: boolean; 原负责人?: string | null },
): Promise<分给结果> {
  const p0 = await prisma.project.findFirst({ where: { id: input.projectId }, select: { id: true, name: true } });
  if (!p0) return { ok: false, error: 项目不在 };
  const counted = 计不计数(input.kind, await getSetting<boolean>(企划线索计数key));
  // 规则在进事务前读好：事务占着库的唯一连接，事务里再读设置会等到超时
  const 规则 = await 生效组织规则();
  const 查额 = counted && !(await 不设配额开着());
  const 月 = 月份();
  const 落库 = await 查完再写(async (tx): Promise<{ ok: true; fromUserId: string | null } | Exclude<分给结果, { ok: true }>> => {
    const p = await tx.project.findUnique({ where: { id: p0.id } });
    if (!p) return { ok: false, error: 项目不在 };
    // 进公海清了负责人的（C-01）ownerId 是空串，和界面交来的「没人」(null) 当一回事
    if (input.原负责人 !== undefined && (p.ownerId || null) !== input.原负责人) return 已被分配;
    if (p.phase !== "线索") return { ok: false, error: "已经转了商机，不用再分：去「项目」里转让负责人" };
    if (p.result) return { ok: false, error: `这条新线索已经${p.result}，不用再分` };
    if (p.ownerId === input.toUserId && !p.pooledAt && !p.awaitAssignAt) return { ok: false, error: "这条新线索已经在他名下了" };
    if (查额) {
      const 已分 = await 本月已分(input.toUserId, 月, tx);
      const 配额 = await 配额of(input.toUserId, tx);
      if (满了(已分, 配额)) return { ok: false, 满: true, error: `他这个月已经分了 ${已分} 条，配额 ${配额} 条，分满了：找他的上级调配额，或者分给别人` };
    }
    if (!input.自动) {
      const 超 = await 超上限(tx, 规则, input.toUserId, p);
      if (超) return { ok: false, 满: true, error: 超 };
    }
    // 分之前的负责人：在公海里的取历史负责人（企业版进公海清了负责人，lib/project/pool-owner.ts）
    const 原 = p.pooledAt ? (await 历史负责人(tx, p.id)) ?? (p.ownerId || null) : p.ownerId;
    // 乐观锁：where 带上刚读到的负责人和公海 / 待分配状态，中间被别人分走了就一行都不动、不覆盖
    const 改 = await tx.project.updateMany({
      where: { id: p.id, ownerId: p.ownerId, pooledAt: p.pooledAt, awaitAssignAt: p.awaitAssignAt, phase: "线索", result: null },
      data: { ownerId: input.toUserId, nextStepAt: null, nextStepText: null, pooledAt: null, awaitAssignAt: null },
    });
    if (改.count !== 1) return 已被分配;
    await 记转让(tx, p, me.id, 原, input.toUserId, "transfer", `分配方式：${input.way}`);
    // 从公海里分出去：客户名下只有这一个项目的，客户跟着走（同领取）
    if (p.pooledAt) await 单项目客户跟着领(tx, p.customerId, input.toUserId, me.id);
    await tx.entLeadAssign.create({
      data: { projectId: p.id, toUserId: input.toUserId, fromUserId: 原, byUserId: me.id, line: input.line, kind: input.kind, counted, month: 月, way: input.way },
    });
    return { ok: true, fromUserId: 原 };
  });
  if (!落库.ok) return 落库;

  const { line } = input;
  const 接手 = await prisma.user.findUnique({ where: { id: input.toUserId }, select: { name: true } });
  await recordAudit({
    user: me, action: "update", entity: "Project", entityId: p0.id,
    summary: `分配新线索「${p0.name}」给 ${接手?.name ?? input.toUserId}${line ? `（${line}）` : ""}${counted ? "" : "，不计数"}`,
    detail: { toUserId: input.toUserId, fromUserId: 落库.fromUserId, line, kind: input.kind, counted, month: 月, 分配方式: input.way },
  });
  revalidatePath("/leads");
  revalidatePath("/projects");
  return { ok: true };
}

/**
 * 分配之前看一眼：现在的负责人（挑人时跳过他）、走哪条线，不能分就给原因。
 * 新线索（项目）的线 = 项目业务线（三选一；老项目没填按负责人的线、再没有按内贸，要传 org 才看负责人）；老线索表 = null
 */
async function 分前看(
  哪条: 目标, org?: 组织,
): Promise<{ ok: true; ownerId: string | null; 实际负责人: string | null; 待分配: boolean; 名: string; 线: 项目线 | null } | { ok: false; error: string }> {
  if (哪条.projectId !== undefined) {
    const p = await prisma.project.findFirst({
      where: { id: 哪条.projectId },
      select: { ownerId: true, pooledAt: true, awaitAssignAt: true, phase: true, result: true, name: true, bizLine: true },
    });
    if (!p) return { ok: false, error: 项目不在 };
    if (p.phase !== "线索") return { ok: false, error: "已经转了商机，不用再分" };
    if (p.result) return { ok: false, error: `这条新线索已经${p.result}，不用再分` };
    // 公海里的、待分配的（A7 / A10，负责人那一格只是建的人占着）：原负责人也能被挑中
    return {
      ok: true, ownerId: p.pooledAt || p.awaitAssignAt ? null : p.ownerId || null, 实际负责人: p.ownerId || null,
      待分配: !p.pooledAt && !!p.awaitAssignAt, 名: p.name, 线: 项目业务线(p, org?.成员),
    };
  }
  const lead = await prisma.lead.findFirst({ where: { id: 哪条.leadId }, select: { ownerId: true, status: true, name: true } });
  if (!lead) return { ok: false, error: "这条线索已经不在了（或者你看不到它），刷新看看" };
  if (lead.status === "已转化") return { ok: false, error: "已转化的线索不用再分" };
  return { ok: true, ownerId: lead.ownerId, 实际负责人: lead.ownerId, 待分配: false, 名: lead.name, 线: null };
}

/**
 * 分配弹窗打开时看这条新线索（项目）：走哪条线（只读显示，总有值）、能指派给谁（正常参与、线对得上的销售 userId）。
 * 不能分 / 看不到 = null
 */
export async function 项目分配线(projectId: string): Promise<{ 线: 项目线; 可选: string[] } | null> {
  const me = await 进门();
  if (!me) return null;
  try {
    const org = await 读组织();
    if (!能分配(org, me)) return null;
    const 看 = await 分前看({ projectId: String(projectId ?? "") }, org);
    if (!看.ok) return null;
    const 线 = 看.线 ?? "内贸";
    return { 线, 可选: await 指派可选(org, 线) };
  } catch {
    return null;
  }
}

export type 自动分配结果 =
  | { ok: true; toUserId: string; 接手人: string; 已分: number; 配额: number | null; 为什么: string }
  | { ok: false; error: string; 都满额?: true; 暂不分配?: true; 已被分配?: true; 待分配?: true };

/** 每人参与状态（暂停 / 禁止的才在表里）；老格式 string[] 读成禁止，存坏了当人人允许 */
async function 参与状态表() {
  return 认参与状态(await getSetting<unknown>(自动分配不参与key));
}
/** 不进轮转的人：暂停、禁止都算 */
async function 不参与名单(): Promise<string[]> {
  return Object.keys(await 参与状态表());
}

/**
 * 自动分配（D-38）：在职、能接这条线、参与自动分配、填了配额（不是 0）、本月没分满的人里，挑「本月已分 / 配额」比例最低的；并列给最早进池的。
 * 规则里选了「不设配额」（10-30）：不看配额，在职、能接、参与的人里挑本月已分最少的，并列同样给最早进池的。
 * 挑中以后走 分给()，配额、留痕和手动分一样；挑完到落库之间他被别人分满了，就顺延到下一个人。
 * 成了带上接手人、分完以后本月已分几条、配额、为什么挑他，界面直接拿去提示
 */
export async function 自动分配线索(id: string, opts: { line?: 线 | null; kind?: 线索种类; 项目?: boolean; 原负责人?: string | null } = {}): Promise<自动分配结果> {
  const me = await 进门();
  if (!me) return 没开;
  const line = opts.line ?? null;
  const kind = opts.kind ?? "营销";
  if (line !== null && !是线(line)) return { ok: false, error: "业务线只能是内贸或外贸" };
  if (!线索种类.includes(kind)) return { ok: false, error: "线索种类只能是营销或营销企划" };
  try {
    const org = await 读组织();
    if (!能分配(org, me)) return { ok: false, error: 能分配的话 };
    const 方式挡 = await 挡分配方式(me, 1);
    if (方式挡) return { ok: false, error: 方式挡 };
    const 哪条 = 目标of(opts.项目 ? { projectId: id } : { leadId: id });
    if (!哪条) return { ok: false, error: "要分哪一条？刷新看看" };
    const r = await 自动分给(me, org, 哪条, line, kind, 认原负责人(opts.原负责人));
    if (!r.ok && r.都满额) {
      const 看 = await 分前看(哪条).catch(() => null);
      await 发满额提醒(org, [看?.ok ? 看.名 : id], me.name).catch((e) => console.error("[满额提醒] 没发出去", e));
    }
    return r;
  } catch (e) {
    return 不在了(e);
  }
}

/**
 * 建档向导选了「自动分配」（A7，10-27）：项目刚建在我名下，按自动分配挑人转过去，客户跟着给接手的人（向导建的客户只有这一个项目）。
 * 只认我自己是负责人、线索阶段、没进公海的项目。不查「能分配」（总管理 / 市场管理 / 销售管理）：向导里能不能自动分只看分配方式的「谁能用」
 */
export async function 向导自动分配(projectId: string): Promise<自动分配结果> {
  const me = await 进门();
  if (!me) return 没开;
  try {
    const 方式挡 = await 挡分配方式(me, 1);
    if (方式挡) return { ok: false, error: 方式挡 };
    const p = await prisma.project.findFirst({ where: { id: String(projectId ?? "") }, select: { ownerId: true, phase: true, pooledAt: true, customerId: true } });
    if (!p || p.ownerId !== me.id || p.phase !== "线索" || p.pooledAt) return { ok: false, error: "只能自动分配自己名下、还在线索阶段的项目" };
    const r = await 自动分给(me, await 读组织(), { projectId }, null, "营销");
    // 客户跟着给接手的人（A7）：只在客户名下就这一个项目时跟（向导新建的客户都是这样）；
    // 客户页给老客户加项目的，客户名下还有别的项目，客户不动
    if (r.ok && (await prisma.project.count({ where: { customerId: p.customerId } })) === 1) {
      await prisma.customer.updateMany({ where: { id: p.customerId, salesOwnerId: me.id }, data: { salesOwnerId: r.toUserId } });
    }
    return r;
  } catch (e) {
    return 不在了(e);
  }
}

/**
 * 自动分配线索()、批量自动分配()、向导自动分配() 共用：进门、能不能分已经查过。
 * 原负责人 = 点按钮时界面上看到的负责人（乐观锁，QA #4）；没交 = 按这里刚读到的比。被别人先分走了直接回「已被分配」，不再换人分
 */
async function 自动分给(
  me: SessionUser, org: 组织, 哪条: 目标, line: 线 | null, kind: 线索种类, 原负责人?: string | null,
): Promise<自动分配结果> {
  const 看 = await 分前看(哪条, org);
  if (!看.ok) return 看;
  const 比谁 = 原负责人 === undefined ? 看.实际负责人 : 原负责人;
  if (比谁 !== 看.实际负责人) return 已被分配;
  // 新线索（项目）挑不到人（QA #5）：不抛错、不动它，回 待分配: true 让界面提示「留在新线索待分配，手动指派」
  const 挑不到 = (为什么: string, 都满额?: true): 自动分配结果 =>
    哪条.projectId !== undefined
      ? { ok: false, 待分配: true, ...(都满额 ? { 都满额 } : {}), error: `${为什么}。${看.待分配 ? "已留在新线索待分配" : "这条新线索留在原处"}，可以手动指派` }
      : { ok: false, ...(都满额 ? { 都满额 } : {}), error: 为什么 };

  // 新线索（项目）：线看项目业务线（A1，三选一；老项目按负责人的线、再没有按内贸），不认弹窗传来的；
  // 「暂不分配」不自动分。勾了部门的线按部门挑人（A4），没勾退回按成员标记
  let 人们: string[];
  let 查线: 线 | null | undefined;
  if (哪条.projectId !== undefined) {
    if (!是业务线(看.线)) return { ok: false, 暂不分配: true, error: 暂不分配不自动 };
    line = 看.线;
    const 设 = await 读线部门();
    人们 = 按部门候选(org, 看.ownerId, line, 设, 自动候选人们);
    查线 = 查哪条线(org, 设, line);
  } else {
    人们 = 自动候选人们(org, 看.ownerId, line);
  }
  const 月 = 月份();
  const [计数, 配额, 加额, 建号, 不参与, 企划算数, 不限额] = await Promise.all([
    prisma.entLeadAssign.groupBy({ by: ["toUserId"], where: { month: 月, counted: true, toUserId: { in: 人们 } }, _count: { _all: true } }),
    prisma.entLeadQuota.findMany({ where: { userId: { in: 人们 } } }),
    本月加额们(人们, 月),
    prisma.user.findMany({ where: { id: { in: 人们 } }, select: { id: true, name: true, createdAt: true } }),
    不参与名单(),
    getSetting<boolean>(企划线索计数key),
    不设配额开着(),
  ]);
  const 数 = new Map(计数.map((c) => [c.toUserId, c._count._all]));
  // 生效配额 = 设的 + 本月加的额（线索最终判无效 +1）
  const 额 = new Map(配额.map((q) => [q.userId, 生效配额(q.quota, 加额.get(q.userId) ?? 0)]));
  const 候选 = 建号.map((u) => ({ userId: u.id, 已分: 数.get(u.id) ?? 0, 配额: 额.get(u.id) ?? null, 进池: u.createdAt }));
  const 跳过 = new Set(不参与);
  const 查满 = 计不计数(kind, 企划算数);
  // 每轮要么分成、要么把挑中的人加进跳过，挑接手人不会再挑他：最多轮完一遍候选
  for (;;) {
    const 谁 = 挑接手人(候选, 跳过, 查满, 不限额);
    if (!谁) {
      // 不设配额（默认）：没有满额一说，也不看持有上限（A10 / A11）。挑不到 = 这条线的人都暂停 / 禁止了，或者这条线没有人
      if (不限额) return 挑不到(`没有能接的人：${line ?? "这条线"}的人都暂停或禁止了自动分配，或者这条线还没有人`);
      // 参与的人里有填了配额的（含 0）、只是都分满了 →「都已满额」，提醒去调配额；
      // 参与的人都没填配额、一个参与的都没有，各是另一回事
      const 参与的 = 候选.filter((c) => !不参与.includes(c.userId));
      if (参与的.some((c) => c.配额 !== null)) {
        return 挑不到("都已满额，没有能接的人：线索留在原处，找他们的上级调配额，或者手动分", true);
      }
      return 挑不到(
        参与的.length
          ? "没有能接的人：没填配额，不参与自动分配。找他们的上级填配额，或者手动分"
          : "没有能接的人：都不参与自动分配，或者业务线对不上",
      );
    }
    const 为什么 = 挑的理由(候选, 跳过, 查满, 谁, 不限额);
    const r = await 分给(me, org, { ...哪条, toUserId: 谁, line, 查线, kind, 自动: true, 原负责人: 比谁 });
    if (r.ok) {
      return { ok: true, toUserId: 谁, 接手人: 建号.find((u) => u.id === 谁)?.name ?? 谁, 已分: await 本月已分(谁, 月), 配额: 不限额 ? null : (额.get(谁) ?? null), 为什么 };
    }
    if (r.已被分配) return 已被分配;
    if (!r.满) return { ok: false, error: r.error };
    跳过.add(谁);
  }
}

export type 批量自动分配结果 = { leadId: string; name: string } & 自动分配结果;
const 批量最多 = 200;

/**
 * 勾了几条一起自动分配（D-38）：一条一条按顺序分，前一条分完再挑下一条的人，
 * 所以连分 10 条和点 10 次单条结果一样；每条成没成都列出来。一次最多 200 条
 */
export async function 批量自动分配(leadIds: string[], opts: { 项目?: boolean } = {}): Promise<{ ok: true; 结果: 批量自动分配结果[] } | { ok: false; error: string }> {
  const me = await 进门();
  if (!me) return 没开;
  const ids = [...new Set(Array.isArray(leadIds) ? leadIds.filter((x) => typeof x === "string") : [])];
  if (!ids.length) return { ok: false, error: "先勾选要分的线索" };
  if (ids.length > 批量最多) return { ok: false, error: `一次最多自动分配 ${批量最多} 条，分几次点` };
  try {
    const org = await 读组织();
    if (!能分配(org, me)) return { ok: false, error: 能分配的话 };
    const 方式挡 = await 挡分配方式(me, 1);
    if (方式挡) return { ok: false, error: 方式挡 };
    const 项目 = opts?.项目 === true;
    const 名 = new Map((项目
      ? await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]));
    const 结果: 批量自动分配结果[] = [];
    for (const id of ids) {
      let r: 自动分配结果;
      try {
        r = await 自动分给(me, org, 项目 ? { projectId: id } : { leadId: id }, null, "营销");
      } catch (e) {
        r = 不在了(e);
      }
      结果.push({ leadId: id, name: 名.get(id) ?? "（看不到这条）", ...r });
    }
    // 因都已满额没分出去的，这一次点击合成一条提醒，不按条刷屏
    // 提醒没发出去不能连累已经分好的结果
    await 发满额提醒(org, 结果.filter((x) => !x.ok && x.都满额).map((x) => x.name), me.name).catch((e) => console.error("[满额提醒] 没发出去", e));
    return { ok: true, 结果 };
  } catch (e) {
    return 不在了(e);
  }
}

/** 我的「都已满额」提醒（首页、线索页顶部）。不是企业版 = 没有；规则后来关了也照样给看，关掉为止 */
export async function 我的满额提醒(): Promise<满额提醒[]> {
  if (!企业版()) return [];
  const me = await requireUser();
  return 读满额提醒(me.id);
}

/** 关掉我自己的一条提醒 */
export async function 关满额提醒(id: string): Promise<结果> {
  if (!企业版() || typeof id !== "string") return { ok: true };
  const me = await requireUser();
  await 关掉满额提醒(me.id, id);
  revalidatePath("/leads");
  revalidatePath("/dashboard");
  return { ok: true };
}

const 状态说法: Record<参与状态, (名: string) => string> = {
  允许: (名) => `恢复 ${名} 参与自动分配`,
  暂停: (名) => `暂停 ${名} 参与自动分配（可随时恢复）`,
  禁止: (名) => `禁止 ${名} 参与自动分配`,
};

/**
 * 设某人参与自动分配：允许（正常）/ 暂停 / 禁止（10-26 三态；11-01 16:1x 拍板：只有总管理员能改，市场管理、销售管理只能手动指派；直属上级只能看）。
 * 暂停、禁止都不进轮转，手动分配不受影响；每月计数照旧按 EntLeadAssign.month 自动清零。
 * 老的 true / false 照收：true = 允许，false = 禁止
 */
export async function 设自动分配参与(userId: string, 状态: 参与状态 | boolean): Promise<结果> {
  const me = await 进门();
  if (!me) return 没开;
  const 新状态: 参与状态 | null = 状态 === true ? "允许" : 状态 === false ? "禁止" : 是参与状态(状态) ? 状态 : null;
  if (!新状态) return { ok: false, error: "参与只能是允许、暂停或禁止" };
  try {
    const org = await 读组织();
    if (!能改参与(org, me)) return { ok: false, error: "只有总管理员能改销售的参与状态（市场管理、销售管理可以手动指派）" };
    if (接手问题(org, userId, null)) return { ok: false, error: "这个人不在组织里、已经停用，或者不是销售 / 销售管理" };
    // 读-改-写放进一个事务：两个人同时改不同人的状态，后写的不会把先写的盖掉
    const 变了 = await 查完再写(async (tx) => {
      const 行 = await tx.setting.findUnique({ where: { key: 自动分配不参与key } });
      let 原值: unknown = null;
      try { 原值 = 行 ? JSON.parse(行.value) : null; } catch { /* 被手改坏：当人人允许 */ }
      const 现在 = 认参与状态(原值);
      const { [userId]: _, ...别人 } = 现在;
      const 新 = 新状态 === "允许" ? 别人 : { ...别人, [userId]: 新状态 };
      // 存着的跟要写的一样就不动；老格式（数组）下一次改就换成新格式，但人的状态没变不留痕
      const value = JSON.stringify(新);
      if (行 ? 行.value === value : 新状态 === "允许") return false;
      await tx.setting.upsert({ where: { key: 自动分配不参与key }, update: { value }, create: { key: 自动分配不参与key, value } });
      return 参与状态of(现在, userId) !== 新状态 ? "留痕" : "只换格式";
    });
    if (!变了) return { ok: true };
    invalidateSettingsCache();
    if (变了 === "留痕") {
      const 人 = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      await recordAudit({
        user: me, action: "update", entity: "EntLeadAssign", entityId: userId,
        summary: 状态说法[新状态](人?.name ?? userId),
        detail: { 参与: 新状态 },
      });
    }
    revalidatePath("/leads");
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/** 「不设配额（人人参与、不限额）」现在开着没：规则关着返回 null（设置页那一块不出现） */
export async function 读不设配额(): Promise<boolean | null> {
  if (!(await 规则开着("线索分配"))) return null;
  await requireUser();
  return 不设配额开着();
}

/**
 * 拨规则「线索分配和配额」里的选项「不设配额（人人参与、不限额）」（10-30）。和拨规则开关同一道门：总管理（只认业务角色）。
 * 开了以后自动分配在参与的人里挑本月已分最少的，手动分不查满额；设过的配额留着不删，关掉就照旧生效
 */
export async function 设不设配额(on: boolean): Promise<结果> {
  const me = await 进门();
  if (!me) return 没开;
  try {
    const org = await 读组织();
    // 和拨规则开关同一道门（org-actions 能改的人）：只有总管理，勾了「不管设置」的不算（11-01）
    if (!能改后台设置(me, org)) return { ok: false, error: "只有总管理能改这个选项" };
    // 先认人再验参数：业务员拿到的是「只有…能改」，不是参数错
    if (typeof on !== "boolean") return { ok: false, error: "开关只能开或关" };
    if ((await 不设配额开着()) === on) return { ok: true };
    await setSetting(不设配额key, on);
    await recordAudit({
      user: me, action: "update", entity: "Setting", entityId: 不设配额key,
      summary: on ? `规则「${规则.线索分配.名}」改成不设配额：人人参与自动分配、不限额` : `规则「${规则.线索分配.名}」改回按配额分配`,
    });
    revalidatePath("/leads");
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

export type 线部门设置 = { 设的: 线部门; 还没勾: 线[]; 能改: boolean };

/**
 * 「各条线参与自动分配的部门」现在怎么设的（设置 → 组织架构）：还没勾 = 那条线一个还在的部门都没勾（退回按成员内贸 / 外贸标记）。
 * 规则没开、不是企业版 = null（那一块不出现）
 */
export async function 读线部门设置(): Promise<线部门设置 | null> {
  if (!企业版()) return null;
  const me = await 进门();
  if (!me) return null;
  const org = await 读组织();
  const 设 = await 读线部门();
  return { 设的: 设, 还没勾: 两条线.filter((l) => !线勾了部门(org, 设, l)), 能改: 能改后台设置(me, org) };
}

/**
 * 设「各条线参与自动分配的部门」（A4 / A5）：每条线一组部门（连下级部门）。只有总管理员能改（看业务角色，不看账号权限）。
 * 不存在的部门编号不收；某条线清空 = 那条线退回按成员的内贸 / 外贸标记
 */
export async function 设线部门(v: unknown): Promise<结果> {
  if (!企业版()) return { ok: false, error: "只有企业版有这个设置" };
  const me = await 进门();
  if (!me) return 没开;
  try {
    const org = await 读组织();
    if (!能改后台设置(me, org)) return { ok: false, error: "只有总管理员能改各条线参与自动分配的部门" };
    const 交来 = 规整线部门(v);
    const 不在 = 两条线.flatMap((l) => 交来[l]).filter((id) => !org.部门.has(id));
    if (不在.length) return { ok: false, error: "有部门已经不在了，刷新再选" };
    const 原 = await 读线部门();
    if (两条线.every((l) => [...原[l]].sort().join() === [...交来[l]].sort().join())) return { ok: true };
    await setSetting(线部门key, 交来);
    const 名 = (ids: string[]) => (ids.length ? ids.map((id) => org.部门.get(id)?.name ?? id).join("、") : "没勾（按成员内贸 / 外贸标记）");
    await recordAudit({
      user: me, action: "update", entity: "Setting", entityId: 线部门key,
      summary: `各条线参与自动分配的部门：内贸 ${名(交来.内贸)}；外贸 ${名(交来.外贸)}`,
      detail: { 原: 原, 新: 交来 },
    });
    revalidatePath("/leads");
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/** 设每月配额；quota = null 是清空配额（手动分不限，自动分配不再挑他） */
export async function 设配额(userId: string, quota: number | null): Promise<结果> {
  const me = await 进门();
  if (!me) return 没开;
  if (quota !== null && (!Number.isInteger(quota) || quota < 0 || quota > 10000)) return { ok: false, error: "配额填 0 到 10000 的整数；不设就清空" };
  try {
    const org = await 读组织();
    if (!org.成员.has(userId)) return { ok: false, error: "这个人不在组织里，或者已经停用" };
    const 改权限 = await 读改权限();
    if (!能设配额(org, me, userId, 改权限)) return { ok: false, error: `线索配额${谁能改的话(改权限, "线索配额")}` };
    if (quota === null) await prisma.entLeadQuota.deleteMany({ where: { userId } });
    else await prisma.entLeadQuota.upsert({ where: { userId }, update: { quota, setById: me.id }, create: { userId, quota, setById: me.id } });
    const 人 = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await recordAudit({
      user: me, action: "update", entity: "EntLeadQuota", entityId: userId,
      summary: quota === null ? `取消 ${人?.name ?? userId} 的线索配额` : `把 ${人?.name ?? userId} 的线索配额设成每月 ${quota} 条`,
    });
    revalidatePath("/leads");
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/** 我分出去的线索和转化情况；规则没开返回 null */
export async function 我分出去的线索(): Promise<分出去的线索[] | null> {
  const me = await 进门();
  if (!me) return null;
  return 我分出去的(me.id);
}

export type 分配情况 = {
  userId: string;
  name: string;
  line: string | null;
  已分: number;
  /** 生效配额 = 设的每月配额 + 本月加额；没设 = null。规则里选了「不设配额」也是 null（不限） */
  配额: number | null;
  /** 设的每月配额（改配额的输入框改的是它） */
  设的配额: number | null;
  /** 本月因线索最终判无效加的额，月初清零；没设配额的人不加 */
  加额: number;
  /** 当前持有：他名下待跟进、跟进中的线索（企业版只用项目：线索阶段、没结局、不在公海的项目），月初不清 */
  持有: number;
  /** 允许才进自动分配轮转；暂停、禁止都不进 */
  参与: boolean;
  参与状态: 参与状态;
  能设配额: boolean;
  能改参与: boolean;
}[];

/**
 * 本月每个能接线索的人分了几条、配额多少、手上还有几条、参与没参与自动分配（设置 → 组织架构 →「线索分配」那一屏用）。
 * 分配的人、能改参与的人看全部；上级只看自己能设配额的那几位；都不是 = 空。规则没开返回 null
 */
export async function 本月分配情况(): Promise<分配情况 | null> {
  const me = await 进门();
  if (!me) return null;
  const org = await 读组织();
  const 全看 = 能分配(org, me) || 能改参与(org, me);
  const 改参与 = 能改参与(org, me);
  const 改权限 = await 读改权限();
  const 人们 = [...org.成员.values()].filter((m) => 接手问题(org, m.userId, null) === null && (全看 || 能设配额(org, me, m.userId, 改权限)));
  const ids = 人们.map((m) => m.userId);
  const 月 = 月份();
  const [计数, 配额, 加额, 持有, 名字, 状态表, 不限额] = await Promise.all([
    prisma.entLeadAssign.groupBy({ by: ["toUserId"], where: { month: 月, counted: true, toUserId: { in: ids } }, _count: { _all: true } }),
    prisma.entLeadQuota.findMany({ where: { userId: { in: ids } } }),
    本月加额们(ids, 月),
    // 持有数不受「按组织架构看客户」限定：上级看下属手上几条，本来就该看得到这个数。不限定的连接不过软删扩展，回收站里的（P9）自己排掉
    (await 企业版只用项目())
      ? defaultClient.project.groupBy({ by: ["ownerId"], where: { ownerId: { in: ids }, phase: "线索", result: null, pooledAt: null, awaitAssignAt: null, deletedAt: null, customer: { deletedAt: null } }, _count: { _all: true } })
      : defaultClient.lead.groupBy({ by: ["ownerId"], where: { ownerId: { in: ids }, status: { in: ["待跟进", "跟进中"] } }, _count: { _all: true } }),
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, createdAt: true } }),
    参与状态表(),
    不设配额开着(),
  ]);
  const 数 = new Map(计数.map((c) => [c.toUserId, c._count._all]));
  const 额 = new Map(配额.map((q) => [q.userId, q.quota]));
  const 持 = new Map(持有.map((c) => [c.ownerId, c._count._all]));
  // 和自动分配挑人的先后一样排：进池早的在前
  const 人 = new Map(名字.map((u) => [u.id, u]));
  return 人们
    .filter((m) => 人.has(m.userId))
    .sort((a, b) => 人.get(a.userId)!.createdAt.getTime() - 人.get(b.userId)!.createdAt.getTime())
    .map((m) => ({
      userId: m.userId, name: 人.get(m.userId)!.name, line: m.line,
      已分: 数.get(m.userId) ?? 0,
      配额: 不限额 ? null : 生效配额(额.get(m.userId) ?? null, 加额.get(m.userId) ?? 0),
      设的配额: 额.get(m.userId) ?? null,
      加额: 额.has(m.userId) ? (加额.get(m.userId) ?? 0) : 0,
      持有: 持.get(m.userId) ?? 0,
      参与: 参与状态of(状态表, m.userId) === "允许", 参与状态: 参与状态of(状态表, m.userId), 能设配额: 能设配额(org, me, m.userId, 改权限), 能改参与: 改参与,
    }));
}
