/**
 * 企业版合并客户 · 数据层（2026-11-25，客户 E-277 / E-280 第一批；方案见 docs/合并客户-第一批-落地.md）。
 *
 * 员工在要留的客户 A 上选另一家 B 并进来：B 名下联系人、项目、沟通、待办……整体改指 A，B 只软删（不连带），
 * 合并单 EntCustomerMerge 记下每一行挪了什么、原值是什么，30 天内照原样整单撤回。
 *
 *   - 合并预览：能不能并（不能就说清原因）、两家并排的格、要挪的各类条数、要不要勾「已核对」
 *   - 执行合并：一个事务，事务里再判一遍；写合并单、两家各一条操作日志；提交后重算三态、发通知
 *   - 撤回合并：30 天内，只比合并写过的那几格（同导入撤回 revert.ts 的 一致()）：还是合并写下的才改回，
 *     对不上的整组留下、记进 undoLeft；合并之后挂在 A 本身的不跟着回去，挂在挪回的项目 / 联系人上的跟着回（审查第二单 M4）。
 *     合并之后又单独合成过这张单里的联系人：先拆开那几次合成再撤（M3）
 *
 * 谁能并（E-280 一.3）：两家负责人都是自己（能删客户的角色，同 P-删-01），且两家名下没结束的项目负责人也都是自己
 * （项目公海里的不算同事的，同 P-删-05 的口径）；系统管理员可代并。合并不成组：项目负责人、组员都不动（E-280 一.2）。
 * 第二批（合并申请、并进另一个项目）用同一张合并单：kind / parentId / approvals / status 留了口子，这里不写。
 */
import type { PrismaClient, Prisma } from "@/generated/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看已删, 回收站保留天数 } from "./soft-delete-core";
import { 企业版 } from "./switch";
import { 权限组织 } from "./org";
import { 能删除, 是系统管理员, 只读角色, 只看的人 } from "./permissions";
import type { 组织 } from "./org";
import { 在推项目条件 } from "@/lib/project/active";
import { 交接中的客户, 离职交接中的客户, 离职交接中的项目 } from "./handover-db";
import { 跟着项目重算, 客户状态自动 } from "./cust-status-auto-db";
import { 存沟通后重算三态 } from "./tri-state-db";
import { 不是同号留痕 } from "./same-number-mark";
import { notify } from "./notify";
import { 通知里的客户名 } from "./notice-mask";
import { 客户编号文字 } from "@/lib/customer-no";
import { 同事项目几个话 } from "@/lib/carry-over";
import { 忘掉企业版范围 } from "./visibility";
import { 合成一对, 拆开一对, 类叫 } from "./contact-merge";
import { 号码脱敏器 } from "./phone-mask";
import { 撞上别的写入 } from "@/lib/check-then-write";
import { 序号撞了 } from "./repeat-inquiry";

type 库 = PrismaClient;
type Tx = Prisma.TransactionClient;
export type 合并人 = { id: string; name: string; role: string };
type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** 撤回期限（天）：同回收站，B 清掉以后撤不了 */
export const 撤回期限天数 = 回收站保留天数;
export const 合并通知种类 = "合并客户";
export const 已核对话 = "已核对，按留下那家的来源和创建人";
/** 合并单 kind：客户合并 / 合成联系人（单独合成的 parentId 空；合并客户时勾的挂在客户合并单下） */
export const 客户单 = "客户";
export const 联系人单 = "联系人";
/** 第二批 2a 项目合并单（同 project-merge-guard.ts 项目单；这里另写一份免得引它） */
const 项目合并单 = "项目";
/** 项目换客户 / 撤回合并时，项目联系人挂靠到项目新归属的客户那一行的说明（project-move-customer.ts 也用） */
export const 挂靠说明 = "随项目换客户挂过来";

/**
 * 合并 / 撤回 / 合成 / 换客户的事务选项：企业版库只开一条连接，默认排队 2 秒会误报（同 settings/org-actions 的 事务选项）；
 * 一次挪的行多，限时放到 60 秒
 */
export const 合并事务选项 = { maxWait: 10_000, timeout: 60_000 };
export const 刚被改过话 = "刚被别人改过，刷新看看";
/** 排队等锁超时（maxWait，P2028「Unable to start a transaction」）、库忙、写冲突：这次什么都没写，给人看一句；别的错照旧抛 */
export function 并发失败话(e: unknown): string | null {
  return 撞上别的写入(e) ? 刚被改过话 : null;
}

/* ───────────────────────── 读两家 ───────────────────────── */

const 客户列 = {
  id: true, name: true, shortName: true, customerNo: true, salesOwnerId: true, channelId: true, channelOwnerId: true, touchpoint: true,
  bizLine: true, customerType: true, customerAttr: true, custStatus: true, poolInvalidAt: true, poolReturns: true,
  addrCountry: true, addrProvince: true, addrCity: true, addrDistrict: true, addrDetail: true, createdAt: true, deletedAt: true,
  referrerCustomerId: true, attributionCustomerId: true, remark: true,
  pool: { select: { customerId: true } },
  creator: { select: { userId: true } },
  extra: { select: { country: true, website: true, level: true, whatsapp: true, wechat: true, email: true, alibabaId: true } },
  channel: { select: { name: true, channelOwnerId: true } },
} satisfies Prisma.CustomerSelect;
export type 客户行 = Prisma.CustomerGetPayload<{ select: typeof 客户列 }>;

export async function 读客户(db: Pick<Tx, "customer">, id: string): Promise<客户行 | null> {
  return 看全部(() => db.customer.findFirst({ where: { id, deletedAt: null }, select: 客户列 }));
}

const 名 = (c: Pick<客户行, "name" | "shortName" | "customerNo" | "id">) => 通知里的客户名(c);
const 地址 = (c: 客户行) => [c.addrCountry, c.addrProvince, c.addrCity, c.addrDistrict, c.addrDetail].filter(Boolean).join(" ");
const 有值 = (v: unknown) => v !== null && v !== undefined && v !== "";

/* ───────────────────────── 谁能并 ───────────────────────── */

/**
 * 两家名下没结束（没结局、不在项目公海）、负责人不是我的项目个数；负责人空的不算。
 * 回收站里的不算（总控 11-25）：显式带 deletedAt: null——预览不在 看已删 里调、执行合并在里面调，两边要数得一样
 */
async function 同事在推个数(db: Pick<Tx, "project">, customerId: string, 我: string): Promise<number> {
  const 们 = await 看全部(() => db.project.findMany({ where: { customerId, deletedAt: null, ...在推项目条件 }, select: { ownerId: true } }));
  return 们.filter((p) => p.ownerId && p.ownerId !== 我).length;
}

/**
 * 离职交接待确认（拦法同 project-move-customer）：两家本身被负责人的离职交接盖住（交这位客户、一键全部交给），
 * 或两家名下没删的项目在离职交接里，都拦。接手人确认时按当时的客户和负责人分拣：B 并掉 / 拆回以后对不上，
 * 挪过去的项目会留在离职的人名下。合并、撤回合并用同一套
 */
async function 离职交接拦(db: Pick<Tx, "entHandover" | "project">, 两家: Pick<客户行, "id" | "name" | "shortName" | "customerNo" | "salesOwnerId">[], 再: string): Promise<string[]> {
  const [客, 项目们] = await Promise.all([
    离职交接中的客户(两家, db),
    看全部(() => db.project.findMany({ where: { customerId: { in: 两家.map((c) => c.id) }, deletedAt: null }, select: { id: true, ownerId: true, customerId: true } })),
  ]);
  const 项 = await 离职交接中的项目(项目们, db);
  const 因: string[] = [];
  for (const c of 两家) {
    if (客.has(c.id)) 因.push(`「${名(c)}」正在离职交接中，等接手人确认或撤回交接后再${再}`);
    else if (项目们.some((p) => p.customerId === c.id && 项.has(p.id))) 因.push(`「${名(c)}」名下有项目正在离职交接中，等接手人确认或撤回交接后再${再}`);
  }
  return 因;
}

/**
 * 不能并的原因（空 = 能并）。A = 留下，B = 并掉。
 * 按申请（第二批 2b 跨负责人合并申请，merge-request.ts）：只判数据拦法（交接中、公海、无效、业务线不同），
 * 「是不是自己负责」那层不判——申请模式下改成算要同意的人、全同意了才执行。
 * 并掉看不到（按申请、并进来那家发起人看不到，靠完整号码放行进来的，PR #506 审查第 3、4 条）：拦话不超过挂靠只读卡——
 * 那家的交接中、离职交接、标了无效统一说 并掉看不到话、不点名原因也不报名字；业务线不同只说「两家业务线不同」、不列值
 */
async function 拦的原因(db: Tx | 库, A: 客户行 | null, B: 客户行 | null, me: 合并人, org: 组织 | null, 按申请 = false, 并掉看不到 = false): Promise<string[]> {
  if (!企业版()) return ["只有企业版能合并客户"];
  if (!A || !B) return ["客户不存在或已删除，刷新看看"];
  if (A.id === B.id) return ["不能和自己合并，请选另一位客户"];
  if (!org || 只读角色(me, org) || 只看的人(org, me.id)) return ["你只能看，不能合并客户"];
  const 管 = 是系统管理员(me, org);
  const 因: string[] = [];
  const 在公海 = (c: 客户行) => !!c.pool;
  if (在公海(A) !== 在公海(B)) 因.push(`「${名(在公海(A) ? A : B)}」在公海里，先领出来再并`);
  else if (在公海(A) && !管) 因.push("两家都在公海里，只有系统管理员能合并");
  // 第二批 2b-3：直接并不了的两种（有一家是同事的、名下有同事在推的项目）引导发合并申请（方案第二批第 4 节：第一批拦下要找系统管理员的改成发申请）
  if (!管 && !在公海(A) && !按申请) {
    const 不是我的 = [A, B].filter((c) => !能删除(me, org, c.salesOwnerId));
    if (不是我的.length) 因.push(`${不是我的.map((c) => `「${名(c)}」`).join("")}不是你负责的，只能直接合并两家都由你负责的客户；要并同事的客户，可以发合并申请，要同意的人都同意后合并`);
    else
      for (const c of [A, B]) {
        const n = await 同事在推个数(db, c.id, me.id);
        if (n) 因.push(`「${名(c)}」名下${同事项目几个话(n)}，不能直接合并；可以发合并申请，要同意的人都同意后合并`);
      }
  }
  const 藏B = 按申请 && 并掉看不到;
  let 说过B = false;
  /** B 的状态拦话：看不到时只说一次 并掉看不到话 */
  const 拦B = (话: string) => {
    if (!藏B) return void 因.push(话);
    if (!说过B) 因.push(并掉看不到话);
    说过B = true;
  };
  const 交接 = await 交接中的客户([A.id, B.id], db as Tx);
  if (交接.has(A.id)) 因.push(`「${名(A)}」正在转让交接中，等接手人确认或撤回交接后再并`);
  if (交接.has(B.id)) 拦B(`「${名(B)}」正在转让交接中，等接手人确认或撤回交接后再并`);
  因.push(...(await 离职交接拦(db as Tx, [A], "并")));
  for (const 话 of await 离职交接拦(db as Tx, [B], "并")) 拦B(话);
  if (A.poolInvalidAt) 因.push(`「${名(A)}」标了无效客户，先由系统管理员恢复再并`);
  if (B.poolInvalidAt) 拦B(`「${名(B)}」标了无效客户，先由系统管理员恢复再并`);
  if (有值(A.bizLine) && 有值(B.bizLine) && A.bizLine !== B.bizLine) 因.push(藏B ? "两家业务线不同，不能合并" : `两家业务线不同（${A.bizLine} / ${B.bizLine}），不能合并`);
  return 因;
}

/** 并进来那家发起人看不到时，它自己的状态（交接中、无效、没负责人、挂着别的申请）拦下统一这一句，不点名原因（PR #506 审查第 3 条） */
export const 并掉看不到话 = "这家暂时不能并，请联系它的负责人";

/**
 * 第二批 2b 合并申请发起前判数据拦法（不判「是不是自己负责」，见 拦的原因）。
 * 并掉看不到 = 并进来那家发起人看不到（按完整号码放行进来的）：拦话收窄，见 拦的原因
 */
export async function 申请拦的原因(db: Tx | 库, A: 客户行 | null, B: 客户行 | null, me: 合并人, org: 组织 | null, opt: { 并掉看不到?: boolean } = {}): Promise<string[]> {
  return 拦的原因(db, A, B, me, org, true, !!opt.并掉看不到);
}

/* ───────────────────────── 只补空 ───────────────────────── */

/** 备注也只补空（E-277「空格用被并那家补」，审查第二单建议 6）：A 有备注的不合并文字，B 的备注记进合并单明细（被并备注） */
const 补空客户格 = ["shortName", "customerType", "customerAttr", "bizLine", "remark"] as const;
const 地址格 = ["addrCountry", "addrProvince", "addrCity", "addrDistrict", "addrDetail"] as const;
const 补空档案格 = ["country", "website", "level"] as const;
/**
 * 档案里的查重号码（contact-dedupe.ts 跨类SQL 档案原样 / 档案号键 按这几列查重）：A 空的用 B 的补上、同时清空 B 的
 * （同 contact-merge.ts 对「并」那位老号码列的处理：免得回收站里的 B 撞号、查重捞回把 B 捞回来），撤回时换回去；
 * A 不空的 B 的不动，预览里列出「随被并那家进回收站」（审查第二单 M6）
 */
const 档案号格 = ["whatsapp", "wechat", "email", "alibabaId"] as const;
const 格叫法: Record<string, string> = {
  shortName: "客户简称", customerType: "客户类型", customerAttr: "客户属性", bizLine: "业务线", 地址: "客户地址", remark: "备注",
  country: "国家 / 地区", website: "官网", level: "客户等级",
  whatsapp: "WhatsApp", wechat: "微信", email: "邮箱", alibabaId: "阿里国际站买家 ID",
};

/** 档案号：A 补上、B 清空的那几格（老合并单没有这一项） */
type 补空 = { 客户: Record<string, string>; 档案: Record<string, string>; 档案号?: Record<string, string>; 档案新建: boolean };
function 算补空(A: 客户行, B: 客户行): 补空 {
  const 客户: Record<string, string> = {};
  for (const k of 补空客户格) if (!有值(A[k]) && 有值(B[k])) 客户[k] = B[k] as string;
  if (地址格.every((k) => !有值(A[k])) && 地址格.some((k) => 有值(B[k]))) for (const k of 地址格) if (有值(B[k])) 客户[k] = B[k] as string;
  const 档案: Record<string, string> = {};
  for (const k of 补空档案格) if (!有值(A.extra?.[k]) && 有值(B.extra?.[k])) 档案[k] = B.extra![k] as string;
  const 档案号: Record<string, string> = {};
  for (const k of 档案号格) if (!有值(A.extra?.[k]) && 有值(B.extra?.[k])) 档案号[k] = B.extra![k] as string;
  return { 客户, 档案, 档案号, 档案新建: !A.extra && Object.keys(档案).length + Object.keys(档案号).length > 0 };
}
const 补空叫法 = (s: 补空) =>
  [...new Set([...Object.keys(s.客户).map((k) => ((地址格 as readonly string[]).includes(k) ? "地址" : k)), ...Object.keys(s.档案), ...Object.keys(s.档案号 ?? {})])].map((k) => 格叫法[k]);
/** 两家档案里查重号码都有、又不一样的格：留下那家的不动，被并那家的值随它进回收站（预览列出） */
const 号格留下有值 = (A: 客户行, B: 客户行) => 档案号格.filter((k) => 有值(A.extra?.[k]) && 有值(B.extra?.[k]) && A.extra![k] !== B.extra![k]).map((k) => 格叫法[k]);

/* ───────────────────────── 预览 ───────────────────────── */

export type 并排格 = { 格: string; 留下: string; 并掉: string; 不同: boolean; 标红?: boolean };
export type 合并条数 = {
  联系人: number; 项目: number; 订单项目: number; 回款: number; 沟通: number; 待办: number; 跟进计划: number;
  关联客户: number; 项目关联: number; 撞号记录: number;
};
export type 合并预览结果 = {
  能并: boolean;
  原因: string[];
  并排: 并排格[];
  条数: 合并条数 | null;
  /** 来源（主渠道、渠道触点）或创建人不同：要勾「已核对，按留下那家的来源和创建人」才能并 */
  要勾选: boolean;
  /** 留下那家空着、要用被并那家补上的格（叫法） */
  补空: string[];
  /** 档案里的查重号码两家都有：留下那家的不动，被并那家的值随它进回收站（叫法） */
  号格留下有值: string[];
  /** 两家的联系人（勾「是同一个人」用；号码照看的人的打码规则） */
  联系人们: { 留下: 预览联系人[]; 并掉: 预览联系人[] };
};
export type 预览联系人 = { id: string; name: string; position: string | null; 关键: boolean; 号: string[] };

async function 预览联系人们(db: 库, customerId: string, me: 合并人): Promise<预览联系人[]> {
  const [们, 号] = await Promise.all([
    看全部(() => db.contact.findMany({
      where: { customerId, deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, position: true, isPrimary: true, contactMethods: { select: { kind: true, value: true }, orderBy: { createdAt: "asc" } } },
    })),
    号码脱敏器(me.id),
  ]);
  return 们.map((c) => ({ id: c.id, name: c.name, position: c.position, 关键: c.isPrimary, 号: c.contactMethods.map((m) => (m.kind === "phone" ? 号(m.value) : m.value)) }));
}

async function 人名们(db: Pick<Tx, "user">, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const 们 = [...new Set(ids.filter((x): x is string => !!x))];
  if (!们.length) return new Map();
  return new Map((await db.user.findMany({ where: { id: { in: 们 } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
}

export function 来源或创建人不同(A: 客户行, B: 客户行): boolean {
  return (A.channelId ?? null) !== (B.channelId ?? null) || (A.touchpoint ?? null) !== (B.touchpoint ?? null) || (A.creator?.userId ?? null) !== (B.creator?.userId ?? null);
}

async function 数条数(db: Tx | 库, id: string): Promise<合并条数> {
  return 看全部(async () => {
    const [联系人, 项目, 订单项目, 回款, 沟通, 待办, 跟进计划, 关联a, 关联b, 项目关联, 撞号记录] = await Promise.all([
      // 只数没删的（执行合并在 看已删 里调，要自己带上）；回收站里的照样一起挪
      db.contact.count({ where: { customerId: id, deletedAt: null } }),
      db.project.count({ where: { customerId: id, deletedAt: null } }),
      db.project.count({ where: { customerId: id, deletedAt: null, phase: "订单" } }),
      db.entProjectPayment.count({ where: { project: { customerId: id, deletedAt: null } } }),
      db.followUp.count({ where: { customerId: id, deletedAt: null } }),
      db.task.count({ where: { customerId: id } }),
      db.followPlan.count({ where: { customerId: id } }),
      db.entCustomerLink.count({ where: { customerId: id } }),
      db.entCustomerLink.count({ where: { otherId: id } }),
      db.projectCustomer.count({ where: { customerId: id } }),
      db.entDupeHit.count({ where: { customerId: id } }),
    ]);
    return { 联系人, 项目, 订单项目, 回款, 沟通, 待办, 跟进计划, 关联客户: 关联a + 关联b, 项目关联, 撞号记录 };
  });
}

/** 合并预览：A = 留下那家，B = 要并掉的那家 */
/**
 * 合并预览。按申请（第二批 2b 发合并申请前的预览，merge-request.ts 合并申请预览）：只判数据拦法；
 * 同事那家不超过挂靠只读卡（方案第二批第 11 件第 3 条）：联系人只给姓名、职务，不给号码；并排不给地址、客户状态（只读卡不给负责人、级别、状态）。
 * 建档时间照给：方案那条只列了条数、来源和创建人，没点名建档时间，只读卡也没这格；一个日期不露联系方式、帮着判是不是同一家，先留（2b-3 审查单 A 第 2 条）
 */
export async function 合并预览(db: 库, 留下id: string, 并掉id: string, me: 合并人, opt: { 按申请?: boolean; 并掉看不到?: boolean } = {}): Promise<合并预览结果> {
  const org = await 权限组织();
  const [A, B] = await Promise.all([读客户(db, 留下id), 读客户(db, 并掉id)]);
  const 按申请 = !!opt.按申请;
  // 按申请且并进来那家看不到（按完整号码放行）：并排再去掉业务线（只读卡没这格，PR #506 审查第 4 条），拦话收窄见 拦的原因
  const 藏B = 按申请 && !!opt.并掉看不到;
  const 原因 = await 拦的原因(db, A, B, me, org, 按申请, 藏B);
  if (!A || !B) return { 能并: false, 原因, 并排: [], 条数: null, 要勾选: false, 补空: [], 号格留下有值: [], 联系人们: { 留下: [], 并掉: [] } };
  const 人 = await 人名们(db, [A.salesOwnerId, B.salesOwnerId, A.creator?.userId, B.creator?.userId]);
  const 日 = (d: Date) => d.toISOString().slice(0, 10);
  const 行 = (格: string, a: string, b: string, 标红 = false): 并排格 => ({ 格, 留下: a, 并掉: b, 不同: a !== b, ...(标红 && a !== b ? { 标红: true } : {}) });
  const 并排 = [
    // 并进来那家发起人看不到（按号放行）：名称给代称、简称不给，同搜索行和确认框
    行("客户名称", A.name ?? "", 藏B ? "同事负责的客户（号码撞上）" : B.name ?? ""),
    行("客户简称", A.shortName ?? "", 藏B ? "" : B.shortName ?? ""),
    行("客户编号", 客户编号文字(A.customerNo) ?? "", 客户编号文字(B.customerNo) ?? ""),
    行("负责人", 人.get(A.salesOwnerId) ?? (A.pool ? "公海" : ""), 人.get(B.salesOwnerId) ?? (B.pool ? "公海" : "")),
    行("来源渠道", A.channel?.name ?? "", B.channel?.name ?? "", true),
    行("渠道触点", A.touchpoint ?? "", B.touchpoint ?? "", true),
    行("创建人", 人.get(A.creator?.userId ?? "") ?? "", 人.get(B.creator?.userId ?? "") ?? "", true),
    ...(藏B ? [] : [行("业务线", A.bizLine ?? "", B.bizLine ?? "")]),
    行("客户类型", A.customerType ?? "", B.customerType ?? ""),
    行("客户属性", A.customerAttr ?? "", B.customerAttr ?? ""),
    ...(按申请 ? [] : [行("客户地址", 地址(A), 地址(B)), 行("客户状态", A.custStatus ?? "", B.custStatus ?? "")]),
    行("建档时间", 日(A.createdAt), 日(B.createdAt)),
  ];
  // 拦住的不给联系人明细（只给能并的人看两家的人和号）
  const 不给号 = (们: 预览联系人[]) => (按申请 ? 们.map((c) => ({ ...c, 号: [] })) : 们);
  const 联系人们 = 原因.length ? { 留下: [], 并掉: [] } : { 留下: 不给号(await 预览联系人们(db, A.id, me)), 并掉: 不给号(await 预览联系人们(db, B.id, me)) };
  return { 能并: 原因.length === 0, 原因, 并排, 条数: await 数条数(db, B.id), 要勾选: 来源或创建人不同(A, B), 补空: 补空叫法(算补空(A, B)), 号格留下有值: 号格留下有值(A, B), 联系人们 };
}

/* ───────────────────────── 合并单明细 ───────────────────────── */

/** 只改了一格（列从 B 改成 A）的那几张表：撤回时这格还是 A 的才改回 B */
const 改指表 = [
  ["followUp", "customerId"], ["task", "customerId"], ["followPlan", "customerId"], ["opportunity", "customerId"], ["contract", "customerId"],
  ["contactMethod", "customerId"], ["customerOwnerLog", "customerId"], ["entBlocker", "customerId"],
  ["unassignedContact", "fromCustomerId"], ["customer", "referrerCustomerId"], ["customer", "attributionCustomerId"],
  ["contactCustomer", "customerId"], ["projectCustomer", "customerId"], ["entDupeHit", "customerId"],
] as const;
type 改指表名 = (typeof 改指表)[number][0];
const 改指键 = (t: string, 列: string) => `${t}.${列}`;

type 合并明细 = {
  版本: 1;
  B删于: string;
  /** "表.列" → 改指过的行 id */
  改指: Record<string, string[]>;
  /** EntExternalRef：entity = customer 的 targetId B → A */
  对照: string[];
  /** 联系人一组：主客户、关键标 */
  联系人: { id: string; 去关键: boolean }[];
  /** 项目一组：所属客户；补的来源；重复咨询原始客户和序号 */
  项目: { id: string; 挪客户: boolean; 补来源?: string; 重复?: { 原序: number | null; 新序: number | null } }[];
  /** A 自己指着 B 的推荐人 / 业绩归属，改成了空 */
  A自指: { referrer: boolean; attribution: boolean };
  /** 去重删掉的整行，撤回时建回 */
  删掉: { contactCustomer: Record<string, unknown>[]; projectCustomer: Record<string, unknown>[]; entCustomerLink: Record<string, unknown>[]; customerPool: Record<string, unknown>[] };
  /** 关联客户改了一头的：原 / 新两头 */
  关联: { id: string; 原: [string, string]; 新: [string, string] }[];
  /** 待处理挂靠申请换了审批人 */
  审批人: { id: string; 原: string | null; 新: string | null }[];
  补空: 补空;
  退回次数: number;
  /** A 有备注、B 也有（不一样）：A 的照旧，B 的记在这里可查（合并单列表读得出） */
  被并备注?: string;
};

const 分段 = <T,>(xs: readonly T[], n = 400): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

type 通用表 = {
  findMany(a: { where: object; select: object }): Promise<Record<string, unknown>[]>;
  updateMany(a: { where: object; data: object }): Promise<{ count: number }>;
};
const 表 = (tx: Tx, t: string) => (tx as unknown as Record<string, 通用表>)[t];

/** 把 t.列 = from 的行改成 to，返回改了哪些 id */
async function 改指(tx: Tx, t: string, 列: string, from: string, to: string | null, 除外: readonly string[] = []): Promise<string[]> {
  const ids = (await 表(tx, t).findMany({ where: { [列]: from, ...(除外.length ? { id: { notIn: [...除外] } } : {}) }, select: { id: true } })).map((r) => r.id as string);
  for (const 段 of 分段(ids)) await 表(tx, t).updateMany({ where: { id: { in: 段 } }, data: { [列]: to } });
  return ids;
}

/* ───────────────────────── 执行合并 ───────────────────────── */

export class 拦下 extends Error {}

export type 合并完 = { mergeId: string; 条数: 合并条数; 合成: number };
/** 勾的「是同一个人」：留 = 留下那家的联系人，并 = 被并那家的联系人 */
export type 同一个人 = { 留: string; 并: string };

/** 「是同一个人」那几对查一遍：留的是 A 的、并的是 B 的，都没删，一位只出现一次 */
async function 查同一个人(tx: Tx, A: string, B: string, 对们: readonly 同一个人[]): Promise<string | null> {
  if (!对们.length) return null;
  const ids = 对们.flatMap((x) => [x.留, x.并]);
  if (new Set(ids).size !== ids.length) return "同一位联系人只能勾一次「是同一个人」";
  const 们 = new Map((await tx.contact.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, customerId: true } })).map((c) => [c.id, c.customerId]));
  for (const x of 对们) if (们.get(x.留) !== A || 们.get(x.并) !== B) return "勾的「是同一个人」对不上两家的联系人，刷新再勾";
  return null;
}

/**
 * 执行合并：B 并进 A。已核对 = 预览里要勾选时勾过了；同一个人 = 勾了「是同一个人」的几对联系人，合成一位。
 * 申请（第二批 2b，merge-request.ts 全同意后调）：me = 发起人，不判「是不是自己负责」（同意人已经同意过），
 * 申请经过（JSON）记进合并单的 approvals 那一格；申请.并掉看不到 = 并进来那家发起人看不到（按号放行进来的），拦话照 拦的原因 收窄
 */
export async function 执行合并(db: 库, 留下id: string, 并掉id: string, me: 合并人, opt: { 已核对?: boolean; 现在?: Date; 同一个人?: readonly 同一个人[]; 申请?: { 经过: string; 已另通知?: readonly string[]; 并掉看不到?: boolean } } = {}): Promise<结果<合并完>> {
  const 现在 = opt.现在 ?? new Date();
  const org = await 权限组织();
  const 开 = await 客户状态自动();
  let 通知要: { A: 客户行; B: 客户行 } | null = null;
  let r: 合并完;
  try {
    r = await 看已删(() =>
      看全部(() =>
        db.$transaction(async (tx) => {
          const [A, B] = [await 读客户(tx, 留下id), await 读客户(tx, 并掉id)];
          // 按申请且并进来那家发起人看不到：拦话收窄（拦下的话会存成申请的失效原因、发给发起人，2b-3 第二段审查第 1 条）
          const 原因 = await 拦的原因(tx, A, B, me, org, !!opt.申请, !!opt.申请?.并掉看不到);
          if (原因.length) throw new 拦下(原因.join("；"));
          if (来源或创建人不同(A!, B!) && !opt.已核对) throw new 拦下(`两家的来源或创建人不一样，请先勾选「${已核对话}」`);
          const 对们 = opt.同一个人 ?? [];
          const 对不上 = await 查同一个人(tx, A!.id, B!.id, 对们);
          if (对不上) throw new 拦下(对不上);
          // 先读好每对两位当时的样子（关键标、主客户），挪完再合成
          const 两位 = new Map((await tx.contact.findMany({ where: { id: { in: 对们.flatMap((x) => [x.留, x.并]) } }, select: { id: true, name: true, customerId: true, isPrimary: true, deletedAt: true } })).map((c) => [c.id, c]));
          const 结 = await 挪(tx, A!, B!, me, 现在, 开);
          if (opt.申请) await tx.entCustomerMerge.update({ where: { id: 结.mergeId }, data: { approvals: opt.申请.经过 } });
          for (const x of 对们) {
            // 挪的时候 B 的关键标可能已经去掉了：按挪完的样子合成
            const 现 = await tx.contact.findMany({ where: { id: { in: [x.留, x.并] } }, select: { id: true, name: true, customerId: true, isPrimary: true, deletedAt: true } });
            const 留 = 现.find((c) => c.id === x.留) ?? 两位.get(x.留)!;
            const 并 = 现.find((c) => c.id === x.并) ?? 两位.get(x.并)!;
            const 明 = await 合成一对(tx, 留, 并, 现在);
            await tx.entCustomerMerge.create({
              data: { kind: 联系人单, fromId: 并.id, intoId: 留.id, parentId: 结.mergeId, status: "已合并", byUserId: me.id, fromName: 并.name, detail: JSON.stringify(明), at: 现在 },
            });
          }
          结.合成 = 对们.length;
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
  await 存沟通后重算三态(留下id, 现在).catch((e) => console.warn("[合并客户] 三态没重算上：", e instanceof Error ? e.message : e));
  if (通知要) await 合并后通知(通知要, me, opt.申请?.已另通知 ?? []);
  return { ok: true, ...r! };
}

async function 挪(tx: Tx, A: 客户行, B: 客户行, me: 合并人, 现在: Date, 开: boolean): Promise<合并完> {
  const 条数 = await 数条数(tx, B.id);
  const 明: 合并明细 = {
    版本: 1, B删于: 现在.toISOString(), 改指: {}, 对照: [], 联系人: [], 项目: [], A自指: { referrer: false, attribution: false },
    删掉: { contactCustomer: [], projectCustomer: [], entCustomerLink: [], customerPool: [] }, 关联: [], 审批人: [], 补空: 算补空(A, B), 退回次数: B.poolReturns,
    ...(有值(A.remark) && 有值(B.remark) && A.remark !== B.remark ? { 被并备注: B.remark! } : {}),
  };

  // 联系人：主客户改 A；A 已有关键联系人的，B 的关键联系人去掉关键标
  const A有关键 = (await tx.contact.count({ where: { customerId: A.id, isPrimary: true, deletedAt: null } })) > 0;
  const 联系人们 = await tx.contact.findMany({ where: { customerId: B.id }, select: { id: true, isPrimary: true } });
  for (const 段 of 分段(联系人们.map((c) => c.id))) await tx.contact.updateMany({ where: { id: { in: 段 } }, data: { customerId: A.id } });
  for (const c of 联系人们) {
    const 去关键 = A有关键 && c.isPrimary;
    if (去关键) await tx.contact.update({ where: { id: c.id }, data: { isPrimary: false } });
    明.联系人.push({ id: c.id, 去关键 });
  }

  // 联系人挂靠：同一位联系人两家都挂着的，删 B 那行；其余改指
  const 挂靠们 = await tx.contactCustomer.findMany({ where: { customerId: B.id } });
  const A已挂 = new Set((await tx.contactCustomer.findMany({ where: { customerId: A.id, contactId: { in: 挂靠们.map((x) => x.contactId) } }, select: { contactId: true } })).map((x) => x.contactId));
  const 挂靠重 = 挂靠们.filter((x) => A已挂.has(x.contactId));
  if (挂靠重.length) await tx.contactCustomer.deleteMany({ where: { id: { in: 挂靠重.map((x) => x.id) } } });
  明.删掉.contactCustomer = 挂靠重;
  明.改指[改指键("contactCustomer", "customerId")] = await 改指(tx, "contactCustomer", "customerId", B.id, A.id);

  // 项目：所属客户改 A；来源空着的补 B 的主渠道；重复咨询原始客户是 B 的改指 A、有序号的接在 A 最大号后面
  //（查重领取建的序号空着、不占号——只出口 C 记号（8bb2bffa）：只改原始客户，序号照旧空）
  const 项目们 = await tx.project.findMany({ where: { customerId: B.id }, select: { id: true, channelId: true } });
  for (const 段 of 分段(项目们.map((p) => p.id))) await tx.project.updateMany({ where: { id: { in: 段 } }, data: { customerId: A.id } });
  const 明项目 = new Map<string, 合并明细["项目"][number]>(项目们.map((p) => [p.id, { id: p.id, 挪客户: true }]));
  if (B.channelId)
    for (const p of 项目们.filter((p) => !p.channelId)) {
      await tx.project.update({ where: { id: p.id }, data: { channelId: B.channelId } });
      明项目.get(p.id)!.补来源 = B.channelId;
    }
  const 重复们 = await tx.project.findMany({ where: { repeatOfCustomerId: B.id }, select: { id: true, repeatSeq: true }, orderBy: [{ repeatSeq: "asc" }, { createdAt: "asc" }] });
  if (重复们.length) {
    let 序 = (await tx.project.aggregate({ where: { repeatOfCustomerId: A.id }, _max: { repeatSeq: true } }))._max.repeatSeq ?? 0;
    for (const p of 重复们) {
      const 新序 = p.repeatSeq == null ? null : ++序;
      await tx.project.update({ where: { id: p.id }, data: { repeatOfCustomerId: A.id, ...(新序 === null ? {} : { repeatSeq: 新序 }) } });
      const 行 = 明项目.get(p.id) ?? { id: p.id, 挪客户: false };
      行.重复 = { 原序: p.repeatSeq, 新序 };
      明项目.set(p.id, 行);
    }
  }
  明.项目 = [...明项目.values()];

  // 项目关联客户：改指后撞上已有的、或关联的就是项目自己的主客户（A）的，删掉
  const 关联们 = await tx.projectCustomer.findMany({ where: { customerId: B.id }, include: { project: { select: { customerId: true } } } });
  const A已关联 = new Set((await tx.projectCustomer.findMany({ where: { customerId: A.id, projectId: { in: 关联们.map((x) => x.projectId) } }, select: { projectId: true } })).map((x) => x.projectId));
  const 关联重 = 关联们.filter((x) => A已关联.has(x.projectId) || x.project.customerId === A.id);
  if (关联重.length) await tx.projectCustomer.deleteMany({ where: { id: { in: 关联重.map((x) => x.id) } } });
  明.删掉.projectCustomer = 关联重.map(({ project: _p, ...x }) => x);
  明.改指[改指键("projectCustomer", "customerId")] = await 改指(tx, "projectCustomer", "customerId", B.id, A.id);
  // A 自己的项目原来关联着 B 的：改指后关联的是主客户，也删
  const A项目关联A = await tx.projectCustomer.findMany({ where: { customerId: A.id, project: { customerId: A.id } } });
  if (A项目关联A.length) {
    await tx.projectCustomer.deleteMany({ where: { id: { in: A项目关联A.map((x) => x.id) } } });
    const 改过 = new Set(明.改指[改指键("projectCustomer", "customerId")]);
    // 刚改指过来的那几行：撤回时按「删掉的整行」建回成 B（行里的 customerId 写回 B）
    for (const x of A项目关联A) 明.删掉.projectCustomer.push(改过.has(x.id) ? { ...x, customerId: B.id } : x);
    明.改指[改指键("projectCustomer", "customerId")] = 明.改指[改指键("projectCustomer", "customerId")].filter((id) => !A项目关联A.some((x) => x.id === id));
  }

  // 关联客户：B 那一头换成 A、两头重排小大；A—B 这一对和改完撞上的删掉
  const 链们 = await tx.entCustomerLink.findMany({ where: { OR: [{ customerId: B.id }, { otherId: B.id }] } });
  const 已有对 = new Set(
    (await tx.entCustomerLink.findMany({ where: { OR: [{ customerId: A.id }, { otherId: A.id }] }, select: { customerId: true, otherId: true } })).map((x) => `${x.customerId}|${x.otherId}`),
  );
  for (const l of 链们) {
    const 另 = l.customerId === B.id ? l.otherId : l.customerId;
    const 新: [string, string] = A.id < 另 ? [A.id, 另] : [另, A.id];
    if (另 === A.id || 已有对.has(新.join("|"))) {
      await tx.entCustomerLink.delete({ where: { id: l.id } });
      明.删掉.entCustomerLink.push(l);
      continue;
    }
    await tx.entCustomerLink.update({ where: { id: l.id }, data: { customerId: 新[0], otherId: 新[1] } });
    已有对.add(新.join("|"));
    明.关联.push({ id: l.id, 原: [l.customerId, l.otherId], 新 });
  }

  // 撞号台账：历史改指 A；等审批的挂靠申请审批人换成 A 的负责人
  const 待审 = await tx.entDupeHit.findMany({ where: { customerId: B.id, status: "待处理" }, select: { id: true, approverId: true } });
  明.改指[改指键("entDupeHit", "customerId")] = await 改指(tx, "entDupeHit", "customerId", B.id, A.id);
  const 新审批人 = A.salesOwnerId || null;
  for (const h of 待审.filter((h) => h.approverId !== 新审批人)) {
    await tx.entDupeHit.update({ where: { id: h.id }, data: { approverId: 新审批人 } });
    明.审批人.push({ id: h.id, 原: h.approverId, 新: 新审批人 });
  }

  // 推荐人 / 业绩归属：A 自己指着 B 的改成空，别人指着 B 的改指 A
  if (A.referrerCustomerId === B.id) { await tx.customer.update({ where: { id: A.id }, data: { referrerCustomerId: null } }); 明.A自指.referrer = true; }
  if (A.attributionCustomerId === B.id) { await tx.customer.update({ where: { id: A.id }, data: { attributionCustomerId: null } }); 明.A自指.attribution = true; }

  // 其余只改一格的
  for (const [t, 列] of 改指表) {
    if (改指键(t, 列) in 明.改指) continue;
    明.改指[改指键(t, 列)] = await 改指(tx, t, 列, B.id, A.id, t === "customer" ? [A.id, B.id] : []);
  }
  明.对照 = (await tx.entExternalRef.findMany({ where: { entity: "customer", targetId: B.id }, select: { id: true } })).map((x) => x.id);
  if (明.对照.length) await tx.entExternalRef.updateMany({ where: { id: { in: 明.对照 } }, data: { targetId: A.id } });

  // 只补空、退回次数
  await tx.customer.update({ where: { id: A.id }, data: { ...明.补空.客户, poolReturns: { increment: B.poolReturns } } });
  const 档案补 = { ...明.补空.档案, ...明.补空.档案号 };
  if (Object.keys(档案补).length) await tx.customerExtra.upsert({ where: { customerId: A.id }, create: { customerId: A.id, ...档案补 }, update: 档案补 });
  // 查重号码 B 的清空（A 已补上）：撤回时换回去
  if (Object.keys(明.补空.档案号 ?? {}).length) await tx.customerExtra.update({ where: { customerId: B.id }, data: Object.fromEntries(Object.keys(明.补空.档案号!).map((k) => [k, null])) });

  // 两家都在公海（系统管理员并）：B 的公海行删掉
  if (B.pool) {
    const 行 = await tx.customerPool.findUnique({ where: { customerId: B.id } });
    if (行) { await tx.customerPool.delete({ where: { customerId: B.id } }); 明.删掉.customerPool.push(行); }
  }

  // B 只软删、不连带（子行都已挪走）
  await tx.customer.update({ where: { id: B.id }, data: { deletedAt: 现在 } });
  await 重算最近跟进(tx, A.id);
  await 跟着项目重算(tx, 开, [A.id]);

  const 单 = await tx.entCustomerMerge.create({
    data: {
      kind: 客户单, fromId: B.id, intoId: A.id, status: "已合并", byUserId: me.id,
      fromName: B.name ?? "", fromNo: B.customerNo, fromOwnerId: B.salesOwnerId || null, fromCreatorId: B.creator?.userId ?? null,
      fromChannelId: B.channelId, fromTouchpoint: B.touchpoint, counts: JSON.stringify(条数), detail: JSON.stringify(明), at: 现在,
    },
  });
  const 编号 = (c: 客户行) => 客户编号文字(c.customerNo) ?? "";
  await tx.auditLog.createMany({
    data: [
      { userId: me.id, userName: me.name, action: "merge", entity: "Customer", entityId: A.id, at: 现在,
        summary: `合并客户：把「${名(B)}」${编号(B)}并进这位客户（${条数.联系人} 位联系人、${条数.项目} 个项目、${条数.沟通} 条沟通），${撤回期限天数} 天内可整单撤回`,
        detail: JSON.stringify({ mergeId: 单.id, 并掉: B.id, 条数, 补空: 补空叫法(明.补空) }) },
      { userId: me.id, userName: me.name, action: "merge", entity: "Customer", entityId: B.id, at: 现在,
        summary: `合并客户：已并入「${名(A)}」${编号(A)}`, detail: JSON.stringify({ mergeId: 单.id, 留下: A.id }) },
    ],
  });
  return { mergeId: 单.id, 条数, 合成: 0 };
}

/**
 * 撤回合并：合并之后挂在挪回 B 的项目 / 联系人上的新行跟着回去（审查第二单 M4；挂在 A 本身的不回）：
 *   - 沟通：经 FollowUpProject 挂在挪回项目上、还挂着 A 的 → B
 *   - 卡点：挪回项目上、还挂着 A 的 → B
 *   - 号码：挪回联系人身上、还挂着 A 的 → B
 *   - 挪回项目的项目联系人（主联系人 + ProjectContact）是 A 的人的：照项目换客户的做法挂靠到 B（已挂着的跳过）
 */
async function 带回新挂的(tx: Tx, A: string, B: string, 项目们: string[], 人们: string[]): Promise<void> {
  for (const 段 of 分段(项目们)) {
    const 沟通们 = (await tx.followUpProject.findMany({ where: { projectId: { in: 段 } }, select: { followUpId: true } })).map((x) => x.followUpId);
    for (const 小段 of 分段(沟通们)) await tx.followUp.updateMany({ where: { id: { in: 小段 }, customerId: A }, data: { customerId: B } });
    await tx.entBlocker.updateMany({ where: { projectId: { in: 段 }, customerId: A }, data: { customerId: B } });
    const 主们 = (await tx.project.findMany({ where: { id: { in: 段 }, contactId: { not: null } }, select: { contactId: true } })).map((x) => x.contactId!);
    const 联们 = (await tx.projectContact.findMany({ where: { projectId: { in: 段 } }, select: { contactId: true } })).map((x) => x.contactId);
    const 候选 = [...new Set([...主们, ...联们])];
    if (!候选.length) continue;
    const A的人 = (await tx.contact.findMany({ where: { id: { in: 候选 }, customerId: A }, select: { id: true } })).map((x) => x.id);
    if (!A的人.length) continue;
    const 已挂 = new Set((await tx.contactCustomer.findMany({ where: { customerId: B, contactId: { in: A的人 } }, select: { contactId: true } })).map((x) => x.contactId));
    const 要挂 = A的人.filter((id) => !已挂.has(id));
    if (要挂.length) await tx.contactCustomer.createMany({ data: 要挂.map((contactId) => ({ contactId, customerId: B, note: 挂靠说明 })) });
  }
  for (const 段 of 分段(人们)) await tx.contactMethod.updateMany({ where: { contactId: { in: 段 }, customerId: A }, data: { customerId: B } });
}

/**
 * 撤回合并「只改一格」时随整组留下的联系人 / 项目留在原处的行（id → 原因）：
 *   - 号码、联系人挂靠：contactId 是留下的联系人
 *   - 沟通：经 FollowUpProject 挂在留下的项目上；没挂项目、contactId 是留下的联系人
 *   - 卡点：projectId 是留下的项目
 */
async function 随留下的(tx: Tx, t: 改指表名, ids: string[], 留人: ReadonlySet<string>, 留项目: ReadonlySet<string>): Promise<Map<string, string>> {
  const 随 = new Map<string, string>();
  if (!ids.length) return 随;
  const 人们 = [...留人];
  const 项目们 = [...留项目];
  for (const 段 of 分段(ids)) {
    if ((t === "contactMethod" || t === "contactCustomer") && 人们.length) {
      const 行 = t === "contactMethod"
        ? await tx.contactMethod.findMany({ where: { id: { in: 段 }, contactId: { in: 人们 } }, select: { id: true } })
        : await tx.contactCustomer.findMany({ where: { id: { in: 段 }, contactId: { in: 人们 } }, select: { id: true } });
      for (const r of 行) 随.set(r.id, "随联系人留在原处");
    }
    // 只挂在留下的联系人身上、没挂项目的沟通跟着人留下（挂了项目的跟项目走：项目回 B 就回 B）
    if (t === "followUp" && 人们.length)
      for (const r of await tx.followUp.findMany({ where: { id: { in: 段 }, contactId: { in: 人们 }, projectNode: { is: null } }, select: { id: true } })) 随.set(r.id, "随联系人留在原处");
    if (t === "followUp" && 项目们.length)
      for (const r of await tx.followUpProject.findMany({ where: { followUpId: { in: 段 }, projectId: { in: 项目们 } }, select: { followUpId: true } })) 随.set(r.followUpId, "随项目留在原处");
    if (t === "entBlocker" && 项目们.length)
      for (const r of await tx.entBlocker.findMany({ where: { id: { in: 段 }, projectId: { in: 项目们 } }, select: { id: true } })) 随.set(r.id, "随项目留在原处");
  }
  return 随;
}

/**
 * 撤回合并后人回了 B、项目留在 A（合并后在 A 上新建的、或被改过整组留下的），项目的主联系人 / 项目联系人是回了 B 的人：
 * 照 带回新挂的 反着做，给这几位挂靠到 A（已挂着的跳过）
 */
async function 留下项目挂回来的人(tx: Tx, A: string, 回了人: string[]): Promise<void> {
  for (const 段 of 分段(回了人)) {
    const 主们 = (await tx.project.findMany({ where: { customerId: A, contactId: { in: 段 } }, select: { contactId: true } })).map((x) => x.contactId!);
    const 联们 = (await tx.projectContact.findMany({ where: { contactId: { in: 段 }, project: { customerId: A } }, select: { contactId: true } })).map((x) => x.contactId);
    const 候选 = [...new Set([...主们, ...联们])];
    if (!候选.length) continue;
    const 已挂 = new Set((await tx.contactCustomer.findMany({ where: { customerId: A, contactId: { in: 候选 } }, select: { contactId: true } })).map((x) => x.contactId));
    const 要挂 = 候选.filter((id) => !已挂.has(id));
    if (要挂.length) await tx.contactCustomer.createMany({ data: 要挂.map((contactId) => ({ contactId, customerId: A, note: 挂靠说明 })) });
  }
}

/** 最近跟进按没删的沟通重算（同 soft-delete.ts 重算最近跟进）；同号留痕不算 */
export async function 重算最近跟进(tx: Tx, customerId: string) {
  const latest = await tx.followUp.findFirst({ where: { customerId, deletedAt: null, occurredAt: { lte: new Date() }, ...不是同号留痕 }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } });
  await tx.customer.updateMany({ where: { id: customerId }, data: { lastFollowAt: latest?.occurredAt ?? null } });
}

/**
 * 合并后通知（E-280 三.2）：被并那家的创建人、来源渠道负责人（B 的 channelOwnerId，空的取 B 主渠道的负责人）各一条，站内 + 飞书。
 * 系统管理员代并时，不是操作人本人的两家负责人也各一条（🔍 我方推断，方案第六节第 3 条）。操作人自己不发。
 * 按合并申请执行的（第二批 2b-3 第二段）：发起人、同意人已收到申请那条「已合并」，这里不再重复发（已另通知）
 */
async function 合并后通知({ A, B }: { A: 客户行; B: 客户行 }, me: 合并人, 已另通知: readonly string[] = []): Promise<void> {
  const 收 = [B.creator?.userId, B.channelOwnerId || B.channel?.channelOwnerId, A.salesOwnerId, B.salesOwnerId].filter((u) => u && u !== me.id && !已另通知.includes(u));
  await notify(收, {
    kind: 合并通知种类,
    title: `「${名(B)}」已并入「${名(A)}」`,
    body: `${me.name}把「${名(B)}」${客户编号文字(B.customerNo) ?? ""}并进了「${名(A)}」${客户编号文字(A.customerNo) ?? ""}，联系人、项目、沟通都已挪过去；${撤回期限天数} 天内可整单撤回。`,
    link: `/customers/${A.id}`,
    key: `merge:${B.id}:${A.id}:${Date.now()}`,
  });
}

/* ───────────────────────── 撤回 ───────────────────────── */

export type 没还原 = { 类: string; id: string; 原因: string };

/** B 已并入哪位（还在撤回期内的合并单）；回收站、旧链接跳转用 */
export async function 并入去向(db: Pick<Tx, "entCustomerMerge">, customerId: string): Promise<{ mergeId: string; intoId: string; at: Date } | null> {
  const m = await db.entCustomerMerge.findFirst({ where: { kind: 客户单, fromId: customerId, status: "已合并" }, orderBy: { at: "desc" }, select: { id: true, intoId: true, at: true } });
  return m ? { mergeId: m.id, intoId: m.intoId, at: m.at } : null;
}

/** 打开已并入的 B：去 A 的地址，带 ?merged=B，别的参数照带（merged 自己不重复带） */
export function 并入后去处(intoId: string, fromId: string, sp: Record<string, string | string[] | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (k !== "merged" && typeof v === "string") q.set(k, v);
  q.set("merged", fromId);
  return `/customers/${intoId}?${q.toString()}`;
}

/** A 页顶上那句「NO.xxxxx「B」已并入这位客户」：merged 参数对得上一张没撤回、并进 A 的合并单才给；对不上给 null */
export async function 并入提示(db: 库, 留下id: string, merged: string | null | undefined): Promise<string | null> {
  if (!merged || !企业版()) return null;
  const m = await db.entCustomerMerge.findFirst({ where: { kind: 客户单, fromId: merged, intoId: 留下id, status: "已合并" }, orderBy: { at: "desc" }, select: { fromName: true, fromNo: true } });
  if (!m) return null;
  const 编号 = 客户编号文字(m.fromNo);
  return `${编号 ?? ""}${m.fromName ? `「${m.fromName}」` : ""}已并入这位客户，原来的链接都会跳到这里`;
}

/**
 * 项目详情那一行「从 NO.xxxxx「B」并入」：这个项目是怎么到这位客户名下的，取最近一次——
 *   - 合并客户：一张没撤回、并进这位客户的合并单里，这个项目是从 B 挪过来的（明细 项目[].挪客户）
 *   - 项目换客户：项目上最近一条 project-move-customer 日志，换到的就是这位客户
 * 都没有给 null。看得到原客户 = 能不能看原来那位客户的名字（调用方给；合并的 B 在回收站里，在 看已删 里问），看不到只给编号
 */
export async function 项目来历(
  db: 库, projectId: string, customerId: string, 看得到原客户: (id: string) => Promise<boolean>,
): Promise<{ 话: string; 怎么来: "合并客户" | "项目换客户"; at: string } | null> {
  if (!企业版()) return null;
  // 一句 SQL 取两样（客户详情一次打开的查询条数有上限，tests/ent-cust-detail-queries.test.ts）：
  // 并进这位客户、明细里这个项目是挪过来的合并单；这个项目最近的换客户日志。动作名走参数（同 history-data.ts 那句的讲究）
  const 行们 = await 看全部(() => db.$queryRawUnsafe<{ k: string; at: bigint | number | string | Date; fromId: string | null; fromName: string | null; fromNo: bigint | number | null; detail: string | null }[]>(
    `SELECT * FROM (
       SELECT 'm' AS k, m."at" AS at, m."fromId" AS fromId, m."fromName" AS fromName, m."fromNo" AS fromNo, NULL AS detail FROM "EntCustomerMerge" m
         WHERE m."kind" = ? AND m."intoId" = ? AND m."status" = ? AND instr(m."detail", ?) > 0
       UNION ALL SELECT 'a', a."at", NULL, NULL, NULL, a."detail" FROM "AuditLog" a WHERE a."entity" = 'Project' AND a."entityId" = ? AND a."action" = ?
     ) ORDER BY at DESC LIMIT 8`,
    客户单, customerId, "已合并", `"id":${JSON.stringify(projectId)},"挪客户":true`, projectId, "project-move-customer",
  ));
  const 时刻 = (v: bigint | number | string | Date) => (v instanceof Date ? v : new Date(typeof v === "bigint" ? Number(v) : v));
  const m行 = 行们.find((r) => r.k === "m");
  const 单 = m行 ? { fromId: m行.fromId ?? "", fromName: m行.fromName ?? "", fromNo: m行.fromNo === null ? null : Number(m行.fromNo), at: 时刻(m行.at) } : null;
  // 换客户日志取最近一条「换到这位客户」的：换走后 8 秒内撤销了（撤销换客户），最近那条是换去别家的，往前找
  let 换: { 从: string; at: Date } | null = null;
  for (const a行 of 行们) {
    if (a行.k !== "a" || !a行.detail) continue;
    try {
      const d = JSON.parse(a行.detail) as { 从?: unknown; 到?: unknown };
      if (d.到 === customerId && typeof d.从 === "string") { 换 = { 从: d.从, at: 时刻(a行.at) }; break; }
    } catch { /* 坏明细不认 */ }
  }
  if (单 && (!换 || 单.at >= 换.at)) {
    // 原客户名字同换客户那条：看得到原客户才给，看不到只给编号（审查第二单建议 4）。B 在回收站里，在 看已删 里判
    const 名字 = 单.fromId && (await 看已删(() => 看得到原客户(单.fromId))) ? 单.fromName : "";
    return { 话: 并入一句(客户编号文字(单.fromNo), 名字), 怎么来: "合并客户", at: 单.at.toISOString() };
  }
  if (!换) return null;
  const 原 = await 看全部(() => 看已删(() => db.customer.findUnique({ where: { id: 换!.从 }, select: { customerNo: true, name: true, shortName: true } })));
  const 编号 = 客户编号文字(原?.customerNo ?? null);
  const 名字 = 原 && (await 看得到原客户(换.从)) ? 原.name?.trim() || 原.shortName || "" : "";
  return { 话: 并入一句(编号, 名字), 怎么来: "项目换客户", at: 换.at.toISOString() };
}
/** 「从 NO.00012「乙」并入」；没名字「从 NO.00012 并入」；都没有「从另一位客户并入」 */
const 并入一句 = (编号: string | null | undefined, 名字: string | null | undefined) =>
  名字 ? `从 ${编号 ?? ""}「${名字}」并入` : 编号 ? `从 ${编号} 并入` : "从另一位客户并入";

/** 联系人已合成进哪位（还没撤回的合成单）；回收站用 */
export async function 合成去向(db: 库, contactIds: string[]): Promise<Map<string, { mergeId: string; intoId: string; parentId: string | null }>> {
  if (!contactIds.length) return new Map();
  const 们 = await db.entCustomerMerge.findMany({ where: { kind: 联系人单, fromId: { in: contactIds }, status: "已合并" }, orderBy: { at: "desc" }, select: { id: true, fromId: true, intoId: true, parentId: true } });
  const m = new Map<string, { mergeId: string; intoId: string; parentId: string | null }>();
  for (const x of 们) if (!m.has(x.fromId)) m.set(x.fromId, { mergeId: x.id, intoId: x.intoId, parentId: x.parentId });
  return m;
}

/** 几位客户各自并入了哪位（还没撤回的合并单）；回收站列表、导入撤回、全局搜索用 */
export async function 并入去向们(db: 库, customerIds: string[]): Promise<Map<string, { mergeId: string; intoId: string; at: Date }>> {
  if (!customerIds.length) return new Map();
  const 们 = await db.entCustomerMerge.findMany({ where: { kind: 客户单, fromId: { in: customerIds }, status: "已合并" }, orderBy: { at: "desc" }, select: { id: true, fromId: true, intoId: true, at: true } });
  const m = new Map<string, { mergeId: string; intoId: string; at: Date }>();
  for (const x of 们) if (!m.has(x.fromId)) m.set(x.fromId, { mergeId: x.id, intoId: x.intoId, at: x.at });
  return m;
}

/**
 * 单独合成联系人：同一位客户名下两位，「并」收进「留」。负责人本人（能删客户的角色）或系统管理员；公海里的先领（系统管理员不用）。
 * 拦法同合并客户：客户在转让交接中、标了无效的不让合成。
 * 在 看已删 里跑（同执行合并、撤回合成）：回收站里的沟通、已删项目的主联系人和项目联系人、卡点、附件也跟着挪
 */
export async function 合成联系人(db: 库, 留id: string, 并id: string, me: 合并人, 现在: Date = new Date()): Promise<结果<{ mergeId: string }>> {
  if (!企业版()) return { ok: false, error: "只有企业版能合成联系人" };
  if (留id === 并id) return { ok: false, error: "请选另一位联系人" };
  const org = await 权限组织();
  try {
    const id = await 看已删(() => 看全部(() =>
      db.$transaction(async (tx) => {
        const 们 = await tx.contact.findMany({ where: { id: { in: [留id, 并id] }, deletedAt: null }, select: { id: true, name: true, customerId: true, isPrimary: true, deletedAt: true } });
        const 留 = 们.find((c) => c.id === 留id);
        const 并 = 们.find((c) => c.id === 并id);
        if (!留 || !并) throw new 拦下("联系人不存在或已删除，刷新看看");
        if (留.customerId !== 并.customerId) throw new 拦下("只能合成同一位客户名下的两位联系人；挂靠过来的联系人请到他的主客户上合成");
        const c = await tx.customer.findFirst({ where: { id: 留.customerId, deletedAt: null }, select: { id: true, name: true, shortName: true, customerNo: true, salesOwnerId: true, poolInvalidAt: true, pool: { select: { customerId: true } } } });
        if (!c) throw new 拦下("客户不存在或已删除，刷新看看");
        if (!org || 只读角色(me, org) || 只看的人(org, me.id)) throw new 拦下("你只能看，不能合成联系人");
        if (!是系统管理员(me, org)) {
          if (c.pool) throw new 拦下("客户在公海里，先领出来再合成联系人");
          if (!能删除(me, org, c.salesOwnerId)) throw new 拦下("只有客户负责人本人或系统管理员能合成联系人");
        }
        if ((await 交接中的客户([c.id], tx)).has(c.id)) throw new 拦下(`「${名(c)}」正在转让交接中，等接手人确认或撤回交接后再合成`);
        if (c.poolInvalidAt) throw new 拦下(`「${名(c)}」标了无效客户，先由系统管理员恢复再合成`);
        const 明 = await 合成一对(tx, 留, 并, 现在);
        const 单 = await tx.entCustomerMerge.create({ data: { kind: 联系人单, fromId: 并.id, intoId: 留.id, status: "已合并", byUserId: me.id, fromName: 并.name, detail: JSON.stringify(明), at: 现在 } });
        await tx.auditLog.createMany({
          data: [
            { userId: me.id, userName: me.name, action: "merge", entity: "Contact", entityId: 留.id, at: 现在, summary: `合成联系人：把「${并.name}」合成进这位联系人，${撤回期限天数} 天内可撤回`, detail: JSON.stringify({ mergeId: 单.id, 并掉: 并.id }) },
            { userId: me.id, userName: me.name, action: "merge", entity: "Customer", entityId: c.id, at: 现在, summary: `合成联系人：「${并.name}」合成进「${留.name}」`, detail: JSON.stringify({ mergeId: 单.id }) },
          ],
        });
        return 单.id;
      }, 合并事务选项),
    ));
    忘掉企业版范围();
    return { ok: true, mergeId: id };
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
}

/**
 * 撤回合并（整单）：合并的人本人或系统管理员，30 天内。单独合成的联系人也走这里（kind = 联系人）。
 * 留下那家现在的负责人已经不是撤回的人本人：只有系统管理员能撤（总控 11-25）；两家有一家在转让交接中不让撤（P-删-10）。
 * 留下那家已并进别家（连环合并 C→B→A 撤 C→B 同理）：先撤回那次合并。
 * 合并之后又单独合成过这张单里的联系人（留或并是挪过来的那几位，且留下那位现在主客户还是 A）：先拆开那几次合成（做法同合并时勾的子单），再撤合并，
 * 结果里 提示 =「先拆开了 N 次联系人合成」（审查第二单 M3）。
 * 撤回提交后：B 的原负责人已停用的，同从回收站恢复（P-删-06 恢复后停用负责人去向）；B 回来不判持有上限（撤回是还原，不算新领）
 */
export async function 撤回合并(db: 库, mergeId: string, me: 合并人, 现在: Date = new Date()): Promise<结果<撤回完>> {
  if (!企业版()) return { ok: false, error: "只有企业版能撤回合并" };
  const 看单 = await db.entCustomerMerge.findUnique({ where: { id: mergeId }, select: { kind: true } });
  if (看单?.kind === 联系人单) return 撤回合成(db, mergeId, me, 现在);
  // 第二批 2a：项目合并单走 project-merge.ts（按需取：它引着这个文件）
  if (看单?.kind === 项目合并单) return (await import("./project-merge")).撤回项目合并(db, mergeId, me, 现在);
  const org = await 权限组织();
  const 开 = await 客户状态自动();
  const 结: 没还原[] = [];
  let 拆开合成 = 0;
  let 拆开项目 = 0;
  let 两家: [string, string] | null = null;
  let B名 = "被并的客户";
  try {
    await 看已删(() =>
      看全部(() =>
        db.$transaction(async (tx) => {
          const m = await tx.entCustomerMerge.findUnique({ where: { id: mergeId } });
          if (!m || m.kind !== 客户单) throw new 拦下("找不到这张合并单");
          if (m.status !== "已合并") throw new 拦下("这张合并单已经撤回过了");
          if (!org || 只读角色(me, org) || 只看的人(org, me.id) || (m.byUserId !== me.id && !是系统管理员(me, org))) throw new 拦下("只有合并的人或系统管理员能撤回合并");
          if (现在.getTime() - m.at.getTime() > 撤回期限天数 * 86_400_000) throw new 拦下(`合并已超过 ${撤回期限天数} 天，不能整单撤回`);
          const [A, B] = await Promise.all([
            tx.customer.findUnique({ where: { id: m.intoId }, select: { id: true, name: true, shortName: true, customerNo: true, deletedAt: true, poolReturns: true, salesOwnerId: true, pool: { select: { customerId: true } } } }),
            tx.customer.findUnique({ where: { id: m.fromId }, select: { id: true, name: true, shortName: true, customerNo: true, deletedAt: true, salesOwnerId: true } }),
          ]);
          if (!B) throw new 拦下("被并的客户已清出回收站，不能撤回");
          B名 = 名(B);
          if (!A) throw new 拦下("留下的客户已彻底删除，不能撤回");
          if (A.deletedAt) {
            const 去 = await 并入去向(tx, A.id);
            const Z = 去 ? await tx.customer.findUnique({ where: { id: 去.intoId }, select: { id: true, name: true, shortName: true, customerNo: true } }) : null;
            throw new 拦下(Z ? `「${名(A)}」已并入「${名(Z)}」，先撤回那次合并` : `「${名(A)}」在回收站里，先恢复再撤回合并`);
          }
          if (!是系统管理员(me, org) && (A.pool || A.salesOwnerId !== me.id)) throw new 拦下(`「${名(A)}」现在不归你负责，请找系统管理员撤回`);
          const 交接 = await 交接中的客户([A.id, B.id], tx);
          for (const c of [A, B]) if (交接.has(c.id)) throw new 拦下(`「${名(c)}」正在转让交接中，等接手人确认或撤回交接后再撤回合并`);
          const 离职 = await 离职交接拦(tx, [A, B], "撤回合并");
          if (离职.length) throw new 拦下(离职.join("；"));
          // 合并之后单独并过这张单里挪过来的项目（第二批 2a 项目合并，被并或留下是挪过来的项目）：先撤那几次（新的先撤，「先拆后撤」）
          const 挪来项目 = (JSON.parse(m.detail) as 合并明细).项目.filter((p) => p.挪客户).map((p) => p.id);
          if (挪来项目.length) {
            const { 在事务里撤回项目合并 } = await import("./project-merge");
            for (const 段 of 分段(挪来项目, 200)) {
              const 们 = await tx.entCustomerMerge.findMany({
                where: { kind: 项目合并单, status: "已合并", at: { gte: m.at }, OR: [{ fromId: { in: 段 } }, { intoId: { in: 段 } }] },
                orderBy: [{ at: "desc" }, { id: "desc" }],
              });
              for (const 子 of 们) {
                if ((await tx.entCustomerMerge.findUnique({ where: { id: 子.id }, select: { status: true } }))?.status !== "已合并") continue;
                结.push(...(await 在事务里撤回项目合并(tx, 子, me, 现在, 开)).没还原);
                拆开项目++;
              }
            }
          }
          // 合并之后单独合成过挪过来的联系人：先拆开（新的先拆），号码、沟通回到原来那位，下面再随联系人一起挪回 B（M3）
          // 只拆现在还在 A 名下合成的（留下那位主客户是 A）：B 来的人后来换主客户到 C、在 C 名下合成过的不拆（那是 C 的事；挪回时这位留在原处）（第二单 b 建议 3）
          const 人们 = (JSON.parse(m.detail) as 合并明细).联系人.map((c) => c.id);
          const 单独们 = new Map<string, Awaited<ReturnType<typeof tx.entCustomerMerge.findMany>>[number]>();
          for (const 段 of 分段(人们, 200)) {
            const 们 = await tx.entCustomerMerge.findMany({
              where: { kind: 联系人单, parentId: null, status: "已合并", at: { gte: m.at }, OR: [{ fromId: { in: 段 } }, { intoId: { in: 段 } }] },
            });
            if (!们.length) continue;
            const 在A = new Set((await tx.contact.findMany({ where: { id: { in: [...new Set(们.map((x) => x.intoId))] }, customerId: A.id }, select: { id: true } })).map((x) => x.id));
            for (const x of 们) if (在A.has(x.intoId)) 单独们.set(x.id, x);
          }
          for (const 子 of [...单独们.values()].sort((x, y) => y.at.getTime() - x.at.getTime() || (y.id < x.id ? -1 : 1))) {
            const 留 = await 拆开一对(tx, 子.detail, 子.intoId, 子.fromId);
            结.push(...留);
            await tx.entCustomerMerge.update({ where: { id: 子.id }, data: { status: "已撤回", undoneAt: 现在, undoneById: me.id, undoLeft: 留.length ? JSON.stringify({ 没还原: 留 }) : null } });
            await tx.auditLog.create({ data: { userId: me.id, userName: me.name, action: "merge-undo", entity: "Contact", entityId: 子.intoId, at: 现在, summary: `撤回合并客户时先拆开合成：「${子.fromName}」已拆回`, detail: JSON.stringify({ mergeId: 子.id, 随: m.id, 没还原: 留 }) } });
            拆开合成++;
          }
          // 合并时勾的「是同一个人」：先拆开（「并」那位回来、还挂在 A 名下），下面再随联系人一起挪回 B
          for (const 子 of await tx.entCustomerMerge.findMany({ where: { parentId: m.id, kind: 联系人单, status: "已合并" } })) {
            结.push(...(await 拆开一对(tx, 子.detail, 子.intoId, 子.fromId)));
            await tx.entCustomerMerge.update({ where: { id: 子.id }, data: { status: "已撤回", undoneAt: 现在, undoneById: me.id } });
          }
          // 拆开合成时没能回到原来那位的号码 / 沟通（之后又合成到别人身上了，不连锁拆）：留在原处，挪回时也不改客户，免得号码挂 A 的人、记 B 的账
          const 拆没回 = new Set(结.map((x) => x.id));
          结.push(...(await 挪回(tx, m.detail, A.id, B.id, A.poolReturns, 拆没回)));
          await tx.customer.update({ where: { id: B.id }, data: { deletedAt: null } });
          await 重算最近跟进(tx, A.id);
          await 重算最近跟进(tx, B.id);
          await 跟着项目重算(tx, 开, [A.id, B.id]);
          await tx.entCustomerMerge.update({ where: { id: m.id }, data: { status: "已撤回", undoneAt: 现在, undoneById: me.id, undoLeft: 存没还原(结, 拆开合成) } });
          const 留话 = `${拆开项目 ? `；${拆开项目话(拆开项目)}` : ""}${拆开合成 ? `；${拆开合成话(拆开合成)}` : ""}${结.length ? `；${结.length} 条之后被改过，留在原处` : ""}`;
          await tx.auditLog.createMany({
            data: [
              { userId: me.id, userName: me.name, action: "merge-undo", entity: "Customer", entityId: A.id, at: 现在, summary: `撤回合并：「${名(B)}」已拆回${留话}`, detail: JSON.stringify({ mergeId: m.id, 没还原: 结 }) },
              { userId: me.id, userName: me.name, action: "merge-undo", entity: "Customer", entityId: B.id, at: 现在, summary: `撤回合并：从「${名(A)}」拆回，已从回收站恢复${留话}`, detail: JSON.stringify({ mergeId: m.id }) },
            ],
          });
          两家 = [A.id, B.id];
        }, 合并事务选项),
      ),
    );
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    // 先查过还撞上 (repeatOfCustomerId, repeatSeq) 唯一索引：查完那一刻 B 名下又建了一条（并发），整笔已回滚，同撤销换客户回人话
    if (序号撞了(e)) return { ok: false, error: 撤回合并序号被占话(B名) };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
  忘掉企业版范围();
  const 这两家 = 两家 as [string, string] | null;
  if (这两家) {
    await 存沟通后重算三态(这两家, 现在).catch((e) => console.warn("[撤回合并] 三态没重算上：", e instanceof Error ? e.message : e));
    await 回来后停用负责人(这两家[1], me);
  }
  const 提示 = [拆开项目 ? 拆开项目话(拆开项目) : "", 拆开合成 ? 拆开合成话(拆开合成) : ""].filter(Boolean).join("；");
  return { ok: true, 没还原: 结, ...(提示 ? { 提示 } : {}) };
}

export type 撤回完 = { 没还原: 没还原[]; /** 先拆开过单独合成时：「先拆开了 N 次联系人合成」 */ 提示?: string };
const 拆开合成话 = (n: number) => `先拆开了 ${n} 次联系人合成`;
const 拆开项目话 = (n: number) => `先撤回了 ${n} 次项目合并`;
/**
 * 撤回合并要把 B 挪到 A 的重复咨询换回原序号，合并之后 B 名下又有一条占了这个号（同撤销换客户的 序号被占话）：整单拦下，不改成别的号。
 * 合并后在 A 上新登的接在 A 的号后面，不占 B 的原序号；拿不到占号那条的名字（并发撞上唯一索引）时只说哪家
 */
export const 撤回合并序号被占话 = (B名: string, 占的?: string) =>
  `「${B名}」合并之后又登了重复咨询${占的 ? `「${占的}」` : ""}，占了原来的序号，撤回会撞号，这次没撤；请找系统管理员处理`;
/** 合并单 undoLeft：{ 没还原, 拆开合成? }；都没有存空 */
const 存没还原 = (留: 没还原[], 拆开合成 = 0) => (留.length || 拆开合成 ? JSON.stringify({ 没还原: 留, ...(拆开合成 ? { 拆开合成 } : {}) }) : null);
/** 读合并单 undoLeft（老的是数组）：给合并单列表 */
export function 读没还原(undoLeft: string | null): { 没还原: 没还原[]; 提示?: string } | null {
  if (!undoLeft) return null;
  try {
    const v = JSON.parse(undoLeft) as unknown;
    if (Array.isArray(v)) return { 没还原: v as 没还原[] };
    const o = v as { 没还原?: 没还原[]; 拆开合成?: number };
    return { 没还原: Array.isArray(o.没还原) ? o.没还原 : [], ...(o.拆开合成 ? { 提示: 拆开合成话(o.拆开合成) } : {}) };
  } catch { return null; }
}

/**
 * 撤回合并后 B 回来了：原负责人已停用的，同从回收站恢复客户（P-删-06）——清空负责人进客户公海（例外留在他名下），通知他的直属上级或系统管理员。
 * 撤回提交后另办（同 soft-delete.ts 恢复一条）；没做成不连累撤回。restore-inactive-owner 引着 pool-link → project/db，按需取
 */
async function 回来后停用负责人(B: string, me: 合并人): Promise<void> {
  try {
    const { 恢复后停用负责人去向 } = await import("./restore-inactive-owner");
    const 去 = await 恢复后停用负责人去向(B, me.id);
    if (!去) return;
    if (去.进了公海) 忘掉企业版范围();
    const { 恢复到停用负责人通知 } = await import("./notice-sources");
    await 恢复到停用负责人通知(me, [{ id: B, ...去 }], "撤回合并");
  } catch (e) {
    console.warn("[撤回合并] 原负责人已停用，进公海没办成：", e instanceof Error ? e.message : e);
  }
}

async function 撤回合成(db: 库, mergeId: string, me: 合并人, 现在: Date): Promise<结果<撤回完>> {
  const org = await 权限组织();
  try {
    const 结 = await 看已删(() =>
      看全部(() =>
        db.$transaction(async (tx) => {
          const m = await tx.entCustomerMerge.findUnique({ where: { id: mergeId } });
          if (!m) throw new 拦下("找不到这张合成单");
          if (m.parentId) throw new 拦下("这两位是合并客户时合成的，请撤回那次合并客户");
          if (m.status !== "已合并") throw new 拦下("这张合成单已经撤回过了");
          if (!org || 只读角色(me, org) || 只看的人(org, me.id) || (m.byUserId !== me.id && !是系统管理员(me, org))) throw new 拦下("只有合成的人或系统管理员能撤回");
          if (现在.getTime() - m.at.getTime() > 撤回期限天数 * 86_400_000) throw new 拦下(`合成已超过 ${撤回期限天数} 天，不能撤回`);
          const 并 = await tx.contact.findUnique({ where: { id: m.fromId }, select: { id: true, name: true, customerId: true } });
          if (!并) throw new 拦下("合成掉的那位已清出回收站，不能撤回");
          const 主 = await tx.customer.findUnique({ where: { id: 并.customerId }, select: { id: true, name: true, shortName: true, customerNo: true, deletedAt: true, salesOwnerId: true, pool: { select: { customerId: true } } } });
          if (主?.deletedAt) throw new 拦下("客户在回收站里，先恢复客户再撤回");
          // 同撤回合并：客户现在不归撤回的人负责（换了负责人、进了公海）只有系统管理员能撤（服务端审查第二单 b 建议 2）
          if (!是系统管理员(me, org) && (!主 || 主.pool || 主.salesOwnerId !== me.id)) throw new 拦下(`${主 ? `「${名(主)}」` : "客户"}现在不归你负责，请找系统管理员撤回`);
          // 拦法同撤回合并：客户在转让交接中不让撤（P-删-10）
          if (主 && (await 交接中的客户([主.id], tx)).has(主.id)) throw new 拦下(`「${名(主)}」正在转让交接中，等接手人确认或撤回交接后再撤回合成`);
          const 留 = await 拆开一对(tx, m.detail, m.intoId, m.fromId);
          await tx.entCustomerMerge.update({ where: { id: m.id }, data: { status: "已撤回", undoneAt: 现在, undoneById: me.id, undoLeft: 存没还原(留) } });
          await tx.auditLog.create({ data: { userId: me.id, userName: me.name, action: "merge-undo", entity: "Contact", entityId: m.intoId, at: 现在, summary: `撤回合成联系人：「${并.name}」已拆回${留.length ? `；${留.length} 条之后被改过，留在原处` : ""}`, detail: JSON.stringify({ mergeId: m.id, 没还原: 留 }) } });
          return 留;
        }, 合并事务选项),
      ),
    );
    忘掉企业版范围();
    return { ok: true, 没还原: 结 };
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
}

async function 挪回(tx: Tx, 原文: string, A: string, B: string, A退回: number, 拆没回: ReadonlySet<string> = new Set()): Promise<没还原[]> {
  const 明 = JSON.parse(原文) as 合并明细;
  const 留: 没还原[] = [];
  const 留下 = (类: string, ids: string[], 原因: string) => ids.forEach((id) => 留.push({ 类, id, 原因 }));
  const 改过话 = "合并之后被改过（换了客户或删了）";

  // 联系人一组：主客户还是 A、去掉的关键标还空着
  const 回了人: string[] = [];
  // 整组留在原处的联系人 / 项目：名下的号码、挂靠、沟通、卡点下面「只改一格」时不单独改回 B（不然号码和人分属两家）
  const 留人 = new Set<string>();
  const 留项目 = new Set<string>();
  for (const c of 明.联系人) {
    const 现 = await tx.contact.findUnique({ where: { id: c.id }, select: { customerId: true, isPrimary: true } });
    if (!现) { 留下("联系人", [c.id], "已彻底删除"); continue; }
    if (现.customerId !== A || (c.去关键 && 现.isPrimary)) { 留下("联系人", [c.id], 改过话); 留人.add(c.id); continue; }
    await tx.contact.update({ where: { id: c.id }, data: { customerId: B, ...(c.去关键 ? { isPrimary: true } : {}) } });
    回了人.push(c.id);
  }
  // 项目一组：所属客户、补的来源、重复咨询
  const 回了项目: string[] = [];
  for (const p of 明.项目) {
    const 现 = await tx.project.findUnique({ where: { id: p.id }, select: { customerId: true, channelId: true, repeatOfCustomerId: true, repeatSeq: true } });
    if (!现) { 留下("项目", [p.id], "已彻底删除"); continue; }
    const 对 = (!p.挪客户 || 现.customerId === A) && (!p.补来源 || 现.channelId === p.补来源) && (!p.重复 || (现.repeatOfCustomerId === A && 现.repeatSeq === p.重复.新序));
    if (!对) { 留下("项目", [p.id], 改过话); 留项目.add(p.id); continue; }
    // 换回原序号前先看 B 名下这个号有没有被占（合并后又登的；回收站里的也算，唯一索引不分删没删）：占了整单拦下，不改成别的号
    if (p.重复?.原序 != null) {
      const 占 = await tx.project.findFirst({ where: { repeatOfCustomerId: B, repeatSeq: p.重复.原序, NOT: { id: p.id } }, select: { name: true } });
      if (占) {
        const b = await tx.customer.findUnique({ where: { id: B }, select: { id: true, name: true, shortName: true, customerNo: true } });
        throw new 拦下(撤回合并序号被占话(b ? 名(b) : "被并的客户", 占.name));
      }
    }
    if (p.挪客户) 回了项目.push(p.id);
    // undefined = 这一格不动；负责人不在里面（撤回不动负责人）
    await tx.project.update({
      where: { id: p.id },
      data: {
        customerId: p.挪客户 ? B : undefined,
        channelId: p.补来源 ? null : undefined,
        repeatOfCustomerId: p.重复 ? B : undefined,
        repeatSeq: p.重复 ? p.重复.原序 : undefined,
      },
    });
  }
  // 只改一格的
  for (const [键, 全] of Object.entries(明.改指)) {
    const [t, 列] = 键.split(".") as [改指表名, string];
    // 号码、沟通跟着联系人走：拆开合成时没回到原来那位的（已记没还原）不动
    const 拆后 = t === "contactMethod" || t === "followUp" ? 全.filter((id) => !拆没回.has(id)) : 全;
    // 随整组留下的联系人 / 项目留在原处的（同 拆没回）：不改，记没还原
    const 随 = await 随留下的(tx, t, 拆后, 留人, 留项目);
    for (const [id, 原因] of 随) 留.push({ 类: 类叫(键), id, 原因 });
    const ids = 拆后.filter((id) => !随.has(id));
    for (const 段 of 分段(ids)) {
      await 表(tx, t).updateMany({ where: { id: { in: 段 }, [列]: A }, data: { [列]: B } });
      const 没回 = (await 表(tx, t).findMany({ where: { id: { in: 段 }, NOT: { [列]: B } }, select: { id: true } })).map((r) => r.id as string);
      const 在 = new Set((await 表(tx, t).findMany({ where: { id: { in: 段 } }, select: { id: true } })).map((r) => r.id as string));
      留下(类叫(键), 没回, 改过话);
      留下(类叫(键), 段.filter((id) => !在.has(id)), "已彻底删除");
    }
  }
  await 带回新挂的(tx, A, B, 回了项目, 回了人);
  await 留下项目挂回来的人(tx, A, 回了人);
  if (明.A自指.referrer) await tx.customer.updateMany({ where: { id: A, referrerCustomerId: null }, data: { referrerCustomerId: B } });
  if (明.A自指.attribution) await tx.customer.updateMany({ where: { id: A, attributionCustomerId: null }, data: { attributionCustomerId: B } });
  for (const 段 of 分段(明.对照)) await tx.entExternalRef.updateMany({ where: { id: { in: 段 }, targetId: A }, data: { targetId: B } });
  // 关联客户：还是合并改成的两头才改回
  for (const l of 明.关联) {
    const n = (await tx.entCustomerLink.updateMany({ where: { id: l.id, customerId: l.新[0], otherId: l.新[1] }, data: { customerId: l.原[0], otherId: l.原[1] } })).count;
    if (!n) 留下("关联客户", [l.id], 改过话);
  }
  for (const h of 明.审批人) await tx.entDupeHit.updateMany({ where: { id: h.id, approverId: h.新, status: "待处理" }, data: { approverId: h.原 } });
  // 去重删掉的整行建回；已经有同样一行的跳过
  const 日期 = (r: Record<string, unknown>, ...ks: string[]) => ({ ...r, ...Object.fromEntries(ks.filter((k) => r[k]).map((k) => [k, new Date(r[k] as string)])) });
  for (const r of 明.删掉.contactCustomer) {
    const 有 = await tx.contactCustomer.findFirst({ where: { contactId: r.contactId as string, customerId: r.customerId as string } });
    const 联 = await tx.contact.findUnique({ where: { id: r.contactId as string }, select: { id: true } });
    if (!有 && 联) await tx.contactCustomer.create({ data: 日期(r, "createdAt") as Prisma.ContactCustomerUncheckedCreateInput });
  }
  for (const r of 明.删掉.projectCustomer) {
    const 有 = await tx.projectCustomer.findFirst({ where: { projectId: r.projectId as string, customerId: r.customerId as string } });
    const 项 = await tx.project.findUnique({ where: { id: r.projectId as string }, select: { customerId: true } });
    if (!有 && 项 && 项.customerId !== r.customerId) await tx.projectCustomer.create({ data: 日期(r, "createdAt") as Prisma.ProjectCustomerUncheckedCreateInput });
  }
  for (const r of 明.删掉.entCustomerLink) {
    const 有 = await tx.entCustomerLink.findFirst({ where: { customerId: r.customerId as string, otherId: r.otherId as string } });
    const 两头 = await tx.customer.count({ where: { id: { in: [r.customerId as string, r.otherId as string] } } });
    if (!有 && 两头 === 2) await tx.entCustomerLink.create({ data: 日期(r, "createdAt") as Prisma.EntCustomerLinkUncheckedCreateInput });
  }
  for (const r of 明.删掉.customerPool) {
    const 有 = await tx.customerPool.findUnique({ where: { customerId: B } });
    if (!有) await tx.customerPool.create({ data: 日期(r, "at") as Prisma.CustomerPoolUncheckedCreateInput });
  }
  // 补空的格：还是补进去的值才清回空
  const 档案列 = Object.fromEntries([...补空档案格, ...档案号格].map((k) => [k, true]));
  const 现A = await tx.customer.findUnique({ where: { id: A }, select: { ...Object.fromEntries([...补空客户格, ...地址格].map((k) => [k, true])), extra: { select: 档案列 } } }) as Record<string, unknown> & { extra: Record<string, unknown> | null };
  const 清: Record<string, null> = {};
  for (const [k, v] of Object.entries(明.补空.客户)) {
    if (现A[k] === v) 清[k] = null;
    else 留.push({ 类: "客户资料", id: (地址格 as readonly string[]).includes(k) ? "客户地址" : (格叫法[k] ?? k), 原因: "合并之后被改过，保留现在的值" });
  }
  await tx.customer.update({ where: { id: A }, data: { ...清, poolReturns: Math.max(0, A退回 - 明.退回次数) } });
  const 清档: Record<string, null> = {};
  for (const [k, v] of Object.entries({ ...明.补空.档案, ...明.补空.档案号 })) {
    if (现A.extra?.[k] === v) 清档[k] = null;
    else 留.push({ 类: "客户资料", id: 格叫法[k] ?? k, 原因: "合并之后被改过，保留现在的值" });
  }
  if (Object.keys(清档).length) await tx.customerExtra.updateMany({ where: { customerId: A }, data: 清档 });
  // 查重号码换回 B（B 这一格这会儿空着才写；A 那一格被人改过的也换回，A 留着现在的值）
  const 号回 = 明.补空.档案号 ?? {};
  if (Object.keys(号回).length) {
    const 现B = await tx.customerExtra.findUnique({ where: { customerId: B }, select: 档案列 }) as Record<string, unknown> | null;
    const 写 = Object.fromEntries(Object.entries(号回).filter(([k]) => !有值(现B?.[k])));
    if (Object.keys(写).length) await tx.customerExtra.upsert({ where: { customerId: B }, create: { customerId: B, ...写 }, update: 写 });
  }
  // 档案行是合并时新建的、清完又全空了：删掉，回到合并前「没有这一行」
  if (明.补空.档案新建) {
    const 行 = await tx.customerExtra.findUnique({ where: { customerId: A } });
    if (行 && Object.entries(行).every(([k, v]) => k === "customerId" || v === null)) await tx.customerExtra.delete({ where: { customerId: A } });
  }
  return 留;
}
