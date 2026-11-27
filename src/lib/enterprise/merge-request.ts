/**
 * 企业版跨负责人合并客户的合并申请 · 数据层（2026-11-26，客户 E-280 / E-331 第二批 2b；方案「合并客户第二批」）。
 *
 * 两家客户、或两家名下没结束的项目里有同事负责的，第一批不让直接并；这里改成发合并申请：
 *   - 谁发起（E-331 一.1）：留下那家的客户负责人。他不是销售（渠运、市场管理，本来不接指定分配）时，
 *     由他的直属上级或能接分配的销售（销售 / 销售管理）发起，两种都要同业务线（E-336 三，写死）；
 *     留下那家没填业务线按它负责人的业务线比。系统管理员不用申请，照第一批直接代并
 *   - 要谁同意（按人去重，同一个人只确认一次，列出他涉及的项目）：留下那家的客户负责人（不是发起人时）+
 *     被并那家的客户负责人（是同事时）+ 两家名下没结束（没结局、不在项目公海）、由同事负责的项目负责人。发起即算发起人同意
 *   - 等多久：5 个工作日（周一到周五，扣法定节假日、调休上班的周末算，同 cn-workday.ts 节假日表；E-428 ①），到期没全部同意就失效、要重新发起
 *   - 执行前再判：只比四项——负责人、阶段、回款或提成、被判无效；任一变了申请失效、要重新发起，别的字段变了不重判。
 *     数据拦法（交接中、公海、无效、业务线不同）照第一批，执行合并时事务里再判一遍
 *   - 全同意后调第一批的 执行合并（me = 发起人；挪、合成联系人、通知、30 天整单撤回都照第一批），
 *     申请经过（发起人、同意人、时间、合并前两家阶段和回款 / 提成）记进合并单 approvals 和两家客户的操作日志（变更历史同一套）
 *   - 合并后各项目负责人、组员不变，不自动成组（第一批 挪 本来就不动）
 *
 *   - 通知（2b-3 第二段，P-界面-67）：收到申请、有人同意、有人拒绝、已失效、已合并、已作废、已撤回 7 种，站内铃铛 + 飞书同一份（notify()），
 *     见本文件末「通知」一节
 *
 * 不做：超时转上级（E-331：到期失效、不转上级）、看板统计；同意人表的 fromUserId / transferredAt 先空着
 */
import type { PrismaClient, Prisma } from "@/generated/prisma";
import { 看全部 } from "@/lib/team-scope";
import { beijingDay, beijingWallIso } from "@/lib/business-clock";
import { 在推项目条件 } from "@/lib/project/active";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 企业版 } from "./switch";
import { 权限组织, 直属上级of, 是系统管理员of, type 组织 } from "./org";
import { 只读角色, 只看的人 } from "./permissions";
import { 接手问题, type 线 } from "./lead-assign";
import { 是项目线 } from "./assign-line";
import { 加天 } from "./tri-state";
import { 是工作日 } from "./cn-workday";
import { 通知里的客户名 } from "./notice-mask";
import { notify } from "./notify";
import { 合并申请页, 凭叫法, 拒绝原因上限 } from "@/app/(app)/customers/merge-request-words";
import {
  读客户, 申请拦的原因, 来源或创建人不同, 执行合并, 合并事务选项, 并发失败话, 已核对话, 刚被改过话, 合并预览, 并掉看不到话,
  撤回期限天数, type 客户行, type 合并人, type 同一个人, type 合并预览结果,
} from "./customer-merge";

type 库 = PrismaClient;
type Tx = Prisma.TransactionClient;
type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/* ───────────────────────── 口径 ───────────────────────── */

/** 申请状态（EntMergeRequest.status）。执行中 = 最后一位同意后正在挪（条件更新抢到的那一次才执行） */
export const 申请状态 = { 待同意: "待同意", 执行中: "执行中", 已合并: "已合并", 已拒绝: "已拒绝", 已失效: "已失效", 已撤回: "已撤回" } as const;
/** 同意人那一行的状态（EntMergeApprover.status） */
export const 同意状态 = { 待同意: "待同意", 同意: "同意", 拒绝: "拒绝" } as const;
/** 等待期：5 个工作日（E-331 一.1） */
export const 等待工作日 = 5;
/** 一位发起人同时挂着的待同意申请上限（我方定，防拿申请当查询用） */
export const 每人最多待同意 = 5;
/** 执行前再判只认这四项（E-331 一.1：「四项任一变化才重判，否则会无限重来」） */
export const 四项 = ["负责人", "阶段", "回款或提成", "被判无效"] as const;
export type 变动项 = (typeof 四项)[number];

export type 凭 = "留下客户负责人" | "被并客户负责人" | "项目负责人";
export type 涉及项目 = { id: string; name: string; customerId: string };
export type 同意人 = { userId: string; 凭: 凭[]; 项目: 涉及项目[] };
/**
 * 给发起人看的同意人（发起返回、申请预览；PR #506 审查第 1 条）：项目数照实；他涉及的项目里有发起人看不到的
 * （并进来那家看不到时它名下的一律算看不到）项目给空数组、不露名字和 id，都看得到的照旧、项目数 = 项目.length
 */
export type 给发起人的同意人 = 同意人 & { 项目数: number };

/** 拒绝原因超了上限：动作层、数据层都拦这一句，不悄悄截（2b-3 第二段审查第 7 条） */
export const 拒绝原因超话 = `拒绝原因最多 ${拒绝原因上限} 字`;
/** 拒绝必须写一句原因（E-428 ②）：空、全空白都拦；动作层、数据层同一句 */
export const 拒绝要写原因话 = "拒绝要写一句原因";
export const 到期话 = `超过 ${等待工作日} 个工作日没有全部同意，申请已失效，要重新发起`;
/**
 * 给人看的状态：库里只有「已失效」一种结束，界面分开说——到期没同意完叫「已失效」；
 * 作废的（系统管理员作废有 endedById；四项有变、执行时被拦是系统判的，原因不是 到期话）叫「已作废」；其余同 status（2b-3 第二段审查第 4 条）
 */
export const 显示状态of = (r: { status: string; reason: string | null; endedById: string | null }): string =>
  r.status === 申请状态.已失效 && (r.endedById || r.reason !== 到期话) ? "已作废" : r.status;
export const 变动话 = (项: readonly 变动项[]) => `两家的${项.join("、")}有变，申请已失效，要重新发起`;

const 名 = (c: Pick<客户行, "name" | "shortName" | "customerNo" | "id">) => 通知里的客户名(c);
const 北京时刻 = (d: Date) => beijingWallIso(d).slice(0, 16).replace("T", " ");

/* ───────────────────────── 纯函数：谁发起、要谁同意、哪天到期、比四项 ───────────────────────── */

/** 能接指定分配（销售 / 销售管理；给了业务线时还要线对得上），同 lead-assign 接手问题 */
const 能接分配 = (org: 组织, userId: string, line: 线 | null) => 接手问题(org, userId, line) === null;
const 线of = (bizLine: string | null | undefined): 线 | null => (bizLine === "内贸" || bizLine === "外贸" ? bizLine : null);

/**
 * 发起人要和哪条线比（E-336 三）：留下那家填了业务线按它（「暂不分配」不限线，同现状）；
 * 没填按留下那家负责人在组织里的业务线（同 X-34「客户算哪条线：标签未填按负责人」）；负责人也没线 = 不限。
 * 「填了」只认 内贸 / 外贸 / 暂不分配 三种（是项目线）：导入的脏值同 line-viewer.ts「标签未填」当没填，按负责人
 */
export function 比的线(org: 组织, 留下业务线: string | null | undefined, 留下负责人: string): { line: 线 | null; 按负责人: boolean } {
  if (是项目线(留下业务线)) return { line: 线of(留下业务线), 按负责人: false };
  return { line: org.成员.get(留下负责人)?.line ?? null, 按负责人: true };
}

/**
 * 跨业务线拦下的说法，同第一批「两家业务线不同（内贸 / 外贸），不能合并」那一种写法。
 * 按负责人 = 留下那家没填业务线、按它负责人的线；借用 = 直属上级自己没设线、按他管的那位负责人的线
 */
export const 线不同话 = (我线: 线, line: 线, 按负责人: boolean, 借用 = false) => {
  const 注 = [按负责人 ? "留下那家没填业务线，按它负责人的业务线算" : "", 借用 ? "你没设业务线，按你管的这位负责人的线算" : ""].filter(Boolean);
  return `你和留下那家业务线不同（${我线} / ${line}${注.map((x) => `，${x}`).join("")}），不能发合并申请`;
};

/**
 * 能不能发这张申请（E-331 一.1；E-336 三补业务线）：null = 能。
 *   - 系统管理员：不用申请，照第一批直接代并
 *   - 留下那家的负责人是销售（能接指定分配）：只有他本人能发
 *   - 不是销售（渠运、市场管理……）：他本人不能发，由他的直属上级或能接分配的销售发，两种都要同业务线（写死）：
 *     线按 比的线（留下那家的业务线，没填按它负责人的）；
 *     能接分配的销售按他自己的线比（没设线的不限，同 接手问题）；
 *     直属上级按他自己在组织里的线，没设线按他管的那位负责人的线，两人都没设不限（E-336 只说「直属上级也按同业务线」，没说上级的线怎么取，我方定）；
 *     发起人是直属上级时只按上级这条判，哪怕他本人也能接分配（销售管理）：不再走「没设线的销售不限」放行，免得绕过「按负责人的线」
 *   - 总管理（不是系统管理员的条线总管理）不是直属上级、不能接分配，本来就发不了，E-336 没提，不动
 */
export function 发起人问题(org: 组织, me: { id: string }, 留下负责人: string, 留下业务线: string | null | undefined): string | null {
  if (是系统管理员of(org, me.id)) return "系统管理员不用发申请，可以直接合并";
  const 负责人是销售 = 能接分配(org, 留下负责人, null);
  if (留下负责人 === me.id) return 负责人是销售 ? null : "你不接指定分配（不是销售），合并申请要由你的直属上级或能接分配的销售发起";
  if (负责人是销售) return "只有留下那家的客户负责人能发合并申请";
  const 是上级 = 直属上级of(org, 留下负责人) === me.id;
  const 是销售 = 能接分配(org, me.id, null);
  if (!是上级 && !是销售) return "留下那家的负责人不是销售，合并申请要由他的直属上级或能接分配的销售发起";
  const { line, 按负责人 } = 比的线(org, 留下业务线, 留下负责人);
  if (!line) return null;
  const 我自己的线 = org.成员.get(me.id)?.line ?? null;
  const 借用 = 是上级 && !我自己的线;
  const 比 = 借用 ? org.成员.get(留下负责人)?.line ?? null : 我自己的线;
  if (!比 || 比 === line) return null;
  return 线不同话(比, line, 按负责人, 借用);
}

/**
 * 要谁同意（E-331 一.1，按人去重）：留下那家的客户负责人、被并那家的客户负责人、两家名下没结束的项目负责人，
 * 去掉发起人、去掉负责人空的；一人多个身份 / 多个项目只出一行，凭和项目都并进去。顺序：留下负责人、被并负责人、再按项目先后。
 * 在推 = 调用方已按 在推项目条件（没结局、不在项目公海）、没删筛过
 */
export function 算同意人(
  发起人: string, A: { id: string; salesOwnerId: string | null }, B: { id: string; salesOwnerId: string | null },
  在推: readonly { id: string; name: string; customerId: string; ownerId: string | null }[],
): 同意人[] {
  const 们 = new Map<string, 同意人>();
  const 加 = (userId: string | null | undefined, 凭: 凭, 项目?: 涉及项目) => {
    if (!userId || userId === 发起人) return;
    const 行 = 们.get(userId) ?? { userId, 凭: [], 项目: [] };
    if (!行.凭.includes(凭)) 行.凭.push(凭);
    if (项目 && !行.项目.some((p) => p.id === 项目.id)) 行.项目.push(项目);
    们.set(userId, 行);
  };
  加(A.salesOwnerId, "留下客户负责人");
  加(B.salesOwnerId, "被并客户负责人");
  for (const p of 在推) if (p.customerId === A.id || p.customerId === B.id) 加(p.ownerId, "项目负责人", { id: p.id, name: p.name, customerId: p.customerId });
  return [...们.values()];
}

/**
 * 到期的那一刻：从发起那天（北京时间的日子）往后数第 5 个工作日的同一时刻，周末、法定节假日不算，调休上班的周末算（E-428 ①，只对新发起的算；已存的 expiresAt 不重算）。
 * 周五 15:00 发起 → 下周五 15:00；周六发起 → 下周五同一时刻
 */
export function 到期时刻(发起: Date, 工作日 = 等待工作日): Date {
  const 起 = beijingDay(发起);
  let k = 0, 数 = 0;
  // 扣法定节假日、调休上班的周末算工作日（cn-workday 节假日表，E-428 ①）；k < 120 只是防表错了死循环
  while (数 < 工作日 && k < 120) { k++; if (是工作日(加天(起, k))) 数++; }
  return new Date(发起.getTime() + k * 86_400_000);
}
export const 到期了 = (r: { expiresAt: Date }, 现在: Date) => 现在.getTime() >= r.expiresAt.getTime();

/** 合并前快照：再判只比四项；其余（客户状态、节点、名字）只为留痕 */
export type 客户快照 = { 名: string; 负责人: string; 无效: boolean; 状态: string | null };
export type 项目快照 = {
  客户: string; 名: string; 负责人: string; 阶段: string; 节点: string; 结局: string | null;
  /** 给人看的：「无」「2 笔 CNY 1000」；键 = 比对用（每笔 id、币种、金额、日子） */
  回款: string; 回款键: string;
  提成: string; 提成键: string;
  无效: boolean;
};
export type 快照 = { 客户: Record<string, 客户快照>; 项目: Record<string, 项目快照> };

/**
 * 两份快照比四项（E-331 一.1）。同意人变了（重算出来的人和申请里的不一样：新来了同事项目、同事项目结束……）算「负责人」变了。
 * 快照之后新建 / 删掉的项目本身不算变动，只经 同意人变了 起作用；节点、客户状态、名字变了不重判
 */
export function 比四项(旧: 快照, 新: 快照, 同意人变了 = false): 变动项[] {
  const 变 = new Set<变动项>();
  if (同意人变了) 变.add("负责人");
  for (const [id, o] of Object.entries(旧.客户)) {
    const n = 新.客户[id];
    if (!n) continue;
    if (o.负责人 !== n.负责人) 变.add("负责人");
    if (o.无效 !== n.无效) 变.add("被判无效");
  }
  for (const [id, o] of Object.entries(旧.项目)) {
    const n = 新.项目[id];
    if (!n) continue;
    if (o.负责人 !== n.负责人 || o.客户 !== n.客户) 变.add("负责人");
    if (o.阶段 !== n.阶段 || o.结局 !== n.结局) 变.add("阶段");
    if (o.回款键 !== n.回款键 || o.提成键 !== n.提成键) 变.add("回款或提成");
    if (o.无效 !== n.无效) 变.add("被判无效");
  }
  return 四项.filter((x) => 变.has(x));
}

/** 申请里的同意人和重算出来的比：只比人（凭、项目列表变了而人没变的，靠四项里的负责人 / 阶段兜住） */
export const 同意人对不上 = (旧: readonly string[], 新: readonly 同意人[]) => {
  const a = new Set(旧), b = new Set(新.map((x) => x.userId));
  return a.size !== b.size || [...a].some((x) => !b.has(x));
};

/* ───────────────────────── 读库 ───────────────────────── */

const 判无效 = (v: { verdict: string; finalResult: string | null } | null) => !!v && (v.verdict === "初验无效" || v.verdict === "无效线索" || v.finalResult === "无效线索");
const 钱 = (n: number) => String(Math.round(n * 100) / 100);

/** 两家名下没删的项目（含已结束的：结束了的回款、提成也算四项）+ 两家本身 → 快照 */
export async function 读快照(db: Tx | 库, A: 客户行, B: 客户行): Promise<快照> {
  const 项目们 = await 看全部(() => db.project.findMany({
    where: { customerId: { in: [A.id, B.id] }, deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, customerId: true, ownerId: true, phase: true, node: true, result: true, entLeadVerify: { select: { verdict: true, finalResult: true } } },
  }));
  const ids = 项目们.map((p) => p.id);
  const [回款们, 提成们] = ids.length
    ? await Promise.all([
        看全部(() => db.entProjectPayment.findMany({ where: { projectId: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, projectId: true, currency: true, amount: true, paidAt: true } })),
        看全部(() => db.entCommission.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, basePrice: true, fixedAt: true, fixedTotal: true } })),
      ])
    : [[], []];
  const 客户: 快照["客户"] = {};
  for (const c of [A, B]) 客户[c.id] = { 名: 名(c), 负责人: c.salesOwnerId ?? "", 无效: !!c.poolInvalidAt, 状态: c.custStatus ?? null };
  const 项目: 快照["项目"] = {};
  for (const p of 项目们) {
    const 笔 = 回款们.filter((x) => x.projectId === p.id);
    const 合计 = new Map<string, number>();
    for (const x of 笔) 合计.set(x.currency, (合计.get(x.currency) ?? 0) + x.amount);
    const 提 = 提成们.find((x) => x.projectId === p.id);
    项目[p.id] = {
      客户: p.customerId, 名: p.name, 负责人: p.ownerId ?? "", 阶段: p.phase, 节点: p.node, 结局: p.result ?? null,
      回款: 笔.length ? `${笔.length} 笔 ${[...合计].map(([币, n]) => `${币} ${钱(n)}`).join(" + ")}` : "无",
      回款键: 笔.map((x) => `${x.id}:${x.currency}:${钱(x.amount)}:${x.paidAt.toISOString()}`).join("|"),
      提成: !提 ? "无" : 提.fixedAt ? `已固定 ${钱(提.fixedTotal ?? 0)}` : 提.basePrice !== null ? `底价 ${钱(提.basePrice)}，未固定` : "未固定",
      提成键: 提 ? `${提.basePrice ?? ""}:${提.fixedAt?.toISOString() ?? ""}:${提.fixedTotal ?? ""}` : "",
      无效: 判无效(p.entLeadVerify),
    };
  }
  return { 客户, 项目 };
}

/** 两家名下没结束、负责人不空的项目（算同意人用） */
async function 在推项目们(db: Tx | 库, A: string, B: string) {
  return 看全部(() => db.project.findMany({
    where: { customerId: { in: [A, B] }, deletedAt: null, ...在推项目条件 },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, customerId: true, ownerId: true },
  }));
}

/** 现在再算一遍要谁同意 */
async function 现算同意人(db: Tx | 库, 发起人: string, A: 客户行, B: 客户行): Promise<同意人[]> {
  return 算同意人(发起人, A, B, await 在推项目们(db, A.id, B.id));
}

/** 申请经过的说法：「张三 11-26 10:00 发起；李四 11-27 09:12 同意，王五 11-27 15:30 同意」 */
function 经过话(发起: { 名: string; at: Date }, 同意们: { 名: string; at: Date | null }[]): string {
  const 同 = 同意们.map((x) => `${x.名}${x.at ? ` ${北京时刻(x.at)}` : ""} 同意`).join("，");
  return `${发起.名} ${北京时刻(发起.at)} 发起${同 ? `；${同}` : ""}`;
}

/** 合并前两家阶段和回款 / 提成（留痕给人看）：「A：项目1 商机·进行中，回款 无，提成 无」 */
export function 快照话(s: 快照): string {
  return Object.entries(s.客户).map(([id, c]) => {
    const 项 = Object.values(s.项目).filter((p) => p.客户 === id);
    const 行 = 项.map((p) => `「${p.名}」${p.阶段}${p.结局 ? `·${p.结局}` : "·进行中"}，回款 ${p.回款}，提成 ${p.提成}${p.无效 ? "，判了无效" : ""}`);
    return `「${c.名}」${c.无效 ? "（无效客户）" : ""}：${行.length ? 行.join("；") : "名下没有项目"}`;
  }).join("。");
}

class 拦下 extends Error {}

/* ───────────────────────── 发起 ───────────────────────── */

export type 发起完 = { requestId: string; 同意人: 给发起人的同意人[]; expiresAt: Date };

/**
 * 发起人看得到哪些（PR #506 审查第 1、3、4 条）：用调用方传进来的带限定 db 直接查（不包 看全部，限定层按登录的人收）。
 * 并掉 = 并进来那家看得到（看不到 = 靠完整号码放行进来的，merge-actions.ts 并掉那家放行）
 */
async function 发起人看得到的并掉(db: 库, 并掉id: string): Promise<boolean> {
  return (await db.customer.count({ where: { id: 并掉id } })) === 1;
}
async function 给发起人看(db: 库, 人们: readonly 同意人[], 并掉id: string, 并掉看得到: boolean): Promise<给发起人的同意人[]> {
  const ids = [...new Set(人们.flatMap((x) => x.项目.map((p) => p.id)))];
  const 看得到 = new Set(ids.length ? (await db.project.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((p) => p.id) : []);
  const 能看 = (p: 涉及项目) => 看得到.has(p.id) && (并掉看得到 || p.customerId !== 并掉id);
  return 人们.map((x) => ({ ...x, 项目: x.项目.every(能看) ? x.项目 : [], 项目数: x.项目.length }));
}

/** 发合并申请：B 并进 A。已核对 / 同一个人 同第一批预览里的勾选，存进申请、执行时照用 */
export async function 发起合并申请(
  db: 库, 留下id: string, 并掉id: string, me: 合并人,
  opt: { 已核对?: boolean; 同一个人?: readonly 同一个人[]; 现在?: Date } = {},
): Promise<结果<发起完>> {
  if (!企业版()) return { ok: false, error: "只有企业版能发合并申请" };
  const 现在 = opt.现在 ?? new Date();
  const org = await 权限组织();
  if (!org) return { ok: false, error: "只有企业版能发合并申请" };
  const 并掉看得到 = await 发起人看得到的并掉(db, 并掉id);
  try {
    const r = await 看全部(() => db.$transaction(async (tx) => {
      const [A, B] = [await 读客户(tx, 留下id), await 读客户(tx, 并掉id)];
      const 判 = await 发起前判(tx, A, B, me, org, !并掉看得到);
      if (!判.ok) throw new 拦下(判.原因.join("；"));
      const 人们 = 判.人们;
      if (来源或创建人不同(A!, B!) && !opt.已核对) throw new 拦下(`两家的来源或创建人不一样，请先勾选「${已核对话}」`);
      const 快 = await 读快照(tx, A!, B!);
      const expiresAt = 到期时刻(现在);
      const 单 = await tx.entMergeRequest.create({
        data: {
          fromId: B!.id, intoId: A!.id, byUserId: me.id, status: 申请状态.待同意, at: 现在, expiresAt,
          choices: JSON.stringify({ 已核对: !!opt.已核对, 同一个人: opt.同一个人 ?? [], ...(并掉看得到 ? {} : { 并掉看不到: true, 并掉编号: B!.customerNo ?? null }) } satisfies 选择),
          snapshot: JSON.stringify(快),
          approvers: { create: 人们.map((x) => ({ userId: x.userId, why: JSON.stringify(x.凭), projects: JSON.stringify(x.项目), createdAt: 现在 })) },
        },
      });
      const 叫 = await 人名们(tx, 人们.map((x) => x.userId));
      const 谁们 = 人们.map((x) => 叫.get(x.userId) ?? "同事").join("、");
      const detail = JSON.stringify({ requestId: 单.id, 留下: A!.id, 并掉: B!.id, 同意人: 人们, 到期: expiresAt.toISOString() });
      await tx.auditLog.createMany({
        data: [
          { userId: me.id, userName: me.name, action: "merge-request", entity: "Customer", entityId: A!.id, at: 现在, summary: `发合并申请：把「${并掉看得到 ? 名(B!) : 看不到那家叫法(B!.customerNo)}」并进这位客户，等 ${谁们} 同意（${等待工作日} 个工作日内）`, detail },
          { userId: me.id, userName: me.name, action: "merge-request", entity: "Customer", entityId: B!.id, at: 现在, summary: `发合并申请：这位客户并进「${名(A!)}」，等 ${谁们} 同意（${等待工作日} 个工作日内）`, detail },
        ],
      });
      return { requestId: 单.id, 同意人: 人们, expiresAt };
    }, 合并事务选项));
    await 申请通知(db, r.requestId, "收到", me);
    return { ok: true, ...r, 同意人: await 给发起人看(db, r.同意人, 并掉id, 并掉看得到) };
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
}

/**
 * 发起前的几道判（发起合并申请、合并申请预览共用，第二批 2b-3 抽出来）：数据拦法 → 谁能发 → 被并那家有负责人 →
 * 要谁同意（没人要同意 = 直接并）→ 同意人没停用 → 两家没挂着别的申请 → 发起人挂着的不超过上限。
 * 「来源或创建人不同要勾已核对」不在这里：预览只提示要勾，发起时判
 */
async function 发起前判(
  db: Tx | 库, A: 客户行 | null, B: 客户行 | null, me: 合并人, org: 组织, 并掉看不到: boolean,
): Promise<{ ok: true; 人们: 同意人[] } | { ok: false; 原因: string[] }> {
  const 不行 = (...原因: string[]) => ({ ok: false as const, 原因 });
  const 原因 = await 申请拦的原因(db, A, B, me, org, { 并掉看不到 });
  if (原因.length) return 不行(...原因);
  const 问 = 发起人问题(org, me, A!.salesOwnerId, A!.bizLine);
  if (问) return 不行(问);
  if (!(await 有负责人(db, B!.salesOwnerId))) return 不行(并掉看不到 ? 并掉看不到话 : `「${名(B!)}」没有负责人，没人可以同意；请找系统管理员代并`);
  const 人们 = await 现算同意人(db, me.id, A!, B!);
  if (!人们.length) return 不行(直接并话);
  const 停了 = 人们.filter((x) => !org.成员.has(x.userId));
  if (停了.length) {
    const 叫 = await 人名们(db, 停了.map((x) => x.userId));
    return 不行(`${停了.map((x) => `「${叫.get(x.userId) ?? "已停用的成员"}」`).join("")}已停用，等不到他同意；先办离职交接，或请系统管理员代并`);
  }
  const 挂着 = await db.entMergeRequest.findFirst({
    where: { status: { in: [申请状态.待同意, 申请状态.执行中] }, OR: [{ fromId: { in: [A!.id, B!.id] } }, { intoId: { in: [A!.id, B!.id] } }] },
    select: { fromId: true, intoId: true },
  });
  if (挂着) {
    const 哪家 = [A!, B!].find((c) => c.id === 挂着.fromId || c.id === 挂着.intoId)!;
    if (哪家.id === B!.id && 并掉看不到) return 不行(并掉看不到话);
    return 不行(`「${名(哪家)}」已有一张合并申请在等同意，先撤回那张再发`);
  }
  if ((await db.entMergeRequest.count({ where: { byUserId: me.id, status: 申请状态.待同意 } })) >= 每人最多待同意)
    return 不行(`你已有 ${每人最多待同意} 张合并申请在等同意，等处理完或撤回一张再发`);
  return { ok: true, 人们 };
}

/** 两家和名下没结束的项目都归发起人：不用申请（发起前判 那一句；界面见到这句就回到直接合并） */
export const 直接并话 = "两家和名下没结束的项目都由你负责，直接合并即可，不用发申请";

/** 项目 / 项目数 同 给发起人的同意人：涉及发起人看不到的项目时 项目 = []、项目数照实 */
export type 申请预览同意人 = { userId: string; 名: string; 凭: 凭[]; 项目: 涉及项目[]; 项目数: number };
export type 合并申请预览结果 = {
  能发: boolean;
  原因: string[];
  /** 同第一批合并预览（按申请：联系人不给号码、并排不给地址和客户状态）；拦下的为 null */
  预览: 合并预览结果 | null;
  同意人: 申请预览同意人[];
  等待工作日: number;
};

/**
 * 发合并申请前的预览（第二批 2b-3 合并客户框）：判法同 发起合并申请（发起前判），能发时给两家并排、要勾的、联系人配对、要谁同意。
 * 只读，不写库；谁能看到同事那家由 merge-actions.ts 先判（看得到，或按完整号码搜到的）
 */
export async function 合并申请预览(db: 库, 留下id: string, 并掉id: string, me: 合并人): Promise<合并申请预览结果> {
  const 空 = (原因: string[]): 合并申请预览结果 => ({ 能发: false, 原因, 预览: null, 同意人: [], 等待工作日 });
  if (!企业版()) return 空(["只有企业版能发合并申请"]);
  const org = await 权限组织();
  if (!org) return 空(["只有企业版能发合并申请"]);
  const 并掉看得到 = await 发起人看得到的并掉(db, 并掉id);
  const [A, B] = await 看全部(() => Promise.all([读客户(db, 留下id), 读客户(db, 并掉id)]));
  const 判 = await 看全部(() => 发起前判(db, A, B, me, org, !并掉看得到));
  if (!判.ok) return 空(判.原因);
  const 预览 = await 看全部(() => 合并预览(db, 留下id, 并掉id, me, { 按申请: true, 并掉看不到: !并掉看得到 }));
  if (!预览.能并) return 空(预览.原因);
  const [叫, 们] = await Promise.all([人名们(db, 判.人们.map((x) => x.userId)), 给发起人看(db, 判.人们, 并掉id, 并掉看得到)]);
  return { 能发: true, 原因: [], 预览, 同意人: 们.map((x) => ({ ...x, 名: 叫.get(x.userId) ?? "同事" })), 等待工作日 };
}

/** 负责人是真人（不空、不是公海占位） */
async function 有负责人(tx: Tx | 库, ownerId: string | null | undefined): Promise<boolean> {
  if (!ownerId) return false;
  const u = await tx.user.findUnique({ where: { id: ownerId }, select: { email: true } });
  return !!u && u.email !== 无负责人占位邮箱;
}

async function 人名们(db: Pick<Tx, "user">, ids: readonly string[]): Promise<Map<string, string>> {
  const 们 = ids.length ? await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } }) : [];
  return new Map(们.map((u) => [u.id, u.name]));
}

/* ───────────────────────── 同意 / 拒绝 ───────────────────────── */

export type 处理完 = { 状态: (typeof 申请状态)[keyof typeof 申请状态]; mergeId?: string };

/**
 * 结束一张申请（拒绝 / 失效 / 撤回）：条件更新，还在待同意才改；两家各记一条操作日志。
 * 系统判的失效（到期、再判）谁 = null：日志记在发起人名下、叫「系统」（操作日志的 userId 不能空）
 */
async function 结束(tx: Tx, r: { id: string; fromId: string; intoId: string; byUserId: string }, 状态: string, 原因: string, 谁: 合并人 | null, 动作: string, 现在: Date): Promise<boolean> {
  const n = await tx.entMergeRequest.updateMany({ where: { id: r.id, status: 申请状态.待同意 }, data: { status: 状态, reason: 原因, endedAt: 现在, endedById: 谁?.id ?? null } });
  if (!n.count) return false;
  const detail = JSON.stringify({ requestId: r.id, 原因 });
  await tx.auditLog.createMany({
    data: [r.intoId, r.fromId].map((entityId) => ({ userId: 谁?.id ?? r.byUserId, userName: 谁?.name ?? "系统", action: 动作, entity: "Customer", entityId, at: 现在, summary: `合并申请${状态}：${原因}`, detail })),
  });
  return true;
}

/**
 * 只读身份（只读管理员、销售教练、设了「只看某人」的切换视图）写不了合并申请：同意 / 拒绝、撤回、作废进事务前先拦，
 * 判法同 merge-actions.ts 搜合并候选的 能写、customer-merge.ts 拦的原因（2b-3 审查单 A 第 4 条）
 */
const 只读身份 = (me: 合并人, org: 组织 | null) => !!org && (只读角色(me, org) || !!只看的人(org, me.id));

/**
 * 同意人处理申请。同意：先看到没到期、再判四项和数据拦法（判出来就失效），都过了记下同意；最后一位同意了就执行。
 * 拒绝：整张申请「已拒绝」，可写一句原因
 */
export async function 处理合并申请(
  db: 库, requestId: string, me: 合并人, 结论: "同意" | "拒绝", opt: { 原因?: string; 现在?: Date } = {},
): Promise<结果<处理完>> {
  if (!企业版()) return { ok: false, error: "只有企业版有合并申请" };
  const 现在 = opt.现在 ?? new Date();
  const org = await 权限组织();
  if (!org) return { ok: false, error: "只有企业版有合并申请" };
  if (只读身份(me, org)) return { ok: false, error: `你现在是只读身份，不能${结论}合并申请` };
  if (结论 === "拒绝" && !opt.原因?.trim()) return { ok: false, error: 拒绝要写原因话 };
  if (结论 === "拒绝" && (opt.原因?.trim().length ?? 0) > 拒绝原因上限) return { ok: false, error: 拒绝原因超话 };
  let 失效: string | null = null;
  let 该执行 = false;
  let 我的行 = "";
  /** 提交以后发的那条通知（事务里不发：notify 走默认库，SQLite 只有一条连接） */
  let 事后: { 事: 申请事件; 原因?: string } | null = null;
  try {
    const 态 = await 看全部(() => db.$transaction(async (tx) => {
      const r = await tx.entMergeRequest.findUnique({ where: { id: requestId }, include: { approvers: true } });
      if (!r) throw new 拦下("找不到这张合并申请");
      if (r.status !== 申请状态.待同意) throw new 拦下(`这张合并申请${r.status === 申请状态.执行中 ? "正在执行" : r.status}，不能再处理`);
      const 我的 = r.approvers.find((x) => x.userId === me.id);
      if (!我的) throw new 拦下("你不是这张合并申请要同意的人");
      if (我的.status !== 同意状态.待同意) throw new 拦下(`你已经${我的.status}过了`);
      if (到期了(r, 现在)) {
        await 结束(tx, r, 申请状态.已失效, 到期话, null, "merge-request-void", 现在);
        失效 = 到期话;
        事后 = { 事: "失效" };
        return 申请状态.已失效;
      }
      if (结论 === "拒绝") {
        const 一句 = opt.原因?.trim() || null;
        await tx.entMergeApprover.update({ where: { id: 我的.id }, data: { status: 同意状态.拒绝, note: 一句, decidedAt: 现在 } });
        await 结束(tx, r, 申请状态.已拒绝, `${me.name}拒绝${一句 ? `：${一句}` : ""}`, me, "merge-reject", 现在);
        事后 = { 事: "拒绝", 原因: 一句 ?? "" };
        return 申请状态.已拒绝;
      }
      const 变 = await 再判(tx, r, me, org);
      if (变) {
        await 结束(tx, r, 申请状态.已失效, 变, null, "merge-request-void", 现在);
        失效 = 变;
        事后 = { 事: "作废", 原因: 变 };
        return 申请状态.已失效;
      }
      const n = await tx.entMergeApprover.updateMany({ where: { id: 我的.id, status: 同意状态.待同意 }, data: { status: 同意状态.同意, decidedAt: 现在 } });
      if (!n.count) throw new 拦下("你已经处理过了");
      await tx.auditLog.createMany({
        data: [r.intoId, r.fromId].map((entityId) => ({ userId: me.id, userName: me.name, action: "merge-approve", entity: "Customer", entityId, at: 现在, summary: `同意合并申请`, detail: JSON.stringify({ requestId: r.id }) })),
      });
      const 还等 = await tx.entMergeApprover.count({ where: { requestId: r.id, status: { not: 同意状态.同意 } } });
      if (还等) {
        事后 = { 事: "同意" };
        return 申请状态.待同意;
      }
      // 两个同意同时到：只有把状态从待同意改成执行中的那一次往下走
      const 抢 = await tx.entMergeRequest.updateMany({ where: { id: r.id, status: 申请状态.待同意 }, data: { status: 申请状态.执行中 } });
      该执行 = 抢.count === 1;
      我的行 = 我的.id;
      return 申请状态.执行中;
    }, 合并事务选项));
    const 发 = 事后 as { 事: 申请事件; 原因?: string } | null;
    if (发) await 申请通知(db, requestId, 发.事, me, 发.原因);
    if (失效) return { ok: false, error: 失效 };
    if (!该执行) return { ok: true, 状态: 态 };
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
  return 执行申请(db, requestId, 我的行, me, 现在);
}

/**
 * 执行前再判（在同意那一刻、事务里）：数据拦法照第一批；四项比合并前快照；同意人重算对不上算负责人变了。
 * 返回失效原因，null = 照旧
 */
async function 再判(tx: Tx, r: { fromId: string; intoId: string; byUserId: string; snapshot: string; choices: string; approvers: { userId: string }[] }, me: 合并人, org: 组织): Promise<string | null> {
  const [A, B] = [await 读客户(tx, r.intoId), await 读客户(tx, r.fromId)];
  // 发起人看不到并进来那家：失效原因存进库、写进日志、发给发起人，不带那家的现名和状态（2b-3 第二段审查第 1 条）
  const 原因 = await 申请拦的原因(tx, A, B, me, org, { 并掉看不到: !!读选择(r.choices).并掉看不到 });
  if (原因.length) return `${原因.join("；")}，申请已失效`;
  const 旧 = JSON.parse(r.snapshot) as 快照;
  const 新 = await 读快照(tx, A!, B!);
  const 人 = 同意人对不上(r.approvers.map((x) => x.userId), await 现算同意人(tx, r.byUserId, A!, B!));
  const 变 = 比四项(旧, 新, 人);
  return 变.length ? 变动话(变) : null;
}

/**
 * 全同意、抢到执行权以后：照第一批 执行合并（me = 发起人），成了记已合并 + 留痕，拦下记已失效。
 * 撞上别的写入（这次什么都没写）或意外的错：申请放回待同意、最后这位的同意也放回待同意，他再点一次就行
 */
async function 执行申请(db: 库, requestId: string, 我的行: string, me: 合并人, 现在: Date): Promise<结果<处理完>> {
  const r = await db.entMergeRequest.findUniqueOrThrow({ where: { id: requestId }, include: { approvers: { orderBy: { createdAt: "asc" } } } });
  const 发 = await db.user.findUnique({ where: { id: r.byUserId }, select: { id: true, name: true, role: true } });
  const 选 = 读选择(r.choices);
  const 快 = JSON.parse(r.snapshot) as 快照;
  const 叫 = await 人名们(db, [r.byUserId, ...r.approvers.map((x) => x.userId)]);
  const 同意们 = r.approvers.map((x) => ({ userId: x.userId, 名: 叫.get(x.userId) ?? "同事", 凭: JSON.parse(x.why) as 凭[], 项目: JSON.parse(x.projects) as 涉及项目[], at: x.decidedAt }));
  const 经过 = {
    requestId: r.id,
    发起: { userId: r.byUserId, 名: 叫.get(r.byUserId) ?? "同事", at: r.at.toISOString() },
    同意人: 同意们.map((x) => ({ ...x, at: x.at?.toISOString() ?? null })),
    合并前: 快,
  };
  const 回到 = async (状态: string, data: Prisma.EntMergeRequestUpdateManyMutationInput) =>
    db.entMergeRequest.updateMany({ where: { id: r.id, status: 申请状态.执行中 }, data: { status: 状态, ...data } });
  const 放回 = () => db.$transaction(async (tx) => {
    await tx.entMergeRequest.updateMany({ where: { id: r.id, status: 申请状态.执行中 }, data: { status: 申请状态.待同意 } });
    await tx.entMergeApprover.update({ where: { id: 我的行 }, data: { status: 同意状态.待同意, decidedAt: null } });
  }, 合并事务选项);
  let 结: Awaited<ReturnType<typeof 执行合并>>;
  try {
    结 = 发
      ? await 执行合并(db, r.intoId, r.fromId, 发, {
          已核对: 选.已核对, 同一个人: 选.同一个人 ?? [], 现在,
          申请: { 经过: JSON.stringify(经过), 已另通知: [r.byUserId, ...r.approvers.map((x) => x.userId)], 并掉看不到: !!选.并掉看不到 },
        })
      : { ok: false, error: "发起人已不在系统里" };
  } catch (e) {
    await 放回();
    throw e;
  }
  if (!结.ok && 结.error === 刚被改过话) {
    await 放回();
    return { ok: false, error: 刚被改过话 };
  }
  if (!结.ok) {
    const 原因 = `${结.error}，申请已失效`;
    await db.$transaction(async (tx) => {
      await tx.entMergeRequest.updateMany({ where: { id: r.id, status: 申请状态.执行中 }, data: { status: 申请状态.待同意 } });
      await 结束(tx, r, 申请状态.已失效, 原因, null, "merge-request-void", 现在);
    }, 合并事务选项);
    await 申请通知(db, r.id, "作废", me, 原因);
    return { ok: false, error: 原因 };
  }
  await 回到(申请状态.已合并, { mergeId: 结.mergeId, endedAt: 现在 });
  const 话 = `合并申请通过：${经过话({ 名: 经过.发起.名, at: r.at }, 同意们)}。合并前：${快照话(快)}`;
  await db.auditLog.createMany({
    data: [r.intoId, r.fromId].map((entityId) => ({
      userId: r.byUserId, userName: 经过.发起.名, action: "merge-request-done", entity: "Customer", entityId, at: 现在, summary: 话,
      detail: JSON.stringify({ ...经过, mergeId: 结.mergeId }),
    })),
  });
  // 最后这位也收一条（原型：「你同意的合并申请已合并，30 天内发起人可撤回」），不按「自己做的不通知自己」排掉
  await 申请通知(db, r.id, "合并", null);
  return { ok: true, 状态: 申请状态.已合并, mergeId: 结.mergeId };
}

/* ───────────────────────── 撤回申请 / 到期 ───────────────────────── */

/** 发起人撤回申请（只在待同意时） */
export async function 撤回合并申请(db: 库, requestId: string, me: 合并人, 现在: Date = new Date()): Promise<结果> {
  if (!企业版()) return { ok: false, error: "只有企业版有合并申请" };
  if (只读身份(me, await 权限组织())) return { ok: false, error: "你现在是只读身份，不能撤回合并申请" };
  try {
    return await 看全部(() => db.$transaction(async (tx) => {
      const r = await tx.entMergeRequest.findUnique({ where: { id: requestId } });
      if (!r) throw new 拦下("找不到这张合并申请");
      if (r.byUserId !== me.id) throw new 拦下("只有发起人能撤回合并申请");
      if (r.status !== 申请状态.待同意) throw new 拦下(`这张合并申请${r.status}，不能撤回`);
      if (!(await 结束(tx, r, 申请状态.已撤回, `${me.name}撤回了申请`, me, "merge-request-withdraw", 现在))) throw new 拦下("这张合并申请刚被处理过，刷新看看");
      return { ok: true as const };
    }, 合并事务选项)).then(async (x) => {
      await 申请通知(db, requestId, "撤回", me);
      return x;
    });
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
}

/** 系统管理员作废一张待同意的申请（同意人停用、等不到人时收尾）：记「已失效」、写明谁作废的 */
export async function 作废合并申请(db: 库, requestId: string, me: 合并人, 现在: Date = new Date()): Promise<结果> {
  if (!企业版()) return { ok: false, error: "只有企业版有合并申请" };
  const org = await 权限组织();
  if (只读身份(me, org)) return { ok: false, error: "你现在是只读身份，不能作废合并申请" };
  if (!org || !是系统管理员of(org, me.id)) return { ok: false, error: "只有系统管理员能作废合并申请" };
  try {
    return await 看全部(() => db.$transaction(async (tx) => {
      const r = await tx.entMergeRequest.findUnique({ where: { id: requestId } });
      if (!r) throw new 拦下("找不到这张合并申请");
      if (r.status !== 申请状态.待同意) throw new 拦下(`这张合并申请${r.status}，不能作废`);
      if (!(await 结束(tx, r, 申请状态.已失效, 作废话(me.name), me, "merge-request-void", 现在))) throw new 拦下("这张合并申请刚被处理过，刷新看看");
      return { ok: true as const };
    }, 合并事务选项)).then(async (x) => {
      await 申请通知(db, requestId, "作废", me, 作废话(me.name));
      return x;
    });
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
}

/** 挂在每分钟的钟上（lib/project/nightly.ts）：用默认库扫一遍过期申请 */
export async function 钟上扫过期合并申请(现在: Date = new Date()): Promise<number> {
  const { prisma } = await import("@/lib/prisma");
  return 扫过期合并申请(prisma, 现在);
}

/** 到期扫一遍：待同意、过了到期时刻的都记已失效（同意 / 拒绝那一刻也会当场判；每分钟的钟调 钟上扫过期合并申请） */
export async function 扫过期合并申请(db: 库, 现在: Date = new Date()): Promise<number> {
  if (!企业版()) return 0;
  const 们 = await db.entMergeRequest.findMany({ where: { status: 申请状态.待同意, expiresAt: { lte: 现在 } }, select: { id: true, fromId: true, intoId: true, byUserId: true } });
  let n = 0;
  for (const r of 们) {
    if (!(await db.$transaction((tx) => 结束(tx, r, 申请状态.已失效, 到期话, null, "merge-request-void", 现在), 合并事务选项))) continue;
    n++;
    await 申请通知(db, r.id, "失效", null);
  }
  return n;
}

/* ───────────────────────── 通知（2b-3 第二段，P-界面-67） ───────────────────────── */

/** 铃铛上的来源（7 种事件都用这一个，标题里写清是哪种结果） */
export const 合并申请通知种类 = "合并申请";
/** 七种事件：收到申请、有人同意、有人拒绝、已失效（到期）、已合并、已作废（四项有变、执行时拦下、系统管理员作废）、已撤回 */
export type 申请事件 = "收到" | "同意" | "拒绝" | "失效" | "合并" | "作废" | "撤回";
export const 作废话 = (谁: string) => `系统管理员${谁}作废了申请`;

/** 按号放行进来、发起人看不到的那家：发起日志、给发起人的通知、「我发起的」列表里都不写它的名字（PR #506 审查第 1 条） */
export const 看不到那家叫法 = (customerNo: number | null | undefined) => `同事负责的客户（号码撞上）${customerNo ? ` ${customerNo}` : ""}`;

/** 申请时存下的选择（EntMergeRequest.choices）。并掉看不到 / 并掉编号：发起人看不到那家时记下（2b-3 第二段起） */
export type 选择 = { 已核对?: boolean; 同一个人?: readonly 同一个人[]; 并掉看不到?: boolean; 并掉编号?: number | null };
export function 读选择(v: string | null | undefined): 选择 {
  try {
    const x = JSON.parse(v ?? "{}") as unknown;
    return x && typeof x === "object" ? (x as 选择) : {};
  } catch {
    return {};
  }
}

type 申请头 = { fromId: string; intoId: string; snapshot: string; choices: string };
const 快照名 = (r: 申请头, id: string): string => {
  try {
    return (JSON.parse(r.snapshot) as 快照).客户?.[id]?.名 ?? "已不在的客户";
  } catch {
    return "已不在的客户";
  }
};

/**
 * 「B」并进「A」：名字取发起那一刻的快照（快照里已过 通知里的客户名：名字是号码的换成编号，不带号码）。
 * 给发起人、且并进来那家他看不到时，B 换成 看不到那家叫法
 */
export function 申请两家话(r: 申请头, 给发起人: boolean): string {
  const 选 = 读选择(r.choices);
  const B = 给发起人 && 选.并掉看不到 ? 看不到那家叫法(选.并掉编号) : 快照名(r, r.fromId);
  return `「${B}」并进「${快照名(r, r.intoId)}」`;
}
/** 给发起人的话里（拒绝原因、失效原因）出现看不到那家的名字，一律换掉 */
export function 给发起人藏名(r: 申请头, 话: string): string {
  const 选 = 读选择(r.choices);
  if (!选.并掉看不到) return 话;
  const 名B = 快照名(r, r.fromId);
  return 名B ? 话.split(名B).join(看不到那家叫法(选.并掉编号)) : 话;
}

/**
 * 一张申请的一件事发通知（提交以后调；从不抛，通知不能连累已经做成的同意 / 拒绝）。
 * 句式「谁 + 对哪张申请 + 结果」，不带号码（notify 再兜一层打码）；同一人同一张申请：收到一条、每位同意人的同意各一条、结束（拒绝 / 失效 / 作废 / 撤回 / 合并）一条，按 key 去重。
 * 收件人：
 *   - 收到申请：每位同意人（发起人不在里面）
 *   - 有人同意：发起人（最后一位同意走「已合并」，不再发这条）
 *   - 有人拒绝 / 已失效 / 已作废：发起人 + 其余同意人（还没处理的不用再处理，已同意的知道没并成）
 *   - 已撤回：同意人
 *   - 已合并：发起人 + 所有同意人（含最后点同意的那位）
 * 做这件事的人（谁）自己不收，已合并除外；系统判的（到期扫、执行时拦下）谁 = null
 */
async function 申请通知(db: 库, requestId: string, 事: 申请事件, 谁: 合并人 | null, 原因 = ""): Promise<void> {
  if (!企业版()) return;
  try {
    const r = await 看全部(() => db.entMergeRequest.findUnique({ where: { id: requestId }, include: { approvers: { orderBy: { createdAt: "asc" } } } }));
    if (!r) return;
    const 叫 = await 看全部(() => 人名们(db, [r.byUserId, ...r.approvers.map((x) => x.userId)]));
    const 发起人名 = 叫.get(r.byUserId) ?? "同事";
    const 谁名 = 谁?.name ?? "";
    const 给发 = 申请两家话(r, true);
    const 给别人 = 申请两家话(r, false);
    const 别的同意人 = r.approvers.map((x) => x.userId).filter((u) => u !== 谁?.id);
    const 发 = (收: readonly string[], title: string, body: string, 键: string) =>
      notify(收.filter((u) => u !== 谁?.id || 事 === "合并"), { kind: 合并申请通知种类, title, body, link: 合并申请页, key: `merge-req:${r.id}:${键}` });
    const 一句 = 原因.trim();
    switch (事) {
      case "收到":
        for (const x of r.approvers) {
          const 凭们 = 读JSON<凭[]>(x.why, []).map((v) => 凭叫法[v] ?? v);
          const 项目数 = 读JSON<涉及项目[]>(x.projects, []).length;
          await 发([x.userId], `${发起人名}发来合并申请：${给别人}，要你同意`,
            `你是${凭们.join("、") || "要同意的人"}${项目数 ? `，涉及你的 ${项目数} 个项目` : ""}。${北京时刻(r.expiresAt)} 前没全部同意，申请失效`, "收到");
        }
        return;
      case "同意": {
        if (r.status !== 申请状态.待同意) return;
        const 还差 = r.approvers.filter((x) => x.status !== 同意状态.同意).length;
        await 发([r.byUserId], `${谁名}同意了你的合并申请：${给发}`, `还差 ${还差} 位同意`, `同意:${谁?.id ?? ""}`);
        return;
      }
      case "拒绝": {
        const 说 = 一句 ? `原因：${一句}` : "没写原因";
        await 发([r.byUserId], `${谁名}拒绝了你的合并申请：${给发}`, `${给发起人藏名(r, 说)}。要并可以改了再发一张`, "结束");
        await 发(别的同意人, `${谁名}拒绝了合并申请：${给别人}`, `${说}。不用再处理`, "结束");
        return;
      }
      case "失效":
        await 发([r.byUserId], `你发起的合并申请${给发}没在 ${等待工作日} 个工作日内全部同意，已失效`, "要并请重新发起", "结束");
        await 发(别的同意人, `合并申请${给别人}没在 ${等待工作日} 个工作日内全部同意，已失效`, "不用再处理", "结束");
        return;
      case "作废":
        await 发([r.byUserId], `你发起的合并申请${给发}已作废`, 给发起人藏名(r, 一句 || "要并请重新发起"), "结束");
        await 发(别的同意人, `合并申请${给别人}已作废`, `${一句 ? `${一句}。` : ""}不用再处理`, "结束");
        return;
      case "撤回":
        await 发(别的同意人, `${发起人名}撤回了合并申请：${给别人}`, "不用再处理", "结束");
        return;
      case "合并":
        await 发([r.byUserId], `你发起的合并申请${给发}已合并`, `${撤回期限天数} 天内可在留下那家的「历史变更」里整单撤回`, "结束");
        await 发(r.approvers.map((x) => x.userId), `你同意的合并申请${给别人}已合并`, `${撤回期限天数} 天内发起人可撤回`, "结束");
        return;
    }
  } catch (e) {
    console.warn("[通知] 合并申请没发：", e instanceof Error ? e.message : e);
  }
}

const 读JSON = <T,>(v: string, 缺: T): T => {
  try {
    return JSON.parse(v) as T;
  } catch {
    return 缺;
  }
};
