/**
 * 客户三态 · 读库和夜扫（M-公海-16～M-公海-37，三态落地计划 P4）。算法在 tri-state.ts（纯函数），这里只把库里的事实收齐、把结果写回去。
 *
 * 收哪些事实（一位客户）：
 *   - 计时范围（M-公海-34）：有负责人（不是无负责人占位账号）、不在客户公海、没标无效；负责人是市场（市场角色、又不兼销售）的不计；已删的读不到（软删统一滤掉）
 *   - 最近有内容的沟通日：挂客户的、挂名下任一项目的（含同事负责的，沟通都带着 customerId）都算；发生时刻晚于现在的（排着的计划）不算；内容判定见 tri-state-quota.ts 有内容的沟通
 *   - 最近项目推进日：名下没进公海的项目，建项目和换节点（ProjectNodeLog kind = node）里最晚的（建项目算一次动静，同现行超时回收的起点，推断）
 *   - 名下项目（没进公海的）：阶段、业务线（项目业务线：没填按负责人的线）、同事负责、结束没有、结束日（最后一行带结局的换节点留痕，没有就 updatedAt）
 *   - 导入完成日：这位客户是哪一批导入建的（EntImportRow entity = customer、kind = create，批次没撤销）那一批的完成时刻
 *   - 换负责人（CustomerOwnerLog）：assign = 转让、deactivate = 离职交接、claim = 公海捞取、pool-assign = 公海指派、market-assign = 市场首次分配；
 *     undo、pool-release 不算。转让 / 离职交接归不归零按时间先后用现在的规则现算（推断：转让那一刻没存，规则后改会回改历史，见 换负责人们of）
 *   - 推后、暂缓回收：读状态留痕（tri-state-quota.ts 留痕转推后 / 最近暂缓回收日）
 *   - 本轮提醒：钟上的 noticeCount / lastNoticeDay。待回收时当「本轮待回收提醒次数 / 最近提醒日」；沉睡时 lastNoticeDay 当「本轮进入沉睡提醒日」
 *     （沉睡期间发的周报、抄上级也写 lastNoticeDay，日子都不早于沉睡节点日，不影响「进入沉睡那条发过没有」的判法）；换状态时清零
 *
 * 写什么：
 *   - 客户钟：一位客户一行，状态（活跃 / 沉睡 / 待回收；该进公海也记待回收）、进入日、被挡、成交成立日（首次成立那天）、额度缓存（次数、合计天数、额度上次重置日）
 *   - 状态留痕：第一次建钟、每次换状态、被挡、自动进公海各一行，方式「自动」
 *   - 自动进客户公海（M-公海-17 唯一的自动动作）：同手动放进公海那一套（pool-link.ts 客户名下在推项目进公海 + 客户进公海清负责人），
 *     公海那一行不记操作人（统一公海「入池方式」认成超时回收），项目留痕记系统
 *
 * 只在企业版、项目模式开着、组织规则里三态开着时跑；三态开着时项目超时回收不再跑（db.ts 按规则收回）。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 企业版 } from "./switch";
import { getBusiness } from "@/lib/business";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import type { 组织规则, 三态规则 } from "@/lib/project/org-rules";
import { 算三态, 换负责人归零, type 三态事实, type 三态结果, type 三态项目, type 换负责人记录, type 换负责人方式 } from "./tri-state";
import { 有内容的沟通, 留痕转推后, 最近暂缓回收日, 额度回满, 留痕方式, type 留痕行 } from "./tri-state-quota";
import { 项目业务线 } from "./assign-line";
import { 读组织, type 组织 } from "./org";
import { 是市场角色, 是销售角色 } from "./permissions";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 看全部 } from "@/lib/team-scope";
import { 查完再写 } from "@/lib/check-then-write";
import { 交接中的客户 } from "./handover-db";
import { 客户名下在推项目进公海, 客户进公海清负责人 } from "./pool-link";
import { 系统 } from "@/lib/project/timeout";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 忘掉企业版范围 } from "./visibility";
import { recordAudit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";
import { beijingDay } from "@/lib/business-clock";

type 库 = Prisma.TransactionClient | typeof prisma;

/** 钟上存的状态：该进公海（被挡、交接中没收成的）也记待回收 */
export type 钟状态 = "活跃" | "沉睡" | "待回收";
export const 钟状态of = (r: Extract<三态结果, { 计时: true }>): 钟状态 => (r.状态 === "该进公海" ? "待回收" : r.状态);

/** 自动进客户公海那一行的说明（CustomerPool.reason、项目 pool-release 留痕、状态留痕都写它） */
export const 三态进公海理由 = (进公海天数: number) => `待回收满 ${进公海天数} 天、3 次提醒都没人处理，自动进客户公海`;
/** 被挡住时留痕那一句（M-公海-27） */
export const 被挡理由 = "到期该进公海，名下有同事在推的项目，挡住了，等条线总管理裁决";

/** 夜扫「今天按这份规则扫过了」的记号（Setting）：值 = 上海日 + 三态规则 JSON，规则改了当晚重算（M-公海-37） */
export const 三态扫过键 = "entTriStateScanned";

const 换人方式: Readonly<Record<string, 换负责人方式>> = { assign: "转让", deactivate: "离职交接", claim: "公海捞取", "pool-assign": "公海指派", "market-assign": "市场首次分配" };

/** 一位客户收齐的东西：算三态要的事实 + 钟 + 留痕（写回时要） */
export type 三态客户 = {
  id: string;
  name: string;
  salesOwnerId: string;
  在公海: boolean;
  事实: 三态事实;
  钟: Prisma.EntCustomerClockGetPayload<object> | null;
  留痕: 留痕行[];
  /** 名下同事负责、没结束的项目负责人（裁决「让同事结束项目」时通知谁） */
  同事们: string[];
};

/** 换负责人记录（按时间正序）→ 算三态要的记录：转让 / 离职交接按先后、拿现在的规则现算归不归零 */
export function 换负责人们of(行们: readonly { at: Date; kind: string }[], 规则: Pick<三态规则, "转让归零">): 换负责人记录[] {
  const 出: 换负责人记录[] = [];
  for (const r of 行们) {
    const 方式 = 换人方式[r.kind];
    if (!方式) continue;
    const 日 = beijingDay(r.at);
    if (方式 === "转让" || 方式 === "离职交接") 出.push({ 日, 方式, 归零: 换负责人归零(出, { 日, 方式 }, 规则) });
    else 出.push({ 日, 方式 });
  }
  return 出;
}

const 分批 = <T,>(xs: readonly T[], n = 500): T[][] => {
  const 出: T[][] = [];
  for (let i = 0; i < xs.length; i += n) 出.push(xs.slice(i, i + n));
  return 出;
};
const 较晚日 = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a > b ? a : b);

/**
 * 把这些客户的事实收齐。db 传 tx 时在事务里读（自动进公海前按最新的重算一遍）。
 * 调用方包 看全部()：同事的项目、沟通都要算进来
 */
export async function 收三态客户(db: 库, ids: readonly string[], 规则: 组织规则, org: 组织, 现在: Date): Promise<Map<string, 三态客户>> {
  const 出 = new Map<string, 三态客户>();
  if (!ids.length) return 出;
  const 占位 = await 无负责人占位Id(db);
  const 起算日 = 规则.超时回收.起算日 || undefined;
  const 成员线 = new Map([...org.成员].map(([id, m]) => [id, { line: m.line }]));
  for (const 批 of 分批(ids)) {
    const 客户们 = await db.customer.findMany({
      where: { id: { in: 批 } },
      select: { id: true, name: true, salesOwnerId: true, poolInvalidAt: true, pool: { select: { customerId: true } }, entClock: true },
    });
    const 项目们 = await db.project.findMany({
      where: { customerId: { in: 批 }, pooledAt: null },
      select: { id: true, customerId: true, ownerId: true, phase: true, result: true, bizLine: true, createdAt: true, updatedAt: true },
    });
    const 项目ids = 项目们.map((p) => p.id);
    const 推进 = new Map<string, Date>(), 结局 = new Map<string, Date>();
    for (const 小 of 分批(项目ids)) {
      for (const g of await db.projectNodeLog.groupBy({ by: ["projectId"], where: { projectId: { in: 小 }, kind: "node" }, _max: { at: true } })) if (g._max.at) 推进.set(g.projectId, g._max.at);
      for (const g of await db.projectNodeLog.groupBy({ by: ["projectId"], where: { projectId: { in: 小 }, kind: "node", toResult: { not: null } }, _max: { at: true } })) if (g._max.at) 结局.set(g.projectId, g._max.at);
    }
    const 沟通日 = await 最近有内容沟通日们(db, 批, 现在);
    const 导入 = await 导入完成日们(db, 批);
    const 换人 = await db.customerOwnerLog.findMany({ where: { customerId: { in: 批 } }, select: { customerId: true, at: true, kind: true }, orderBy: { at: "asc" } });
    const 痕 = await db.entCustomerStateLog.findMany({
      where: { customerId: { in: 批 } },
      select: { customerId: true, at: true, fromState: true, toState: true, via: true, reason: true, holdDays: true },
      orderBy: { at: "asc" },
    });
    const 按客户 = <T extends { customerId: string }>(xs: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of xs) m.set(x.customerId, [...(m.get(x.customerId) ?? []), x]);
      return m;
    };
    const 项目of = 按客户(项目们), 换人of = 按客户(换人), 痕of = 按客户(痕);
    for (const c of 客户们) {
      const 有负责人 = !!c.salesOwnerId && c.salesOwnerId !== 占位;
      const ps = 项目of.get(c.id) ?? [];
      let 最近推进: string | null = null;
      const 三态项目们: 三态项目[] = ps.map((p) => {
        const 推 = beijingDay(推进.get(p.id) ?? p.createdAt);
        最近推进 = 较晚日(最近推进, 推);
        const 同事负责 = !!p.ownerId && p.ownerId !== c.salesOwnerId;
        const 基 = { 阶段: p.phase as 三态项目["阶段"], 业务线: 项目业务线(p, 成员线), 同事负责, 最近推进日: 推 };
        return p.result ? { ...基, 结束: true as const, 结束日: beijingDay(结局.get(p.id) ?? p.updatedAt) } : { ...基, 结束: false as const };
      });
      const 留痕: 留痕行[] = (痕of.get(c.id) ?? []).map((x) => ({ 日: beijingDay(x.at), fromState: x.fromState, toState: x.toState, via: x.via, reason: x.reason, holdDays: x.holdDays }));
      const 钟 = c.entClock;
      const 待回收中 = 钟?.state === "待回收";
      const 事实: 三态事实 = {
        有负责人,
        在公海: !!c.pool,
        已删: false,
        无效: !!c.poolInvalidAt,
        负责人是市场: 有负责人 && 是市场角色(org, c.salesOwnerId) && !是销售角色(org, c.salesOwnerId),
        最近沟通日: 沟通日.get(c.id) ?? null,
        最近推进日: 最近推进,
        导入完成日: 导入.get(c.id) ?? null,
        系统起算日: 起算日,
        项目们: 三态项目们,
        成交成立日: 钟?.dealDay ?? null,
        推后们: 留痕转推后(留痕),
        换负责人们: 换负责人们of(换人of.get(c.id) ?? [], 规则.三态),
        暂缓回收日: 最近暂缓回收日(留痕),
        本轮待回收提醒次数: 待回收中 ? 钟!.noticeCount : 0,
        本轮最近待回收提醒日: 待回收中 ? 钟!.lastNoticeDay : null,
        本轮进入沉睡提醒日: 钟?.state === "沉睡" ? 钟.lastNoticeDay : null,
      };
      const 同事们 = [...new Set(ps.filter((p) => !p.result && p.ownerId && p.ownerId !== c.salesOwnerId).map((p) => p.ownerId))];
      出.set(c.id, { id: c.id, name: c.name, salesOwnerId: c.salesOwnerId, 在公海: !!c.pool, 事实, 钟, 留痕, 同事们 });
    }
  }
  return 出;
}

/**
 * 每位客户最近一条有内容的沟通（上海日）。先按客户取发生时刻最晚的非空内容，最晚那条只有空白的（少见）再逐条往前找。
 * 只认发生时刻不晚于现在的（同最近跟进的算法，soft-delete.ts 重算最近跟进）
 */
async function 最近有内容沟通日们(db: 库, ids: readonly string[], 现在: Date): Promise<Map<string, string>> {
  const 出 = new Map<string, string>();
  const 最晚 = await db.followUp.groupBy({ by: ["customerId"], where: { customerId: { in: [...ids] }, occurredAt: { lte: 现在 }, content: { not: "" } }, _max: { occurredAt: true } });
  for (const g of 最晚) {
    const t = g._max.occurredAt;
    if (!t) continue;
    const 那条 = await db.followUp.findMany({ where: { customerId: g.customerId, occurredAt: t }, select: { content: true } });
    if (那条.some((f) => 有内容的沟通(f.content))) {
      出.set(g.customerId, beijingDay(t));
      continue;
    }
    // 最晚那条只有空白：往前一条条找（只这位客户）
    const 往前 = await db.followUp.findMany({ where: { customerId: g.customerId, occurredAt: { lt: t }, content: { not: "" } }, orderBy: { occurredAt: "desc" }, select: { content: true, occurredAt: true }, take: 200 });
    const 有 = 往前.find((f) => 有内容的沟通(f.content));
    if (有) 出.set(g.customerId, beijingDay(有.occurredAt));
  }
  return 出;
}

/** 这些客户里导入建的那几位：建它们的那一批（完成了、没撤销）的完成日（上海日）；一位被几批碰过取最晚一批 */
async function 导入完成日们(db: 库, ids: readonly string[]): Promise<Map<string, string>> {
  const 行 = await db.entImportRow.findMany({
    where: { entity: "customer", kind: "create", targetId: { in: [...ids] }, batch: { revertedAt: null, finishedAt: { not: null } } },
    select: { targetId: true, batch: { select: { finishedAt: true } } },
  });
  const 出 = new Map<string, string>();
  for (const r of 行) if (r.batch.finishedAt) 出.set(r.targetId, 较晚日(出.get(r.targetId) ?? null, beijingDay(r.batch.finishedAt))!);
  return 出;
}

/**
 * 一位客户算出来的结果要往钟上写的（没变化 = null）。纯函数，单测直接测。
 * 额度上次重置日（M-公海-38）：最近一条有内容的沟通日晚于它就记成那天；次数、合计天数按 算三态() 认的写（它只数那天以后的推后）
 */
export function 钟要改(c: Pick<三态客户, "钟" | "事实">, r: Extract<三态结果, { 计时: true }>, 今天: string): {
  data: Partial<Omit<Prisma.EntCustomerClockUncheckedCreateInput, "customerId">>;
  留痕: { fromState: string | null; toState: string; reason: string }[];
} | null {
  const 状态 = 钟状态of(r);
  const 进入日 = 状态 === "活跃" ? r.归零日 : 状态 === "沉睡" ? r.节点.沉睡 : r.节点.待回收;
  const 被挡 = r.被挡;
  const 钟 = c.钟;
  const 额 = 额度回满({ holdCount: 钟?.holdCount ?? 0, holdDays: 钟?.holdDays ?? 0, quotaResetDay: 钟?.quotaResetDay ?? null }, c.事实.最近沟通日);
  const 成交日 = 钟?.dealDay ?? (r.成交首次成立 ? 今天 : null);
  const 留痕: { fromState: string | null; toState: string; reason: string }[] = [];
  if (!钟) {
    留痕.push({ fromState: null, toState: 状态, reason: "开始按客户计三态" });
    if (被挡) 留痕.push({ fromState: 状态, toState: 状态, reason: 被挡理由 });
    return {
      data: { state: 状态, enteredDay: 进入日, blocked: 被挡, dealDay: 成交日, holdCount: r.继续持有.已用次数, holdDays: r.继续持有.已用天数, quotaResetDay: 额.quotaResetDay },
      留痕,
    };
  }
  const 换了 = 钟.state !== 状态;
  if (换了) 留痕.push({ fromState: 钟.state, toState: 状态, reason: 换状态理由(钟.state, 状态, r) });
  if (被挡 && (!钟.blocked || 换了)) 留痕.push({ fromState: 状态, toState: 状态, reason: 被挡理由 });
  const data: Partial<Omit<Prisma.EntCustomerClockUncheckedCreateInput, "customerId">> = {};
  if (换了) Object.assign(data, { state: 状态, enteredDay: 进入日, noticeCount: 0, lastNoticeDay: null, holdUntil: null });
  else if (钟.enteredDay !== 进入日) data.enteredDay = 进入日; // 推后顺延、规则改天数：同一状态里进入日跟着挪
  if (钟.blocked !== 被挡) data.blocked = 被挡;
  if (钟.dealDay !== 成交日) data.dealDay = 成交日;
  if (钟.holdCount !== r.继续持有.已用次数) data.holdCount = r.继续持有.已用次数;
  if (钟.holdDays !== r.继续持有.已用天数) data.holdDays = r.继续持有.已用天数;
  if (额.回满) data.quotaResetDay = 额.quotaResetDay;
  return Object.keys(data).length || 留痕.length ? { data, 留痕 } : null;
}

function 换状态理由(从: string, 到: 钟状态, r: Extract<三态结果, { 计时: true }>): string {
  if (到 === "活跃") return r.订单在推 ? "名下有订单阶段没结束的项目，算活跃" : "有了新动静（沟通、项目推进或换负责人），钟归零";
  if (到 === "沉睡") return 从 === "待回收" ? "继续持有顺延，退回沉睡" : `满 ${r.节点天.沉睡} 天没动静，进入沉睡`;
  return `满 ${r.节点天.待回收} 天没动静，进入待回收`;
}

/** 按算出来的结果把钟和留痕写下去；返回换没换状态、是不是刚被挡住 */
export async function 写钟(db: 库, c: 三态客户, r: Extract<三态结果, { 计时: true }>, 今天: string, at: Date): Promise<{ 换了状态: boolean; 新被挡: boolean }> {
  const 改 = 钟要改(c, r, 今天);
  if (!改) return { 换了状态: false, 新被挡: false };
  if (c.钟) await db.entCustomerClock.update({ where: { customerId: c.id }, data: 改.data });
  else await db.entCustomerClock.create({ data: { customerId: c.id, state: 钟状态of(r), ...改.data, enteredDay: 改.data.enteredDay ?? 今天 } });
  for (const x of 改.留痕) await db.entCustomerStateLog.create({ data: { customerId: c.id, fromState: x.fromState, toState: x.toState, via: 留痕方式.自动, reason: x.reason, at } });
  return { 换了状态: 改.留痕.some((x) => x.fromState !== null && x.fromState !== x.toState), 新被挡: 改.留痕.some((x) => x.reason === 被挡理由) };
}

/** 三态在不在跑：企业版、项目模式开着、组织规则里三态开着 */
export async function 三态开着(规则?: 组织规则): Promise<boolean> {
  if (!企业版()) return false;
  if ((await getBusiness()).projectMode !== true) return false;
  return (规则 ?? (await 生效组织规则())).三态.开;
}

/** 计时范围里可能有的客户：有负责人、不在公海、没标无效（市场成员名下的算的时候再排） */
async function 候选客户(db: 库): Promise<string[]> {
  const 占位 = await 无负责人占位Id(db);
  return (await db.customer.findMany({ where: { pool: { is: null }, poolInvalidAt: null, salesOwnerId: { not: 占位 } }, select: { id: true }, orderBy: { id: "asc" } })).map((c) => c.id);
}

export type 三态夜扫明细 = { 算了: number; 换状态: number; 进公海: string[]; 新被挡: number; 交接中没收: number };

/**
 * 夜扫（00:05 那一遍里，nightly.ts 调）：按客户算三态、写钟和留痕，到了自动进公海的进客户公海。
 * 三态没开 = null，什么都不做。同一天按同一份三态规则只扫一遍（记号见 三态扫过键）；改了规则当晚重算。
 * 停机几天：状态按「今天该是什么」判，开机这一遍自然补上（P-全局-07）
 */
export async function 三态夜扫(现在: Date = new Date()): Promise<三态夜扫明细 | null> {
  const 规则 = await 生效组织规则();
  if (!(await 三态开着(规则))) return null;
  const 今天 = beijingDay(现在);
  const 记号 = `${今天} ${JSON.stringify(规则.三态)}`;
  if ((await getSetting<string>(三态扫过键)) === 记号) return { 算了: 0, 换状态: 0, 进公海: [], 新被挡: 0, 交接中没收: 0 };
  const 明细 = await 看全部(() => 按客户扫(规则, 现在, 今天));
  await setSetting(三态扫过键, 记号);
  return 明细;
}

async function 按客户扫(规则: 组织规则, 现在: Date, 今天: string): Promise<三态夜扫明细> {
  const org = await 读组织();
  const ids = await 候选客户(prisma);
  const 明细: 三态夜扫明细 = { 算了: 0, 换状态: 0, 进公海: [], 新被挡: 0, 交接中没收: 0 };
  const 要收: string[] = [];
  for (const 批 of 分批(ids)) {
    const 们 = await 收三态客户(prisma, 批, 规则, org, 现在);
    for (const c of 们.values()) {
      const r = 算三态(c.事实, 规则.三态, 今天);
      if (!r.计时) continue;
      明细.算了++;
      const w = await 写钟(prisma, c, r, 今天, 现在);
      if (w.换了状态) 明细.换状态++;
      if (w.新被挡) 明细.新被挡++;
      if (r.状态 === "该进公海" && !r.被挡) 要收.push(c.id);
    }
  }
  if (!要收.length) return 明细;
  const 中 = await 交接中的客户(要收);
  明细.交接中没收 = 中.size;
  const 收 = 要收.filter((id) => !中.has(id));
  if (!收.length) return 明细;
  // 负责人要清空，也算一次换负责人：先钉住老签约（事务外，同手动放进公海）
  await 钉住老签约();
  for (const id of 收) if (await 自动进公海一位(id, 规则, org, 现在, 今天)) 明细.进公海.push(id);
  if (明细.进公海.length) {
    忘掉企业版范围();
    await (await import("./attach-approval")).进公海挂靠通知(明细.进公海);
    await recordAudit({
      user: 系统, action: "pool", entity: "Customer", entityId: 明细.进公海.length === 1 ? 明细.进公海[0] : null,
      summary: `${明细.进公海.length} 位客户待回收期满、3 次提醒都没人处理，自动进客户公海`,
      detail: { ids: 明细.进公海, 三态: 规则.三态 },
    });
  }
  return 明细;
}

/**
 * 一位客户自动进客户公海：事务里按最新的事实重算一遍（查出来到写之间有人记了沟通、点了继续持有、转走了就不收），
 * 还该进、没被挡、不在交接中才收。返回收了没有
 */
export async function 自动进公海一位(id: string, 规则: 组织规则, org: 组织, 现在: Date, 今天: string): Promise<boolean> {
  return 查完再写(async (tx) => {
    const c = (await 收三态客户(tx, [id], 规则, org, 现在)).get(id);
    if (!c) return false;
    const r = 算三态(c.事实, 规则.三态, 今天);
    if (!r.计时 || r.状态 !== "该进公海" || r.被挡) return false;
    if ((await 交接中的客户([id], tx)).size) return false;
    const 理由 = 三态进公海理由(r.节点天.进公海 - r.节点天.待回收);
    const 们 = [{ id, salesOwnerId: c.salesOwnerId }];
    // 公海那一行不记操作人：统一公海入池方式认成超时回收（unified-pool.ts 客户入池类）
    await tx.customerPool.create({ data: { customerId: id, userId: null, reason: 理由, at: 现在 } });
    // 先项目后清负责人：项目那边靠客户原来的负责人认「他自己负责的」
    await 客户名下在推项目进公海(tx, 们, 系统.id, 理由, 现在);
    await 客户进公海清负责人(tx, 们, null);
    await tx.entCustomerStateLog.create({ data: { customerId: id, fromState: c.钟?.state ?? "待回收", toState: "公海", via: 留痕方式.自动, reason: 理由, at: 现在 } });
    if (c.钟) await tx.entCustomerClock.update({ where: { customerId: id }, data: { blocked: false, holdUntil: null } });
    return true;
  });
}
