/**
 * 企业版线索有效性验证（2026-10-29，P12）：项目停在线索·线索验证时走四步。
 *   1. 销售初判（负责人，能改节点的人）：有效 → 推到 线索推进（照旧走 改节点，门槛照拦）；
 *      还需培育 → 走原来的 MQL 不合格（退回 潜客培育 + 培育计划）；无效 → 要写无效原因，交市场复核。
 *   2. 市场复核（组织里「市场管理」类的人）：判无效 → 结束（线索流失）；判有效 → 回销售终验。
 *   3. 销售终验（负责人）：接受复核 → 推到 线索推进；提交异议（要写说明）→ 交总管理终判。
 *   4. 总管理终判（老板 / 总管理员）：判无效 → 结束；判有效 → 回销售，销售认领继续推，或自己退回公海（算主动退回）。
 * 后台规则「无效线索要市场复核」（默认开）关了、或组织里没有市场管理：销售判无效直接交总管理终判。
 * 判死（市场复核 / 总管理终判判无效）：项目结局记 线索流失（和手动点线索流失同一格「没成」），节点变更留一行带无效原因；
 * 负责人占过额度的（这条线索上有他算数的分配记录）本月自动分配配额 +1，没占过的、没设配额的不加（见 lead-assign.ts 占过名额、加一条配额）。
 * 每一步记一行 EntLeadVerifyLog（谁、何时、判了什么、说明），详情页小时间线读它。不是企业版一律拦，一行不写。
 */
import { prisma } from "../prisma";
import { 查完再写 } from "../check-then-write";
import { 看全部 } from "../team-scope";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织, 管理员类别们of, 能市场复核, type 组织 } from "@/lib/enterprise/org";
import { 规则开着 } from "@/lib/enterprise/rules";
import { 读市场成员们 } from "@/lib/enterprise/market-db";
import { 可选项, 选的原因 } from "@/lib/enterprise/dict";
import { 加一条配额, 占过名额 } from "@/lib/enterprise/lead-assign";
import { 客户状态自动, 跟着项目重算 } from "@/lib/enterprise/cust-status-auto-db";
import { 改节点, 能改节点, 放回公海 } from "./db";
import { 是总管理 } from "@/lib/enterprise/permissions";
import { 待分配占位, 待分配不能动 } from "@/lib/enterprise/await-assign";
import { 判MQL, MQL合格去 } from "./mql";
import { 有效线索节点 } from "./stage-gates";
import { 生效组织规则 } from "./org-rules-store";
import { 原因上限 } from "./nodes";

type 谁 = { id: string; role: string };
type 结果 = { ok: true; 自动推到?: string[] } | { ok: false; error: string };

export type 待哪步 = "市场复核" | "销售终验" | "总管理终判" | "销售认领";
export type 验证步 = "销售初判" | 待哪步;
/** 痕里的步：四步之外还有撤回验证 */
type 痕步 = 验证步 | "撤回验证";
export const 说明上限 = 原因上限;
const 开不了 = { ok: false as const, error: "线索验证只在企业版有" };
const 作废 = { ok: false as const, error: "这条线索已经不在「线索验证」了（可能改了进程、点了结局或回了公海），这次复核作废，刷新看看" };
/** 同一步两个人前后脚判（X-81，M-线索-02）：后到的写不进去，回这句，不盖先到的 */
const 判过了 = { ok: false as const, error: "这条线索已被别人判过，刷新看看" };

/** 组织里有没有在职的「市场管理」 */
export function 有市场管理(org: 组织): boolean {
  for (const id of org.成员.keys()) if (管理员类别们of(org, id).has("市场管理")) return true;
  return false;
}

/** 销售判无效交给谁：规则开着且组织里有市场管理 → 市场复核，不然 → 总管理终判 */
export async function 无效交给(org: 组织): Promise<"市场复核" | "总管理终判"> {
  return (await 规则开着("市场复核")) && 有市场管理(org) ? "市场复核" : "总管理终判";
}

/** 存着「市场复核」但规则后来关了、或市场管理都走了：按总管理终判算，不让它卡死 */
export function 实际待(存的: string | null, 交给: "市场复核" | "总管理终判"): 待哪步 | null {
  if (!存的) return null;
  return 存的 === "市场复核" && 交给 !== "市场复核" ? "总管理终判" : (存的 as 待哪步);
}

/**
 * 创建人是销售（业务角色 销售成员 / 销售管理）：线索验证初判即终判（11-01 定）——判有效、判无效都不再走市场复核、总管理终判，
 * 直接按销售初判算最终结果。创建人不在组织里了（离职）按不是算，照旧走复核；
 * 创建人算市场成员（市场部门里的、逐人设的）也按不是算——角色挂着销售、人在市场试岗的照旧走复核
 */
export function 创建人是销售(org: 组织, creatorId: string, 市场: ReadonlySet<string> = new Set()): boolean {
  if (市场.has(creatorId)) return false;
  const 们 = org.成员.get(creatorId)?.角色们 ?? [];
  return 们.includes("sales") || 们.includes("sales_mgr");
}

/** 这一步谁能拍板。销售两步看 能改节点（企业版只有负责人本人，C2）；市场复核给建线索的人或他的直属市场管理（11-05，能市场复核）；
 *  总管理终判给老板、总管理员。待分配期间占着负责人一格的建的人不能初判、终验、认领（P-转-21、X-68） */
export function 能拍板(me: 谁, 步: 验证步, p: { ownerId: string; creatorId?: string | null; pooledAt?: Date | null; awaitAssignAt?: Date | null }, org: 组织): boolean {
  if (步 === "市场复核") return 能市场复核(org, me.id, p);
  if (步 === "总管理终判") return 是总管理(me, org);
  return 能改节点(me, p, org) && !待分配占位(me, p);
}
const 拍不了: Record<验证步, string> = {
  销售初判: "只有项目负责人、老板或主管能判这条线索",
  市场复核: "只有建这条线索的人或他的直属市场管理能复核；没有直属市场管理的由系统总管理复核",
  销售终验: "只有项目负责人、老板或主管能终验",
  总管理终判: "只有老板或总管理员能终判",
  销售认领: "只有项目负责人、老板或主管能认领",
};

const 字 = (v: unknown, 上限: number) => (typeof v === "string" ? v.trim().slice(0, 上限) : "");

type 项目 = { id: string; name: string; phase: string; node: string; result: string | null; ownerId: string; creatorId: string; pooledAt: Date | null; awaitAssignAt: Date | null; customerId: string };
const 项目列 = { id: true, name: true, phase: true, node: true, result: true, ownerId: true, creatorId: true, pooledAt: true, awaitAssignAt: true, customerId: true } as const;
const 在验证 = (p: 项目) => p.phase === "线索" && p.node === 有效线索节点 && !p.result && !p.pooledAt;

/** 读项目 + 验证状态 + 现在实际等哪步（看全部：复核的人多半看不到这位销售的项目） */
async function 读当前(projectId: unknown) {
  const id = String(projectId ?? "");
  const [p, v, org] = await 看全部(() => Promise.all([
    prisma.project.findUnique({ where: { id }, select: 项目列 }),
    prisma.entLeadVerify.findUnique({ where: { projectId: id } }),
    读组织(),
  ]));
  const 交给 = await 无效交给(org);
  return { p, v, org, 交给, 待: 实际待(v?.pending ?? null, 交给) };
}

/** 新一轮初判把上一轮的复核、终验、终判都清掉（项目退回去又走到线索验证会再判一次） */
const 清空 = {
  reviewResult: null, reviewNote: null, reviewedById: null, reviewedAt: null,
  salesAck: null, disputeNote: null, ackedAt: null,
  finalResult: null, finalNote: null, finalById: null, finalAt: null,
};

/** 判的人核步骤时读到的验证状态（没有这一行 = null）。写的时候拿它当条件：这期间别人判过，pending / updatedAt 就变了 */
type 读到 = { pending: string | null; updatedAt: Date } | null;
const 快照 = (v: { pending: string | null; updatedAt: Date } | null): 读到 => (v ? { pending: v.pending, updatedAt: v.updatedAt } : null);
type 事务 = Parameters<Parameters<typeof 查完再写>[0]>[0];

/**
 * 在事务里抢这一步（X-81）：只有验证状态还是核的时候读到的那样（等的步没变、没被别人写过）才写，命中 0 行 = 别人先判了。
 * 没有这一行的（第一次初判）：事务里再看一眼，已经有了就是别人先建的
 */
async function 抢这一步(tx: 事务, projectId: string, 读: 读到, data: Record<string, unknown>): Promise<boolean> {
  if (!读) {
    if (await tx.entLeadVerify.findUnique({ where: { projectId }, select: { projectId: true } })) return false;
    await tx.entLeadVerify.create({ data: { projectId, ...data } });
    return true;
  }
  const r = await tx.entLeadVerify.updateMany({ where: { projectId, pending: 读.pending, updatedAt: 读.updatedAt }, data });
  return r.count === 1;
}

/** 项目已经不在线索验证了：是别人这一步先判死的（验证状态跟着变了）回「已被别人判过」，不然（改了进程、点了结局、回了公海）照旧作废 */
async function 不在验证(tx: 事务, projectId: string, 读: 读到) {
  const 还在 = 读
    ? await tx.entLeadVerify.count({ where: { projectId, pending: 读.pending, updatedAt: 读.updatedAt } })
    : 1 - (await tx.entLeadVerify.count({ where: { projectId } }));
  return 还在 ? 作废 : 判过了;
}

/**
 * 写验证状态 + 痕，一个事务：先抢这一步，抢不到回「已被别人判过」、一行不写。
 * 核项目：这一步前面没推进程的（初判交复核、复核判有效、提交异议、终判判有效），事务里再看一眼项目还在线索验证
 */
async function 写状态(projectId: string, 读: 读到, data: Record<string, unknown>, 痕: { step: 痕步; verdict: string; reason?: string | null; note?: string | null; userId: string }, 核项目 = false): Promise<结果> {
  return 看全部(() => 查完再写(async (tx) => {
    if (核项目) {
      const p = await tx.project.findUnique({ where: { id: projectId }, select: 项目列 });
      if (!p || !在验证(p)) return 不在验证(tx, projectId, 读);
    }
    if (!(await 抢这一步(tx, projectId, 读, data))) return 判过了;
    await tx.entLeadVerifyLog.create({ data: { projectId, ...痕, reason: 痕.reason ?? null, note: 痕.note || null } });
    return { ok: true as const };
  }));
}

/**
 * 判死：项目结局 线索流失（closedAt）、节点变更一行、验证状态 无效线索、占过额度的负责人本月配额 +1。都在一个事务里，项目先被人动了就作废。
 * 先抢这一步（X-81）：别人先判过（复核判了有效、另一位也判了无效、初判已交了复核）回「已被别人判过」，项目一点不动——
 * 原来先改项目再核，核不过 return 了事务照样提交，项目白白流失。
 * 销售初判直接判死（创建人是销售）：带上这次的无效原因，不加配额——不是分来的线索，不补名额
 */
async function 判死(me: 谁, projectId: string, 读: 读到, 步: "销售初判" | "市场复核" | "总管理终判", 说明: string, 段: Record<string, unknown>): Promise<结果> {
  const 状态开 = await 客户状态自动();
  return 看全部(() => 查完再写(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: projectId }, select: 项目列 });
    if (!p || !在验证(p)) return 不在验证(tx, projectId, 读);
    const v = await tx.entLeadVerify.findUnique({ where: { projectId }, select: { invalidReason: true } });
    if (!(await 抢这一步(tx, projectId, 读, { ...段, verdict: "无效线索", finalResult: "无效线索", pending: null }))) return 判过了;
    const 现在 = new Date();
    await tx.project.update({ where: { id: p.id }, data: { result: "线索流失", closedAt: 现在 } });
    const 无效原因 = 步 === "销售初判" ? (段.invalidReason as string) : v?.invalidReason;
    const 原因 = [无效原因 ? `无效原因：${无效原因}` : "", 步 === "销售初判" ? "负责人初判无效（创建人是销售，初判即终判）" : `${步}判无效`, 说明].filter(Boolean).join("；").slice(0, 原因上限);
    await tx.projectNodeLog.create({
      data: {
        projectId: p.id, userId: me.id,
        fromPhase: p.phase, fromNode: p.node, fromResult: null,
        toPhase: p.phase, toNode: p.node, toResult: "线索流失", reason: 原因,
      },
    });
    await tx.entLeadVerifyLog.create({ data: { projectId, step: 步, verdict: "无效", reason: 步 === "销售初判" ? 无效原因 : null, note: 说明 || null, userId: me.id } });
    if (步 !== "销售初判" && (await 占过名额(tx, p.id, p.ownerId))) await 加一条配额(tx, p.ownerId);
    await 跟着项目重算(tx, 状态开, [p.customerId]);
    return { ok: true as const };
  }));
}

/** 无效原因：字典里有启用的无效原因就得从里面选（「其他」要写一句）；字典空着（没配）写一句也行（字数上限看组织规则，默认不设） */
async function 核无效原因(v: unknown): Promise<{ ok: true; 值: string } | { ok: false; error: string }> {
  const 写的 = 字(v, Infinity);
  if (!写的) return { ok: false, error: "判无效要选或写一个无效原因" };
  if (!(await 可选项("invalid")).length) {
    // 自由写的字数上限按组织规则（M-节点-03）：数据交接期默认不设，管理员设了才拦（原来写死 200、超了悄悄截掉）
    const 上限 = (await 生效组织规则()).阶段.无效原因上限;
    if (上限 !== null && 写的.length > 上限) return { ok: false, error: `无效原因最多 ${上限} 个字` };
    return { ok: true, 值: 写的 };
  }
  const 选 = await 选的原因("invalid", 写的);
  if (!选.ok) return 选;
  return { ok: true, 值: 选.值 ?? 写的 };
}

export type 初判 = "有效" | "无效" | "还需培育";

/** 1. 销售初判 */
export async function 销售初判(
  me: 谁, projectId: string, 判: 初判,
  附: { invalidReason?: unknown; verifyNote?: unknown; 下一步时间?: string | null; 计划内容?: string | null } = {},
  now: Date = new Date(),
): Promise<结果> {
  if (!企业版()) return 开不了;
  if (判 !== "有效" && 判 !== "无效" && 判 !== "还需培育") return { ok: false, error: "请选有效、无效或还需培育" };
  const { p, v, org, 待 } = await 读当前(projectId);
  const 读 = 快照(v);
  if (!p) return { ok: false, error: "这个项目已经不在了，刷新看看" };
  if (!在验证(p)) return { ok: false, error: `只有停在「${有效线索节点}」的线索能判` };
  if (待) return { ok: false, error: `这条线索在等${待}，不用再判` };
  if (待分配占位(me, p)) return { ok: false, error: 待分配不能动 };
  if (!能拍板(me, "销售初判", p, org)) return { ok: false, error: 拍不了.销售初判 };
  const 说明 = 字(附.verifyNote, 说明上限);
  const 验证人 = { verifiedById: me.id, verifiedAt: now, verifyNote: 说明 || null };
  if (判 === "有效") {
    // 先推进程（门槛不过什么都不写），推成了再记
    const r = await 改节点(me, p.id, { phase: "线索", node: MQL合格去 }, undefined, { 验证放行: true });
    if (!r.ok) return r;
    const w = await 写状态(p.id, 读, { ...清空, ...验证人, invalidReason: null, verdict: "有效线索", finalResult: "有效线索", pending: null }, { step: "销售初判", verdict: "有效", note: 说明, userId: me.id });
    if (!w.ok) return w;
    return { ok: true, ...(r.自动推到 ? { 自动推到: r.自动推到 } : {}) };
  }
  if (判 === "还需培育") {
    const r = await 判MQL(me, p.id, false, 附.下一步时间, now, 附.计划内容);
    if (!r.ok) return r;
    return 写状态(p.id, 读, { ...清空, ...验证人, invalidReason: null, verdict: "暂未判定", pending: null }, { step: "销售初判", verdict: "还需培育", note: 说明 || 字(附.计划内容, 说明上限), userId: me.id });
  }
  const 原因 = await 核无效原因(附.invalidReason);
  if (!原因.ok) return 原因;
  if (创建人是销售(org, p.creatorId, await 读市场成员们(org))) return 判死(me, p.id, 读, "销售初判", 说明, { ...清空, ...验证人, invalidReason: 原因.值 });
  const 交给 = await 无效交给(org);
  return 写状态(p.id, 读, { ...清空, ...验证人, invalidReason: 原因.值, verdict: "初验无效", pending: 交给 }, { step: "销售初判", verdict: "无效", reason: 原因.值, note: 说明, userId: me.id }, true);
}

/** 复核两步（市场复核、总管理终判）共用：先核是不是轮到这一步、这人能不能拍板 */
async function 核复核(me: 谁, projectId: string, 步: "市场复核" | "总管理终判") {
  if (!企业版()) return 开不了;
  const { p, v, org, 待 } = await 读当前(projectId);
  if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
  if (待 !== 步) return { ok: false as const, error: 待 ? `这条线索现在等的是${待}，不是${步}` : "这条线索没在等复核，刷新看看" };
  if (!在验证(p)) return 作废;
  if (!能拍板(me, 步, p, org)) return { ok: false as const, error: 拍不了[步] };
  return { ok: true as const, p, 读: 快照(v) };
}

/** 2. 市场复核：有效 → 回销售终验；无效 → 判死 */
export async function 市场复核(me: 谁, projectId: string, 有效: boolean, reviewNote?: unknown): Promise<结果> {
  const 核 = await 核复核(me, projectId, "市场复核");
  if (!核.ok) return 核;
  const 说明 = 字(reviewNote, 说明上限);
  const 段 = { reviewResult: 有效 ? "有效" : "无效", reviewNote: 说明 || null, reviewedById: me.id, reviewedAt: new Date() };
  if (!有效) return 判死(me, 核.p.id, 核.读, "市场复核", 说明, 段);
  return 写状态(核.p.id, 核.读, { ...段, pending: "销售终验" }, { step: "市场复核", verdict: "有效", note: 说明, userId: me.id }, true);
}

/** 4. 总管理终判：有效 → 等销售认领或退回公海；无效 → 判死 */
export async function 总管理终判(me: 谁, projectId: string, 有效: boolean, finalNote?: unknown): Promise<结果> {
  const 核 = await 核复核(me, projectId, "总管理终判");
  if (!核.ok) return 核;
  const 说明 = 字(finalNote, 说明上限);
  const 段 = { finalNote: 说明 || null, finalById: me.id, finalAt: new Date() };
  if (!有效) return 判死(me, 核.p.id, 核.读, "总管理终判", 说明, 段);
  return 写状态(核.p.id, 核.读, { ...段, verdict: "有效线索", finalResult: "有效线索", pending: "销售认领" }, { step: "总管理终判", verdict: "有效", note: 说明, userId: me.id }, true);
}

/** 销售两步（终验、认领）共用的核 */
async function 核销售(me: 谁, projectId: string, 步: "销售终验" | "销售认领") {
  if (!企业版()) return 开不了;
  const { p, v, org, 待 } = await 读当前(projectId);
  if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
  if (待 !== 步) return { ok: false as const, error: 待 ? `这条线索现在等的是${待}` : "这条线索没在等你处理，刷新看看" };
  if (!在验证(p)) return 作废;
  if (待分配占位(me, p)) return { ok: false as const, error: 待分配不能动 };
  if (!能拍板(me, 步, p, org)) return { ok: false as const, error: 拍不了[步] };
  return { ok: true as const, p, 读: 快照(v) };
}

/** 3. 销售终验：接受复核 → 推到 线索推进；提交异议（要写说明）→ 交总管理终判 */
export async function 销售终验(me: 谁, projectId: string, 接受: boolean, disputeNote?: unknown): Promise<结果> {
  const 核 = await 核销售(me, projectId, "销售终验");
  if (!核.ok) return 核;
  const 说明 = 字(disputeNote, 说明上限);
  if (接受) {
    const r = await 改节点(me, 核.p.id, { phase: "线索", node: MQL合格去 }, undefined, { 验证放行: true });
    if (!r.ok) return r;
    const w = await 写状态(核.p.id, 核.读, { salesAck: "接受复核", ackedAt: new Date(), verdict: "有效线索", finalResult: "有效线索", pending: null }, { step: "销售终验", verdict: "接受复核", note: 说明, userId: me.id });
    if (!w.ok) return w;
    return { ok: true, ...(r.自动推到 ? { 自动推到: r.自动推到 } : {}) };
  }
  if (!说明) return { ok: false, error: "提交异议要写一句为什么还认为无效" };
  return 写状态(核.p.id, 核.读, { salesAck: "提交异议", disputeNote: 说明, ackedAt: new Date(), pending: "总管理终判" }, { step: "销售终验", verdict: "提交异议", note: 说明, userId: me.id }, true);
}

/** 总管理判有效之后：认领继续 → 推到 线索推进；退回公海 → 放回公海（不带原因 = 主动退回，客户退回次数 +1） */
export async function 销售认领(me: 谁, projectId: string, 继续: boolean): Promise<结果> {
  const 核 = await 核销售(me, projectId, "销售认领");
  if (!核.ok) return 核;
  if (继续) {
    const r = await 改节点(me, 核.p.id, { phase: "线索", node: MQL合格去 }, undefined, { 验证放行: true });
    if (!r.ok) return r;
    const w = await 写状态(核.p.id, 核.读, { pending: null }, { step: "销售认领", verdict: "认领继续", userId: me.id });
    if (!w.ok) return w;
    return { ok: true, ...(r.自动推到 ? { 自动推到: r.自动推到 } : {}) };
  }
  // 进公海那一笔把验证状态清了（进公海清验证，9f）：这一步只留痕，时间记在放回之前，排在「进公海清验证」那行前面
  const 时 = new Date();
  const r = await 放回公海(me, 核.p.id, undefined, { 验证放行: true });
  if (!r.ok) return r;
  await 看全部(() => prisma.entLeadVerifyLog.create({ data: { projectId: 核.p.id, step: "销售认领", verdict: "退回公海", userId: me.id, at: 时 } }));
  return { ok: true };
}

/** 撤回验证（X-77「验证中不能改派，要改先撤回验证」）：提交验证的人（初判无效交复核的那位）、系统管理员能撤 */
function 能撤回(me: 谁, v: { pending: string | null; verifiedById: string | null } | null, org: 组织): boolean {
  return !!v?.pending && (v.verifiedById === me.id || 是总管理(me, org));
}

/**
 * 撤回验证：验证中（pending 有值）的线索回到提交验证前（暂未判定、不在等哪步，初判、复核、终验、终判那几格都清掉），
 * 项目本身不动（交复核那一步没动过项目），留一行痕「撤回验证」。之后能改派，也能重新初判。
 * 和别人判同一步前后脚：抢这一步，后到的回「已被别人判过」
 */
export async function 撤回验证(me: 谁, projectId: string): Promise<结果> {
  if (!企业版()) return 开不了;
  // 回收站里的项目也能撤（恢复要换负责人、验证中拦着，回收站那头先撤再恢复）
  return 看已删(() => 撤回这条(me, projectId));
}
async function 撤回这条(me: 谁, projectId: string): Promise<结果> {
  const { p, v, org, 待 } = await 读当前(projectId);
  if (!p) return { ok: false, error: "这个项目已经不在了，刷新看看" };
  if (!v?.pending || !待) return { ok: false, error: "这条线索没在验证中，不用撤回，刷新看看" };
  if (!能撤回(me, v, org)) return { ok: false, error: "只有提交验证的人或系统管理员能撤回验证" };
  return 写状态(p.id, 快照(v), {
    ...清空, verdict: "暂未判定", pending: null, invalidReason: null, verifyNote: null, verifiedById: null, verifiedAt: null,
  }, { step: "撤回验证", verdict: "撤回", note: `撤回前等${待}`, userId: me.id });
}

export type 验证痕 = { id: string; step: string; verdict: string; reason: string | null; note: string | null; 谁: string; at: string };
export type 线索验证 = {
  判定: string; 待: 待哪步 | null; 无效原因: string | null;
  复核结果: string | null; 最终结果: string | null;
  /** 负责人终验的结果：接受复核 / 提交异议（没到这步 null） */
  终验: string | null;
  /** 项目创建人是销售：初判即终判，判无效不再交复核（11-01） */
  初判即终判: boolean;
  /** 眼下销售判无效会交给哪一步（规则「市场复核」关了、或没有市场管理 → 总管理终判）；初判弹窗按它说（11-03 D-A4-1） */
  无效交给?: "市场复核" | "总管理终判";
  /** 项目卡「线索验证」右边显示的结果（11-01）：暂未验证 / 初验无效 / 复核有效 / 终验无效 / 有效线索 / 无效线索 */
  叫法: 验证结果叫法;
  /** 我现在能做的：初判 / 终验 / 认领；复核两步在列表的「待复核的线索」里 */
  我能: "初判" | "销售终验" | "销售认领" | "市场复核" | "总管理终判" | null;
  /** 我能撤回验证（验证中，我是提交验证的人或系统管理员，X-77） */
  能撤回?: boolean;
  痕: 验证痕[];
};

/** 详情页读：验证状态 + 时间线 + 我现在能做哪一步。不是企业版 null */
export async function 读线索验证(me: 谁, p: 项目): Promise<线索验证 | null> {
  if (!企业版()) return null;
  const [v, 痕, org] = await 看全部(() => Promise.all([
    prisma.entLeadVerify.findUnique({ where: { projectId: p.id } }),
    prisma.entLeadVerifyLog.findMany({ where: { projectId: p.id }, orderBy: { at: "asc" } }),
    读组织(),
  ]));
  const 交给 = await 无效交给(org);
  const 待 = 实际待(v?.pending ?? null, 交给);
  const 名 = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(痕.map((l) => l.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  let 我能: 线索验证["我能"] = null;
  if (在验证(p)) {
    if (!待) 我能 = 能拍板(me, "销售初判", p, org) ? "初判" : null;
    else 我能 = 能拍板(me, 待, p, org) ? 待 : null;
  }
  const 判定 = v?.verdict ?? "暂未判定";
  const 终验 = v?.salesAck ?? null;
  const 叫法 = 验证结果叫法({ 判定, 待, 终验 });
  return {
    // 最后判成有效线索：当初初判写的无效原因不再挂在结果旁边（痕里照留）
    判定, 待, 无效原因: 叫法 === "有效线索" ? null : v?.invalidReason ?? null, 叫法,
    复核结果: v?.reviewResult ?? null, 最终结果: v?.finalResult ?? null, 终验, 初判即终判: 创建人是销售(org, p.creatorId, await 读市场成员们(org)), 无效交给: 交给, 我能, 能撤回: !!待 && 能撤回(me, v ?? null, org),
    痕: 痕.map((l) => ({ id: l.id, step: l.step, verdict: l.verdict, reason: l.reason, note: l.note, 谁: 名.get(l.userId) ?? "已不在的成员", at: l.at.toISOString() })),
  };
}

export type 待复核项 = {
  projectId: string; 项目: string; 负责人: string; 步: 待哪步;
  无效原因: string | null; 初判说明: string | null; 复核说明: string | null; 异议说明: string | null; 更新于: Date;
};

/** 列表顶上的「待复核的线索」：我能拍板的那几条（市场复核、总管理终判，以及我负责的销售终验、销售认领）。不是企业版空 */
export async function 待我复核的(me: 谁): Promise<待复核项[]> {
  if (!企业版()) return [];
  return 看全部(async () => {
    const [行, org] = await Promise.all([
      prisma.entLeadVerify.findMany({
        where: { pending: { not: null }, project: { phase: "线索", node: 有效线索节点, result: null, pooledAt: null } },
        include: { project: { select: 项目列 } },
        orderBy: { updatedAt: "asc" },
        take: 200,
      }),
      读组织(),
    ]);
    const 交给 = await 无效交给(org);
    const 人 = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(行.map((v) => v.project.ownerId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const 出: 待复核项[] = [];
    for (const v of 行) {
      const 步 = 实际待(v.pending, 交给);
      if (!步) continue;
      // 销售两步只给负责人本人看（老板、主管在详情页也能代办，列表不堆给他们）
      if (步 === "销售终验" || 步 === "销售认领" ? v.project.ownerId !== me.id : !能拍板(me, 步, v.project, org)) continue;
      出.push({
        projectId: v.projectId, 项目: v.project.name, 负责人: 人.get(v.project.ownerId) ?? "", 步,
        无效原因: v.invalidReason, 初判说明: v.verifyNote, 复核说明: v.reviewNote, 异议说明: v.disputeNote, 更新于: v.updatedAt,
      });
    }
    return 出;
  });
}

export type 验证结果叫法 = "暂未验证" | "初验无效" | "复核有效" | "终验无效" | "有效线索" | "无效线索";
/**
 * 项目卡上「线索验证」右边那个结果（11-01 客户定的六个叫法）：
 * 等复核 = 初验无效；复核判有效、等负责人确认 = 复核有效；负责人提交异议、等最终确认 = 终验无效；
 * 定了的按最终结果（有效线索 / 无效线索）；没判过、还需培育 = 暂未验证
 */
export function 验证结果叫法(v: Pick<线索验证, "判定" | "待" | "终验">): 验证结果叫法 {
  if (v.待 === "市场复核") return "初验无效";
  if (v.待 === "销售终验") return "复核有效";
  if (v.待 === "总管理终判") return v.终验 === "提交异议" ? "终验无效" : "初验无效";
  if (v.判定 === "有效线索") return "有效线索";
  if (v.判定 === "无效线索") return "无效线索";
  if (v.判定 === "初验无效") return "初验无效";
  return "暂未验证";
}
