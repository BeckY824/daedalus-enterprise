/**
 * 企业版项目合并 · 数据层（合并客户第二批 2a：同负责人的两个项目合并；规划 merge-customer-b2 第「同负责人的两个项目怎么并」节，客户 E-280 二）。
 *
 * 同一位客户名下、同一位负责人的两个线索：被并掉的那个（B）挂着的沟通、附件、录音点评、项目联系人、关联客户、没解决的卡点改指留下的那个（A），
 * B 本身结束为「重复线索」（结局线索流失 + 线索验证终判无效线索 + 无效原因重复线索），系统直接记、不走复核、不退还已占线索名额。
 * 合并单照第一批记在 EntCustomerMerge（kind = 项目，fromId = B、intoId = A），明细记下每一行挪了什么，30 天内只撤这一单。
 *
 *   挪：FollowUpProject / EntFollowUpMark / EntFollowUpMeta / Attachment / EntCoachRecording / EntCoachTopic / 没解决的 EntBlocker / 老商机对照（EntExternalRef entity = opportunity）
 *   挪 + 去重：ProjectContact、ProjectCustomer（A 已有同一位的，B 那行删掉、整行记进明细，撤回建回）
 *   组员不并（客户 E-331 必改 3「被并掉那个项目的组员关系随项目结束、留痕，不并进留下项目」）：ProjectMember 一行不动，B 当时的组员名单记进合并单明细和操作日志
 *   不挪：节点变更、线索验证结论和记录、分配 / 放弃 / 待补、回复逾期、必填拦截、冷项目标记、B 自己的资料格；回款提成不会有（前提拦住）
 * 合并本身不算一次跟进：A 的下一步时间、回复逾期都不碰，只重算客户最近跟进、客户状态、三态。
 *
 * 撤回（照第一批 customer-merge.ts 撤回合并）：只比合并写过的格，还是合并写下的才改回，对不上的记进「没还原」。
 * 谁能撤：合并的人（A 仍归他、不在公海）或系统管理员；30 天内；两个项目都不在回收站；A 没再并进别的项目（先撤那次）。
 * 整单撤回客户合并时，之后单独并过的项目先撤（撤回合并 调 在事务里撤回项目合并，「先拆后撤」）。
 */
import type { PrismaClient, Prisma } from "@/generated/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "./soft-delete-core";
import { 企业版 } from "./switch";
import { 字段权限of } from "./field-perm";
import { 权限组织, type 组织 } from "./org";
import { 是系统管理员, 只读角色, 只看的人 } from "./permissions";
import { 交接中的客户, 离职交接中的项目 } from "./handover-db";
import { 跟着项目重算, 客户状态自动, 重复线索名们 } from "./cust-status-auto-db";
import { 存沟通后重算三态 } from "./tri-state-db";
import { notify } from "./notify";
import { 忘掉企业版范围 } from "./visibility";
import { 拦下, 合并事务选项, 并发失败话, 重算最近跟进, 读没还原, type 合并人, type 没还原 } from "./customer-merge";
import { 项目有未裁定异议 } from "./objection-guard";
import { 记项目合并异议入口 } from "./objection";
import { 终止合并异议, 通知合并异议终止 } from "./objection-merge";
import { 异议链接, 异议期天数 } from "./objection-core";
import type { EntTransferObjection } from "@/generated/prisma";
import { 项目单, 项目合并撤回天数, 项目合并单们, 项目合并验证步 } from "./project-merge-guard";
import { 生效的合同状态 } from "@/lib/project/proj-fields";
import { 在潜客培育, 培育计划来源, 撤培育计划 } from "@/lib/project/nurture-plan";
import { 短时刻 } from "@/lib/project/time-fields";
import { 实际待, 无效交给 } from "@/lib/project/lead-verify";
import { 占过名额 } from "./lead-assign";
import { 记并走待补, 作废并走待补 } from "./invalid-makeup";

export { 项目单, 项目合并撤回天数, 项目合并验证步 };
type 库 = PrismaClient;
type Tx = Prisma.TransactionClient;
type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const 项目合并通知种类 = "合并项目";
/** 撤回项目合并时给被并掉的项目在线索验证记录里留的那一步（EntLeadVerifyLog.step）；合并那一步「项目合并验证步」在 project-merge-guard */
export const 撤回项目合并验证步 = "撤回项目合并";
/** 过了撤回期限的那句：撤回拦话、历史变更「不能撤因」、项目详情顶上「已并入」那一行都用这一句（天数引 项目合并撤回天数） */
export const 项目合并撤回过期话 = `合并已超过 ${项目合并撤回天数} 天，不能撤回`;

/* ───────────────────────── 读两个项目 ───────────────────────── */

const 项目列 = {
  id: true, name: true, customerId: true, ownerId: true, creatorId: true, phase: true, node: true, result: true, closedAt: true,
  pooledAt: true, awaitAssignAt: true, deletedAt: true, channelId: true, bizLine: true, contractStatus: true, channel: { select: { channelOwnerId: true } },
} satisfies Prisma.ProjectSelect;
export type 项目行 = Prisma.ProjectGetPayload<{ select: typeof 项目列 }>;

export async function 读项目(db: Pick<Tx, "project">, id: string, 连删的 = false): Promise<项目行 | null> {
  return 看全部(() => db.project.findFirst({ where: { id, ...(连删的 ? {} : { deletedAt: null }) }, select: 项目列 }));
}
const 名 = (p: Pick<项目行, "name">) => p.name || "未命名项目";
const 有值 = (v: unknown) => v !== null && v !== undefined && v !== "";

/* ───────────────────────── 能不能并 ───────────────────────── */

/**
 * 待客户回复的第 6 件（留下的项目能不能是商机 / 订单）：先按规划默认，两个都限线索阶段、没有回款、没有提成行。
 * 客户回复要放宽留下的那个，只改这里：能并的阶段.留下 加上「商机」「订单」，留下的 钱也能有 改成 true。
 */
export const 能并的阶段: Record<"留下" | "并掉", readonly string[]> = { 留下: ["线索"], 并掉: ["线索"] };
const 钱也能有: Record<"留下" | "并掉", boolean> = { 留下: false, 并掉: false };
/** 已签合同（合同状态 = 已生效，proj-fields 生效的合同状态）：两边都拦（客户 E-331 必改 1）。开票库里没有字段，不判 */
export const 已签合同的项目不能合并 = "已签合同的项目不能合并";
export const 签了合同 = (p: { contractStatus?: string | null }) => p.contractStatus === 生效的合同状态;
/** 候选里灰着列的那句：留下的那个到了商机 / 订单（能并的阶段.留下 之外），客户 E-331 必改 5「别让人以为功能坏了」 */
export const 到商机订单不能合并 = "到商机 / 订单的项目暂不能合并";
export function 阶段和钱拦(p: Pick<项目行, "name" | "phase"> & { contractStatus?: string | null }, 角色: "留下" | "并掉", 钱: { 回款: number; 提成: number }): string[] {
  const 因: string[] = [];
  if (!能并的阶段[角色].includes(p.phase)) 因.push(`「${名(p)}」在${p.phase}阶段，只有${能并的阶段[角色].join("、")}阶段的项目能合并`);
  if (签了合同(p)) 因.push(`「${名(p)}」已签合同，不能合并`);
  if (!钱也能有[角色] && 钱.回款) 因.push(`「${名(p)}」有回款，不能合并`);
  if (!钱也能有[角色] && 钱.提成) 因.push(`「${名(p)}」有提成记录，不能合并`);
  return 因;
}

export async function 钱(db: Pick<Tx, "entProjectPayment" | "entCommission" | "entCommissionSplit">, projectId: string) {
  const [回款, 提成, 分配] = await 看全部(() => Promise.all([
    db.entProjectPayment.count({ where: { projectId } }),
    db.entCommission.count({ where: { projectId } }),
    db.entCommissionSplit.count({ where: { projectId } }),
  ]));
  return { 回款, 提成: 提成 + 分配 };
}

/** 业务线不同的那一句（两边都有值、不一样才拦；一边空着不拦）。合并框的预览和候选的灰着列共用这一处 */
export function 业务线不同的原因(A: { bizLine?: string | null }, B: { bizLine?: string | null }): string | null {
  return 有值(A.bizLine) && 有值(B.bizLine) && A.bizLine !== B.bizLine ? `两个项目业务线不同（${A.bizLine} / ${B.bizLine}），不能合并` : null;
}

/** 留下的项目在线索验证里等人判：预览和候选的灰着列共用这一句 */
export const 留下在等的原因 = (p: { name?: string | null }, 等: string) => `留下的项目「${名(p as 项目行)}」在等${等}，判完再并`;

/** 不能并的原因（空 = 能并）。A = 留下，B = 并掉 */
/** 销售判无效现在交给谁（实际待要用）：读规则要用外面的库连接，不能在合并事务里读，调用方先在事务外算好传进来 */
export async function 现在交给(org: 组织 | null): Promise<"市场复核" | "总管理终判"> {
  return org ? 无效交给(org) : "总管理终判";
}
/** 验证里存着的 pending 换成现在实际在等的那步（规则关了 / 市场管理走了，存着「市场复核」按总管理终判算，和验证页、待办同一口径） */
const 等谁 = (pending: string, 交给: "市场复核" | "总管理终判") => 实际待(pending, 交给) ?? pending;

/**
 * 跨负责人并（E-380）时由 project-merge-request.ts 带进来：放开「负责人不同」和「不是你负责的」两条（谁能发起、谁能确认由申请那边判），
 * 其余照旧；申请 id = 正在执行的那张申请（自己不挡自己）
 */
export type 跨并信息 = {
  申请id: string | null; 发起人id: string; 确认人id: string; 发起方式: "本人发起" | "申请确认"; 确认人层级: string;
  /** 事务里再核一遍（s1 审查必改 2）：负责人还是发起时那两位、有快照的四项没变、另判（确认人身份 / 客户负责人）；不过 = 抛 拦下，整笔回滚 */
  期望?: { 留下负责人: string; 并掉负责人: string; 快照?: 快照; 另判?: (tx: Tx, A: 项目行, B: 项目行) => Promise<string | null> };
};

/* 确认时比四项的快照（从 project-merge-request.ts 挪来，事务里要用；那边照旧导出） */
export const 四项 = ["负责人", "阶段", "回款或提成", "被判无效"] as const;
export type 变动项 = (typeof 四项)[number];
export type 项目快照 = { 名: string; 负责人: string; 阶段: string; 回款: number; 提成: number; 无效: boolean };
export type 快照 = { 项目: Record<string, 项目快照> };
const 变动句 = (项: readonly string[]) => `两个项目的${项.join("、")}有变`;
export const 变动话 = (项: readonly string[]) => `${变动句(项)}，申请已失效，要重新发起`;
const 判无效 = (v: { verdict: string; finalResult: string | null } | null) => !!v && (v.verdict === "初验无效" || v.verdict === "无效线索" || v.finalResult === "无效线索");
export async function 读快照(db: Tx | 库, A: 项目行, B: 项目行): Promise<快照> {
  const 项目: Record<string, 项目快照> = {};
  for (const p of [A, B]) {
    const [m, v] = await Promise.all([
      钱(db as Tx, p.id),
      看全部(() => db.entLeadVerify.findUnique({ where: { projectId: p.id }, select: { verdict: true, finalResult: true } })),
    ]);
    项目[p.id] = { 名: p.name, 负责人: p.ownerId, 阶段: `${p.phase}/${p.node ?? ""}/${p.result ?? ""}`, 回款: m.回款, 提成: m.提成, 无效: 判无效(v) };
  }
  return { 项目 };
}
export function 比四项(旧: 快照, 新: 快照): 变动项[] {
  const 变 = new Set<变动项>();
  for (const [id, a] of Object.entries(旧.项目)) {
    const b = 新.项目[id];
    if (!b) { 变.add("阶段"); continue; }
    if (a.负责人 !== b.负责人) 变.add("负责人");
    if (a.阶段 !== b.阶段) 变.add("阶段");
    if (a.回款 !== b.回款 || a.提成 !== b.提成) 变.add("回款或提成");
    if (a.无效 !== b.无效) 变.add("被判无效");
  }
  return 四项.filter((x) => 变.has(x));
}
/** 事务里的「还是发起时那样吗」：null = 没变；有话 = 不能并（调用方抛 拦下） */
async function 跨并期望判(tx: Tx, A: 项目行, B: 项目行, 期: NonNullable<跨并信息["期望"]>): Promise<string | null> {
  if (A.ownerId !== 期.留下负责人 || B.ownerId !== 期.并掉负责人) return 变动句(["负责人"]);
  if (期.快照) {
    const 变 = 比四项(期.快照, await 读快照(tx, A, B));
    if (变.length) return 变动句(变);
  }
  return 期.另判 ? await 期.另判(tx, A, B) : null;
}
export const 跨并待确认挡话 = (p: { name?: string | null }) => `「${p.name || "未命名项目"}」有一张跨负责人合并申请在等确认，先处理那张`;

export const 撤回过不能直接并话 = "这对项目撤回过，要并请重新发起申请";
/** 同一对项目（同 from / into 或反向）有已撤回的跨负责人合并单（明细里有「跨负责人」） */
export async function 撤回过的跨并对(db: Tx | 库, a: string, b: string): Promise<boolean> {
  const 单 = await db.entCustomerMerge.findFirst({
    where: { kind: 项目单, status: "已撤回", detail: { contains: '"跨负责人"' }, OR: [{ fromId: b, intoId: a }, { fromId: a, intoId: b }] },
    select: { id: true },
  });
  return !!单;
}

export async function 拦的原因(db: Tx | 库, A: 项目行 | null, B: 项目行 | null, me: 合并人, org: 组织 | null, 交给: "市场复核" | "总管理终判", 跨: 跨并信息 | null = null): Promise<string[]> {
  if (!企业版()) return ["只有企业版能合并项目"];
  if (!A || !B) return ["项目不存在或已删除，刷新看看"];
  if (A.id === B.id) return ["不能和自己合并，请选另一个项目"];
  if (!org || 只读角色(me, org) || 只看的人(org, me.id)) return ["你只能看，不能合并项目"];
  const 管 = 是系统管理员(me, org);
  const 因: string[] = [];
  // E-484 2：这对项目（正向、反向）有撤回过的跨负责人合并，直接并入口拦下；走申请（申请确认）仍可
  // 同负责人的普通合并不拦（撤回后 B 转到 A 的负责人名下，两条路都走不通）
  if (跨?.发起方式 === "本人发起" && 跨.期望) {
    if (await 撤回过的跨并对(db, A.id, B.id)) 因.push(撤回过不能直接并话);
  }
  // 12-22 异议：这两个项目有没裁定的转让异议，裁定前不能合并（判定页 #20）
  const 异议拦 = await 项目有未裁定异议(db, [A, B], "合并");
  if (异议拦) 因.push(异议拦);
  if (A.customerId !== B.customerId) 因.push("两个项目不在同一位客户名下；先「项目换客户」或先合并客户再并");
  // 业务线不同不能并（对齐第一批客户合并 customer-merge.ts 拦的原因：两边都有值、不一样才拦）；预览里同一句，框里「并过去」灰着
  const 线因 = 业务线不同的原因(A, B);
  if (线因) 因.push(线因);
  let 公海 = false;
  for (const p of [A, B]) {
    if (p.pooledAt) { 因.push(`「${名(p)}」在线索公海里，先领出来再并`); 公海 = true; }
    else if (p.awaitAssignAt) { 因.push(`「${名(p)}」在等分配，先分出去再并`); 公海 = true; }
  }
  if (!公海) {
    if (跨) {
      if (A.ownerId === B.ownerId) 因.push("两个项目是同一位负责人，直接合并即可，不用跨负责人申请");
    } else if (A.ownerId !== B.ownerId) 因.push("两个项目负责人不同，只能合并同一位负责人的两个项目");
    else if (!管 && A.ownerId !== me.id) 因.push("这两个项目不是你负责的，只有负责人本人或系统管理员能合并");
  }
  // 跨负责人合并申请在等确认的项目，别的合并先不动（申请执行时带 申请id，自己不挡自己）
  const 挂 = await db.entProjectMergeRequest.findMany({
    where: { status: { in: ["待确认", "执行中"] }, OR: [{ fromProjectId: { in: [A.id, B.id] } }, { intoProjectId: { in: [A.id, B.id] } }], ...(跨?.申请id ? { id: { not: 跨.申请id } } : {}) },
    select: { fromProjectId: true, intoProjectId: true },
  });
  for (const p of [A, B]) if (挂.some((r) => r.fromProjectId === p.id || r.intoProjectId === p.id)) 因.push(跨并待确认挡话(p));
  for (const [p, 角色] of [[A, "留下"], [B, "并掉"]] as const) {
    if (p.result) { 因.push(`「${名(p)}」已经结束（${p.result}），不能合并`); continue; }
    因.push(...阶段和钱拦(p, 角色, await 钱(db as Tx, p.id)));
  }
  // 被并掉的那个：线索验证判过有效、在等复核 / 终验 / 终判 / 认领、已判无效的都拦（再记一遍重复线索会盖掉原结局）
  // 留下的那个也一样（P-合并-09）：在等复核 / 终验 / 终判 / 认领不能把别的并进来。「等销售初判」= 刚分来还没初判，pending 是 null（lead-verify.ts 只有初判无效才写 pending = 复核 / 终判），不拦
  const 留 = await 看全部(() => db.entLeadVerify.findUnique({ where: { projectId: A.id }, select: { pending: true } }));
  if (留?.pending) 因.push(留下在等的原因(A, 等谁(留.pending, 交给)));
  const v = await 看全部(() => db.entLeadVerify.findUnique({ where: { projectId: B.id }, select: { verdict: true, finalResult: true, pending: true } }));
  if (v?.pending) 因.push(`「${名(B)}」在等${等谁(v.pending, 交给)}，判完再并`);
  else if (v?.verdict === "有效线索" || v?.finalResult === "有效线索") 因.push(`「${名(B)}」线索验证判过有效，不能并掉；要并请把它留下、并另一个`);
  else if (v?.verdict === "无效线索" || v?.finalResult === "无效线索") 因.push(`「${名(B)}」已判无效线索，不能再并`);
  if ((await 交接中的客户([A.customerId], db as Tx)).has(A.customerId)) 因.push("这位客户正在转让交接中，等接手人确认或撤回交接后再并");
  const 离职 = await 离职交接中的项目([A, B], db as Tx);
  for (const p of [A, B]) if (离职.has(p.id)) 因.push(`「${名(p)}」正在离职交接中，等接手人确认或撤回交接后再并`);
  return 因;
}

/* ───────────────────────── 预览 ───────────────────────── */

export type 项目合并条数 = { 沟通: number; 附件: number; 录音: number; 点评: number; 联系人: number; 关联客户: number; 卡点: number };
export type 项目合并预览结果 = {
  能并: boolean;
  原因: string[];
  留下: { id: string; name: string } | null;
  并掉: { id: string; name: string } | null;
  条数: 项目合并条数 | null;
  /** 被并掉的项目组员（已进组的）：只是框里提示一句「留在这个项目里、不并进留下的项目」，不能勾（E-331） */
  组员: { userId: string; name: string }[];
  /**
   * 两边的项目联系人（E-331 必改 2「合并时要核实」）：并掉 只列留下那边没有的（同一位联系人 id 合并时去重，不提示）。
   * 两边都有人时框里提示「这两位可能是同一个人，确认后可在客户详情里合成」，号码同不同都提示；合并本身不按号码去重、不自动合成
   */
  联系人: { 留下: 合并联系人[]; 并掉: 合并联系人[] };
};
/** 尾号 = 号码后四位（老号码列优先，没有取联系方式里第一个手机号）；没留号码是空串 */
export type 合并联系人 = { id: string; name: string; 尾号: string; /** 电话权限是「藏」：尾号不给、界面写「号码看不到」 */ 号藏?: true };
const 没联系人 = { 留下: [], 并掉: [] };

async function 数条数(db: Tx | 库, B: string): Promise<项目合并条数> {
  const [沟通, 附件, 录音, 点评, 联系人, 关联客户, 卡点] = await 看全部(() => Promise.all([
    db.followUpProject.count({ where: { projectId: B, followUp: { deletedAt: null } } }),
    db.attachment.count({ where: { projectId: B } }),
    db.entCoachRecording.count({ where: { projectId: B } }),
    db.entCoachTopic.count({ where: { projectId: B, deletedAt: null } }),
    db.projectContact.count({ where: { projectId: B } }),
    db.projectCustomer.count({ where: { projectId: B } }),
    db.entBlocker.count({ where: { projectId: B, status: { not: 已解决 } } }),
  ]));
  return { 沟通, 附件, 录音, 点评, 联系人, 关联客户, 卡点 };
}

async function 两边联系人(db: Tx | 库, A: string, B: string, me: 合并人): Promise<项目合并预览结果["联系人"]> {
  const [行, 级别] = await Promise.all([
    看全部(() => db.projectContact.findMany({
      where: { projectId: { in: [A, B] }, contact: { deletedAt: null } }, orderBy: { createdAt: "asc" },
      select: { projectId: true, contact: { select: { id: true, name: true, phone: true, contactMethods: { where: { kind: "phone" }, orderBy: { createdAt: "asc" }, take: 1, select: { value: true } } } } },
    })),
    字段权限of(me.id),
  ]);
  const 藏 = 级别("电话") === "藏";
  const 位 = ({ contact: c }: (typeof 行)[number]): 合并联系人 => {
    const 数字 = (c.phone || c.contactMethods[0]?.value || "").replace(/\D/g, "");
    // 电话「藏」：号码够 11 位才给尾号，不然给空并标「号藏」，界面不能把「看不到」说成「没留号码」
    if (藏) return 数字.length >= 11 ? { id: c.id, name: c.name, 尾号: 数字.slice(-4) } : { id: c.id, name: c.name, 尾号: "", 号藏: true };
    return { id: c.id, name: c.name, 尾号: 数字.length >= 4 ? 数字.slice(-4) : "" };
  };
  const 留下 = 行.filter((x) => x.projectId === A).map(位);
  const 有 = new Set(留下.map((x) => x.id));
  return { 留下, 并掉: 行.filter((x) => x.projectId === B && !有.has(x.contact.id)).map(位) };
}

/** 被并项目的组员（带名字、角色、邀请状态）：预览只取已进组的，合并单明细留痕全取 */
async function 组员们(db: Tx | 库, B: string, 只进组的: boolean): Promise<项目合并明细["被并组员"]> {
  const 行 = await 看全部(() => db.projectMember.findMany({
    where: { projectId: B, ...(只进组的 ? { inviteStatus: "JOINED" } : {}) }, orderBy: { createdAt: "asc" }, select: { userId: true, roleId: true, inviteStatus: true },
  }));
  const 人 = new Map((await db.user.findMany({ where: { id: { in: 行.map((x) => x.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return 行.map((x) => ({ userId: x.userId, name: 人.get(x.userId) ?? "", roleId: x.roleId, inviteStatus: x.inviteStatus }));
}

export async function 项目合并预览(db: 库, 留下id: string, 并掉id: string, me: 合并人): Promise<项目合并预览结果> {
  const org = await 权限组织();
  const [A, B] = await Promise.all([读项目(db, 留下id), 读项目(db, 并掉id)]);
  const 原因 = await 拦的原因(db, A, B, me, org, await 现在交给(org));
  const 两个 = { 留下: A ? { id: A.id, name: A.name } : null, 并掉: B ? { id: B.id, name: B.name } : null };
  if (原因.length || !A || !B) return { 能并: false, 原因, ...两个, 条数: null, 组员: [], 联系人: 没联系人 };
  const [条数, 组员, 联系人] = await Promise.all([数条数(db, B.id), 组员们(db, B.id, true), 两边联系人(db, A.id, B.id, me)]);
  return { 能并: true, 原因: [], ...两个, 条数, 组员: 组员.map(({ userId, name }) => ({ userId, name })), 联系人 };
}

/** 留下的候选一项：不能 = 灰着列、不能选，写原因（已签合同 / 到商机订单）；选不选得了执行时照样整套再判 */
export type 并进候选 = { id: string; name: string; node: string; 不能?: string };
/** 候选的一份结果：列 = 能选的全部在前、灰的只列前 灰着列的上限 个在后；灰共 = 灰的总数（没列出的 = 灰共 − 列里灰的个数） */
export type 并进候选们 = { 列: 并进候选[]; 灰共: number };
/** 灰着列的个数上限：能选的一个不少，灰的只是告诉人「为什么没法选」，列前几个、写明总数 */
export const 灰着列的上限 = 20;

/**
 * 从这个项目（被并掉的那个）出发，同一位客户名下留下的候选：同负责人、没结束、不在公海。
 * 阶段对不上、已签合同的也列，灰着写原因（E-331 必改 5）；只是给选择框列候选，执行时照样整套再判
 */
export async function 能并进的项目(db: 库, 并掉id: string, me: 合并人): Promise<并进候选们> {
  const 无: 并进候选们 = { 列: [], 灰共: 0 };
  if (!企业版()) return 无;
  const B = await 读项目(db, 并掉id);
  if (!B || B.pooledAt || B.result) return 无;
  const org = await 权限组织();
  if (!org || 只读角色(me, org) || 只看的人(org, me.id)) return 无;
  if (!是系统管理员(me, org) && B.ownerId !== me.id) return 无;
  return 能并进的候选们(db, B);
}

const 候选底 = (B: { id: string; customerId: string; ownerId: string }) =>
  ({ customerId: B.customerId, ownerId: B.ownerId, id: { not: B.id }, deletedAt: null, result: null, pooledAt: null, awaitAssignAt: null }) satisfies Prisma.ProjectWhereInput;

/** 菜单只问有没有候选（能选的、灰的都算）：一次查询，不取全列表 */
export async function 有并进的候选(db: 库, B: { id: string; customerId: string; ownerId: string }): Promise<boolean> {
  return !!(await 看全部(() => db.project.findFirst({ where: 候选底(B), select: { id: true } })));
}

/**
 * 候选那一句（同客户、同负责人、在推的）：能选的排前，灰的（已签合同 / 不在线索阶段 / 业务线不同）排后。
 * 取数分两次：能选的不设上限（同一客户同一负责人下本来有限，不能被灰的挤掉），灰的另取前 灰着列的上限 个并数总数。
 * 判定还是 签了合同 / 能并的阶段.留下 那一套，这里只把它翻成查询条件，两边条件互补。
 * 调用方手里已有这个项目的行（项目详情的 load.ts）就直接用，省一次读项目；菜单只看有没有（灰的也算，点开框里写原因）
 */
export async function 能并进的候选们(db: 库, B: { id: string; customerId: string; ownerId: string; bizLine?: string | null }): Promise<并进候选们> {
  const 底 = 候选底(B);
  // 业务线：和 业务线不同的原因 同一规则（两边都有值、不一样才算不同），翻成查询条件，两边互补
  const 线不同: Prisma.ProjectWhereInput[] = 有值(B.bizLine) ? [{ AND: [{ bizLine: { not: null } }, { bizLine: { not: "" } }, { bizLine: { not: B.bizLine } }] }] : [];
  const 线同或空: Prisma.ProjectWhereInput[] = 有值(B.bizLine) ? [{ OR: [{ bizLine: null }, { bizLine: "" }, { bizLine: B.bizLine }] }] : [];
  const 验证中: Prisma.ProjectWhereInput = { entLeadVerify: { is: { pending: { not: null } } } };
  const 没签合同: Prisma.ProjectWhereInput = { OR: [{ contractStatus: null }, { contractStatus: { not: 生效的合同状态 } }] };
  const 能选的条件: Prisma.ProjectWhereInput = { ...底, AND: [没签合同, { NOT: 验证中 }, { phase: { in: [...能并的阶段.留下] } }, ...线同或空] };
  const 灰的条件: Prisma.ProjectWhereInput = { ...底, OR: [验证中, { contractStatus: 生效的合同状态 }, { phase: { notIn: [...能并的阶段.留下] } }, ...线不同] };
  const 选 = { id: true, name: true, node: true, phase: true, contractStatus: true, bizLine: true, entLeadVerify: { select: { pending: true } } } satisfies Prisma.ProjectSelect;
  const 交给 = await 现在交给(await 权限组织());
  const [能, 灰, 灰共] = await 看全部(() => Promise.all([
    db.project.findMany({ where: 能选的条件, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], select: 选 }),
    db.project.findMany({ where: 灰的条件, orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 灰着列的上限, select: 选 }),
    db.project.count({ where: 灰的条件 }),
  ]));
  const 列 = [
    ...能.map(({ id, name, node }): 并进候选 => ({ id, name, node })),
    ...灰.map(({ id, name, node, contractStatus, phase, bizLine, entLeadVerify }): 并进候选 => ({ id, name, node, 不能: entLeadVerify?.pending ? 留下在等的原因({ name }, 等谁(entLeadVerify.pending, 交给)) : 签了合同({ contractStatus }) ? 已签合同的项目不能合并 : !能并的阶段.留下.includes(phase) ? 到商机订单不能合并 : 业务线不同的原因({ bizLine }, B) ?? 到商机订单不能合并 })),
  ];
  return { 列, 灰共 };
}

/* ───────────────────────── 执行 ───────────────────────── */

const 已解决 = "已解决";
/** 挪的表：Prisma 模型名 → 主键、指项目的列、额外条件 */
const 挪表 = [
  ["followUpProject", "followUpId", "projectId", {}],
  ["entFollowUpMark", "followUpId", "projectId", {}],
  ["entFollowUpMeta", "followUpId", "projectId", {}],
  ["attachment", "id", "projectId", {}],
  ["entCoachRecording", "id", "projectId", {}],
  ["entCoachTopic", "id", "projectId", {}],
  ["entBlocker", "id", "projectId", { status: { not: 已解决 } }],
  ["entExternalRef", "id", "targetId", { entity: "opportunity" }],
] as const;
const 去重表 = [["projectContact", "contactId"], ["projectCustomer", "customerId"]] as const;
/*
 * 字段覆盖守卫（tests/ent-project-merge.test.ts「字段覆盖守卫」）只扫列名带 projectId 的。下面几处指项目不叫 projectId，2a 审查人工核过：
 *   - EntExternalRef.targetId（多态）：只有 entity=opportunity 的指项目 → 挪表里改指留下的项目；之后原系统再同步这条商机，
 *     apply.ts 对照 整条记冲突、不写（project-merge-guard 对照被项目合并改指）。客户 / 联系人 / 沟通的对照不指项目，不涉及
 *   - EntImportRow.targetId（多态，导入记录）：不挪；整批撤回时这一批的项目在合并单里（被并或留下）跳过不撤，报告写明（revert.ts 项目已并入未撤话）
 *   - EntConflict.targetId（多态，同步冲突）：不挪；被并项目上没定的冲突，对照改指后 targetId 对不上，去定按过时（resolve.ts 过时了）
 *   - EntTrash.targetId（多态，整批撤回删掉的记录）：指的是已删的项目，删了的项目不能并（读项目 deletedAt: null），不涉及
 *   - EntHandover.projectIds（JSON 数组）：不挪；离职交接待确认里的项目合并、撤回都拦（离职交接中的项目），确认过的是历史不动
 */
/*
 * FollowPlan.projectId（判 MQL 不合格自动建的培育计划，autoBy = mql-nurture，E-396）：不在挪表里，挪不挪看留下的项目 A 在不在潜客培育（挪 里单独处理）——
 *   A 也在潜客培育：B 的这些未完成计划改指 A（记进 改指，撤回改回 B）；A 不在：撤掉（硬删 + 操作日志），撤回合并不重建。人手加的计划（autoBy 空）一概不动
 */
const 计划键 = "followPlan.projectId";
const 主键of: Record<string, string> = Object.fromEntries([...挪表.map(([t, 键]) => [t, 键]), ...去重表.map(([t]) => [t, "id"]), ["followPlan", "id"]]);
const 类叫: Record<string, string> = {
  followUpProject: "沟通", entFollowUpMark: "沟通标记", entFollowUpMeta: "沟通编号", attachment: "附件", entCoachRecording: "录音", entCoachTopic: "点评",
  entBlocker: "卡点", followPlan: "培育计划", entExternalRef: "老系统对照", projectContact: "项目联系人", projectCustomer: "项目关联客户", project: "被并掉的项目",
};
const 键 = (t: string, 列: string) => `${t}.${列}`;

/** 合并单明细（detail）：撤回只认这里记下的 */
export type 项目合并明细 = {
  版本: 1;
  /** 留下的项目当时的名字（30 天保护的提示话、合并单列表用） */
  留下名: string;
  客户: string;
  负责人: string;
  /** "表.列" → 改指过的行主键 */
  改指: Record<string, string[]>;
  /** 去重删掉的整行，撤回时建回 */
  删掉: { projectContact: Record<string, unknown>[]; projectCustomer: Record<string, unknown>[] };
  /** 被并掉的项目合并时的组员名单（只留痕：组员行合并、撤回都不动，不并进留下的项目，E-331 必改 3） */
  被并组员: { userId: string; name: string; roleId: string | null; inviteStatus: string }[];
  /** E-335 一.4：合并人勾过「两个项目都还没开票」的自查留痕（旧单没有这一项） */
  自查?: { 两个项目都未开票: true; 谁: string; 时间: string };
  /** 被并掉的项目合并前的结局和线索验证（null = 原来没有验证这一行），和合并写下的无效原因 */
  被并: { result: string | null; closedAt: string | null; 验证: Record<string, unknown> | null; 无效原因: string };
  /** 跨负责人并才有（跨并后补记写）：撤回时确认人和发起人都算合并的人，留下的项目判还归 留下负责人 */
  跨负责人?: { 申请id: string | null; 发起人: string; 确认人: string; 发起方式: string; 确认人层级: string; 原负责人: string | null; 留下负责人: string | null };
};

type 通用表 = {
  findMany(a: { where: object; select?: object }): Promise<Record<string, unknown>[]>;
  updateMany(a: { where: object; data: object }): Promise<{ count: number }>;
  deleteMany(a: { where: object }): Promise<{ count: number }>;
  create(a: { data: object }): Promise<unknown>;
};
const 表 = (tx: Tx, t: string) => (tx as unknown as Record<string, 通用表>)[t];
const 分段 = <T,>(xs: readonly T[], n = 400): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function 改指(tx: Tx, t: string, 主键: string, 列: string, from: string, to: string, 加: object): Promise<string[]> {
  const ids = (await 表(tx, t).findMany({ where: { [列]: from, ...加 }, select: { [主键]: true } })).map((r) => r[主键] as string);
  for (const 段 of 分段(ids)) await 表(tx, t).updateMany({ where: { [主键]: { in: 段 } }, data: { [列]: to } });
  return ids;
}

export type 项目合并完 = { mergeId: string; 条数: 项目合并条数 };

/**
 * 执行项目合并：B 并进 A。B 的组员不并进 A（E-331 必改 3，推翻 E-280 一.2 的勾选），名单记进合并单和日志
 */
export async function 执行项目合并(db: 库, 留下id: string, 并掉id: string, me: 合并人, opt: { 现在?: Date; 已核未开票?: boolean; 跨负责人?: 跨并信息 } = {}): Promise<结果<项目合并完>> {
  if (!opt.已核未开票) return { ok: false, error: "请先确认两个项目都还没开票" };
  const 现在 = opt.现在 ?? new Date();
  const org = await 权限组织();
  const 开 = await 客户状态自动();
  const 交给 = await 现在交给(org);
  let 通知要: { A: 项目行; B: 项目行 } | null = null;
  let 异议id: string | null = null;
  let r: 项目合并完;
  try {
    r = await 看已删(() =>
      看全部(() =>
        db.$transaction(async (tx) => {
          const [A, B] = [await 读项目(tx, 留下id), await 读项目(tx, 并掉id)];
          if (opt.跨负责人?.期望 && A && B) {
            const 变 = await 跨并期望判(tx, A, B, opt.跨负责人.期望);
            if (变) throw new 拦下(变);
          }
          const 原因 = await 拦的原因(tx, A, B, me, org, 交给, opt.跨负责人 ?? null);
          if (原因.length) throw new 拦下(原因.join("；"));
          const 结 = await 挪(tx, A!, B!, me, 现在);
          if (opt.跨负责人) {
            await 跨并后补记(tx, A!, B!, 结.mergeId, opt.跨负责人, 现在);
            // 阶段 4：同一事务里给被并走的原负责人记异议入口（崩在中间不丢；通知仍在提交后发）
            异议id = await 记项目合并异议入口(tx, { mergeId: 结.mergeId, A: A!, B: B!, 生效人: opt.跨负责人.确认人id, 发起人: opt.跨负责人.发起人id, 现在 });
          }
          await 重算最近跟进(tx, A!.customerId);
          await 跟着项目重算(tx, 开, [A!.customerId]);
          通知要 = { A: A!, B: B! };
          return 结;
        }, 合并事务选项),
      ),
    );
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
  忘掉企业版范围();
  const 要 = 通知要 as { A: 项目行; B: 项目行 } | null;
  if (要) {
    await 存沟通后重算三态(要.A.customerId, 现在).catch((e) => console.warn("[合并项目] 三态没重算上：", e instanceof Error ? e.message : e));
    await 合并后通知(要, me, opt.跨负责人 ?? null, 异议id);
  }
  return { ok: true, ...r! };
}

/**
 * 跨负责人并成功后同事务补的三样（E-337:13、判定 二#15）：合并单明细记「跨负责人」（谁发起、谁确认、怎么发起，台账阶段读）；
 * 被并走的原负责人记 1 个并走待补（占过名额才记，自己新建的、随客户分来的不补，P-合并-10 的「不退还已占线索名额」不变）；两个项目各记一条操作日志
 */
async function 跨并后补记(tx: Tx, A: 项目行, B: 项目行, mergeId: string, 跨: 跨并信息, 现在: Date): Promise<void> {
  const 单 = await tx.entCustomerMerge.findUniqueOrThrow({ where: { id: mergeId }, select: { detail: true } });
  const 明 = JSON.parse(单.detail) as Record<string, unknown>;
  明.跨负责人 = { 申请id: 跨.申请id, 发起人: 跨.发起人id, 确认人: 跨.确认人id, 发起方式: 跨.发起方式, 确认人层级: 跨.确认人层级, 原负责人: B.ownerId, 留下负责人: A.ownerId };
  await tx.entCustomerMerge.update({ where: { id: mergeId }, data: { detail: JSON.stringify(明) } });
  // 跨负责人并的申请：同一笔里置「已合并」（条件更新，状态不是执行中 = 刚被别人处理过，整笔回滚）
  if (跨.申请id) {
    const n = await tx.entProjectMergeRequest.updateMany({ where: { id: 跨.申请id, status: "执行中" }, data: { status: "已合并", mergeId, endedAt: 现在, endedById: 跨.确认人id } });
    if (!n.count) throw new 拦下("刚被别人改过，刷新看看");
  }
  const 补 = !!B.ownerId && (await 占过名额(tx, B.id, B.ownerId)) && (await 记并走待补(tx, B.ownerId, B.id, 现在));
  const 话 = `跨负责人合并（${跨.发起方式}，${跨.确认人层级}确认）${补 ? "；原负责人记 1 个待补" : ""}`;
  const 谁 = await tx.user.findUnique({ where: { id: 跨.确认人id }, select: { name: true } });
  await tx.auditLog.createMany({
    data: [A, B].map((p) => ({ userId: 跨.确认人id, userName: 谁?.name ?? "同事", action: "merge", entity: "Project", entityId: p.id, at: 现在, summary: 话, detail: JSON.stringify({ mergeId, 跨负责人: 明.跨负责人, 记待补: 补 }) })),
  });
}

async function 挪(tx: Tx, A: 项目行, B: 项目行, me: 合并人, 现在: Date): Promise<项目合并完> {
  const 条数 = await 数条数(tx, B.id);
  const 名们 = await 重复线索名们(tx);
  const 无效原因 = 名们[名们.length - 1];
  const 原验证 = await tx.entLeadVerify.findUnique({ where: { projectId: B.id } });
  const 明: 项目合并明细 = {
    版本: 1, 留下名: A.name, 客户: A.customerId, 负责人: A.ownerId, 改指: {}, 删掉: { projectContact: [], projectCustomer: [] }, 被并组员: await 组员们(tx, B.id, false),
    自查: { 两个项目都未开票: true, 谁: me.name, 时间: 现在.toISOString() },
    被并: { result: B.result, closedAt: B.closedAt?.toISOString() ?? null, 验证: 原验证 ? (JSON.parse(JSON.stringify(原验证)) as Record<string, unknown>) : null, 无效原因 },
  };

  for (const [t, 主键, 列, 加] of 挪表) 明.改指[键(t, 列)] = await 改指(tx, t, 主键, 列, B.id, A.id, 加);
  // B 判 MQL 不合格建的培育计划（E-396）：A 也在潜客培育就改指 A，不然撤掉（B 结束为重复线索，计划没处挂）；撤了的撤回合并不重建
  if (在潜客培育(A.node)) 明.改指[计划键] = await 改指(tx, "followPlan", "id", "projectId", B.id, A.id, { autoBy: 培育计划来源, done: false });
  else await 撤培育计划(tx, me, B.id);

  // 项目联系人、关联客户：A 已有同一位的，B 那行删掉（整行记下）；关联的是 A 的主客户的也删（主客户不在关联表里占行）
  for (const [t, 对] of 去重表) {
    const B行 = await 表(tx, t).findMany({ where: { projectId: B.id } });
    const A有 = new Set((await 表(tx, t).findMany({ where: { projectId: A.id }, select: { [对]: true } })).map((x) => x[对] as string));
    const 重 = B行.filter((x) => A有.has(x[对] as string) || (t === "projectCustomer" && x[对] === A.customerId));
    if (重.length) await 表(tx, t).deleteMany({ where: { id: { in: 重.map((x) => x.id as string) } } });
    明.删掉[t] = JSON.parse(JSON.stringify(重)) as Record<string, unknown>[];
    const 余 = B行.filter((x) => !重.includes(x)).map((x) => x.id as string);
    for (const 段 of 分段(余)) await 表(tx, t).updateMany({ where: { id: { in: 段 } }, data: { projectId: A.id } });
    明.改指[键(t, "projectId")] = 余;
  }

  // B 结束为重复线索：系统直接记终判无效，不走复核、不记待补（不调 记补位）
  await tx.project.update({ where: { id: B.id }, data: { result: "线索流失", closedAt: 现在 } });
  const 写 = { verdict: "无效线索", finalResult: "无效线索", invalidReason: 无效原因, pending: null, finalNote: `系统：并入「${A.name}」`.slice(0, 200), finalById: null, finalAt: 现在 };
  await tx.entLeadVerify.upsert({ where: { projectId: B.id }, create: { projectId: B.id, ...写 }, update: 写 });
  await tx.entLeadVerifyLog.create({ data: { projectId: B.id, step: 项目合并验证步, verdict: "无效", reason: 无效原因, note: `系统：并入 → 「${A.name}」`.slice(0, 200), userId: me.id, at: 现在 } });
  await tx.projectNodeLog.create({
    data: { projectId: B.id, userId: me.id, at: 现在, fromPhase: B.phase, fromNode: B.node, fromResult: null, toPhase: B.phase, toNode: B.node, toResult: "线索流失", reason: `无效原因：${无效原因}；并入「${A.name}」`.slice(0, 500) },
  });

  const 单 = await tx.entCustomerMerge.create({
    data: {
      kind: 项目单, fromId: B.id, intoId: A.id, status: "已合并", byUserId: me.id, fromName: B.name, fromOwnerId: B.ownerId || null, fromCreatorId: B.creatorId || null,
      fromChannelId: B.channelId, counts: JSON.stringify(条数), detail: JSON.stringify(明), at: 现在,
    },
  });
  await tx.auditLog.createMany({
    data: [
      { userId: me.id, userName: me.name, action: "merge", entity: "Project", entityId: A.id, at: 现在,
        summary: `合并项目：把「${名(B)}」并进这个项目（${条数.沟通} 条沟通、${条数.附件} 个附件、${条数.联系人} 位项目联系人），${项目合并撤回天数} 天内可撤回；${自查话(明)}`,
        detail: JSON.stringify({ mergeId: 单.id, 并掉: B.id, 条数, 自查: 明.自查 }) },
      { userId: me.id, userName: me.name, action: "merge", entity: "Project", entityId: B.id, at: 现在,
        summary: `合并项目：已并入「${名(A)}」，结束为重复线索（不退还已占线索名额）${组员话(明.被并组员, A)}；${自查话(明)}`,
        detail: JSON.stringify({ mergeId: 单.id, 留下: A.id, 组员: 明.被并组员.map(({ userId, name, inviteStatus }) => ({ userId, name, inviteStatus })) }) },
    ],
  });
  return { mergeId: 单.id, 条数 };
}

/** 合并人勾过的自查，写进两条操作日志 */
function 自查话(明: 项目合并明细): string {
  return `自查：两个项目都未开票（${明.自查?.谁 || "未知"} ${短时刻(明.自查?.时间) ?? ""}）`;
}

/** 被并项目那条日志末尾的组员留痕（已进组的写名字；邀请着没进组的只在 detail 里） */
function 组员话(组: 项目合并明细["被并组员"], A: 项目行): string {
  const 进 = 组.filter((m) => m.inviteStatus === "JOINED");
  if (!进.length) return "";
  const 名们 = 进.map((m) => m.name || "（已删除的账号）").join("、");
  return `；${进.length} 位组员留在这个项目里（${名们.length > 60 ? `${名们.slice(0, 60)}…` : 名们}），不并进「${名(A)}」`;
}

/**
 * 合并后通知（照第一批 E-280 三.2）：被并掉的项目创建人、来源渠道负责人各一条；系统管理员代并时负责人也一条。操作人自己不发。
 * 🔍 我方对应：第一批是被并那家客户的创建人、来源渠道负责人，项目合并换成被并项目的
 */
async function 合并后通知({ A, B }: { A: 项目行; B: 项目行 }, me: 合并人, 跨: 跨并信息 | null = null, 异议id: string | null = null): Promise<void> {
  // 跨负责人并（审查 S5）：留下项目的负责人不是并的人（系统管理员 / 确认人直接并、申请确认的发起人除外：那条走 跨并通知）时也收一条，链接去留下的项目
  const 留下负责人收 = 跨 && A.ownerId && A.ownerId !== me.id && A.ownerId !== 跨.发起人id ? A.ownerId : null;
  // 阶段 4：被并走的原负责人（记了异议入口的）单发一条，带「提异议」入口；其余人照旧
  const 异议人 = 异议id ? B.ownerId : null;
  const 收 = [B.creatorId, B.channel?.channelOwnerId, B.ownerId].filter((u) => u && u !== me.id && u !== 留下负责人收 && u !== 异议人);
  const 话 = `${me.name}把项目「${名(B)}」并进了「${名(A)}」，沟通、附件、项目联系人都已挪过去；「${名(B)}」结束为重复线索，不退还已占线索名额；${项目合并撤回天数} 天内可撤回。`;
  const 标题 = `项目「${名(B)}」已并入「${名(A)}」`;
  // 链接（审查 S4）：跨负责人并时被并走那头多半看不到留下的项目，链到被并掉的项目（已并入那一行）；留下项目的负责人自己的那条链到留下的项目
  await notify(收, { kind: 项目合并通知种类, title: 标题, body: 话, link: `/projects/${跨 ? B.id : A.id}`, key: `merge-project:${B.id}:${A.id}:${Date.now()}` });
  if (异议人 && 异议id) await notify([异议人], { kind: 项目合并通知种类, title: 标题, body: `${话}\n有不同意见，${异议期天数} 天内可以提异议（点开这条，写明理由，由上一级裁定）。`, link: 异议链接([异议id]), key: `merge-project:${B.id}:${A.id}:${Date.now()}` });
  if (留下负责人收) await notify([留下负责人收], { kind: 项目合并通知种类, title: 标题, body: 话, link: `/projects/${A.id}`, key: `merge-project-a:${B.id}:${A.id}:${Date.now()}` });
}

/* ───────────────────────── 撤回 ───────────────────────── */

export type 撤回项目合并完 = { 没还原: 没还原[] };
export type 撤回通知要 = { mergeId: string; 原负责人: string; 谁撤: string; A: { id: string; name: string }; B: { id: string; name: string }; /** 这次撤回终止的待裁定异议（阶段 4，E-484 第 3 条）：异议人那条通知并进「已撤回合并」一条，裁定人另发作废 */ 终止?: EntTransferObjection[] };

/**
 * E-484 1：撤回跨负责人合并，不管谁撤都给被并走的原负责人发一条（站内 + 飞书同一份，链到回来的项目）。事务提交后调；notify 从不抛
 */
export async function 发撤回通知(要: 撤回通知要 | null): Promise<void> {
  if (!要) return;
  const 终止 = 要.终止 ?? [];
  const 并了 = 终止.some((r) => r.objectorUserId === 要.原负责人);
  if (要.原负责人) await notify([要.原负责人], {
    kind: 项目合并通知种类,
    title: `项目「${要.B.name}」已撤回合并，回到你名下`,
    body: `${要.谁撤}撤回了把项目「${要.B.name}」并进「${要.A.name}」的合并，「${要.B.name}」已拆回，仍是你负责。${并了 ? "你提的合并异议因撤回终止，不用再等裁定。" : ""}`,
    link: `/projects/${要.B.id}`,
    key: `merge-project-undo:${要.mergeId}`,
  });
  await 通知合并异议终止(终止, 要.谁撤).catch((e) => console.warn("[撤回合并项目] 异议终止通知没发：", e instanceof Error ? e.message : e));
}

/**
 * 这张合并单谁算「合并的人」、留下的项目该归谁才能自己撤（跨负责人并读明细里记的，审查 M1 / 方案 E）：
 * 跨负责人并 = 确认人（byUserId）和发起人都算；留下的项目判「还归并的当时的留下负责人」，不判 me。老单（同负责人并）= 合并人本人、留下的项目还归他。
 */
function 撤回身份(m: { byUserId: string; detail: string }, me: { id: string }): { 是合并的人: boolean; 留下归: string } {
  let 跨: 项目合并明细["跨负责人"] | undefined;
  try { 跨 = (JSON.parse(m.detail) as 项目合并明细).跨负责人; } catch { /* 老格式 */ }
  if (!跨) return { 是合并的人: m.byUserId === me.id, 留下归: m.byUserId };
  return { 是合并的人: m.byUserId === me.id || 跨.发起人 === me.id, 留下归: 跨.留下负责人 ?? "" };
}
const 改过话 = "合并之后被改过（换了项目或删了）";

/**
 * 撤回项目合并（只撤这一单）：合并的人（留下的项目仍归他、不在公海）或系统管理员，30 天内。
 * 留下的项目转给了别人：只有系统管理员能撤。客户在转让交接中、两个项目有在离职交接里的不让撤（同第一批）
 */
export async function 撤回项目合并(db: 库, mergeId: string, me: 合并人, 现在: Date = new Date()): Promise<结果<撤回项目合并完>> {
  if (!企业版()) return { ok: false, error: "只有企业版能撤回合并" };
  const org = await 权限组织();
  const 开 = await 客户状态自动();
  let 客户: string | null = null;
  let 通知: 撤回通知要 | null = null;
  try {
    const 留 = await 看已删(() =>
      看全部(() =>
        db.$transaction(async (tx) => {
          const m = await tx.entCustomerMerge.findUnique({ where: { id: mergeId } });
          if (!m || m.kind !== 项目单) throw new 拦下("找不到这张合并单");
          if (m.status !== "已合并") throw new 拦下("这张合并单已经撤回过了");
          if (!org || 只读角色(me, org) || 只看的人(org, me.id) || (!撤回身份(m, me).是合并的人 && !是系统管理员(me, org))) throw new 拦下("只有合并的人或系统管理员能撤回合并");
          if (现在.getTime() - m.at.getTime() > 项目合并撤回天数 * 86_400_000) throw new 拦下(项目合并撤回过期话);
          const A = await 读项目(tx, m.intoId, true);
          if (A && !是系统管理员(me, org) && (A.pooledAt || A.ownerId !== 撤回身份(m, me).留下归)) throw new 拦下(`「${名(A)}」现在不归你负责，请找系统管理员撤回`);
          const r = await 在事务里撤回项目合并(tx, m, me, 现在, 开, true);
          客户 = r.客户;
          通知 = r.通知;
          return r.没还原;
        }, 合并事务选项),
      ),
    );
    忘掉企业版范围();
    if (客户) await 存沟通后重算三态(客户, 现在).catch((e) => console.warn("[撤回合并项目] 三态没重算上：", e instanceof Error ? e.message : e));
    await 发撤回通知(通知);
    return { ok: true, 没还原: 留 };
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
}

/**
 * 异议裁定撤回前，只读核「在事务里撤回项目合并」会不会拦（A 没再被并、两个项目都不在回收站、仍同一位客户、客户不在交接中、没人离职交接、合并单还是已合并）。
 * 返回拦的原因，null = 能撤。30 天期限不核（异议在期内提即可，裁定撤回不再校，终审 1）；其余前置照校
 */
export async function 合并撤不了的原因(tx: Tx, m: { id: string; status: string; fromId: string; intoId: string }, 现在: Date = new Date()): Promise<string | null> {
  if (m.status !== "已合并") return "这张合并单已经撤回过了";
  const [A, B] = [await 读项目(tx, m.intoId, true), await 读项目(tx, m.fromId, true)];
  if (!A || !B) return "项目已彻底删除，不能撤回合并";
  for (const p of [A, B]) if (p.deletedAt) return `「${名(p)}」在回收站里，先恢复再撤回合并`;
  if (A.customerId !== B.customerId) return "两个项目已不在同一位客户名下，撤回会对不上";
  const 链 = (await 项目合并单们(tx, [A.id], 现在)).get(A.id);
  if (链?.我是 === "被并") return `「${名(A)}」已并入「${链.留下名 || "另一个项目"}」，先撤回那次合并`;
  if ((await 交接中的客户([A.customerId], tx)).has(A.customerId)) return "这位客户正在转让交接中";
  const 离职 = await 离职交接中的项目([A, B], tx as never);
  for (const p of [A, B]) if (离职.has(p.id)) return `「${名(p)}」正在离职交接中`;
  return null;
}

/**
 * 在一个事务里撤一张项目合并单（单撤、整单撤回客户合并时「先拆后撤」都走这里）。谁能撤、期限调用方判过；
 * 拦交接 = 单撤时拦（客户合并撤回自己已经拦过两家的交接）
 */
export async function 在事务里撤回项目合并(
  tx: Tx, m: { id: string; detail: string; fromId: string; intoId: string; fromOwnerId: string | null }, me: 合并人, 现在: Date, 开: boolean, 拦交接 = false, 排除异议?: string,
): Promise<{ 没还原: 没还原[]; 客户: string; 通知: 撤回通知要 | null }> {
  const 明 = JSON.parse(m.detail) as 项目合并明细;
  const [A, B] = [await 读项目(tx, m.intoId, true), await 读项目(tx, m.fromId, true)];
  if (!A || !B) throw new 拦下("项目已彻底删除，不能撤回合并");
  for (const p of [A, B]) if (p.deletedAt) throw new 拦下(`「${名(p)}」在回收站里，先恢复再撤回合并`);
  if (A.customerId !== B.customerId) throw new 拦下("两个项目已不在同一位客户名下，撤回会对不上；请找系统管理员处理");
  const 链 = (await 项目合并单们(tx, [A.id], 现在)).get(A.id);
  if (链?.我是 === "被并") throw new 拦下(`「${名(A)}」已并入「${链.留下名 || "另一个项目"}」，先撤回那次合并`);
  if (拦交接) {
    if ((await 交接中的客户([A.customerId], tx)).has(A.customerId)) throw new 拦下("这位客户正在转让交接中，等接手人确认或撤回交接后再撤回合并");
    const 离职 = await 离职交接中的项目([A, B], tx as never);
    for (const p of [A, B]) if (离职.has(p.id)) throw new 拦下(`「${名(p)}」正在离职交接中，等接手人确认或撤回交接后再撤回合并`);
  }
  const 留: 没还原[] = [];
  const 记 = (t: string, id: string, 原因: string) => 留.push({ 类: 类叫[t] ?? t, id, 原因 });

  // 改指过的：还指着 A 的改回 B；没了的、指到别处的记「没还原」。项目联系人 / 关联客户 B 那头已有同一位的留在 A
  for (const [k, ids] of Object.entries(明.改指)) {
    const [t, 列] = k.split(".");
    const 主键 = 主键of[t];
    const 对 = 去重表.find(([x]) => x === t)?.[1];
    for (const 段 of 分段(ids)) {
      const 现 = await 表(tx, t).findMany({ where: { [主键]: { in: 段 } }, select: { [主键]: true, [列]: true, ...(对 ? { [对]: true } : {}) } });
      const 在 = new Map(现.map((r) => [r[主键] as string, r]));
      let 回 = 现.filter((r) => r[列] === A.id);
      if (对 && 回.length) {
        const B有 = new Set((await 表(tx, t).findMany({ where: { projectId: B.id, [对]: { in: 回.map((r) => r[对] as string) } }, select: { [对]: true } })).map((x) => x[对] as string));
        for (const r of 回.filter((r) => B有.has(r[对] as string))) 记(t, r[主键] as string, "被并掉的项目合并之后又加了同一位，留在留下的项目");
        回 = 回.filter((r) => !B有.has(r[对] as string));
      }
      if (回.length) await 表(tx, t).updateMany({ where: { [主键]: { in: 回.map((r) => r[主键] as string) } }, data: { [列]: B.id } });
      for (const id of 段) {
        const r = 在.get(id);
        if (!r) 记(t, id, "已彻底删除");
        else if (r[列] !== A.id) 记(t, id, 改过话);
      }
    }
  }

  // 去重删掉的整行建回（B 那头已有同一位、人或客户已不在的不建）
  for (const [t, 对] of 去重表) {
    for (const 行 of 明.删掉[t] ?? []) {
      const 有 = await 表(tx, t).findMany({ where: { projectId: B.id, [对]: 行[对] }, select: { id: true } });
      if (有.length) continue;
      const 那头 = t === "projectContact"
        ? await tx.contact.count({ where: { id: 行.contactId as string } })
        : await tx.customer.count({ where: { id: 行.customerId as string } });
      if (!那头) { 记(t, 行.id as string, "已彻底删除，没建回"); continue; }
      await 表(tx, t).create({ data: { ...行, projectId: B.id, createdAt: new Date(行.createdAt as string) } });
    }
  }

  // 组员：合并没动过（B 的组员行一直在，A 没加人），撤回不用还原
  // 被并掉的项目：结局、终判、原因还是合并写下的，清回原值；对不上的不动
  const 现验证 = await tx.entLeadVerify.findUnique({ where: { projectId: B.id } });
  if (B.result === "线索流失" && 现验证?.finalResult === "无效线索" && 现验证.invalidReason === 明.被并.无效原因 && !现验证.pending) {
    await tx.project.update({ where: { id: B.id }, data: { result: 明.被并.result, closedAt: 明.被并.closedAt ? new Date(明.被并.closedAt) : null } });
    if (!明.被并.验证) await tx.entLeadVerify.delete({ where: { projectId: B.id } });
    else {
      const { projectId: _p, updatedAt: _u, ...原 } = 明.被并.验证;
      const 时格 = ["verifiedAt", "reviewedAt", "ackedAt", "finalAt"];
      await tx.entLeadVerify.update({ where: { projectId: B.id }, data: Object.fromEntries(Object.entries(原).map(([k, v]) => [k, 时格.includes(k) && typeof v === "string" ? new Date(v) : v])) });
    }
    await tx.entLeadVerifyLog.create({ data: { projectId: B.id, step: 撤回项目合并验证步, verdict: "撤回", note: `撤回并入「${名(A)}」`.slice(0, 200), userId: me.id, at: 现在 } });
    await tx.projectNodeLog.create({
      data: { projectId: B.id, userId: me.id, at: 现在, fromPhase: B.phase, fromNode: B.node, fromResult: "线索流失", toPhase: B.phase, toNode: B.node, toResult: 明.被并.result, reason: `撤回并入「${名(A)}」`.slice(0, 500) },
    });
  } else 记("project", B.id, "合并之后结局或线索验证被改过，没清回");
  // 跨负责人并时给原负责人记的待补：没用掉的作废（撤回 = 这次并没发生）
  await 作废并走待补(tx, B.id, 现在);

  await 重算最近跟进(tx, A.customerId);
  await 跟着项目重算(tx, 开, [A.customerId]);
  // 条件更新：并发时（自己撤和异议裁定撤回同时来）只有第一个成，后到的整笔回滚
  const 撤了 = await tx.entCustomerMerge.updateMany({ where: { id: m.id, status: "已合并" }, data: { status: "已撤回", undoneAt: 现在, undoneById: me.id, undoLeft: 留.length ? JSON.stringify({ 没还原: 留 }) : null } });
  if (撤了.count !== 1) throw new 拦下("这张合并单已经撤回过了");
  // E-484 第 3 条：这张合并单下待裁定的异议因撤回终止、可提的作废（同事务）
  const 终止们 = await 终止合并异议(tx, m.id, me, 现在, 排除异议);
  const 留话 = 留.length ? `；${留.length} 条之后被改过，留在原处` : "";
  await tx.auditLog.createMany({
    data: [
      { userId: me.id, userName: me.name, action: "merge-undo", entity: "Project", entityId: A.id, at: 现在, summary: `撤回合并项目：「${名(B)}」已拆回${留话}`, detail: JSON.stringify({ mergeId: m.id, 没还原: 留 }) },
      { userId: me.id, userName: me.name, action: "merge-undo", entity: "Project", entityId: B.id, at: 现在, summary: `撤回合并项目：从「${名(A)}」拆回，结局清回原样${留话}`, detail: JSON.stringify({ mergeId: m.id }) },
    ],
  });
  // E-484 1：跨负责人并撤回，原负责人（不是撤的人自己）要通知，操作日志留一条（通知本身事务提交后由调用方发）
  const 原 = 明.跨负责人?.原负责人 ?? m.fromOwnerId ?? null;
  let 通知: 撤回通知要 | null = null;
  if (终止们.终止.length) 通知 = { mergeId: m.id, 原负责人: "", 谁撤: me.name, A: { id: A.id, name: 名(A) }, B: { id: B.id, name: 名(B) }, 终止: 终止们.终止 };
  if (原 && 原 !== me.id) {
    通知 = { mergeId: m.id, 原负责人: 原, 谁撤: me.name, A: { id: A.id, name: 名(A) }, B: { id: B.id, name: 名(B) }, ...(终止们.终止.length ? { 终止: 终止们.终止 } : {}) };
    const 原名 = (await tx.user.findUnique({ where: { id: 原 }, select: { name: true } }))?.name ?? "";
    await tx.auditLog.create({ data: { userId: me.id, userName: me.name, action: "merge-undo-notice", entity: "Project", entityId: B.id, at: 现在, summary: `撤回合并项目：已通知原负责人${原名 ? `${原名}` : ""}：「${名(B)}」回到他名下`, detail: JSON.stringify({ mergeId: m.id, 通知给: 原 }) } });
  }
  return { 没还原: 留, 客户: A.customerId, 通知 };
}

/* ───────────────────────── 合并单列表（项目详情 / 历史变更用） ───────────────────────── */

export type 项目合并单一条 = {
  id: string;
  /** 并进来：别的项目并进这个；并出去：这个项目并进了别的 */
  方向: "并进来" | "并出去";
  从: string; 到: string; 从id: string; 到id: string;
  at: string; status: string;
  /** 谁并的（名字；人删了写空） */
  谁: string;
  能撤: boolean;
  /** 已合并、这会儿不能撤的原因（历史变更里摆在按钮的位置）；能撤、已撤回的不给 */
  不能撤因?: string;
  /** 过了撤回期限（由判定函数明确给，界面不比文案）；过期一定 不能撤因 = 项目合并撤回过期话 */
  过期?: boolean;
  没还原?: Pick<没还原, "类" | "原因">[];
};

/** 已合并的单这会儿为什么不能撤（和 撤回项目合并 / 在事务里撤回项目合并 的拦话同一套说法，先判的先说） */
function 不能撤因of(
  m: { at: Date; byUserId: string; detail: string }, A: { name: string; ownerId: string | null; pooledAt: Date | null; deletedAt: Date | null } | undefined,
  B: { name: string; deletedAt: Date | null } | undefined, me: 合并人, 管: boolean, 能写: boolean, 线: number,
): string {
  if (m.at.getTime() < 线) return 项目合并撤回过期话;
  if (!能写 || (!撤回身份(m, me).是合并的人 && !管)) return "只有合并的人或系统管理员能撤回合并";
  if (!A || !B) return "项目已彻底删除，不能撤回合并";
  for (const p of [A, B]) if (p.deletedAt) return `「${名(p)}」在回收站里，先恢复再撤回合并`;
  return `「${名(A)}」现在不归你负责，请找系统管理员撤回`;
}

/** 这个项目相关的项目合并单（并进来的、并出去的），能撤 按服务端撤回的拦法预判（服务端照样再判） */
export async function 项目的合并单(db: 库, projectId: string, me: 合并人, 现在: Date = new Date()): Promise<项目合并单一条[]> {
  if (!企业版()) return [];
  const org = await 权限组织();
  const 管 = 是系统管理员(me, org);
  const 能写 = !!org && !只读角色(me, org) && !只看的人(org, me.id);
  const 们 = await db.entCustomerMerge.findMany({ where: { kind: 项目单, OR: [{ fromId: projectId }, { intoId: projectId }] }, orderBy: { at: "desc" }, take: 50 });
  const 项目们 = new Map((await 看已删(() => 看全部(() => db.project.findMany({ where: { id: { in: 们.flatMap((m) => [m.fromId, m.intoId]) } }, select: { id: true, name: true, ownerId: true, pooledAt: true, deletedAt: true } })))).map((p) => [p.id, p]));
  const 线 = 现在.getTime() - 项目合并撤回天数 * 86_400_000;
  const 人名 = new Map((await 看全部(() => db.user.findMany({ where: { id: { in: [...new Set(们.map((m) => m.byUserId))] } }, select: { id: true, name: true } }))).map((u) => [u.id, u.name]));
  return 们.map((m) => {
    const A = 项目们.get(m.intoId);
    const B = 项目们.get(m.fromId);
    const 撤 = m.status === "已撤回" ? 读没还原(m.undoLeft) : null;
    let 留下名 = A?.name ?? "";
    try { 留下名 = (JSON.parse(m.detail) as 项目合并明细).留下名 || 留下名; } catch { /* 老格式 */ }
    const 能撤 = m.status === "已合并" && m.at.getTime() >= 线 && 能写 && !!A && !!B && !A.deletedAt && !B.deletedAt
      && (管 || (撤回身份(m, me).是合并的人 && A.ownerId === 撤回身份(m, me).留下归 && !A.pooledAt));
    return {
      id: m.id, 方向: m.intoId === projectId ? "并进来" as const : "并出去" as const, 从: m.fromName, 到: A?.name ?? 留下名, 从id: m.fromId, 到id: m.intoId,
      at: m.at.toISOString(), status: m.status, 谁: 人名.get(m.byUserId) ?? "", 能撤,
      ...(m.status === "已合并" && !能撤 ? { 不能撤因: 不能撤因of(m, A, B, me, 管, 能写, 线), ...(m.at.getTime() < 线 ? { 过期: true } : {}) } : {}),
      ...(撤 ? { 没还原: 撤.没还原.map((x) => ({ 类: x.类, 原因: x.原因 })) } : {}),
    };
  });
}
