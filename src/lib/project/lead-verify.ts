/**
 * 企业版线索有效性验证（2026-10-29，P12）：项目停在线索·线索验证时走四步。
 *   1. 销售初判（负责人，能改节点的人）：有效 → 推到 线索推进（照旧走 改节点，门槛照拦）；
 *      还需培育 → 走原来的 MQL 不合格（退回 潜客培育 + 培育计划）；无效 → 要写无效原因，交市场复核。
 *   2. 市场复核（组织里「市场管理」类的人）：判无效 → 结束（线索流失）；判有效 → 回销售终验。
 *   3. 销售终验（负责人）：接受复核 → 推到 线索推进；提交异议（要写说明）→ 交总管理终判。
 *   4. 总管理终判（老板 / 总管理员）：判无效 → 结束；判有效 → 回销售，销售认领继续推，或自己退回公海（算主动退回）。
 * 后台规则「无效线索要市场复核」（默认开）关了、或组织里没有市场管理：销售判无效直接交总管理终判。
 * 判死（市场复核 / 总管理终判判无效）：项目结局记 线索流失（和手动点线索流失同一格「没成」），节点变更留一行带无效原因；
 * 负责人本月自动分配配额 +1（没设配额的不加，见 lead-assign.ts 加一条配额）。
 * 每一步记一行 EntLeadVerifyLog（谁、何时、判了什么、说明），详情页小时间线读它。不是企业版一律拦，一行不写。
 */
import { prisma } from "../prisma";
import { 查完再写 } from "../check-then-write";
import { 看全部 } from "../team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织, 管理员类别们of, type 组织 } from "@/lib/enterprise/org";
import { 规则开着 } from "@/lib/enterprise/rules";
import { 可选项, 选的原因 } from "@/lib/enterprise/dict";
import { 加一条配额 } from "@/lib/enterprise/lead-assign";
import { 改节点, 能改节点, 放回公海 } from "./db";
import { 判MQL, MQL合格去 } from "./mql";
import { 有效线索节点, 无效原因上限 } from "./stage-gates";
export { 无效原因上限 };
import { 原因上限 } from "./nodes";
export { 等复核的, 等复核拦 } from "./lead-verify-guard";

type 谁 = { id: string; role: string };
type 结果 = { ok: true; 自动推到?: string[] } | { ok: false; error: string };

export type 线索判定 = "有效线索" | "暂未判定" | "初验无效" | "无效线索";
export type 待哪步 = "市场复核" | "销售终验" | "总管理终判" | "销售认领";
export type 验证步 = "销售初判" | 待哪步;
export const 说明上限 = 原因上限;
const 开不了 = { ok: false as const, error: "线索验证只在企业版有" };
const 作废 = { ok: false as const, error: "这条线索已经不在「线索验证」了（可能改了进程、点了结局或回了公海），这次复核作废，刷新看看" };

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

/** 这一步谁能拍板。销售两步看 能改节点（负责人、老板、主管、直属上级、总管理员）；市场复核只给市场管理；总管理终判给老板、总管理员 */
export function 能拍板(me: 谁, 步: 验证步, p: { ownerId: string; pooledAt?: Date | null }, org: 组织): boolean {
  if (步 === "市场复核") return 管理员类别们of(org, me.id).has("市场管理");
  if (步 === "总管理终判") return me.role === "ADMIN" || 管理员类别们of(org, me.id).has("总管理员");
  return 能改节点(me, p, org);
}
const 拍不了: Record<验证步, string> = {
  销售初判: "只有项目负责人、老板或主管能判这条线索",
  市场复核: "只有市场管理能复核这条线索",
  销售终验: "只有项目负责人、老板或主管能终验",
  总管理终判: "只有老板或总管理员能终判",
  销售认领: "只有项目负责人、老板或主管能认领",
};

const 字 = (v: unknown, 上限: number) => (typeof v === "string" ? v.trim().slice(0, 上限) : "");

type 项目 = { id: string; name: string; phase: string; node: string; result: string | null; ownerId: string; pooledAt: Date | null; customerId: string };
const 项目列 = { id: true, name: true, phase: true, node: true, result: true, ownerId: true, pooledAt: true, customerId: true } as const;
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

async function 写状态(projectId: string, data: Record<string, unknown>, 痕: { step: 验证步; verdict: string; reason?: string | null; note?: string | null; userId: string }) {
  await 看全部(() => prisma.$transaction([
    prisma.entLeadVerify.upsert({ where: { projectId }, create: { projectId, ...data }, update: data }),
    prisma.entLeadVerifyLog.create({ data: { projectId, ...痕, reason: 痕.reason ?? null, note: 痕.note || null } }),
  ]));
}

/** 判死：项目结局 线索流失（closedAt）、节点变更一行、验证状态 无效线索、负责人本月配额 +1。都在一个事务里，项目先被人动了就作废 */
async function 判死(me: 谁, projectId: string, 步: "市场复核" | "总管理终判", 说明: string, 段: Record<string, unknown>): Promise<结果> {
  return 看全部(() => 查完再写(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: projectId }, select: 项目列 });
    if (!p || !在验证(p)) return 作废;
    const v = await tx.entLeadVerify.findUnique({ where: { projectId } });
    const 现在 = new Date();
    await tx.project.update({ where: { id: p.id }, data: { result: "线索流失", closedAt: 现在 } });
    const 原因 = [v?.invalidReason ? `无效原因：${v.invalidReason}` : "", `${步}判无效`, 说明].filter(Boolean).join("；").slice(0, 原因上限);
    await tx.projectNodeLog.create({
      data: {
        projectId: p.id, userId: me.id,
        fromPhase: p.phase, fromNode: p.node, fromResult: null,
        toPhase: p.phase, toNode: p.node, toResult: "线索流失", reason: 原因,
      },
    });
    const data = { ...段, verdict: "无效线索", finalResult: "无效线索", pending: null };
    await tx.entLeadVerify.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
    await tx.entLeadVerifyLog.create({ data: { projectId, step: 步, verdict: "无效", note: 说明 || null, userId: me.id } });
    await 加一条配额(tx, p.ownerId);
    return { ok: true as const };
  }));
}

/** 无效原因：字典里有启用的无效原因就得从里面选（「其他」要写一句）；字典空着（没配）写一句也行 */
async function 核无效原因(v: unknown): Promise<{ ok: true; 值: string } | { ok: false; error: string }> {
  const 写的 = 字(v, 无效原因上限);
  if (!写的) return { ok: false, error: "判无效要选或写一个无效原因" };
  if (!(await 可选项("invalid")).length) return { ok: true, 值: 写的 };
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
  const { p, org, 待 } = await 读当前(projectId);
  if (!p) return { ok: false, error: "这个项目已经不在了，刷新看看" };
  if (!在验证(p)) return { ok: false, error: `只有停在「${有效线索节点}」的线索能判` };
  if (待) return { ok: false, error: `这条线索在等${待}，不用再判` };
  if (!能拍板(me, "销售初判", p, org)) return { ok: false, error: 拍不了.销售初判 };
  const 说明 = 字(附.verifyNote, 说明上限);
  const 验证人 = { verifiedById: me.id, verifiedAt: now, verifyNote: 说明 || null };
  if (判 === "有效") {
    // 先推进程（门槛不过什么都不写），推成了再记
    const r = await 改节点(me, p.id, { phase: "线索", node: MQL合格去 }, undefined, { 验证放行: true });
    if (!r.ok) return r;
    await 写状态(p.id, { ...清空, ...验证人, invalidReason: null, verdict: "有效线索", finalResult: "有效线索", pending: null }, { step: "销售初判", verdict: "有效", note: 说明, userId: me.id });
    return { ok: true, ...(r.自动推到 ? { 自动推到: r.自动推到 } : {}) };
  }
  if (判 === "还需培育") {
    const r = await 判MQL(me, p.id, false, 附.下一步时间, now, 附.计划内容);
    if (!r.ok) return r;
    await 写状态(p.id, { ...清空, ...验证人, invalidReason: null, verdict: "暂未判定", pending: null }, { step: "销售初判", verdict: "还需培育", note: 说明 || 字(附.计划内容, 说明上限), userId: me.id });
    return { ok: true };
  }
  const 原因 = await 核无效原因(附.invalidReason);
  if (!原因.ok) return 原因;
  const 交给 = await 无效交给(org);
  await 写状态(p.id, { ...清空, ...验证人, invalidReason: 原因.值, verdict: "初验无效", pending: 交给 }, { step: "销售初判", verdict: "无效", reason: 原因.值, note: 说明, userId: me.id });
  return { ok: true };
}

/** 复核两步（市场复核、总管理终判）共用：先核是不是轮到这一步、这人能不能拍板 */
async function 核复核(me: 谁, projectId: string, 步: "市场复核" | "总管理终判") {
  if (!企业版()) return 开不了;
  const { p, org, 待 } = await 读当前(projectId);
  if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
  if (待 !== 步) return { ok: false as const, error: 待 ? `这条线索现在等的是${待}，不是${步}` : "这条线索没在等复核，刷新看看" };
  if (!在验证(p)) return 作废;
  if (!能拍板(me, 步, p, org)) return { ok: false as const, error: 拍不了[步] };
  return { ok: true as const, p };
}

/** 2. 市场复核：有效 → 回销售终验；无效 → 判死 */
export async function 市场复核(me: 谁, projectId: string, 有效: boolean, reviewNote?: unknown): Promise<结果> {
  const 核 = await 核复核(me, projectId, "市场复核");
  if (!核.ok) return 核;
  const 说明 = 字(reviewNote, 说明上限);
  const 段 = { reviewResult: 有效 ? "有效" : "无效", reviewNote: 说明 || null, reviewedById: me.id, reviewedAt: new Date() };
  if (!有效) return 判死(me, 核.p.id, "市场复核", 说明, 段);
  await 写状态(核.p.id, { ...段, pending: "销售终验" }, { step: "市场复核", verdict: "有效", note: 说明, userId: me.id });
  return { ok: true };
}

/** 4. 总管理终判：有效 → 等销售认领或退回公海；无效 → 判死 */
export async function 总管理终判(me: 谁, projectId: string, 有效: boolean, finalNote?: unknown): Promise<结果> {
  const 核 = await 核复核(me, projectId, "总管理终判");
  if (!核.ok) return 核;
  const 说明 = 字(finalNote, 说明上限);
  const 段 = { finalNote: 说明 || null, finalById: me.id, finalAt: new Date() };
  if (!有效) return 判死(me, 核.p.id, "总管理终判", 说明, 段);
  await 写状态(核.p.id, { ...段, verdict: "有效线索", finalResult: "有效线索", pending: "销售认领" }, { step: "总管理终判", verdict: "有效", note: 说明, userId: me.id });
  return { ok: true };
}

/** 销售两步（终验、认领）共用的核 */
async function 核销售(me: 谁, projectId: string, 步: "销售终验" | "销售认领") {
  if (!企业版()) return 开不了;
  const { p, org, 待 } = await 读当前(projectId);
  if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
  if (待 !== 步) return { ok: false as const, error: 待 ? `这条线索现在等的是${待}` : "这条线索没在等你处理，刷新看看" };
  if (!在验证(p)) return 作废;
  if (!能拍板(me, 步, p, org)) return { ok: false as const, error: 拍不了[步] };
  return { ok: true as const, p };
}

/** 3. 销售终验：接受复核 → 推到 线索推进；提交异议（要写说明）→ 交总管理终判 */
export async function 销售终验(me: 谁, projectId: string, 接受: boolean, disputeNote?: unknown): Promise<结果> {
  const 核 = await 核销售(me, projectId, "销售终验");
  if (!核.ok) return 核;
  const 说明 = 字(disputeNote, 说明上限);
  if (接受) {
    const r = await 改节点(me, 核.p.id, { phase: "线索", node: MQL合格去 }, undefined, { 验证放行: true });
    if (!r.ok) return r;
    await 写状态(核.p.id, { salesAck: "接受复核", ackedAt: new Date(), verdict: "有效线索", finalResult: "有效线索", pending: null }, { step: "销售终验", verdict: "接受复核", note: 说明, userId: me.id });
    return { ok: true, ...(r.自动推到 ? { 自动推到: r.自动推到 } : {}) };
  }
  if (!说明) return { ok: false, error: "提交异议要写一句为什么还认为无效" };
  await 写状态(核.p.id, { salesAck: "提交异议", disputeNote: 说明, ackedAt: new Date(), pending: "总管理终判" }, { step: "销售终验", verdict: "提交异议", note: 说明, userId: me.id });
  return { ok: true };
}

/** 总管理判有效之后：认领继续 → 推到 线索推进；退回公海 → 放回公海（不带原因 = 主动退回，客户退回次数 +1） */
export async function 销售认领(me: 谁, projectId: string, 继续: boolean): Promise<结果> {
  const 核 = await 核销售(me, projectId, "销售认领");
  if (!核.ok) return 核;
  if (继续) {
    const r = await 改节点(me, 核.p.id, { phase: "线索", node: MQL合格去 }, undefined, { 验证放行: true });
    if (!r.ok) return r;
    await 写状态(核.p.id, { pending: null }, { step: "销售认领", verdict: "认领继续", userId: me.id });
    return { ok: true, ...(r.自动推到 ? { 自动推到: r.自动推到 } : {}) };
  }
  const r = await 放回公海(me, 核.p.id, undefined, { 验证放行: true });
  if (!r.ok) return r;
  await 写状态(核.p.id, { pending: null }, { step: "销售认领", verdict: "退回公海", userId: me.id });
  return { ok: true };
}

export type 验证痕 = { id: string; step: string; verdict: string; reason: string | null; note: string | null; 谁: string; at: string };
export type 线索验证 = {
  判定: string; 待: 待哪步 | null; 无效原因: string | null;
  复核结果: string | null; 最终结果: string | null;
  /** 我现在能做的：初判 / 终验 / 认领；复核两步在列表的「待复核的线索」里 */
  我能: "初判" | "销售终验" | "销售认领" | "市场复核" | "总管理终判" | null;
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
  const 待 = 实际待(v?.pending ?? null, await 无效交给(org));
  const 名 = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(痕.map((l) => l.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  let 我能: 线索验证["我能"] = null;
  if (在验证(p)) {
    if (!待) 我能 = 能拍板(me, "销售初判", p, org) ? "初判" : null;
    else 我能 = 能拍板(me, 待, p, org) ? 待 : null;
  }
  return {
    判定: v?.verdict ?? "暂未判定", 待, 无效原因: v?.invalidReason ?? null,
    复核结果: v?.reviewResult ?? null, 最终结果: v?.finalResult ?? null, 我能,
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
