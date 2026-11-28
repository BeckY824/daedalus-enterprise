/**
 * 企业版主动放弃（豁免）（2026-11-20，批次 32H；用户 11-20：「豁免按钮可以顺带着做」「豁免按钮机制上不打架就行」「而且是每月一次」）。
 *
 * 谁、什么时候能点（全满足才出按钮）：
 *   - 组织规则「销售主动放弃线索（豁免）」开着（rules-table.ts，默认关；关着按钮不出现）
 *   - 点的人是这条线索的负责人、是这条线索流转线上的自动分配候选（assign-eta.ts 自动分配池，同自动分配、超时转挑人那一份：
 *     销售；另含本人事业部是这条线的销售管理（内贸 P-转-34、外贸 11-23，不跨线）；整组不进自动分配的部门不算），不是切换视图、不是只读身份。
 *     能被自动分配 / 超时转 / 放弃转分到线索、被计时的人才给（3703 实操 r22：内贸纯销售管理原来接得到、计时，却没有按钮）
 *   - 线索阶段、没结局、不在公海（项目和客户都不在）、不在待分配、没删
 *   - 新分配给他的（lead-giveup-core.ts 新分配时刻：市场分配（自动 / 指定 / 定时）、超时转来的、别人主动放弃转来的），
 *     接手在往回 7 天里；超时转开着时到点就被转走了，所以实际就是「接手后、超时转到点前」
 *   - 这条占过他的名额：他在这条上最近一条分配记录算数（counted），或是补发给他的；管理从公海分、企划不计数的不给（M-线索-02 没占过的不补）
 *   - 本人还没记有效沟通：同超时转的「首次沟通」口径（reply-overdue.ts 负责人跟过的 + 分配后沟通过的，只认负责人本人，
 *     有效 = reply-notice.ts 是有效沟通）。记过的不出按钮
 * 出了按钮但点不了（灰着、写为什么）：验证中（X-77，等复核、等销售：不能改负责人）；本月已经用过（每人每月 1 次，北京自然月）。
 * 夜里、周末、节假日也能点，立即转（超时转夜里、周末、节假日不执行那条只管系统自己转）。
 *
 * 点了（原因必填，选项 外出 / 忙不过来 / 其他，不含「线索无效 / 质量不达标」，那种走判无效）：
 *   1. 先占这个月的次数（EntLeadGiveUp 一行，(userId, month) 唯一：同时点两条只成一条）
 *   2. 按超时转同一套挑人转给本线下一位（assign-actions.ts 超时转出：这条线索的流转线、参与状态、本月分得最少、配额照查），
 *      排除这条线索上放弃过的人（EntLeadGiveUp）和这一轮超时过的人，挑不到再开新一轮（仍不给放弃过的人；超时转同样不给回他们）。挑不到 / 没转成 = 删掉占的那一行（不扣次数）、什么都不改，
 *      明确回「这条转不出去」
 *   3. 接手人照记一次「本月已分」（超时转出 不用待补、算数，同 P-转-29 ②）；放弃人原来那条分配记录照算（不退名额、不改 counted）
 *   4. 客户随线索：照超时转（reply-overdue.ts 客户随线索：原负责人手上还有这位客户别的进行中项目就留给他）
 *   5. 给放弃人记 1 条待补（EntLeadMakeup kind = giveup，方向 = 他这条的分配方向）：下一条自动分配先补给他，补发那条不计本月已分，
 *      每次只补 1 条（同 M-线索-06）。之后接手人判无效 → 只补接手人（判无效记补位只给现负责人），放弃人不重复补
 *   6. 接手人开始新的超时计时（同超时转来的）：转让留痕原因带「主动放弃（豁免）」，timeout.ts 是超时自动转痕 认它——
 *      超时链不挪分配基准、接手人从转来那一刻起算 1.5 小时；项目超时回收日不归零、跟着走的客户三态钟不归零（同超时转）。
 *      超时链在走的，链上记成接手人、计时从现在起、放弃人记进「这一轮超时过的人」（轮转不再给回他）
 *   7. 留痕：项目节点记录一行转让（操作人 系统，原因写明谁主动放弃、原因）；操作日志一条（放弃人名下，action giveup）。
 *      市场管理、销售管理在项目节点记录（项目页「进程变更」）里看得到，和超时转的记录同一处，不另开页
 *   8. 通知（站内 + 飞书，notify 同超时转的通道）：接手人收「分给你」，正文写「同事 X 主动放弃（豁免）转给你」；放弃人收一条确认
 *
 * 从通知直达（11-21，用户「通知里面直接加上这个按钮」）：分到我的线索（自动 / 指定分配、超时转来、同事放弃转来，notice-sources.ts 分配通知，
 * 只一条项目的）和超时提醒（reply-overdue.ts 发超时提醒）发出那一刻，对收件人按 放弃资格 能放弃（可 = true）才带 ?giveup=1（通知放弃链接）：
 * 飞书多一个「放弃（豁免）」链接；项目页带参数打开自动弹框，不能放弃时弹 放弃资格明细 的那句（GiveUpBanner）。
 * 首页置顶条、铃铛按钮（11-21，客户「用最短的路径让销售触达」）：我能放弃的（只查本人、一批判，判一批 同单条一份判定）此刻能放弃的才出，
 * 原地弹同一个放弃框（projects/[id]/GiveUpDialog）
 */
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 看全部 } from "@/lib/team-scope";
import { 查完再写 } from "@/lib/check-then-write";
import { 不刷新页面 } from "@/lib/revalidate-safe";
import { 放弃转理由 } from "@/lib/project/timeout";
import { 超时转出 } from "@/app/(app)/leads/assign-actions";
import { 企业版 } from "./switch";
import { 项目有未裁定异议 } from "./objection-guard";
import { 规则开着 } from "./rules";
import { 自动分配池, 读线部门 } from "./assign-eta";
import { 超时转的线 } from "./flow-line-core";
import { 月份 } from "./lead-assign";
import { 读组织于 } from "./org";
import { 只读角色 } from "./permissions";
import { 负责人跟过的, 分配后沟通过的, 读试过, 本轮排除, 客户随线索, 超时提醒分钟, 客户在谁名下话, 放弃过的人, 会按超时计时, 超时时限们 } from "./reply-overdue";
import type { 客户去向 } from "./reply-overdue";
import { 超时转令牌 } from "./scheduled-assign-token";
import { 系统操作人 } from "./scheduled-assign";
import { 放弃待补种类 } from "./invalid-makeup";
import { notify } from "./notify";
import { 挑不到原因 } from "./await-assign-core";
import { 分配通知 } from "./notice-sources";
import {
  新分配时刻, 在放弃窗口, 认放弃原因, 本月用过话, 每月放弃次数, 不给放弃话, 项目不给放弃, 通知链接带放弃, 放弃窗口天, 首页放弃最多, 放弃时限话,
  type 放弃入口, type 我能放弃的线索,
} from "./lead-giveup-core";

export * from "./lead-giveup-core";

/** 主动放弃开关：组织规则（rules-table.ts），默认关 */
export const 主动放弃开着 = (): Promise<boolean> => 规则开着("主动放弃");
/** 通知种类（铃铛里的来源） */
export const 放弃通知种类 = "主动放弃";

/** 这个月放弃过没有（北京自然月） */
export async function 本月放弃过(userId: string, 现在: Date = new Date()): Promise<boolean> {
  return !!(await prisma.entLeadGiveUp.findFirst({ where: { userId, month: 月份(现在) }, select: { id: true } }));
}

type 看的项目 = { id: string; name: string; ownerId: string; creatorId: string; customerId: string; createdAt: Date };

/** 放弃资格的明细：给 = 资格；不给 = 为什么（不给放弃话 里那几句） */
export type 放弃资格明细结果 = { 资格: 放弃入口 & { p: 看的项目; 接手于: Date } } | { 不给: string };

/**
 * 这条线索给不给我放弃（项目页按钮、点的时候、通知带不带「放弃（豁免）」都问它）：不给 = null（按钮不出现）；给但点不了 = 可 false + 为什么。
 * 只读，看全部（判定和谁在看无关，进门的权限由调用方保证：只有负责人本人会拿到非 null）
 */
export async function 放弃资格(me: Pick<SessionUser, "id" | "视图由">, projectId: string, 现在: Date = new Date()): Promise<(放弃入口 & { p: 看的项目; 接手于: Date }) | null> {
  const r = await 放弃资格明细(me, projectId, 现在);
  return "资格" in r ? r.资格 : null;
}

/** 判资格要读的项目列（单条、首页一批同一份） */
const 判的列 = {
  id: true, name: true, ownerId: true, creatorId: true, customerId: true, createdAt: true, flowLine: true,
  phase: true, result: true, pooledAt: true, awaitAssignAt: true, deletedAt: true, customer: { select: { pool: { select: { customerId: true } } } },
} as const;
type 判的行 = 看的项目 & {
  flowLine: string | null; phase: string; result: string | null; pooledAt: Date | null; awaitAssignAt: Date | null; deletedAt: Date | null;
  customer: { pool: { customerId: string } | null } | null;
};

/** 同 放弃资格，不给时回为什么（项目页从通知带 ?giveup=1 打开、又没有入口时弹这一句） */
export async function 放弃资格明细(me: Pick<SessionUser, "id" | "视图由">, projectId: string, 现在: Date = new Date()): Promise<放弃资格明细结果> {
  if (!企业版() || !me?.id) return { 不给: 不给放弃话.不在手上 };
  if (me.视图由) return { 不给: 不给放弃话.切换视图 };
  if (!(await 主动放弃开着())) return { 不给: 不给放弃话.没开 };
  return 看全部(async (): Promise<放弃资格明细结果> => {
    const org = await 读组织于(prisma);
    if (只读角色({ id: me.id }, org)) return { 不给: 不给放弃话.只读 };
    const 行 = await prisma.project.findFirst({ where: { id: projectId }, select: 判的列 });
    if (!行) return { 不给: 不给放弃话.不在手上 };
    return (await 判一批(me.id, org, [行], 现在)).get(行.id) ?? { 不给: 不给放弃话.不在手上 };
  });
}

/**
 * 判一批项目（同一个人）给不给放弃：单条（放弃资格明细）和首页 / 铃铛一批（我能放弃的）同一份判定。
 * 调用方已在 看全部 里、已查过开关开着、不是只读身份。查询次数和条数无关（一批 in 查），只有「最近那条分配不计数」的才逐条问补发
 */
async function 判一批(me: string, org: Awaited<ReturnType<typeof 读组织于>>, 行们: readonly 判的行[], 现在: Date): Promise<Map<string, 放弃资格明细结果>> {
  const 结果 = new Map<string, 放弃资格明细结果>();
  const 设 = 行们.length ? await 读线部门() : null;
  const 留: 判的行[] = [];
  for (const 行 of 行们) {
    const 状态不给 = 项目不给放弃(me, { ...行, 客户在公海: 行.customer?.pool != null });
    if (状态不给) { 结果.set(行.id, { 不给: 状态不给 }); continue; }
    // 本线自动分配候选（同超时转出：线 = 项目上存的流转线，没存按他所在事业部兜底；候选池同自动分配那一份）
    const 线 = 超时转的线(org, 设, 行.flowLine, me);
    if (!线 || !自动分配池(org, null, 线, 设!).includes(me)) { 结果.set(行.id, { 不给: 不给放弃话.不在分配池 }); continue; }
    留.push(行);
  }
  if (!留.length) return 结果;
  const ids = 留.map((p) => p.id);
  const [痕们, 分配们, 补发们] = await Promise.all([
    prisma.projectNodeLog.findMany({ where: { projectId: { in: ids }, kind: { in: ["transfer", "pool-claim"] } }, select: { projectId: true, kind: true, userId: true, reason: true, toOwnerId: true, at: true } }),
    prisma.entLeadAssign.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, toUserId: true, byUserId: true, createdAt: true, counted: true } }),
    // 补发给他的（补发 counted=false，但用掉过他的待补，invalid-makeup.ts 是补发来的 的一批版）
    prisma.entLeadMakeup.findMany({ where: { usedProjectId: { in: ids }, userId: me, usedAt: { not: null } }, select: { usedProjectId: true } }),
  ]);
  const 补发 = new Set(补发们.map((r) => r.usedProjectId));
  const 接手们: (看的项目 & { 基: Date })[] = [];
  for (const 行 of 留) {
    const 分 = 分配们.filter((a) => a.projectId === 行.id);
    const 接手 = 新分配时刻(me, 行, 痕们.filter((l) => l.projectId === 行.id), 分);
    if (!接手) { 结果.set(行.id, { 不给: 不给放弃话.不是新分配 }); continue; }
    if (!在放弃窗口(接手, 现在)) { 结果.set(行.id, { 不给: 不给放弃话.过了窗口 }); continue; }
    // 占过名额的才给放弃、才补（M-线索-02「没占过额度的不补」）：他在这条上最近一条分配记录算数（自动 / 指定 / 定时分配、超时转来、放弃转来），
    // 或这条是补发给他的（补发 counted=false，但用掉过他的待补）。管理从公海分（P-转-29 ③）、企划不计数的 counted=false：不出按钮
    const 最近分 = 分.filter((a) => a.toUserId === me).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!最近分 || (!最近分.counted && !补发.has(行.id))) { 结果.set(行.id, { 不给: 不给放弃话.没占名额 }); continue; }
    接手们.push({ id: 行.id, name: 行.name, ownerId: 行.ownerId, creatorId: 行.creatorId, customerId: 行.customerId, createdAt: 行.createdAt, 基: 接手 });
  }
  if (!接手们.length) return 结果;
  // 本人还没记有效沟通（同超时转「首次沟通」：这位客户上他记过的、或接手以后挂这条记的，只认本人）
  const [跟过, 分配后, 本月已用, 验证中们] = await Promise.all([
    负责人跟过的(接手们), 分配后沟通过的(接手们), 本月放弃过(me, 现在),
    企业版() ? prisma.entLeadVerify.findMany({ where: { projectId: { in: 接手们.map((p) => p.id) }, pending: { not: null } }, select: { projectId: true } }) : [],
  ]);
  const 验证中 = new Set(验证中们.map((v) => v.projectId));
  for (const { 基: 接手, ...p } of 接手们) {
    if (跟过.has(p.id) || 分配后.has(p.id)) { 结果.set(p.id, { 不给: 不给放弃话.记过沟通 }); continue; }
    // 验证中（同 lead-verify-guard.ts 验证中不能改派：EntLeadVerify.pending 有值）
    if (验证中.has(p.id)) 结果.set(p.id, { 资格: { p, 接手于: 接手, 可: false, 为什么: 验证中话, 本月已用 } });
    else if (本月已用) 结果.set(p.id, { 资格: { p, 接手于: 接手, 可: false, 为什么: 本月用过话, 本月已用 } });
    else 结果.set(p.id, { 资格: { p, 接手于: 接手, 可: true, 本月已用 } });
  }
  return 结果;
}

const 验证中话 = "这条线索在验证中，不能放弃（不能改负责人）；验证走完或先撤回验证";

/**
 * 我此刻能放弃（可 = true）的线索（首页置顶条、铃铛里那颗按钮，11-21 客户「用最短的路径让销售触达」）：只查本人，
 * 先按「往回 放弃窗口天 + 1 天内分给我的分配记录」圈出候选（能放弃的必有一条分给他的分配记录，判定里 最近分 要它），再一批判。
 * 本月用过、开关关、切换视图、只读身份 = 空，不往下查。带上离超时还剩多久（超时转计时的按超时，不计时的按放弃窗口）。从不抛（出错 = 空，首页照开）
 */
export async function 我能放弃的(me: Pick<SessionUser, "id" | "视图由">, 现在: Date = new Date(), 最多 = 首页放弃最多): Promise<我能放弃的线索[]> {
  try {
    if (!企业版() || !me?.id || me.视图由 || !(await 主动放弃开着())) return [];
    if (await 本月放弃过(me.id, 现在)) return [];
    return await 看全部(async () => {
      const org = await 读组织于(prisma);
      if (只读角色({ id: me.id }, org)) return [];
      const 起 = new Date(现在.getTime() - (放弃窗口天 + 1) * 86_400_000);
      // 按分配时间倒序（新建早、最近才分来的也排得进）：近 8 天分给我的就这些，条数有限；同一时刻的按记录 id，次次一样
      const 分给我 = await prisma.entLeadAssign.findMany({
        where: { toUserId: me.id, createdAt: { gte: 起 }, projectId: { not: null } }, select: { projectId: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const 候选 = [...new Set(分给我.map((a) => a.projectId!))];
      if (!候选.length) return [];
      const 先后 = new Map(候选.map((id, i) => [id, i]));
      const 行们 = (await prisma.project.findMany({
        where: { id: { in: 候选 }, ownerId: me.id, deletedAt: null, phase: "线索", result: null, pooledAt: null, awaitAssignAt: null, customer: { pool: null } },
        select: 判的列,
      })).sort((a, b) => 先后.get(a.id)! - 先后.get(b.id)!).slice(0, 最多 * 3);
      const 判 = await 判一批(me.id, org, 行们, 现在);
      const 能: { p: 看的项目; 接手于: Date }[] = [];
      for (const 行 of 行们) {
        const r = 判.get(行.id);
        if (r && "资格" in r && r.资格.可) 能.push(r.资格);
      }
      if (!能.length) return [];
      // 离超时还剩多久：同超时转那一套（reply-overdue.ts 超时时限们，链在走按链、还没起链按基准算）；不计时的按放弃窗口还剩多久
      const 时限们 = await 超时时限们(能.map((x) => ({ id: x.p.id, 接手于: x.接手于 })), 现在);
      return 能
        // 同一时刻接手的按项目 id 倒序：首页每次刷新顺序不跳
        .sort((a, b) => b.接手于.getTime() - a.接手于.getTime() || (a.p.id < b.p.id ? 1 : a.p.id > b.p.id ? -1 : 0))
        .slice(0, 最多)
        .map(({ p, 接手于 }) => {
          const 时限 = 时限们.get(p.id) ?? { 种: "窗口" as const, 截止: new Date(接手于.getTime() + 放弃窗口天 * 86_400_000) };
          return { projectId: p.id, name: p.name, 接手于: 接手于.toISOString(), 时限话: 放弃时限话(时限.种, 时限.截止, 现在) };
        });
    });
  } catch (e) {
    console.error("[主动放弃] 首页 / 铃铛能放弃的没读出来", e);
    return [];
  }
}

/**
 * 通知链接带不带「放弃（豁免）」（11-21）：发通知那一刻对收件人能放弃（资格在、可点）才带 ?giveup=1，
 * 开关关、不给、验证中、本月用过的照旧只给原链接。从不抛（出错 = 原链接，通知照发）
 */
export async function 通知放弃链接(userId: string, projectId: string, link: string, 现在: Date = new Date()): Promise<string> {
  try {
    return 通知链接带放弃(link, await 放弃资格({ id: userId }, projectId, 现在));
  } catch (e) {
    console.warn(`[主动放弃] ${projectId} 通知链接没判成，照旧只给原链接：`, e instanceof Error ? e.message : e);
    return link;
  }
}

/**
 * 放弃的结果。成了带上客户（铃铛里放弃后判断当前页是不是这条 / 这位客户，是就别刷新、去项目列表，lead-giveup-core.ts 放弃后要离开）：
 * 客户去向 = 客户跟着走（一起给了接手人）/ 留给原负责人（他手上还有这位客户别的项目）/ 不动（公海、归别人）
 */
export type 放弃结果 = { ok: true; 接手人: string; customerId?: string; 客户去向?: 客户去向 } | { ok: false; error: string };

/** Prisma 唯一键冲突（P2002）或 SQLite 的 UNIQUE constraint failed */
const 是唯一键冲突 = (e: unknown): boolean =>
  (e as { code?: string } | null)?.code === "P2002" || /UNIQUE constraint failed/i.test(String((e as Error | null)?.message ?? e));

/** 节点记录里放弃转的那一行（最近一条转给 新、原因带 痕附 的）补成「…，原因：…，转给 Y」 */
async function 补上接手人(projectId: string, 新: string, 痕附: string, 接手人: string): Promise<void> {
  const 行 = await prisma.projectNodeLog.findFirst({
    where: { projectId, kind: "transfer", toOwnerId: 新, reason: { contains: 痕附 } }, orderBy: { at: "desc" }, select: { id: true, reason: true },
  });
  if (!行?.reason) return;
  await prisma.projectNodeLog.update({ where: { id: 行.id }, data: { reason: 行.reason.replace(痕附, `${痕附}，转给 ${接手人}`) } });
}

/** 有转让异议待裁定时点放弃的拦话（同超时转：裁定前不动，裁定后再放弃；没扣次数） */
export const 放弃被异议拦话 = "这条线索有转让异议待裁定，裁定后再放弃（没扣本月放弃次数）";
export const 放弃被合并异议拦话 = "这条线索有合并异议待裁定，裁定后再放弃（没扣本月放弃次数）";

/** 只剩放弃过的人能接时那句（别说「都暂停或禁止了」：是放弃过的人不再分回） */
const 只剩放弃过的话 = "本线其他人都不能接（放弃过的人不会再分回）";

/** 转不出去时那句（明确告诉不扣次数、线索还在手上）；别人在这条上也放弃过、挑不到 = 只剩放弃过的人 */
const 转不出去话 = (为什么: string, 挑不到: boolean, 别人放弃过 = false) => 挑不到 && 别人放弃过
  ? `这条转不出去：${只剩放弃过的话}。没扣本月放弃次数，线索还在你手上`
  : `${挑不到 ? "这条转不出去" : "这条没转成"}：${挑不到原因(为什么)}。没扣本月放弃次数，线索还在你手上`;

/**
 * 点「放弃」：见文件头。成了回接手人名字；不成回原因，什么都不改（占的次数退掉）。从不抛
 */
export async function 放弃线索(me: SessionUser, projectId: string, 原因: unknown, 补充: unknown, 现在: Date = new Date()): Promise<放弃结果> {
  try {
    const 认 = 认放弃原因(原因, 补充);
    const 资格 = await 放弃资格(me, projectId, 现在);
    if (!资格) return { ok: false, error: "这条线索现在不能放弃：只有新分配给你、你还没记有效沟通的线索能放弃（刷新看看）" };
    if (!资格.可) return { ok: false, error: 资格.为什么 ?? "这条线索现在不能放弃" };
    if (!认.ok) return 认;
    // 12-22 判定页 #20：这条项目（或随客户转走的那次）有转让异议待裁定时不能主动放弃（超时转对同一项目是暂停，这里同口径）。
    // 在占次数之前拦：不扣本月次数、线索还在手上
    const 异议拦 = await 项目有未裁定异议(prisma, [{ id: 资格.p.id, customerId: 资格.p.customerId, ownerId: me.id }]);
    if (异议拦) return { ok: false, error: 异议拦.includes("合并异议") ? 放弃被合并异议拦话 : 放弃被异议拦话 };
    // 挑人要数全组本月已分、读同事的参与状态：同超时转在钟上那样看全部，不按点的人的可见范围。
    // 不刷新页面：转出走的 分项目给 会 revalidate，server action 里 revalidate 过 Next 就重画当前页，线索已转走 → 落「找不到」（3703 实操 r22）
    return await 不刷新页面(() => 看全部(() => 放出去(me, 资格, 认, 现在)));
  } catch (e) {
    console.error(`[主动放弃] ${projectId} 出错`, e);
    return { ok: false, error: "这次没放弃成，刷新看看再点" };
  }
}

async function 放出去(
  me: SessionUser, 资格: { p: 看的项目 }, 认: { 原因: string; 补充: string | null; 文字: string }, 现在: Date,
): Promise<放弃结果> {
  const { p } = 资格;
  const projectId = p.id;
  const 月 = 月份(现在);
  // 1. 先占次数：(userId, month) 唯一，同时点两条只成一条
  let 占: string;
  try {
    占 = (await prisma.entLeadGiveUp.create({ data: { userId: me.id, month: 月, projectId, reason: 认.原因, note: 认.补充 } })).id;
  } catch (e) {
    // 只有 (userId, month) 唯一键冲突才是「本月用过了」（同时点两条）；别的错（库锁、磁盘）照实说没放弃成
    if (是唯一键冲突(e)) return { ok: false, error: 本月用过话 };
    console.error(`[主动放弃] ${projectId} 占次数出错`, e);
    return { ok: false, error: "这次没放弃成，刷新看看再点" };
  }
  const 退次数 = () => prisma.entLeadGiveUp.deleteMany({ where: { id: 占 } }).catch((e) => console.error("[主动放弃] 退次数没退成", e));
  // 2. 挑人转出：同超时转（排除放弃人和这一轮超时过的人，挑不到开新一轮、仍不给放弃人）
  const 链 = await prisma.entReplyOverdue.findUnique({ where: { projectId }, select: { tried: true, transfers: true, stoppedAt: true } });
  const 试过 = 链 && !链.stoppedAt ? 读试过(链.tried) : [];
  // 项目节点记录那行（进程变更，管理、市场都看）写第三人称，转成了再补「，转给 Y」；接手人通知里才说「转给你」
  const 痕附 = `${me.name} ${放弃转理由}，原因：${认.文字}`;
  const 附 = `同事 ${me.name} ${放弃转理由}转给你，原因：${认.文字}`;
  // 这条线索上放弃过的人（含刚占的这一行 = 放弃人自己）都不给，开新一轮也不给（没起链就放弃的，链里没有他们）
  const 放弃过 = await 放弃过的人(projectId);
  let 排除 = [...new Set([...本轮排除(试过, me.id), ...放弃过])];
  const 新轮排除 = [...new Set([me.id, ...放弃过])];
  let r = await 超时转出(超时转令牌, 系统操作人, projectId, me.id, 排除, 痕附);
  if (!r.ok && r.挑不到 && 新轮排除.length < 排除.length) {
    排除 = 新轮排除;
    r = await 超时转出(超时转令牌, 系统操作人, projectId, me.id, 排除, 痕附);
  }
  if (!r.ok) {
    await 退次数();
    return { ok: false, error: 转不出去话(r.error, !!r.挑不到, 放弃过.some((id) => id !== me.id)) };
  }
  const 新 = r.接手人Id;
  // 节点记录那行补上接手人（超时转出 写的时候还不知道挑中谁）。补不上只记日志
  await 补上接手人(projectId, 新, 痕附, r.接手人).catch((e) => console.error(`[主动放弃] ${projectId} 节点记录没补上接手人`, e));
  // 3. 次数记上接手人、给放弃人记 1 条待补（方向 = 他这条的分配方向）
  // 线索已经转走、次数已经占上：这一步出错只记日志、照常回成功（不能让人以为没放弃成再点一次）
  try {
    await 查完再写(async (tx) => {
      const 分 = await tx.entLeadAssign.findFirst({ where: { projectId, toUserId: me.id }, orderBy: { createdAt: "desc" }, select: { line: true } });
      const 补 = await tx.entLeadMakeup.create({ data: { userId: me.id, projectId, line: 分?.line ?? null, kind: 放弃待补种类, createdAt: 现在 } });
      await tx.entLeadGiveUp.update({ where: { id: 占 }, data: { toUserId: 新, makeupId: 补.id } });
    });
  } catch (e) {
    console.error(`[主动放弃] ${projectId} 待补 / 接手人没记上（线索已转给 ${新}）`, e);
  }
  // 4. 超时链在走的：链上记成接手人、从现在起算，放弃人记进这一轮（轮转不再给回他）
  if (链 && !链.stoppedAt) {
    await prisma.entReplyOverdue.update({
      where: { projectId },
      data: { holderId: 新, since: 现在, overdueAt: null, tried: JSON.stringify([...new Set([...本轮排除(试过, me.id), me.id])]), transfers: 链.transfers + 1 },
    }).catch((e) => console.error(`[主动放弃] ${projectId} 超时链没跟上`, e));
  }
  // 5. 客户随线索（同超时转）
  const 客户 = await 客户随线索(projectId, p.customerId, me.id, 新).catch((e) => {
    console.error(`[主动放弃] ${projectId} 客户没跟过去`, e);
    return { 去向: "不动" as const, 在谁名下: null };
  });
  const 客户名下 = 客户.在谁名下 && 客户.在谁名下 !== 新
    ? (await prisma.user.findUnique({ where: { id: 客户.在谁名下 }, select: { name: true } }))?.name ?? null
    : null;
  // 6. 留痕：操作日志（项目节点记录那行 超时转出 已记，操作人 系统、原因带 附）
  await recordAudit({
    user: { id: me.id, name: me.name }, action: "giveup", entity: "Project", entityId: projectId,
    summary: `主动放弃（豁免）：「${p.name}」转给「${r.接手人}」，原因：${认.文字}`,
    detail: { 原负责人: me.id, 接手人: 新, 原因: 认.原因, ...(认.补充 ? { 补充: 认.补充 } : {}), 月: 月, 客户: 客户.去向 },
  });
  // 7. 通知：接手人收「分给你」+ 同事主动放弃那句；放弃人收确认
  // 接手人这条会按超时计时（开关开着、分配基准不早于生效时刻）才写那句；生效以前分的线索不计时，不吓人
  const 计时话 = (await 会按超时计时(projectId, 现在).catch(() => false)) ? `；请在 ${超时提醒分钟 / 60} 小时内记一条有效沟通，没记会按超时规则再转走` : "";
  await 分配通知(系统操作人, [{ projectId, toUserId: 新, ...(r.留下 ? { 留下: r.留下 } : {}) }], true, `${附}${客户名下 ? `；${客户在谁名下话(客户名下)}` : ""}${计时话}`);
  const 客户话 = 客户.去向 === "留给原负责人" ? "你手上还有这位客户别的项目，客户还在你名下；" : 客户.去向 === "跟着走" ? "客户一起给了接手人；" : "";
  await notify([me.id], {
    kind: 放弃通知种类,
    title: `已放弃：${p.name}`,
    body: `已转给 ${r.接手人}（原因：${认.文字}）。${客户话}本月放弃次数已用（每人每月 ${每月放弃次数} 次）；已给你记 1 条待补，下一条自动分配先补给你，补的那条不计入本月已分`,
    key: `giveup:${projectId}:${me.id}:${月}`,
  });
  return { ok: true, 接手人: r.接手人, customerId: p.customerId, 客户去向: 客户.去向 };
}
