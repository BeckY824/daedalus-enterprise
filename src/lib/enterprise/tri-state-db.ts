/**
 * 客户三态 · 读库和夜扫（M-公海-16～M-公海-37，三态落地计划 P4）。算法在 tri-state.ts（纯函数），这里只把库里的事实收齐、把结果写回去。
 *
 * 收哪些事实（一位客户）：
 *   - 计时范围（M-公海-34）：有负责人（不是无负责人占位账号）、不在客户公海、没标无效；负责人是市场（市场角色、又不兼销售）的不计；已删的读不到（软删统一滤掉）
 *   - 最近有效沟通日（拨钟、回满额度同源，T1 / T2，tri-state-quota.ts 有内容的沟通）：挂客户的、挂名下任一项目的（含同事负责的，沟通都带着 customerId）都算；
 *     发生时刻晚于现在的（排着的计划）不算；空的、不足 4 字、只有占位词、只有素材链接的不算，AI 起草成功的算
 *   - 最近项目推进日：名下项目建项目和换节点（ProjectNodeLog kind = node）里最晚的（T8：建项目算一次动静，建完转给同事的照算在客户上）；
 *     退回了项目公海的项目（T3），退回前的推进算到退回那天为止，退回本身不算动静
 *   - 额度重置日（T4）：最近有效沟通、最近一次从公海领走 / 分走里较晚的那天，继续持有额度从这天起重新数
 *   - 名下项目（没进公海的）：阶段、业务线（项目业务线：没填按负责人的线）、同事负责、结束没有、结束日（最后一行带结局的换节点留痕，没有就 updatedAt）
 *   - 导入完成日：这位客户是哪一批导入建的（EntImportRow entity = customer、kind = create，批次没撤销）那一批的完成时刻
 *   - 换负责人（CustomerOwnerLog）：assign = 转让、deactivate = 离职交接、claim = 公海捞取、pool-assign = 公海指派、market-assign = 市场首次分配；
 *     undo、pool-release 不算。转让 / 离职交接归不归零第一次被算到时存在那一行（clockReset，迁移 127），之后只读（M-公海-20 / M-公海-37：改规则不回改历史）。
 *     撤销转让（T7）：企业版撤销会删掉被撤的那一行（owner-log-db.ts 删被撤的换负责人记录），次数和钟都还原；
 *     同一对负责人 7 天内第 2 次起撤销的，状态留痕里记「撤销转让·计次」，算次数时当一次不归零的转让（tri-state-transfer.ts 撤销计次们）
 *   - 推后、暂缓回收：读状态留痕（tri-state-quota.ts 留痕转推后 / 最近暂缓回收日）
 *   - 本轮提醒：钟上的 noticeCount / lastNoticeDay。待回收时当「本轮待回收提醒次数 / 最近提醒日」；沉睡时 lastNoticeDay 当「本轮进入沉睡提醒日」
 *     （沉睡期间发的周报、抄上级也写 lastNoticeDay，日子都不早于沉睡节点日，不影响「进入沉睡那条发过没有」的判法）；换状态时清零
 *
 * 写什么：
 *   - 客户钟：一位客户一行，状态（活跃 / 沉睡 / 待回收；该进公海也记待回收；进了客户公海记「公海」）、进入日、被挡、成交成立日（首次成立那天）、额度缓存（次数、合计天数、额度上次重置日）
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
import type { 组织规则 } from "@/lib/project/org-rules";
import { 算三态, 解除后几天收, type 三态事实, type 三态结果, type 三态项目 } from "./tri-state";
import { 换负责人们of, 撤销计次们, 并上撤销计次 } from "./tri-state-transfer";
export { 换负责人们of } from "./tri-state-transfer";
import { 有内容的沟通, 暂缓回收次数, 默认占位词, 占位词键, 规整占位词, 留痕转推后, 最近暂缓回收日, 额度回满, 留痕方式, 自动收回次数, type 留痕行 } from "./tri-state-quota";
import { 项目业务线 } from "./assign-line";
import { 读组织, type 组织 } from "./org";
import { 是市场角色, 是销售角色 } from "./permissions";
import { 无负责人占位Id } from "@/lib/no-owner-db";
import { 看全部 } from "@/lib/team-scope";
import { 查完再写 } from "@/lib/check-then-write";
import { 交接中的客户, 待确认 } from "./handover-db";
import { 客户名下在推项目进公海, 客户进公海清负责人 } from "./pool-link";
import { 客户退回前查联系方式, 退回号码种类表 } from "./return-contact-check";
import { 系统 } from "@/lib/project/timeout";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 忘掉企业版范围 } from "./visibility";
import { recordAudit } from "@/lib/audit";
import { getSetting, setSetting } from "@/lib/settings";
import { beijingDay } from "@/lib/business-clock";

type 库 = Prisma.TransactionClient | typeof prisma;
type 号码种类表 = Awaited<ReturnType<typeof 退回号码种类表>>;

/** 钟上存的状态：该进公海（被挡、交接中没收成的）也记待回收 */
export type 钟状态 = "活跃" | "沉睡" | "待回收";
/** 钟上「进了客户公海」的状态值（自动进公海、或别的路进了公海后夜扫标掉）：列表按状态查时不和待回收混；领走 / 分走后按换负责人重新起算 */
export const 公海状态 = "公海";
export const 钟状态of = (r: Extract<三态结果, { 计时: true }>): 钟状态 => (r.状态 === "该进公海" ? "待回收" : r.状态);

/** 自动进客户公海那一行的说明（CustomerPool.reason、项目 pool-release 留痕、状态留痕都写它） */
export const 三态进公海理由 = (进公海天数: number) => `待回收满 ${进公海天数} 天、3 次提醒都没人处理，自动进客户公海`;
/** 被挡住时留痕那一句（M-公海-27；T5 起对用户统一叫「暂缓回收」，标识符照旧叫被挡） */
export const 被挡理由 = "到期该进公海，名下有同事在推的项目，暂缓回收，等条线总管理裁决";
/** T5 改名前写的那一句（认旧留痕用） */
const 旧被挡理由 = "到期该进公海，名下有同事在推的项目，挡住了，等条线总管理裁决";
/** 暂缓回收解除（挡住的同事项目都结束了）留痕那一句（T5） */
export const 暂缓解除理由 = `名下同事的项目都结束了，暂缓回收解除：提醒 1 次，满 ${解除后几天收} 天没人处理自动进客户公海`;

/** 夜扫「今天按这份规则扫过了」的记号（Setting）：值 = 上海日 + 三态规则 JSON，规则改了当晚重算（M-公海-37） */
export const 三态扫过键 = "entTriStateScanned";


/** 一位客户收齐的东西：算三态要的事实 + 钟 + 留痕（写回时要） */
export type 三态客户 = {
  id: string;
  name: string;
  salesOwnerId: string;
  /** 客户业务线（找哪位条线总管理先看它，M-公海-24） */
  bizLine: string | null;
  在公海: boolean;
  事实: 三态事实;
  钟: Prisma.EntCustomerClockGetPayload<object> | null;
  留痕: 留痕行[];
  /** 名下同事负责、没结束的项目负责人（裁决「让同事结束项目」时通知谁） */
  同事们: string[];
  /** 这次才第一次算出归不归零的转让 / 离职交接（CustomerOwnerLog id → 归零），写库的调用方用 存归零 存下 */
  待存归零: { id: string; 归零: boolean }[];
  /** 负责人账号停用了（T12） */
  负责人停用: boolean;
  /** 这一任负责人名下已经标过「待交接」（T12：最近一次换负责人以后、记的是这位负责人）的那天；没标 null */
  待交接日: string | null;
};

/** T12：负责人停用、客户还挂在他名下，标「待交接」那一行的理由（进离职交接看板 /projects/handover，超 15 个工作日推系统管理员） */
export const 待交接理由 = "负责人账号已停用，客户标待交接、进离职交接队列";

/** 把第一次算出来的归不归零存到换负责人那一行（只写还空着的，别人先存了不覆盖） */
export async function 存归零(db: 库, 们: Iterable<Pick<三态客户, "待存归零">>): Promise<void> {
  for (const c of 们) for (const x of c.待存归零) await db.customerOwnerLog.updateMany({ where: { id: x.id, clockReset: null }, data: { clockReset: x.归零 } });
}

export const 分批 = <T,>(xs: readonly T[], n = 500): T[][] => {
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
      select: { id: true, name: true, salesOwnerId: true, bizLine: true, poolInvalidAt: true, pool: { select: { customerId: true } }, entClock: true },
    });
    const 项目们 = await db.project.findMany({
      where: { customerId: { in: 批 }, pooledAt: null },
      select: { id: true, customerId: true, ownerId: true, phase: true, result: true, bizLine: true, createdAt: true, updatedAt: true },
    });
    // T3：退回了项目公海的项目，退回前的推进照算到退回那天为止（不算退回本身，也不往后加成）
    const 退回的 = await db.project.findMany({ where: { customerId: { in: 批 }, pooledAt: { not: null } }, select: { id: true, customerId: true, createdAt: true, pooledAt: true } });
    const 项目ids = [...项目们.map((p) => p.id), ...退回的.map((p) => p.id)];
    const 推进 = new Map<string, Date>(), 结局 = new Map<string, Date>();
    for (const 小 of 分批(项目ids)) {
      for (const g of await db.projectNodeLog.groupBy({ by: ["projectId"], where: { projectId: { in: 小 }, kind: "node" }, _max: { at: true } })) if (g._max.at) 推进.set(g.projectId, g._max.at);
      for (const g of await db.projectNodeLog.groupBy({ by: ["projectId"], where: { projectId: { in: 小 }, kind: "node", toResult: { not: null } }, _max: { at: true } })) if (g._max.at) 结局.set(g.projectId, g._max.at);
    }
    const 沟通日 = await 最近沟通日们(db, 批, 现在);
    const 导入 = await 导入完成日们(db, 批);
    const 换人 = await db.customerOwnerLog.findMany({ where: { customerId: { in: 批 } }, select: { id: true, customerId: true, at: true, kind: true, clockReset: true }, orderBy: [{ at: "asc" }, { id: "asc" }] });
    const 计次 = await 撤销计次们(db, 批);
    const 痕 = await db.entCustomerStateLog.findMany({
      where: { customerId: { in: 批 } },
      select: { customerId: true, at: true, fromState: true, toState: true, via: true, reason: true, holdDays: true, fromOwnerId: true },
      orderBy: { at: "asc" },
    });
    const 停用的 = new Set((await db.user.findMany({ where: { id: { in: [...new Set(客户们.map((c) => c.salesOwnerId))] }, active: false }, select: { id: true } })).map((u) => u.id));
    const 按客户 = <T extends { customerId: string }>(xs: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of xs) m.set(x.customerId, [...(m.get(x.customerId) ?? []), x]);
      return m;
    };
    const 项目of = 按客户(项目们), 换人of = 按客户(换人), 痕of = 按客户(痕), 退回of = 按客户(退回的);
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
      for (const p of 退回of.get(c.id) ?? []) {
        const 退回日 = beijingDay(p.pooledAt!);
        const 推 = beijingDay(推进.get(p.id) ?? p.createdAt);
        最近推进 = 较晚日(最近推进, 推 < 退回日 ? 推 : 退回日);
      }
      const 留痕: 留痕行[] = (痕of.get(c.id) ?? []).map((x) => ({ 日: beijingDay(x.at), fromState: x.fromState, toState: x.toState, via: x.via, reason: x.reason, holdDays: x.holdDays }));
      const 钟 = c.entClock;
      const 待回收中 = 钟?.state === "待回收";
      // T5：最近一条「解除」晚于最近一条「挡住」才算解除过（又被挡住的按新挡住算）
      const 痕们 = 痕of.get(c.id) ?? [];
      const 末 = (理由们: readonly string[]) => { for (let i = 痕们.length - 1; i >= 0; i--) if (理由们.includes(痕们[i].reason ?? "")) return i; return -1; };
      const 解除下标 = 末([暂缓解除理由]);
      const 暂缓解除日 = 解除下标 >= 0 && 解除下标 > 末([被挡理由, 旧被挡理由]) ? beijingDay(痕们[解除下标].at) : null;
      const 换人们 = 换负责人们of(并上撤销计次(换人of.get(c.id) ?? [], 计次.get(c.id)), 规则.三态);
      const 领取日 = (换人of.get(c.id) ?? []).filter((x) => x.kind === "claim" || x.kind === "pool-assign").map((x) => beijingDay(x.at)).reduce<string | null>(较晚日, null);
      const 事实: 三态事实 = {
        有负责人,
        在公海: !!c.pool,
        已删: false,
        无效: !!c.poolInvalidAt,
        负责人是市场: 有负责人 && 是市场角色(org, c.salesOwnerId) && !是销售角色(org, c.salesOwnerId),
        最近沟通日: 沟通日.get(c.id) ?? null,
        最近有内容沟通日: 沟通日.get(c.id) ?? null,
        // T4：从公海领走 / 分走是新一轮持有，额度回满（不看前手用掉的）；市场首次分配、转让、离职交接不回满
        额度重置日: 较晚日(沟通日.get(c.id) ?? null, 领取日),
        最近推进日: 最近推进,
        导入完成日: 导入.get(c.id) ?? null,
        系统起算日: 起算日,
        项目们: 三态项目们,
        成交成立日: 钟?.dealDay ?? null,
        推后们: 留痕转推后(留痕),
        换负责人们: [...换人们],
        暂缓回收日: 最近暂缓回收日(留痕),
        暂缓解除日,
        上回被挡: !!钟?.blocked,
        最近被挡日: (() => { const i = 末([被挡理由, 旧被挡理由]); return i >= 0 ? beijingDay(痕们[i].at) : null; })(),
        暂缓回收次数: 暂缓回收次数(留痕, 较晚日(沟通日.get(c.id) ?? null, 领取日)),
        本轮待回收提醒次数: 待回收中 ? 钟!.noticeCount : 0,
        本轮最近待回收提醒日: 待回收中 ? 钟!.lastNoticeDay : null,
        本轮进入沉睡提醒日: 钟?.state === "沉睡" ? 钟.lastNoticeDay : null,
      };
      const 同事们 = [...new Set(ps.filter((p) => !p.result && p.ownerId && p.ownerId !== c.salesOwnerId).map((p) => p.ownerId))];
      // T12：这一任负责人（最近一次换负责人以后）名下标过的待交接
      const 上次换人 = (换人of.get(c.id) ?? []).at(-1)?.at ?? null;
      const 标 = 痕们.findLast((x) => x.reason === 待交接理由 && x.fromOwnerId === c.salesOwnerId && (上次换人 === null || x.at >= 上次换人));
      出.set(c.id, {
        id: c.id, name: c.name, salesOwnerId: c.salesOwnerId, bizLine: c.bizLine, 在公海: !!c.pool, 事实, 钟, 留痕, 同事们, 待存归零: 换人们.待存,
        负责人停用: 有负责人 && 停用的.has(c.salesOwnerId), 待交接日: 标 ? beijingDay(标.at) : null,
      });
    }
  }
  return 出;
}

/** 占位词表（T2）：读 Setting 占位词键，没存 / 存坏了用默认词表。db 传 tx 时在事务里读（不走设置缓存） */
export async function 读占位词(db: Pick<Prisma.TransactionClient, "setting"> = prisma): Promise<readonly string[]> {
  const 行 = await db.setting.findUnique({ where: { key: 占位词键 }, select: { value: true } });
  if (!行) return 默认占位词;
  try {
    return 规整占位词(JSON.parse(行.value)) ?? 默认占位词;
  } catch {
    return 默认占位词;
  }
}

/** 后台改占位词表（T2，界面以后做）：规整后存；传空数组 = 不认任何占位词（只剩字数那条） */
export async function 存占位词(词们: readonly string[]): Promise<string[]> {
  const 规整 = 规整占位词(词们) ?? [];
  await setSetting(占位词键, 规整);
  return 规整;
}

/**
 * 每位客户最近一条有效沟通的上海日（T1 / T2：拨钟和回满额度同源，tri-state-quota.ts 有内容的沟通）：
 * 按客户分组取最晚的非空内容，再一次取回这批「最晚那条」判；判下来无效的（空的、不足 4 字、只有占位词、只有链接）才逐位往前找。
 * 只认发生时刻不晚于现在的（同最近跟进的算法，soft-delete.ts 重算最近跟进）；同一天几条只算一次（只取日子）
 */
async function 最近沟通日们(db: 库, ids: readonly string[], 现在: Date): Promise<Map<string, string>> {
  const 出 = new Map<string, string>();
  const 词们 = await 读占位词(db);
  const 有效 = (f: { content: string; source: { followUpId: string } | null }) => 有内容的沟通(f.content, { 占位词: 词们, AI生成: !!f.source });
  const 最晚 = (await db.followUp.groupBy({ by: ["customerId"], where: { customerId: { in: [...ids] }, occurredAt: { lte: 现在 }, content: { not: "" } }, _max: { occurredAt: true } }))
    .filter((g): g is typeof g & { _max: { occurredAt: Date } } => !!g._max.occurredAt);
  const 那几条 = 最晚.length
    ? await db.followUp.findMany({ where: { OR: 最晚.map((g) => ({ customerId: g.customerId, occurredAt: g._max.occurredAt })) }, select: { customerId: true, content: true, source: { select: { followUpId: true } } } })
    : [];
  const 有字 = new Set(那几条.filter(有效).map((f) => f.customerId));
  for (const g of 最晚) {
    if (有字.has(g.customerId)) {
      出.set(g.customerId, beijingDay(g._max.occurredAt));
      continue;
    }
    // 最晚那条无效：只这位往前找，一次 200 条，找到为止
    let 早于 = g._max.occurredAt;
    for (;;) {
      const 往前 = await db.followUp.findMany({
        where: { customerId: g.customerId, occurredAt: { lt: 早于 }, content: { not: "" } },
        orderBy: { occurredAt: "desc" }, select: { content: true, occurredAt: true, source: { select: { followUpId: true } } }, take: 200,
      });
      const 有 = 往前.find(有效);
      if (有) {
        出.set(g.customerId, beijingDay(有.occurredAt));
        break;
      }
      if (往前.length < 200) break;
      早于 = 往前[往前.length - 1].occurredAt;
    }
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
export function 钟要改(c: Pick<三态客户, "钟" | "事实">, r: Extract<三态结果, { 计时: true }>, 今天: string, 换状态说明?: string): {
  data: Partial<Omit<Prisma.EntCustomerClockUncheckedCreateInput, "customerId">>;
  留痕: { fromState: string | null; toState: string; reason: string }[];
} | null {
  const 状态 = 钟状态of(r);
  const 进入日 = 状态 === "活跃" ? r.归零日 : 状态 === "沉睡" ? r.节点.沉睡 : r.节点.待回收;
  const 被挡 = r.被挡;
  const 钟 = c.钟;
  const 额 = 额度回满({ holdCount: 钟?.holdCount ?? 0, holdDays: 钟?.holdDays ?? 0, quotaResetDay: 钟?.quotaResetDay ?? null }, c.事实.额度重置日 ?? c.事实.最近有内容沟通日 ?? null);
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
  if (换了) 留痕.push({ fromState: 钟.state, toState: 状态, reason: 换状态说明 ?? 换状态理由(钟.state, 状态, r) });
  if (被挡 && (!钟.blocked || 换了)) 留痕.push({ fromState: 状态, toState: 状态, reason: 被挡理由 });
  // T5：今天刚解除（钟上还记着被挡、留痕里还没有解除那行）
  if (钟.blocked && !被挡 && r.暂缓解除日 === 今天 && !c.事实.暂缓解除日) 留痕.push({ fromState: 状态, toState: 状态, reason: 暂缓解除理由 });
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
  if (从 === 公海状态) return "从客户公海领走 / 分走，换了负责人，重新起算";
  if (到 === "活跃") return r.订单在推 ? "名下有订单阶段没结束的项目，算活跃" : "有了新动静（沟通、项目推进或换负责人），钟归零";
  if (到 === "沉睡") return 从 === "待回收" ? "继续持有顺延，退回沉睡" : `满 ${r.节点天.沉睡} 天没动静，进入沉睡`;
  return `满 ${r.节点天.待回收} 天没动静，进入待回收`;
}

/** 按算出来的结果把钟和留痕写下去；返回换没换状态、是不是刚被挡住。换状态说明 = 按钮引起的换状态（继续持有顺延）写的那句，不传按天数推 */
export async function 写钟(db: 库, c: 三态客户, r: Extract<三态结果, { 计时: true }>, 今天: string, at: Date, 换状态说明?: string): Promise<{ 换了状态: boolean; 新被挡: boolean }> {
  const 改 = 钟要改(c, r, 今天, 换状态说明);
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

/** 计时范围里可能有的客户：有负责人、不在公海、没标无效（市场成员名下的算的时候再排）；已删的软删统一滤掉 */
export async function 候选客户(db: 库): Promise<string[]> {
  const 占位 = await 无负责人占位Id(db);
  return (await db.customer.findMany({ where: { pool: { is: null }, poolInvalidAt: null, salesOwnerId: { not: 占位 } }, select: { id: true }, orderBy: { id: "asc" } })).map((c) => c.id);
}

/**
 * 交接中挡自动进公海（X-38 → P-转-05）：转让交接待确认的客户（handover-db.ts 交接中的客户），加上离职交接待确认的——
 * 离职那一行列了客户的按列的，没列的按「负责人是离职那位」认（推断：离职交接确认前客户还在他名下）
 */
export async function 交接挡住的(db: 库, ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const 中 = await 交接中的客户([...ids], db);
  for (const id of await 离职交接中的(db, ids)) 中.add(id);
  return 中;
}

/** 离职交接待确认的客户（T6：挂起期间不收、不推提醒）：离职那一行列了客户的按列的，没列的按「负责人是离职那位」认 */
export async function 离职交接中的(db: 库, ids: readonly string[]): Promise<Set<string>> {
  const 中 = new Set<string>();
  if (!ids.length) return 中;
  const 离职 = await db.entHandover.findMany({ where: { kind: "离职", status: 待确认 }, select: { fromUserId: true, customerIds: true } });
  if (!离职.length) return 中;
  const 要 = new Set(ids);
  const 走的人 = new Set<string>();
  for (const h of 离职) {
    let 列的: unknown = [];
    try {
      列的 = JSON.parse(h.customerIds);
    } catch {
      列的 = [];
    }
    if (Array.isArray(列的) && 列的.length) for (const id of 列的) { if (typeof id === "string" && 要.has(id)) 中.add(id); }
    else 走的人.add(h.fromUserId);
  }
  if (走的人.size) for (const c of await db.customer.findMany({ where: { id: { in: [...ids] }, salesOwnerId: { in: [...走的人] } }, select: { id: true } })) 中.add(c.id);
  return 中;
}

export type 三态夜扫明细 = { 算了: number; 换状态: number; 进公海: string[]; 新被挡: number; 交接中没收: number; 标公海: number };
const 空明细 = (): 三态夜扫明细 => ({ 算了: 0, 换状态: 0, 进公海: [], 新被挡: 0, 交接中没收: 0, 标公海: 0 });

/** 自动进公海收了的一位：原负责人、这是第几次被三态自动收回（含这次，M-公海-28） */
export type 自动收了 = { id: string; name: string; 原负责人: string; 第几次: number; bizLine?: string | null };

/**
 * 夜扫（00:05 那一遍里，nightly.ts 调）：按客户算三态、写钟和留痕，到了自动进公海的进客户公海。
 * 三态没开 = null，什么都不做。一天只扫一遍（记号见 三态扫过键）：白天改了三态天数不马上整库重算，等第二天 00:05 那遍（M-公海-37「当晚」）；
 * 今天还没扫过（第一次开三态、停过机）的照扫。停机几天：状态按「今天该是什么」判，开机这一遍自然补上（P-全局-07）
 */
export async function 三态夜扫(现在: Date = new Date()): Promise<三态夜扫明细 | null> {
  const 规则 = await 生效组织规则();
  if (!(await 三态开着(规则))) return null;
  const 今天 = beijingDay(现在);
  const 旧 = await getSetting<string>(三态扫过键);
  if (typeof 旧 === "string" && 旧.slice(0, 10) === 今天) return 空明细();
  const 明细 = await 看全部(() => 按客户扫(规则, 现在, 今天));
  await setSetting(三态扫过键, `${今天} ${JSON.stringify(规则.三态)}`);
  return 明细;
}

/**
 * 一批客户写钟：一笔写事务（首次开三态 5 千多位建钟时按 500 一批包）。事实整批在事务里重收再算（第二轮审查）：
 * 事务外读到的到开事务之间，有人转让、记沟通、点了继续持有、按钮先建了钟，都按事务里最新的写，不写过时的状态留痕。
 * 只重读钟的 updatedAt 不够——转让、记沟通不动钟。们 传客户 id 或事务外收好的（只取它的 id）。
 * 返回这批里该进公海的，和每位在计时的客户按最新事实算出来的结果（提醒那遍接着用）
 */
export type 算过 = { c: 三态客户; r: Extract<三态结果, { 计时: true }> };
export async function 写一批(规则: 组织规则, org: 组织, 们: Map<string, 三态客户> | readonly string[], 现在: Date, 今天: string, 明细: 三态夜扫明细 = 空明细()): Promise<{ 要收: string[]; 算: 算过[] }> {
  const ids = Array.isArray(们) ? [...们] : [...(们 as Map<string, 三态客户>).keys()];
  return 查完再写(async (tx) => {
    const 新 = await 收三态客户(tx, ids, 规则, org, 现在);
    const 要收: string[] = [];
    const 算: 算过[] = [];
    for (const id of ids) {
      const c = 新.get(id);
      if (!c) continue; // 中间被删了
      const r = 算三态(c.事实, 规则.三态, 今天);
      if (!r.计时) continue;
      算.push({ c, r });
      明细.算了++;
      await 存归零(tx, [c]);
      const w = await 写钟(tx, c, r, 今天, 现在);
      if (w.换了状态) 明细.换状态++;
      if (w.新被挡) 明细.新被挡++;
      if (r.状态 === "该进公海" && !r.被挡) 要收.push(id);
    }
    // T12：负责人停用、还没标过、也不在离职交接待确认里（那边有 T6 的兜底）的，标「待交接」
    const 要标 = 算.filter((x) => x.c.负责人停用 && !x.c.待交接日).map((x) => x.c);
    if (要标.length) {
      const 挂着 = await 离职交接中的(tx, 要标.map((c) => c.id));
      for (const c of 要标) {
        if (挂着.has(c.id)) continue;
        const 态 = 钟状态of(算.find((x) => x.c === c)!.r);
        await tx.entCustomerStateLog.create({ data: { customerId: c.id, fromState: 态, toState: 态, via: 留痕方式.自动, reason: 待交接理由, fromOwnerId: c.salesOwnerId, at: 现在 } });
      }
    }
    return { 要收, 算 };
  }, { timeout: 60_000 });
}

/** 别的路进了客户公海（手动放、离职放公海）的客户，钟还停在原状态：标成「公海」、留一行痕，列表按状态查时不混进待回收 */
async function 标掉公海里的(现在: Date, 今天: string): Promise<number> {
  const 们 = await prisma.entCustomerClock.findMany({ where: { state: { not: 公海状态 }, customer: { pool: { isNot: null } } }, select: { customerId: true, state: true } });
  for (const 批 of 分批(们)) {
    await 查完再写(async (tx) => {
      for (const x of 批) {
        const n = await tx.entCustomerClock.updateMany({ where: { customerId: x.customerId, state: x.state }, data: { state: 公海状态, enteredDay: 今天, noticeCount: 0, lastNoticeDay: null, blocked: false, holdUntil: null } });
        if (n.count) await tx.entCustomerStateLog.create({ data: { customerId: x.customerId, fromState: x.state, toState: 公海状态, via: 留痕方式.自动, reason: "进了客户公海，停止计时", at: 现在 } });
      }
    });
  }
  return 们.length;
}

async function 按客户扫(规则: 组织规则, 现在: Date, 今天: string): Promise<三态夜扫明细> {
  const org = await 读组织();
  const ids = await 候选客户(prisma);
  const 明细 = 空明细();
  const 要收: string[] = [];
  for (const 批 of 分批(ids)) 要收.push(...(await 写一批(规则, org, 批, 现在, 今天, 明细)).要收);
  明细.标公海 = await 标掉公海里的(现在, 今天);
  if (!要收.length) return 明细;
  const 中 = await 交接挡住的(prisma, 要收);
  明细.交接中没收 = 中.size;
  const 收 = 要收.filter((id) => !中.has(id));
  if (!收.length) return 明细;
  // 负责人要清空，也算一次换负责人：先钉住老签约（事务外，同手动放进公海）
  await 钉住老签约();
  const 收了: 自动收了[] = [];
  const 号码表 = await 退回号码种类表();
  for (const id of 收) {
    const x = await 自动进公海一位(id, 规则, org, 现在, 今天, 号码表);
    if (x) {
      收了.push(x);
      明细.进公海.push(id);
    }
  }
  if (明细.进公海.length) {
    忘掉企业版范围();
    await (await import("./attach-approval")).进公海挂靠通知(明细.进公海);
    await recordAudit({
      user: 系统, action: "pool", entity: "Customer", entityId: 明细.进公海.length === 1 ? 明细.进公海[0] : null,
      summary: `${明细.进公海.length} 位客户待回收期满、3 次提醒都没人处理，自动进客户公海`,
      detail: { ids: 明细.进公海, 三态: 规则.三态 },
    });
    // 「已回公海」单独一条（M-公海-26），第 2 次起抄原负责人的直属上级（M-公海-28）。动态引：通知那边引着本文件
    await (await import("./tri-state-notice")).已回公海通知(收了, org, 今天);
  }
  return 明细;
}

/**
 * 一位客户自动进客户公海：事务里按最新的事实重算一遍（查出来到写之间有人记了沟通、点了继续持有、转走了就不收），
 * 还该进、没被挡、不在交接中（转让 / 离职）才收。钟标成「公海」。号码表 = 号码类型字典（事务外先读，要读设置）。返回收了谁
 */
export async function 自动进公海一位(id: string, 规则: 组织规则, org: 组织, 现在: Date, 今天: string, 号码表: 号码种类表): Promise<自动收了 | null> {
  return 查完再写(async (tx) => {
    const c = (await 收三态客户(tx, [id], 规则, org, 现在)).get(id);
    if (!c) return null;
    const r = 算三态(c.事实, 规则.三态, 今天);
    if (!r.计时 || r.状态 !== "该进公海" || r.被挡) return null;
    if ((await 交接挡住的(tx, [id])).size) return null;
    await 存归零(tx, [c]);
    const 理由 = 三态进公海理由(r.节点天.进公海 - r.节点天.待回收);
    const 们 = [{ id, salesOwnerId: c.salesOwnerId }];
    // T10：不查号码齐不齐（不挡收回），只按退回公海那一套查一遍、打「号码不全」（项目还没跟着进公海前查，同手动退回）
    const 号码不全 = (await 客户退回前查联系方式(tx, [id], 号码表)).has(id);
    // 公海那一行不记操作人：统一公海入池方式认成超时回收（unified-pool.ts 客户入池类）
    await tx.customerPool.create({ data: { customerId: id, userId: null, reason: 理由, at: 现在, phoneIncomplete: 号码不全 } });
    // 先项目后清负责人：项目那边靠客户原来的负责人认「他自己负责的」
    await 客户名下在推项目进公海(tx, 们, 系统.id, 理由, 现在);
    await 客户进公海清负责人(tx, 们, null);
    await tx.entCustomerStateLog.create({ data: { customerId: id, fromState: c.钟?.state ?? "待回收", toState: 公海状态, via: 留痕方式.自动, reason: 理由, at: 现在 } });
    const 标 = { state: 公海状态, enteredDay: 今天, noticeCount: 0, lastNoticeDay: null, blocked: false, holdUntil: null };
    await tx.entCustomerClock.upsert({ where: { customerId: id }, create: { customerId: id, ...标 }, update: 标 });
    return { id, name: c.name, 原负责人: c.salesOwnerId, 第几次: 自动收回次数(c.留痕) + 1, bizLine: c.bizLine };
  });
}
