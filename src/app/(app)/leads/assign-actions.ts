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
import { 能改后台设置, 是市场角色, 是销售角色, 能管公海 } from "@/lib/enterprise/permissions";
import { 查完再写 } from "@/lib/check-then-write";
import { 读改权限, 谁能改的话 } from "@/lib/enterprise/edit-perm";
import { 企业版 } from "@/lib/enterprise/switch";
import { 分配方式叫法, 挡分配方式, 选的原因 } from "@/lib/enterprise/dict";
import { 能自动分配客户, 不是市场话 } from "@/lib/enterprise/cust-auto-assign";
import { 交接中的客户 } from "@/lib/enterprise/handover-db";
import { 发满额提醒, 发待分配提醒, 读满额提醒, 关掉满额提醒, type 满额提醒 } from "@/lib/enterprise/lead-full-notice";
import { 标待分配 } from "@/lib/enterprise/await-assign";
import { 验证中不能改派, 客户有验证中线索 } from "@/lib/project/lead-verify-guard";
import { 分配通知, 同事待分配随客户通知, type 分配条, type 留下的活, type 同事待分配条 } from "@/lib/enterprise/notice-sources";
import { 企业版只用项目 } from "@/lib/enterprise/project-only";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 超上限n, 记转让, 将回收提醒跟着换人, 勾掉将回收提醒 } from "@/lib/project/db";
import { 单项目客户跟着领, 领项目连带超上限, 客户整包出公海 } from "@/lib/enterprise/pool-link";
import { 拦客户公海里的项目, 客户在公海项目不单领提示, 客户在公海找销管提示 } from "@/lib/enterprise/pool-rules";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 客户在市场手里, 算市场转客户, 转客户给销售 } from "@/lib/enterprise/market-transfer";
import { 分配带走的同事项目, 数进手的持有项目 } from "@/lib/carry-over-db";
import type { 转走项目预览 } from "@/lib/carry-over";
import { 看全部 } from "@/lib/team-scope";
import { 项目业务线, 线部门key, 规整线部门, 线勾了部门, 按部门候选, 只留销售, 两条线, 是业务线, type 线部门, type 项目线 } from "@/lib/enterprise/assign-line";
import { 历史负责人 } from "@/lib/project/pool-owner";
import { 区域线of, 按区域分配of, 去掉销售管理, 区域分配理由 } from "@/lib/enterprise/customer-region";
import type { 客户地址 } from "@/lib/enterprise/customer-v2";
import { 换负责人待办, 待办痕, 接上待办痕, 带待办勾 } from "@/lib/project/carry-tasks";
import { 规整还原单, 撤回自动分配, 自动分配撤销对不上, type 自动分配还原 } from "@/lib/enterprise/auto-assign-undo";
import {
  企划线索计数key, 我分出去的, 月份, 本月已分, 本月加额们, 生效配额, 满了, 接手问题, 能分配, 能设配额, 能改参与, 线索种类, 计不计数, 配额of, 挑接手人, 挑的理由, 自动分配不参与key,
  认参与状态, 参与状态of, 是参与状态, type 参与状态, 不设配额key, 自动候选人们,
  type 分出去的线索, type 线,
} from "@/lib/enterprise/lead-assign";
import { 换负责人 } from "@/lib/project/owner-write";
import { 定时分配令牌, 超时转令牌 } from "@/lib/enterprise/scheduled-assign-token";
import { 刷新页面 } from "@/lib/revalidate-safe";

type 结果 = { ok: true } | { ok: false; error: string };
/** 分哪一条：老的线索表，或者企业版「新线索」= 线索阶段的项目 */
type 目标 = { leadId: string; projectId?: undefined } | { projectId: string; leadId?: undefined };
const 目标of = (x: { leadId?: unknown; projectId?: unknown }): 目标 | null =>
  typeof x.projectId === "string" && x.projectId ? { projectId: x.projectId } : typeof x.leadId === "string" && x.leadId ? { leadId: x.leadId } : null;
const 没开: { ok: false; error: string } = { ok: false, error: `规则「${规则.线索分配.名}」没开：总管理在 设置 → 组织架构 里打开` };

/** 规则开着才放行 */
async function 进门() {
  if (!(await 规则开着("线索分配"))) return null;
  return requireUser();
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
 * 手动指派。原负责人 = 界面上看到的负责人（乐观锁，QA #4）：写库时负责人已经不是他了 = 被别人先分走，回「已被分配」不覆盖。
 * 带待办（企业版 C-06，分配弹窗的勾）：分的是新线索（项目）时，原负责人没做完的待办一起转给接手人；没传按默认勾。
 * 市场首次分给销售（X-18）不看这个勾：待办、计划还归原负责人（P-转-10，见 分项目给）
 */
export async function 分配线索(input: { leadId?: string; projectId?: string; toUserId: string; line?: 线 | null; kind?: 线索种类; 原负责人?: string | null; 带待办?: boolean }): Promise<结果 | { ok: false; error: string; 已被分配: true }> {
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
      // 客户在客户公海里：销售管理 / 总管理指定分配 = 客户连名下公海项目整包给这位销售（P-公海-10），市场管理照拦、提示找销售管理
      const 公海客户 = 能管公海(me, org) ? "整包" as const : "找销管" as const;
      const 看 = await 分前看(哪条, org, 公海客户);
      if (!看.ok) return 看;
      if (!(await 指派可选(org, 看.线 ?? "暂不分配")).includes(input.toUserId)) {
        // 不是销售、停用了这类更具体的原因先说
        return { ok: false, error: 接手问题(org, input.toUserId, null) ?? 不能指派的话 };
      }
      const 用线 = 是业务线(看.线) ? 看.线 : null;
      // 人已经按线（部门 / 标记）筛过了，这里不再查标记
      // 界面没交看到的负责人（老页面）：按这次请求开头读到的比
      const 原负责人 = 看到的 === undefined ? 看.实际负责人 : 看到的;
      const r = await 分给(me, org, { ...哪条, toUserId: input.toUserId, line: 用线, 查线: null, kind, 自动: false, 原负责人, 带待办: 带待办勾(input.带待办), 公海客户 });
      if (r.ok) await 分配通知(me, [{ ...哪条, toUserId: input.toUserId, ...留下字段(r.留下) }], false);
      return r.ok ? { ok: true } : r.已被分配 ? 已被分配 : { ok: false, error: r.error };
    }
    const r = await 分给(me, org, { ...哪条, toUserId: input.toUserId, line, kind, 自动: false, 原负责人: 看到的, 带待办: 带待办勾(input.带待办) });
    if (r.ok) await 分配通知(me, [{ ...哪条, toUserId: input.toUserId }], false);
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
type 分给结果 = { ok: true; 留下?: 留下的活; 还原?: 自动分配还原 } | { ok: false; error: string; 满?: true; 已被分配?: true };
const 已被分配: { ok: false; error: string; 已被分配: true } = { ok: false, error: 已被分配的话, 已被分配: true };

async function 分给(
  me: SessionUser, org: 组织, input: 目标 & { toUserId: string; line: 线 | null; kind: 线索种类; 自动: boolean; 查线?: 线 | null; 原负责人?: string | null; 带待办?: boolean; 公海客户?: 公海客户分法; 备注?: string },
): Promise<分给结果> {
  // 查线：核对接手人内贸 / 外贸标记用的线；这条线勾了部门时传 null（按部门挑，不看标记）。没传 = 就用 line
  const 问题 = 接手问题(org, input.toUserId, input.查线 === undefined ? input.line : input.查线);
  if (问题) return { ok: false, error: 问题 };
  // 分配方式（10-27，字典「分配方式」前两项的叫法）：事务外读好，记进分配记录和审计
  const way = await 分配方式叫法(input.自动 ? 1 : 0);
  if (input.projectId !== undefined) return 分项目给(me, org, { ...input, projectId: input.projectId, way });

  // 走限定过的连接：「按组织架构看客户」开着时，看不到的线索当不在
  const lead = await prisma.lead.findFirst({ where: { id: input.leadId }, select: { id: true, name: true } });
  if (!lead) return { ok: false, error: "这条线索已经不在了（或者你看不到它），刷新看看" };

  const counted = 计不计数(input.kind, await getSetting<boolean>(企划线索计数key));
  // 不设配额开着：照样记数（算不算数不变），只是不查满额
  const 查额 = counted && !(await 不设配额开着());
  const 月 = 月份();
  // 能不能分在入口查过（能分配）、这条看得到也查过：事务里看全部——市场管理分别人名下的，按「我」限定的写一行都改不到（11-03 A3-4）
  const 落库 = await 看全部(() => 查完再写(async (tx): Promise<{ ok: true; fromUserId: string | null } | Exclude<分给结果, { ok: true }>> => {
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
  }));
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
 * 换负责人 = 转让：下一步跟着项目走（11-03 A2-3，超时回收从接手那天重新算），在公海里的出公海、待分配的清掉待分配，记一行转让痕。
 * 带待办（C-06）：手动分才有，原负责人的待办按 lib/project/carry-tasks.ts 带过去或关掉；自动分配不传、不碰。
 * 市场首次分给销售（X-18，手动、自动都一样）：服务端不信传来的勾，待办、计划不搬、不关，还归原负责人（P-转-10）；
 * 回 留下 = 这一下走了这条路，分配通知据此告诉接手人客户上还有多少原负责人的活
 */
const 留下字段 = (留下: 留下的活 | undefined): { 留下?: 留下的活 } => (留下 ? { 留下 } : {});

async function 分项目给(
  me: SessionUser, org: 组织, input: { projectId: string; toUserId: string; line: 线 | null; kind: 线索种类; way: string; 自动?: boolean; 原负责人?: string | null; 带待办?: boolean; 公海客户?: 公海客户分法; 备注?: string },
): Promise<分给结果> {
  const p0 = await prisma.project.findFirst({ where: { id: input.projectId }, select: { id: true, name: true, customerId: true } });
  if (!p0) return { ok: false, error: 项目不在 };
  // 客户负责人是市场、接手的是销售：这一下算转客户（见事务里那段），换负责人之前钉住老签约（事务外，它用全局连接）
  const 客户0 = await 看全部(() => prisma.customer.findUnique({ where: { id: p0.customerId }, select: { salesOwnerId: true } }));
  if ((客户0 && 是市场角色(org, 客户0.salesOwnerId) && 是销售角色(org, input.toUserId)) || input.公海客户 === "整包") await 钉住老签约();
  const counted = 计不计数(input.kind, await getSetting<boolean>(企划线索计数key));
  // 规则在进事务前读好：事务占着库的唯一连接，事务里再读设置会等到超时
  const 规则 = await 生效组织规则();
  const 查额 = counted && !(await 不设配额开着());
  const 月 = 月份();
  // 同老线索：入口查过能分配、看得到，事务里看全部（11-03 A3-4 市场管理分别人名下的假报「已被分配」）
  const 落库 = await 看全部(() => 查完再写(async (tx): Promise<{ ok: true; fromUserId: string | null; 留下?: 留下的活; 同事待分配?: 同事待分配条[]; 还原: 自动分配还原 } | Exclude<分给结果, { ok: true }>> => {
    const p = await tx.project.findUnique({ where: { id: p0.id } });
    if (!p) return { ok: false, error: 项目不在 };
    // 分前看查过一次；这里再查：弹框开着时客户可能刚被放进公海（放在乐观锁前面，说的是真原因）
    const 在公海 = await tx.customerPool.findUnique({ where: { customerId: p.customerId }, select: { customerId: true } });
    // 销售管理 / 总管理指定分配：客户连名下公海项目整包出公海给这位销售（P-公海-10）；别的入口照拦
    const 整包 = 企业版() && !!在公海 && input.公海客户 === "整包";
    if (!整包 && 拦客户公海里的项目(!!在公海)) return { ok: false, error: 公海客户拦的话(input.公海客户) };
    // 进公海清了负责人的（C-01）ownerId 是空串，和界面交来的「没人」(null) 当一回事
    if (input.原负责人 !== undefined && (p.ownerId || null) !== input.原负责人) return 已被分配;
    if (p.phase !== "线索") return { ok: false, error: "已经转了商机，不用再分：去「项目」里转让负责人" };
    if (p.result) return { ok: false, error: `这条新线索已经${p.result}，不用再分` };
    // 验证中不能改派（X-77）：分前看查过一次，弹框开着时可能刚进验证，事务里再查
    const 验证中 = await 验证中不能改派(tx, p.id);
    if (验证中) return { ok: false, error: 验证中 };
    if (p.ownerId === input.toUserId && !p.pooledAt && !p.awaitAssignAt) return { ok: false, error: "这条新线索已经在他名下了" };
    if (查额) {
      const 已分 = await 本月已分(input.toUserId, 月, tx);
      const 配额 = await 配额of(input.toUserId, tx);
      if (满了(已分, 配额)) return { ok: false, 满: true, error: `他这个月已经分了 ${已分} 条，配额 ${配额} 条，分满了：找他的上级调配额，或者分给别人` };
    }
    // 唯一例外（规划第五节问题 1）：客户负责人有市场角色且没有销售角色（兼任按销售算）、接手人是销售角色 = 市场第一次分给销售，算转客户。
    // 其他项目层动作都不碰客户。下面改的只是项目，客户在这里先读，拦上限和后面转客户都用它
    const 客户 = await tx.customer.findUnique({ where: { id: p.customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
    const 市场转客户 = 算市场转客户(org, 客户, input.toUserId);
    if (!input.自动) {
      // 市场转客户时客户上同事待分配的项目随客户一起进手（市场转一位），照接待分配一起数（M-公海-18）；
      // 在公海里的、开关开着时还连带客户名下别的公海项目（领项目连带超上限）；这里只分线索阶段没结局的，手上这个一定算 1 个
      const 另进 = 市场转客户 ? await 数进手的持有项目([p.customerId], input.toUserId, { 同事待分配: true, 除了: [p.id] }, tx) : 0;
      const 超 = p.pooledAt || 整包 ? await 领项目连带超上限(tx, 规则, input.toUserId, p, 另进, 整包) : await 超上限n(tx, 规则, input.toUserId, 1 + 另进);
      if (超) return { ok: false, 满: true, error: 超 };
    }
    // 分之前的负责人：在公海里的取历史负责人（企业版进公海清了负责人，lib/project/pool-owner.ts）
    const 原 = p.pooledAt ? (await 历史负责人(tx, p.id)) ?? (p.ownerId || null) : p.ownerId;
    // 乐观锁：where 带上刚读到的负责人和公海 / 待分配状态，中间被别人分走了就一行都不动、不覆盖。
    // 下一步（时间 + 文字）跟着项目走、不清（11-03 A2-3，同 改项目 转让）
    const 改 = await tx.project.updateMany({
      where: { id: p.id, ownerId: p.ownerId, pooledAt: p.pooledAt, awaitAssignAt: p.awaitAssignAt, phase: "线索", result: null },
      data: { ...换负责人(input.toUserId), pooledAt: null },
    });
    if (改.count !== 1) return 已被分配;
    // 市场转客户要在动待办之前判（上面判好了）：这条路径上传来的勾不算数
    const 带待办 = 市场转客户 ? undefined : input.带待办;
    await 将回收提醒跟着换人(tx, p, 原, input.toUserId);
    const 几条 = await 换负责人待办(tx, p, 原, input.toUserId, 带待办);
    await 记转让(tx, p, me.id, 原, input.toUserId, "transfer", 接上待办痕(`分配方式：${input.way}${input.备注 ? `；${input.备注}` : ""}`, 待办痕(带待办, 几条)));
    await 勾掉将回收提醒(tx, 规则, { ...p, ownerId: input.toUserId }, new Date());
    // 只改项目，客户负责人不动（P-转-03、M-公海-06；开关 领项目带走单项目客户 关着）
    if (整包) await 客户整包出公海(tx, p.customerId, input.toUserId, me.id, 带待办, "pool-assign");
    else if (p.pooledAt) await 单项目客户跟着领(tx, p.customerId, input.toUserId, me.id, 带待办);
    const 转 = !整包 && 市场转客户 && 客户 ? await 转客户给销售(tx, p.customerId, 客户.salesOwnerId, input.toUserId, me.id, input.way) : undefined;
    await tx.entLeadAssign.create({
      data: { projectId: p.id, toUserId: input.toUserId, fromUserId: 原, byUserId: me.id, line: input.line, kind: input.kind, counted, month: 月, way: input.way },
    });
    // 还原单（撤销自动分配整批还原用，auto-assign-undo.ts）：分之前的负责人、待分配 / 入池时刻、市场转销售连带过去的客户和活
    const 还原: 自动分配还原 = {
      原, 待分配: p.awaitAssignAt?.toISOString() ?? null, 公海: p.pooledAt?.toISOString() ?? null,
      ...(转 && 客户 ? { 客户: { customerId: p.customerId, 原: 客户.salesOwnerId, 带过来: 转.带过来 } } : {}),
    };
    return { ok: true, fromUserId: 原, 留下: 转?.留下, 同事待分配: 转?.同事待分配, 还原 };
  }));
  if (!落库.ok) return 落库;
  if (落库.同事待分配?.length) await 同事待分配随客户通知(me.id, input.toUserId, 落库.同事待分配);

  const { line } = input;
  const 接手 = await prisma.user.findUnique({ where: { id: input.toUserId }, select: { name: true } });
  await recordAudit({
    user: me, action: "update", entity: "Project", entityId: p0.id,
    summary: `分配新线索「${p0.name}」给 ${接手?.name ?? input.toUserId}${line ? `（${line}）` : ""}${counted ? "" : "，不计数"}`,
    detail: { toUserId: input.toUserId, fromUserId: 落库.fromUserId, line, kind: input.kind, counted, month: 月, 分配方式: input.way, ...(input.备注 ? { 备注: input.备注 } : {}) },
  });
  // 定时分配到点时在后台钟上跑，没有请求上下文：刷新页面缓存那一步出错不算分配失败（lib/revalidate-safe.ts）
  刷新页面("/leads", "/projects");
  return { ok: true, ...留下字段(落库.留下), 还原: 落库.还原 };
}

/**
 * 客户在客户公海里的项目怎么分（P-公海-10）：整包 = 销售管理 / 总管理指定分配，客户和名下公海项目一起给这位销售；
 * 找销管 = 市场管理指定分配，拦下、提示找销售管理；不传 = 自动分配等别的入口，照旧拦（项目跟客户走、不单分）
 */
type 公海客户分法 = "整包" | "找销管";
function 公海客户拦的话(分法?: 公海客户分法): string {
  return 分法 === "找销管" ? 客户在公海找销管提示 : 客户在公海项目不单领提示;
}

/**
 * 分配之前看一眼：现在的负责人（挑人时跳过他）、走哪条线，不能分就给原因。
 * 新线索（项目）的线 = 项目业务线（三选一；老项目没填按负责人的线、再没有按内贸，要传 org 才看负责人）；老线索表 = null
 */
async function 分前看(
  哪条: 目标, org?: 组织, 公海客户?: 公海客户分法,
): Promise<{ ok: true; ownerId: string | null; 实际负责人: string | null; 待分配: boolean; 名: string; 线: 项目线 | null; 区域?: { 客户: 客户地址; 项目: 客户地址 } } | { ok: false; error: string }> {
  if (哪条.projectId !== undefined) {
    const 址 = { addrCountry: true, addrProvince: true, addrCity: true, addrDistrict: true } as const;
    const p = await prisma.project.findFirst({
      where: { id: 哪条.projectId },
      select: { ownerId: true, pooledAt: true, awaitAssignAt: true, phase: true, result: true, name: true, bizLine: true, ...址, customer: { select: { ...址, pool: { select: { customerId: true } } } } },
    });
    if (!p) return { ok: false, error: 项目不在 };
    // 客户公海里的项目跟客户走，不单独分（M-公海-06、X-13）；线索公海（客户不在公海）照分
    // 例外：销售管理 / 总管理指定分配，客户整包出公海（P-公海-10，见 分项目给）
    if (公海客户 !== "整包" && 拦客户公海里的项目(!!p.customer.pool)) return { ok: false, error: 公海客户拦的话(公海客户) };
    if (p.phase !== "线索") return { ok: false, error: "已经转了商机，不用再分" };
    if (p.result) return { ok: false, error: `这条新线索已经${p.result}，不用再分` };
    const 验证中 = await 验证中不能改派(prisma, 哪条.projectId);
    if (验证中) return { ok: false, error: 验证中 };
    // 公海里的、待分配的（A7 / A10，负责人那一格只是建的人占着）：原负责人也能被挑中
    return {
      ok: true, ownerId: p.pooledAt || p.awaitAssignAt ? null : p.ownerId || null, 实际负责人: p.ownerId || null,
      待分配: !p.pooledAt && !!p.awaitAssignAt, 名: p.name, 线: 项目业务线(p, org?.成员),
      区域: {
        客户: { addrCountry: p.customer.addrCountry, addrProvince: p.customer.addrProvince, addrCity: p.customer.addrCity, addrDistrict: p.customer.addrDistrict },
        项目: { addrCountry: p.addrCountry, addrProvince: p.addrProvince, addrCity: p.addrCity, addrDistrict: p.addrDistrict },
      },
    };
  }
  const lead = await prisma.lead.findFirst({ where: { id: 哪条.leadId }, select: { ownerId: true, status: true, name: true } });
  if (!lead) return { ok: false, error: "这条线索已经不在了（或者你看不到它），刷新看看" };
  if (lead.status === "已转化") return { ok: false, error: "已转化的线索不用再分" };
  return { ok: true, ownerId: lead.ownerId, 实际负责人: lead.ownerId, 待分配: false, 名: lead.name, 线: null };
}

/**
 * 分配弹窗打开时看这条新线索（项目）：走哪条线（只读显示，总有值）、能指派给谁（正常参与、线对得上的销售 userId）、
 * 是不是市场首次分配（X-18：可选的都是销售，客户在市场手里就是；弹窗据此不摆「待办一起转」的勾，服务端在 分项目给 里再判一次）。
 * 不能分 / 看不到 = null
 */
export async function 项目分配线(projectId: string): Promise<{ 线: 项目线; 可选: string[]; 市场转客户: boolean } | null> {
  const me = await 进门();
  if (!me) return null;
  try {
    const org = await 读组织();
    if (!能分配(org, me)) return null;
    const 看 = await 分前看({ projectId: String(projectId ?? "") }, org, 能管公海(me, org) ? "整包" : "找销管");
    if (!看.ok) return null;
    const 线 = 看.线 ?? "内贸";
    const 项目 = await 看全部(() => prisma.project.findUnique({ where: { id: String(projectId ?? "") }, select: { customer: { select: { salesOwnerId: true, pool: { select: { customerId: true } } } } } }));
    return { 线, 可选: await 指派可选(org, 线), 市场转客户: 客户在市场手里(org, 项目?.customer ?? null) };
  } catch {
    return null;
  }
}

/**
 * 分配之前列出会一起转走的项目（含同事在推的，只给个数；P-转-07）：只有市场首次分给销售（X-18）、客户名下有同事的项目才有；别的情况 0 个 = 不弹。只读。
 * 接手人不传 = 批量 / 单条自动分配，还没挑人（挑的都是销售）；暂不分配的不进自动分配，不算。
 * 分不了的、看不到的、算不出来的都回 0 个：不拦，分的时候服务端照常查
 */
export async function 分配带走的项目(projectIds: string[], 接手人?: string): Promise<转走项目预览> {
  const 不弹: 转走项目预览 = { 项目数: 0, 项目: [] };
  const me = await 进门();
  if (!me) return 不弹;
  const ids = [...new Set(Array.isArray(projectIds) ? projectIds.filter((x) => typeof x === "string") : [])];
  if (!ids.length || ids.length > 批量最多 || (接手人 !== undefined && typeof 接手人 !== "string")) return 不弹;
  try {
    const org = await 读组织();
    if (!能分配(org, me)) return 不弹;
    const 能分的: string[] = [];
    // 市场成员（按岗位）点自动分配不看项目业务线、按客户区域定（P-转-26），「暂不分配」的也会分
    const 按区域 = 按区域分配of(org, me.id);
    for (const id of ids) {
      const 看 = await 分前看({ projectId: id }, org);
      if (看.ok && (接手人 !== undefined || 按区域 || 是业务线(看.线))) 能分的.push(id);
    }
    return await 看全部(async () => {
      const 行 = await prisma.project.findMany({ where: { id: { in: 能分的 } }, select: { customer: { select: { id: true, salesOwnerId: true, pool: { select: { customerId: true } } } } } });
      const 客户们 = [...new Map(行.map((p) => [p.customer.id, p.customer])).values()]
        .filter((c) => (接手人 === undefined ? 客户在市场手里(org, c) : 算市场转客户(org, c, 接手人)));
      return 分配带走的同事项目(客户们, 接手人 ?? "", ids);
    });
  } catch {
    return 不弹;
  }
}

export type 自动分配结果 =
  | { ok: true; toUserId: string; 接手人: string; 已分: number; 配额: number | null; 为什么: string; 随客户?: true; 还原?: 自动分配还原; 区域未填?: true }
  | { ok: false; error: string; 都满额?: true; 暂不分配?: true; 已被分配?: true; 待分配?: true };
/**
 * 服务端自己用：多带 留下（分配通知要）、要标（挑不到人、还没待分配的新线索：调用方标待分配、发提醒，X-85），不给浏览器
 */
type 内部自动结果 = 自动分配结果 & { 留下?: 留下的活; 要标?: { 名: string; 为什么: string }; 挑不到?: string };

function 对外(r: 内部自动结果): 自动分配结果 {
  const { 留下: _留下, 要标: _要标, 挑不到: _挑不到, ...外 } = r;
  return 外;
}

/** 挑不到人标了待分配之后回给界面的那句（X-85） */
const 标了待分配话 = (为什么: string) => `${为什么}。已标成待分配、留在新线索，已提醒能分配的人手动指派`;

/**
 * 点自动分配（单条、批量）挑不到人、还没待分配的新线索：标成待分配（X-85，11-01 A10），回去的那句改成已标。
 * 提醒由调用方合成一条发（批量不按条刷屏）；建档向导不走这里，建好再分 自己标
 */
async function 挑不到就标(projectId: string, r: 内部自动结果): Promise<内部自动结果> {
  if (r.ok || !r.要标) return r;
  await 标待分配(projectId, null);
  return { ...r, error: 标了待分配话(r.要标.为什么) };
}

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
    const r = 哪条.projectId !== undefined
      ? await 挑不到就标(哪条.projectId, await 自动分给(me, org, 哪条, line, kind, 认原负责人(opts.原负责人)))
      : await 自动分给(me, org, 哪条, line, kind, 认原负责人(opts.原负责人));
    if (r.ok) await 分配通知(me, [{ ...哪条, toUserId: r.toUserId, ...留下字段(r.留下) }], true);
    if (!r.ok && r.要标) {
      await 发待分配提醒(org, [r.要标.名], me.name, r.要标.为什么).catch((e) => console.error("[待分配提醒] 没发出去", e));
    } else if (!r.ok && r.都满额) {
      const 看 = await 分前看(哪条).catch(() => null);
      await 发满额提醒(org, [看?.ok ? 看.名 : id], me.name).catch((e) => console.error("[满额提醒] 没发出去", e));
    }
    return 对外(r);
  } catch (e) {
    return 不在了(e);
  }
}

/**
 * 撤销行末「自动分配」（原型 pr.autoone，6 秒撤销条；P-撤销-01 按原样回滚）：整批还原——负责人、待分配标记、将回收提醒、卡点认领，
 * 市场转销售连带过去的客户和计划 / 待办 / 项目，删被撤的转让痕和这次的分配记录（不占额度）。还原单 是 自动分配线索 回的，不可信，
 * 全靠留痕核对（auto-assign-undo.ts）；对不上整批不动、回原因。谁撤的记操作日志。分配通知发出去了收不回，不另发撤销通知
 */
export async function 撤销自动分配(projectId: string, 还原: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await 进门();
  if (!me) return 没开;
  try {
    const org = await 读组织();
    if (!能分配(org, me)) return { ok: false, error: 能分配的话 };
    const 单 = 规整还原单(还原);
    if (!单 || typeof projectId !== "string" || !projectId) return { ok: false, error: "撤销参数不对，刷新看看" };
    let r: Awaited<ReturnType<typeof 撤回自动分配>>;
    try {
      const 方式 = await 分配方式叫法(1);
      r = await 看全部(() => 查完再写((tx) => 撤回自动分配(tx, projectId, 单, me.id, 方式)));
    } catch (e) {
      if (e instanceof 自动分配撤销对不上) return { ok: false, error: `${e.message}，要改回请手工改` };
      throw e;
    }
    if (!r.ok) return r;
    const 人 = await prisma.user.findMany({ where: { id: { in: [r.原, r.现] } }, select: { id: true, name: true } });
    const 名 = (id: string) => 人.find((u) => u.id === id)?.name ?? id;
    await recordAudit({
      user: me, action: "update", entity: "Project", entityId: projectId,
      summary: `撤销了刚才的自动分配：新线索「${r.名}」从 ${名(r.现)} 改回 ${名(r.原)}${单.客户 ? "，客户和一起转过去的活一并还原" : ""}`,
      detail: { 从: r.现, 改回: r.原, 连客户: !!单.客户 },
    });
    revalidatePath("/leads");
    revalidatePath("/projects");
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/**
 * 建档向导选了「自动分配」（A7，10-27）：项目刚建在我名下，按自动分配挑人转过去。只改项目，客户负责人不动（P-转-03）；
 * 市场建档分给销售例外，算转客户（分项目给 里那段，X-18）。
 * 只认我自己是负责人、线索阶段、没进公海的项目。不查「能分配」（总管理 / 市场管理 / 销售管理）：向导里能不能自动分只看分配方式的「谁能用」
 */
export async function 向导自动分配(projectId: string): Promise<自动分配结果> {
  const me = await 进门();
  if (!me) return 没开;
  try {
    const 方式挡 = await 挡分配方式(me, 1);
    if (方式挡) return { ok: false, error: 方式挡 };
    const p = await prisma.project.findFirst({ where: { id: String(projectId ?? "") }, select: { ownerId: true, phase: true, pooledAt: true } });
    if (!p || p.ownerId !== me.id || p.phase !== "线索" || p.pooledAt) return { ok: false, error: "只能自动分配自己名下、还在线索阶段的项目" };
    const r = await 自动分给(me, await 读组织(), { projectId }, null, "营销");
    if (r.ok) await 分配通知(me, [{ projectId, toUserId: r.toUserId, ...留下字段(r.留下) }], true);
    return 对外(r);
  } catch (e) {
    return 不在了(e);
  }
}

/**
 * 自动分配线索()、批量自动分配()、向导自动分配() 共用：进门、能不能分已经查过。
 * 原负责人 = 点按钮时界面上看到的负责人（乐观锁，QA #4）；没交 = 按这里刚读到的比。被别人先分走了直接回「已被分配」，不再换人分。
 * 发起人 = 按区域定事业部（P-转-26）看谁发起的；没交 = me。定时分配到点是系统在分，发起人是建线索的人。
 * 排除 = 这些人不挑（超时未跟进自动转：这一轮已经超时过的人，lib/enterprise/reply-overdue.ts）；没交 = 只排除现负责人（照旧）
 */
async function 自动分给(
  me: SessionUser, org: 组织, 哪条: 目标, line: 线 | null, kind: 线索种类, 原负责人?: string | null, 备注?: string, 发起人?: string, 排除?: readonly string[],
): Promise<内部自动结果> {
  const 看 = await 分前看(哪条, org);
  if (!看.ok) return 看;
  const 比谁 = 原负责人 === undefined ? 看.实际负责人 : 原负责人;
  if (比谁 !== 看.实际负责人) return 已被分配;
  // 新线索（项目）挑不到人（QA #5）：不抛错、不动它，回 待分配: true 让界面提示「留在新线索待分配，手动指派」
  // 还没待分配的带上 要标：点自动分配的调用方标待分配、提醒（X-85）；建档向导由 建好再分 标
  const 挑不到 = (为什么: string, 都满额?: true): 内部自动结果 =>
    哪条.projectId !== undefined
      ? {
        ok: false, 待分配: true, ...(都满额 ? { 都满额 } : {}), error: `${为什么}。${看.待分配 ? "已留在新线索待分配" : "这条新线索留在原处"}，可以手动指派`, 挑不到: 为什么,
        ...(看.待分配 ? {} : { 要标: { 名: 看.名, 为什么 } }),
      }
      : { ok: false, ...(都满额 ? { 都满额 } : {}), error: 为什么 };

  // 新线索（项目）：线看项目业务线（A1，三选一；老项目按负责人的线、再没有按内贸），不认弹窗传来的；
  // 「暂不分配」不自动分。勾了部门的线按部门挑人（A4），没勾退回按成员标记
  // 例外（P-转-26 自动分配这一半，X-141）：市场成员（按岗位：市场管理、渠道运营）发起的，不看项目业务线，按客户区域定事业部——
  // 大陆 → 内贸、非大陆（含港澳台）→ 外贸，客户地址全空看项目所在地，再空 = 两条线都算、结果里提示补区域；候选都去掉销售管理。
  // 指定分配的事业部限制（P-转-26 另一半）还没做，见 X-141
  let 人们: string[];
  let 查线: 线 | null | undefined;
  const 按区域 = 哪条.projectId !== undefined && 按区域分配of(org, 发起人 ?? me.id);
  let 区域未填 = false;
  if (按区域) {
    line = 看.区域 ? 区域线of(看.区域.客户, 看.区域.项目) : null;
    const 设 = await 读线部门();
    if (line) {
      人们 = 按部门候选(org, 看.ownerId, line, 设, 自动候选人们);
      查线 = 查哪条线(org, 设, line);
    } else {
      区域未填 = true;
      人们 = [...new Set(两条线.flatMap((l) => 按部门候选(org, 看.ownerId, l, 设, 自动候选人们)))];
      查线 = null;
    }
    人们 = 去掉销售管理(org, 人们);
  } else if (哪条.projectId !== undefined) {
    if (!是业务线(看.线)) return { ok: false, 暂不分配: true, error: 暂不分配不自动 };
    line = 看.线;
    const 设 = await 读线部门();
    人们 = 按部门候选(org, 看.ownerId, line, 设, 自动候选人们);
    查线 = 查哪条线(org, 设, line);
  } else {
    人们 = 自动候选人们(org, 看.ownerId, line);
  }
  人们 = 只留销售(org, 人们);
  if (排除?.length) 人们 = 人们.filter((id) => !排除.includes(id));
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
    const 为什么 = 按区域 ? `${挑的理由(候选, 跳过, 查满, 谁, 不限额)}；${区域分配理由(line)}` : 挑的理由(候选, 跳过, 查满, 谁, 不限额);
    const r = await 分给(me, org, { ...哪条, toUserId: 谁, line, 查线, kind, 自动: true, 原负责人: 比谁, ...(备注 ? { 备注 } : {}) });
    if (r.ok) {
      return { ok: true, toUserId: 谁, 接手人: 建号.find((u) => u.id === 谁)?.name ?? 谁, 已分: await 本月已分(谁, 月), 配额: 不限额 ? null : (额.get(谁) ?? null), 为什么, ...留下字段(r.留下), ...(r.还原 ? { 还原: r.还原 } : {}), ...(区域未填 ? { 区域未填: true as const } : {}) };
    }
    if (r.已被分配) return 已被分配;
    if (!r.满) return { ok: false, error: r.error };
    跳过.add(谁);
  }
}

/**
 * 定时分配执行（11-17 PR3，lib/enterprise/scheduled-assign.ts 调；钟上到点和「改成现在分配」）：不是给浏览器的 action——
 * 这个文件导出的都能被浏览器调，所以带一把服务端令牌（scheduled-assign-token.ts），对不上不干活。
 * 指定分配（接手人有值）：照建档向导的指定分配口径查接手人（接手问题，业务线不比），查持有上限；市场首次分给销售客户随行（X-18）。
 * 自动分配（接手人空）：那时再挑人（当时的候选、参与状态）。成了照常发「分给你」，多一句 附。分不出去原样回原因，项目不动（还在待分配）
 */
export async function 定时分出去(令牌: unknown, 谁: SessionUser, projectId: string, 接手人: string | null, 附: string): Promise<{ ok: true; 接手人: string } | { ok: false; error: string }> {
  if (令牌 !== 定时分配令牌) return { ok: false, error: "不对外：只给后台定时任务用" };
  const org = await 读组织();
  const 哪条 = { projectId };
  if (接手人) {
    const 看 = await 分前看(哪条, org);
    if (!看.ok) return 看;
    const 问题 = 接手问题(org, 接手人, null);
    if (问题) return { ok: false, error: 问题 };
    const r = await 分给(谁, org, { ...哪条, toUserId: 接手人, line: 是业务线(看.线) ? 看.线 : null, 查线: null, kind: "营销", 自动: false, 原负责人: 看.实际负责人, 备注: 附 });
    if (!r.ok) return { ok: false, error: r.error };
    await 分配通知(谁, [{ ...哪条, toUserId: 接手人, ...留下字段(r.留下) }], false, 附);
    return { ok: true, 接手人: (await prisma.user.findUnique({ where: { id: 接手人 }, select: { name: true } }))?.name ?? 接手人 };
  }
  // 按区域定事业部（P-转-26）看建线索的人：市场成员建的自动分配，到点照样按客户区域分（区域没填 = 两条线都算），不退回按内贸
  const 建的人 = (await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { creatorId: true } })))?.creatorId;
  const r = await 自动分给(谁, org, 哪条, null, "营销", undefined, 附, 建的人);
  if (!r.ok) return { ok: false, error: r.error };
  await 分配通知(谁, [{ ...哪条, toUserId: r.toUserId, ...留下字段(r.留下) }], true, 附);
  return { ok: true, 接手人: r.接手人 };
}

/**
 * 超时未跟进自动转（11-17，lib/enterprise/reply-overdue.ts 调；钟上到点）：不是给浏览器的 action，带服务端令牌（同 定时分出去）。
 * 按自动分配挑下一位（同一套候选：项目业务线 / 市场成员建的按客户区域、参与状态、本月分得最少、并列最早进池；配额照查，不看持有上限），
 * 排除 = 现负责人 + 这一轮超时过的人。乐观锁：负责人还得是 原。不发通知（调用方把客户怎么办定好了再发，通知里要写客户在谁名下）。
 * 挑不到 = 挑不到人（排除之后没人能接），调用方据此开新一轮；别的不成（验证中、规则关着、被人先分走）原样回原因，项目不动
 */
export async function 超时转出(
  令牌: unknown, 谁: SessionUser, projectId: string, 原: string, 排除: readonly string[], 附: string,
): Promise<{ ok: true; 接手人Id: string; 接手人: string; 留下?: 留下的活 } | { ok: false; error: string; 挑不到?: true }> {
  if (令牌 !== 超时转令牌) return { ok: false, error: "不对外：只给后台定时任务用" };
  if (!(await 规则开着("线索分配"))) return { ok: false, error: "规则「线索分配」关着" };
  const org = await 读组织();
  const 建的人 = (await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { creatorId: true } })))?.creatorId;
  const r = await 自动分给(谁, org, { projectId }, null, "营销", 原, 附, 建的人, 排除);
  if (!r.ok) return { ok: false, error: r.error, ...(r.待分配 ? { 挑不到: true as const } : {}) };
  return { ok: true, 接手人Id: r.toUserId, 接手人: r.接手人, ...留下字段(r.留下) };
}

export type 客户自动分配结果 = { ok: true; toUserId: string; 接手人: string; 为什么: string; 区域未填?: true } | { ok: false; error: string };

type 看的客户 = { id: string; name: string; salesOwnerId: string; bizLine: string | null; pool: { customerId: string } | null };
const 看客户字段 = { id: true, name: true, salesOwnerId: true, bizLine: true, pool: { select: { customerId: true } } } as const;
const 客户看不到话 = "这位客户已经不在了（或者你看不到它），刷新看看";

/**
 * 客户自动分配、批量客户自动分配 共用：一位客户从「能不能自动分」判到分出去、记操作日志。进门、认人、原因已由调用方查过。
 * 不发通知：成了回 通知条，调用方发（批量合成一次，按接手人一人一条）。
 * 挑人走 自动分给：本月已分数每次现读分配记录，批里前面分出去的那几家已经写进去了，下一家自然轮到别人（不另记一份）
 */
async function 自动分一位客户(
  me: SessionUser, org: 组织, c: 看的客户, 原因值: string | null,
): Promise<(Exclude<客户自动分配结果, { ok: false }> & { 通知条: 分配条 }) | { ok: false; error: string }> {
  const 能 = await 能自动分配客户(me, org, c);
  if (!能.ok) return 能;
  // 同指定转让（assignSalesOwner）：正在移交的不能再转，名下有验证中的线索不能改派
  if ((await 交接中的客户([c.id])).size) return { ok: false, error: "这位客户正在移交（等接手人确认），不能再转；要换人先撤回，或等对方拒收" };
  const 验证中 = await 客户有验证中线索(prisma, [c.id]);
  if (验证中) return { ok: false, error: 验证中 };
  const r = await 自动分给(me, org, { projectId: 能.projectId }, null, "营销", c.salesOwnerId);
  if (!r.ok) {
    if (r.已被分配) return { ok: false, error: "这位客户刚被别人分走了，刷新看看现在在谁名下" };
    return { ok: false, error: r.挑不到 ? `没有自动分出去：${r.挑不到}。客户还在原负责人名下，没转；可以改用指定分配` : r.error };
  }
  await recordAudit({
    user: me, action: "assign", entity: "Customer", entityId: c.id,
    summary: `客户转让（自动分配）：把「${c.name}」分给「${r.接手人}」${原因值 ? `（${原因值}）` : ""}`,
    detail: { 自动分配: true, 原负责人: c.salesOwnerId, salesOwnerId: r.toUserId, projectId: 能.projectId, 为什么: r.为什么, ...(原因值 ? { 转让原因: 原因值 } : {}) },
  });
  return {
    ok: true, toUserId: r.toUserId, 接手人: r.接手人, 为什么: r.为什么, ...(r.区域未填 ? { 区域未填: true as const } : {}),
    通知条: { projectId: 能.projectId, toUserId: r.toUserId, ...留下字段(r.留下) },
  };
}

/**
 * 客户转让框里选「自动分配」（客户 11-17：市场成员给暂不分配的客户分配时可选自动和指定；lib/enterprise/cust-auto-assign.ts 说谁能用、什么算暂不分配）。
 * 拿客户名下那条暂不分配的项目走新线索的自动分配（自动分给：本月分得最少的优先、配额照算，市场成员按客户区域定内贸 / 外贸，P-转-26），
 * 分项目给 里市场转销售那段把客户连名下项目、联系人一起给挑中的销售（P-转-03 例外：算分配、写分配记录，不计转客户次数），清待分配（P-转-21），
 * 只通知接手人、不走接手人确认（P-转-17）。挑不到人：什么都不动、不标待分配，回原因（框里写，可以改用指定分配）。
 * 转让原因（可不选）同指定转让，记进操作日志
 */
export async function 客户自动分配(customerId: string, 原因?: string | null): Promise<客户自动分配结果> {
  const me = await 进门();
  if (!me) return 没开;
  try {
    const org = await 读组织();
    // 先认人再看参数：不是市场成员的直接拒（权限表按这一格记 403）
    if (!按区域分配of(org, me.id)) return { ok: false, error: 不是市场话 };
    if (typeof customerId !== "string" || !customerId) return { ok: false, error: "要分哪一位客户？刷新看看" };
    const 选 = await 选的原因("transfer", 原因);
    if (!选.ok) return 选;
    // 按「我」限定着读：看不到的当不在
    const c = await prisma.customer.findFirst({ where: { id: customerId }, select: 看客户字段 });
    if (!c) return { ok: false, error: 客户看不到话 };
    const r = await 自动分一位客户(me, org, c, 选.值);
    if (!r.ok) return r;
    const { 通知条, ...外 } = r;
    await 分配通知(me, [通知条], true);
    revalidatePath("/customers");
    return 外;
  } catch (e) {
    return 不在了(e);
  }
}

/** 客户列表勾几位一起转：一次最多这么多位（同批量自动分配线索） */
const 批量客户最多 = 200;
/** 勾的客户编号：只认字符串、去重；空 / 超上限回原因 */
function 认勾的客户(customerIds: unknown): { ok: true; ids: string[] } | { ok: false; error: string } {
  const ids = [...new Set(Array.isArray(customerIds) ? customerIds.filter((x): x is string => typeof x === "string" && !!x) : [])];
  if (!ids.length) return { ok: false, error: "先勾选要分的客户" };
  if (ids.length > 批量客户最多) return { ok: false, error: `一次最多自动分配 ${批量客户最多} 位，分几次点` };
  return { ok: true, ids };
}

export type 批量客户预看 = { ok: true; 可: string[]; 不可: { customerId: string; name: string; error: string }[] } | { ok: false; error: string };

/**
 * 客户列表批量转让框：勾的这几位里哪些能选自动分配（和单个客户转让框同一个判定 能自动分配客户：市场成员、暂不分配的客户……）。
 * 可 有人 = 框里摆「指定分配 / 自动分配」；一个都不行 = 不摆，框和原来一样。不可 = 选了自动分配时框里说这几位不会自动分、为什么。
 * 只读不写
 */
export async function 批量客户自动分配预看(customerIds: string[]): Promise<批量客户预看> {
  const me = await 进门();
  if (!me) return 没开;
  try {
    const org = await 读组织();
    if (!按区域分配of(org, me.id)) return { ok: false, error: 不是市场话 };
    const 勾 = 认勾的客户(customerIds);
    if (!勾.ok) return 勾;
    const 们 = await prisma.customer.findMany({ where: { id: { in: 勾.ids } }, select: 看客户字段 });
    const 按id = new Map(们.map((c) => [c.id, c]));
    const 可: string[] = [];
    const 不可: { customerId: string; name: string; error: string }[] = [];
    for (const id of 勾.ids) {
      const c = 按id.get(id);
      if (!c) { 不可.push({ customerId: id, name: "（看不到这位）", error: 客户看不到话 }); continue; }
      const 能 = await 能自动分配客户(me, org, c);
      if (能.ok) 可.push(id);
      else 不可.push({ customerId: id, name: c.name, error: 能.error });
    }
    return { ok: true, 可, 不可 };
  } catch (e) {
    return 不在了(e);
  }
}

export type 批量客户自动分配行 = { customerId: string; name: string } & 客户自动分配结果;

/**
 * 客户列表勾了几位、批量转让框选「自动分配」：一位一位按顺序分，每位和单个客户转让框的自动分配一模一样（自动分一位客户）。
 * 批内均衡：每位挑人时现读本月分配记录，前面几位刚分出去的已算进去，不会全给同一个人。
 * 混着勾了不是「暂不分配」的（或不在市场名下、别人的、公海里的……）：照单个的条件判，这几位不动、那行写原因（请用指定分配），不悄悄自动分。
 * 一位分不出去不影响别的；通知按接手人合成一条（分配通知）。转让原因一批一个，每位记一行操作日志
 */
export async function 批量客户自动分配(customerIds: string[], 原因?: string | null): Promise<{ ok: true; 结果: 批量客户自动分配行[] } | { ok: false; error: string }> {
  const me = await 进门();
  if (!me) return 没开;
  try {
    const org = await 读组织();
    // 先认人再看参数（同 客户自动分配）
    if (!按区域分配of(org, me.id)) return { ok: false, error: 不是市场话 };
    const 勾 = 认勾的客户(customerIds);
    if (!勾.ok) return 勾;
    const 选 = await 选的原因("transfer", 原因);
    if (!选.ok) return 选;
    const 名 = new Map((await prisma.customer.findMany({ where: { id: { in: 勾.ids } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const 结果: 批量客户自动分配行[] = [];
    const 通知条: 分配条[] = [];
    for (const id of 勾.ids) {
      let r: Awaited<ReturnType<typeof 自动分一位客户>>;
      try {
        // 每位现读：前面那位分出去时可能把这位一起带走了（同一位销售名下同事的项目随客户走），按现在的样子判
        const c = 名.has(id) ? await prisma.customer.findFirst({ where: { id }, select: 看客户字段 }) : null;
        r = c ? await 自动分一位客户(me, org, c, 选.值) : { ok: false, error: 客户看不到话 };
      } catch (e) {
        r = 不在了(e);
      }
      if (r.ok) {
        const { 通知条: 条, ...外 } = r;
        通知条.push(条);
        结果.push({ customerId: id, name: 名.get(id) ?? "（看不到这位）", ...外 });
      } else {
        结果.push({ customerId: id, name: 名.get(id) ?? "（看不到这位）", ok: false, error: r.error });
      }
    }
    await 分配通知(me, 通知条, true);
    if (通知条.length) revalidatePath("/customers");
    return { ok: true, 结果 };
  } catch (e) {
    return 不在了(e);
  }
}

export type 批量自动分配结果 = { leadId: string; name: string } & 自动分配结果;
const 批量最多 = 200;

/**
 * 这一批前面已经把这条的客户分给了销售（X-18），这条跟着过去了：现在真在他名下、还在线索阶段就不用再分。
 * 不挑人、不占额度、不写分配记录。重读一次，判断落空（又被改走了、已经结束）回 null，按普通的一条分，该报什么报什么
 */
async function 本批已随客户走(id: string, 本批: ReadonlyMap<string, { toUserId: string; 接手人: string }>): Promise<自动分配结果 | null> {
  if (!本批.size) return null;
  const p = await 看全部(() => prisma.project.findUnique({ where: { id }, select: { customerId: true, ownerId: true, pooledAt: true, awaitAssignAt: true, phase: true, result: true } }));
  const 谁 = p ? 本批.get(p.customerId) : undefined;
  if (!p || !谁 || p.ownerId !== 谁.toUserId || p.pooledAt || p.awaitAssignAt || p.phase !== "线索" || p.result) return null;
  return { ok: true, toUserId: 谁.toUserId, 接手人: 谁.接手人, 已分: await 本月已分(谁.toUserId, 月份()), 配额: null, 为什么: "同一位客户的线索，随客户一起给他，不再单算一条", 随客户: true };
}

/**
 * 勾了几条一起自动分配（D-38）：一条一条按顺序分，前一条分完再挑下一条的人；每条成没成都列出来。一次最多 200 条。
 * 市场客户按客户算一份（11-09，只在 X-18 下）：一位客户下几条线索，第一条分给谁，客户和其余几条就都归谁，后面几条结果行写「已随客户给 A」。
 * 客户负责人已是销售的不算转客户，还是一条条分（和点几次单条一样）。
 * 原负责人们 = 每行勾选时界面上看到的负责人（乐观锁，X-89 / QA #4）：哪行被别人先分走了只那行回「已被分配」；没交的行按刚读到的比
 */
export async function 批量自动分配(
  leadIds: string[], opts: { 项目?: boolean; 原负责人们?: Record<string, string | null> } = {},
): Promise<{ ok: true; 结果: 批量自动分配结果[] } | { ok: false; error: string }> {
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
    const 原们 = opts?.原负责人们 && typeof opts.原负责人们 === "object" && !Array.isArray(opts.原负责人们) ? opts.原负责人们 : {};
    const 原of = (id: string) => (Object.prototype.hasOwnProperty.call(原们, id) ? 认原负责人(原们[id]) : undefined);
    const 名 = new Map((项目
      ? await prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((l) => [l.id, l.name]));
    const 结果: 批量自动分配结果[] = [];
    const 通知条: 分配条[] = [];
    // 本批已转给销售的客户：客户 id → 接手人。分配人看不到的那条（名 里没有）不走这里，照原样报
    const 本批随客户 = new Map<string, { toUserId: string; 接手人: string }>();
    const 标了的: { id: string; 名: string; 为什么: string }[] = [];
    for (const id of ids) {
      let r: 内部自动结果;
      try {
        r = (项目 && 名.has(id) ? await 本批已随客户走(id, 本批随客户) : null)
          ?? (项目
            ? await 挑不到就标(id, await 自动分给(me, org, { projectId: id }, null, "营销", 原of(id)))
            : await 自动分给(me, org, { leadId: id }, null, "营销", 原of(id)));
      } catch (e) {
        r = 不在了(e);
      }
      if (r.ok) {
        通知条.push({ toUserId: r.toUserId, [项目 ? "projectId" : "leadId"]: id, ...留下字段(r.留下) });
        if (r.留下) 本批随客户.set(r.留下.customerId, { toUserId: r.toUserId, 接手人: r.接手人 });
      }
      if (!r.ok && r.要标) 标了的.push({ id, ...r.要标 });
      结果.push({ leadId: id, name: 名.get(id) ?? "（看不到这条）", ...对外(r) });
    }
    await 分配通知(me, 通知条, true);
    // 这一次点击合成一条提醒，不按条刷屏：这次标成待分配的发待分配（X-85）；其余因都已满额没分出去的发满额
    // 提醒没发出去不能连累已经分好的结果
    if (标了的.length) {
      const 为什么们 = [...new Set(标了的.map((x) => x.为什么))];
      await 发待分配提醒(org, 标了的.map((x) => x.名), me.name, 为什么们.join("；")).catch((e) => console.error("[待分配提醒] 没发出去", e));
    }
    const 标了ids = new Set(标了的.map((x) => x.id));
    await 发满额提醒(org, 结果.filter((x) => !x.ok && x.都满额 && !标了ids.has(x.leadId)).map((x) => x.name), me.name).catch((e) => console.error("[满额提醒] 没发出去", e));
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
