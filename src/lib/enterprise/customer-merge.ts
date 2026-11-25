/**
 * 企业版合并客户 · 数据层（2026-11-25，客户 E-277 / E-280 第一批；方案见 docs/合并客户-第一批-落地.md）。
 *
 * 员工在要留的客户 A 上选另一家 B 并进来：B 名下联系人、项目、沟通、待办……整体改指 A，B 只软删（不连带），
 * 合并单 EntCustomerMerge 记下每一行挪了什么、原值是什么，30 天内照原样整单撤回。
 *
 *   - 合并预览：能不能并（不能就说清原因）、两家并排的格、要挪的各类条数、要不要勾「已核对」
 *   - 执行合并：一个事务，事务里再判一遍；写合并单、两家各一条操作日志；提交后重算三态、发通知
 *   - 撤回合并：30 天内，只比合并写过的那几格（同导入撤回 revert.ts 的 一致()）：还是合并写下的才改回，
 *     对不上的整组留下、记进 undoLeft；合并之后在 A 上新记的不跟着回去
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
import { 交接中的客户 } from "./handover-db";
import { 跟着项目重算, 客户状态自动 } from "./cust-status-auto-db";
import { 存沟通后重算三态 } from "./tri-state-db";
import { 不是同号留痕 } from "./same-number-mark";
import { notify } from "./notify";
import { 通知里的客户名 } from "./notice-mask";
import { 客户编号文字 } from "@/lib/customer-no";
import { 同事项目几个话 } from "@/lib/carry-over";
import { 忘掉企业版范围 } from "./visibility";

type 库 = PrismaClient;
type Tx = Prisma.TransactionClient;
export type 合并人 = { id: string; name: string; role: string };
type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** 撤回期限（天）：同回收站，B 清掉以后撤不了 */
export const 撤回期限天数 = 回收站保留天数;
export const 合并通知种类 = "合并客户";
export const 已核对话 = "已核对，按留下那家的来源和创建人";

/* ───────────────────────── 读两家 ───────────────────────── */

const 客户列 = {
  id: true, name: true, shortName: true, customerNo: true, salesOwnerId: true, channelId: true, channelOwnerId: true, touchpoint: true,
  bizLine: true, customerType: true, customerAttr: true, custStatus: true, poolInvalidAt: true, poolReturns: true,
  addrCountry: true, addrProvince: true, addrCity: true, addrDistrict: true, addrDetail: true, createdAt: true, deletedAt: true,
  referrerCustomerId: true, attributionCustomerId: true,
  pool: { select: { customerId: true } },
  creator: { select: { userId: true } },
  extra: { select: { country: true, website: true, level: true } },
  channel: { select: { name: true, channelOwnerId: true } },
} satisfies Prisma.CustomerSelect;
type 客户行 = Prisma.CustomerGetPayload<{ select: typeof 客户列 }>;

async function 读客户(db: Pick<Tx, "customer">, id: string): Promise<客户行 | null> {
  return 看全部(() => db.customer.findFirst({ where: { id, deletedAt: null }, select: 客户列 }));
}

const 名 = (c: Pick<客户行, "name" | "shortName" | "customerNo" | "id">) => 通知里的客户名(c);
const 地址 = (c: 客户行) => [c.addrCountry, c.addrProvince, c.addrCity, c.addrDistrict, c.addrDetail].filter(Boolean).join(" ");
const 有值 = (v: unknown) => v !== null && v !== undefined && v !== "";

/* ───────────────────────── 谁能并 ───────────────────────── */

/** 两家名下没结束（没结局、不在项目公海）、负责人不是我的项目个数；负责人空的不算 */
async function 同事在推个数(db: Pick<Tx, "project">, customerId: string, 我: string): Promise<number> {
  const 们 = await 看全部(() => db.project.findMany({ where: { customerId, ...在推项目条件 }, select: { ownerId: true } }));
  return 们.filter((p) => p.ownerId && p.ownerId !== 我).length;
}

/** 不能并的原因（空 = 能并）。A = 留下，B = 并掉 */
async function 拦的原因(db: Tx | 库, A: 客户行 | null, B: 客户行 | null, me: 合并人, org: 组织 | null): Promise<string[]> {
  if (!企业版()) return ["只有企业版能合并客户"];
  if (!A || !B) return ["客户不存在或已删除，刷新看看"];
  if (A.id === B.id) return ["不能和自己合并，请选另一位客户"];
  if (!org || 只读角色(me, org) || 只看的人(org, me.id)) return ["你只能看，不能合并客户"];
  const 管 = 是系统管理员(me, org);
  const 因: string[] = [];
  const 在公海 = (c: 客户行) => !!c.pool;
  if (在公海(A) !== 在公海(B)) 因.push(`「${名(在公海(A) ? A : B)}」在公海里，先领出来再并`);
  else if (在公海(A) && !管) 因.push("两家都在公海里，只有系统管理员能合并");
  if (!管 && !在公海(A)) {
    const 不是我的 = [A, B].filter((c) => !能删除(me, org, c.salesOwnerId));
    if (不是我的.length) 因.push(`${不是我的.map((c) => `「${名(c)}」`).join("")}不是你负责的，只能合并两家都由你负责的客户；要并同事的客户，请找系统管理员代并`);
    else
      for (const c of [A, B]) {
        const n = await 同事在推个数(db, c.id, me.id);
        if (n) 因.push(`「${名(c)}」名下${同事项目几个话(n)}，不能直接合并；请找系统管理员代并`);
      }
  }
  const 交接 = await 交接中的客户([A.id, B.id], db as Tx);
  for (const c of [A, B]) if (交接.has(c.id)) 因.push(`「${名(c)}」正在转让交接中，等接手人确认或撤回交接后再并`);
  for (const c of [A, B]) if (c.poolInvalidAt) 因.push(`「${名(c)}」标了无效客户，先由系统管理员恢复再并`);
  if (有值(A.bizLine) && 有值(B.bizLine) && A.bizLine !== B.bizLine) 因.push(`两家业务线不同（${A.bizLine} / ${B.bizLine}），不能合并`);
  return 因;
}

/* ───────────────────────── 只补空 ───────────────────────── */

const 补空客户格 = ["shortName", "customerType", "customerAttr", "bizLine"] as const;
const 地址格 = ["addrCountry", "addrProvince", "addrCity", "addrDistrict", "addrDetail"] as const;
const 补空档案格 = ["country", "website", "level"] as const;
const 格叫法: Record<string, string> = {
  shortName: "客户简称", customerType: "客户类型", customerAttr: "客户属性", bizLine: "业务线", 地址: "客户地址",
  country: "国家 / 地区", website: "官网", level: "客户等级",
};

type 补空 = { 客户: Record<string, string>; 档案: Record<string, string>; 档案新建: boolean };
function 算补空(A: 客户行, B: 客户行): 补空 {
  const 客户: Record<string, string> = {};
  for (const k of 补空客户格) if (!有值(A[k]) && 有值(B[k])) 客户[k] = B[k] as string;
  if (地址格.every((k) => !有值(A[k])) && 地址格.some((k) => 有值(B[k]))) for (const k of 地址格) if (有值(B[k])) 客户[k] = B[k] as string;
  const 档案: Record<string, string> = {};
  for (const k of 补空档案格) if (!有值(A.extra?.[k]) && 有值(B.extra?.[k])) 档案[k] = B.extra![k] as string;
  return { 客户, 档案, 档案新建: !A.extra && Object.keys(档案).length > 0 };
}
const 补空叫法 = (s: 补空) => [...new Set([...Object.keys(s.客户).map((k) => ((地址格 as readonly string[]).includes(k) ? "地址" : k)), ...Object.keys(s.档案)])].map((k) => 格叫法[k]);

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
};

async function 人名们(db: Pick<Tx, "user">, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const 们 = [...new Set(ids.filter((x): x is string => !!x))];
  if (!们.length) return new Map();
  return new Map((await db.user.findMany({ where: { id: { in: 们 } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
}

function 来源或创建人不同(A: 客户行, B: 客户行): boolean {
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
export async function 合并预览(db: 库, 留下id: string, 并掉id: string, me: 合并人): Promise<合并预览结果> {
  const org = await 权限组织();
  const [A, B] = await Promise.all([读客户(db, 留下id), 读客户(db, 并掉id)]);
  const 原因 = await 拦的原因(db, A, B, me, org);
  if (!A || !B) return { 能并: false, 原因, 并排: [], 条数: null, 要勾选: false, 补空: [] };
  const 人 = await 人名们(db, [A.salesOwnerId, B.salesOwnerId, A.creator?.userId, B.creator?.userId]);
  const 日 = (d: Date) => d.toISOString().slice(0, 10);
  const 行 = (格: string, a: string, b: string, 标红 = false): 并排格 => ({ 格, 留下: a, 并掉: b, 不同: a !== b, ...(标红 && a !== b ? { 标红: true } : {}) });
  const 并排 = [
    行("客户名称", A.name ?? "", B.name ?? ""),
    行("客户简称", A.shortName ?? "", B.shortName ?? ""),
    行("客户编号", 客户编号文字(A.customerNo) ?? "", 客户编号文字(B.customerNo) ?? ""),
    行("负责人", 人.get(A.salesOwnerId) ?? (A.pool ? "公海" : ""), 人.get(B.salesOwnerId) ?? (B.pool ? "公海" : "")),
    行("来源渠道", A.channel?.name ?? "", B.channel?.name ?? "", true),
    行("渠道触点", A.touchpoint ?? "", B.touchpoint ?? "", true),
    行("创建人", 人.get(A.creator?.userId ?? "") ?? "", 人.get(B.creator?.userId ?? "") ?? "", true),
    行("业务线", A.bizLine ?? "", B.bizLine ?? ""),
    行("客户类型", A.customerType ?? "", B.customerType ?? ""),
    行("客户属性", A.customerAttr ?? "", B.customerAttr ?? ""),
    行("客户地址", 地址(A), 地址(B)),
    行("客户状态", A.custStatus ?? "", B.custStatus ?? ""),
    行("建档时间", 日(A.createdAt), 日(B.createdAt)),
  ];
  return { 能并: 原因.length === 0, 原因, 并排, 条数: await 数条数(db, B.id), 要勾选: 来源或创建人不同(A, B), 补空: 补空叫法(算补空(A, B)) };
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
  项目: { id: string; 挪客户: boolean; 补来源?: string; 重复?: { 原序: number | null; 新序: number } }[];
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

class 拦下 extends Error {}

export type 合并完 = { mergeId: string; 条数: 合并条数 };

/** 执行合并：B 并进 A。已核对 = 预览里要勾选时勾过了 */
export async function 执行合并(db: 库, 留下id: string, 并掉id: string, me: 合并人, opt: { 已核对?: boolean; 现在?: Date } = {}): Promise<结果<合并完>> {
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
          const 原因 = await 拦的原因(tx, A, B, me, org);
          if (原因.length) throw new 拦下(原因.join("；"));
          if (来源或创建人不同(A!, B!) && !opt.已核对) throw new 拦下(`两家的来源或创建人不一样，请先勾选「${已核对话}」`);
          const 结 = await 挪(tx, A!, B!, me, 现在, 开);
          通知要 = { A: A!, B: B! };
          return 结;
        }, { timeout: 60_000 }),
      ),
    );
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    throw e;
  }
  忘掉企业版范围();
  await 存沟通后重算三态(留下id, 现在).catch((e) => console.warn("[合并客户] 三态没重算上：", e instanceof Error ? e.message : e));
  if (通知要) await 合并后通知(通知要, me);
  return { ok: true, ...r! };
}

async function 挪(tx: Tx, A: 客户行, B: 客户行, me: 合并人, 现在: Date, 开: boolean): Promise<合并完> {
  const 条数 = await 数条数(tx, B.id);
  const 明: 合并明细 = {
    版本: 1, B删于: 现在.toISOString(), 改指: {}, 对照: [], 联系人: [], 项目: [], A自指: { referrer: false, attribution: false },
    删掉: { contactCustomer: [], projectCustomer: [], entCustomerLink: [], customerPool: [] }, 关联: [], 审批人: [], 补空: 算补空(A, B), 退回次数: B.poolReturns,
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

  // 项目：所属客户改 A；来源空着的补 B 的主渠道；重复咨询原始客户是 B 的改指 A、序号接在 A 最大号后面
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
      序++;
      await tx.project.update({ where: { id: p.id }, data: { repeatOfCustomerId: A.id, repeatSeq: 序 } });
      const 行 = 明项目.get(p.id) ?? { id: p.id, 挪客户: false };
      行.重复 = { 原序: p.repeatSeq, 新序: 序 };
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
  if (Object.keys(明.补空.档案).length) await tx.customerExtra.upsert({ where: { customerId: A.id }, create: { customerId: A.id, ...明.补空.档案 }, update: 明.补空.档案 });

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
      kind: "客户", fromId: B.id, intoId: A.id, status: "已合并", byUserId: me.id,
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
  return { mergeId: 单.id, 条数 };
}

/** 最近跟进按没删的沟通重算（同 soft-delete.ts 重算最近跟进）；同号留痕不算 */
async function 重算最近跟进(tx: Tx, customerId: string) {
  const latest = await tx.followUp.findFirst({ where: { customerId, deletedAt: null, occurredAt: { lte: new Date() }, ...不是同号留痕 }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } });
  await tx.customer.updateMany({ where: { id: customerId }, data: { lastFollowAt: latest?.occurredAt ?? null } });
}

/**
 * 合并后通知（E-280 三.2）：被并那家的创建人、来源渠道负责人（B 的 channelOwnerId，空的取 B 主渠道的负责人）各一条，站内 + 飞书。
 * 系统管理员代并时，不是操作人本人的两家负责人也各一条（🔍 我方推断，方案第六节第 3 条）。操作人自己不发
 */
async function 合并后通知({ A, B }: { A: 客户行; B: 客户行 }, me: 合并人): Promise<void> {
  const 收 = [B.creator?.userId, B.channelOwnerId || B.channel?.channelOwnerId, A.salesOwnerId, B.salesOwnerId].filter((u) => u && u !== me.id);
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
export async function 并入去向(db: 库, customerId: string): Promise<{ mergeId: string; intoId: string; at: Date } | null> {
  const m = await db.entCustomerMerge.findFirst({ where: { kind: "客户", fromId: customerId, status: "已合并" }, orderBy: { at: "desc" }, select: { id: true, intoId: true, at: true } });
  return m ? { mergeId: m.id, intoId: m.intoId, at: m.at } : null;
}

/** 撤回合并（整单）：合并的人本人或系统管理员，30 天内 */
export async function 撤回合并(db: 库, mergeId: string, me: 合并人, 现在: Date = new Date()): Promise<结果<{ 没还原: 没还原[] }>> {
  if (!企业版()) return { ok: false, error: "只有企业版能撤回合并" };
  const org = await 权限组织();
  const 开 = await 客户状态自动();
  let 结: 没还原[] = [];
  let 两家: [string, string] | null = null;
  try {
    await 看已删(() =>
      看全部(() =>
        db.$transaction(async (tx) => {
          const m = await tx.entCustomerMerge.findUnique({ where: { id: mergeId } });
          if (!m || m.kind !== "客户") throw new 拦下("找不到这张合并单");
          if (m.status !== "已合并") throw new 拦下("这张合并单已经撤回过了");
          if (!org || 只读角色(me, org) || 只看的人(org, me.id) || (m.byUserId !== me.id && !是系统管理员(me, org))) throw new 拦下("只有合并的人或系统管理员能撤回合并");
          if (现在.getTime() - m.at.getTime() > 撤回期限天数 * 86_400_000) throw new 拦下(`合并已超过 ${撤回期限天数} 天，不能整单撤回`);
          const [A, B] = await Promise.all([
            tx.customer.findUnique({ where: { id: m.intoId }, select: { id: true, name: true, shortName: true, customerNo: true, deletedAt: true, poolReturns: true } }),
            tx.customer.findUnique({ where: { id: m.fromId }, select: { id: true, name: true, shortName: true, customerNo: true, deletedAt: true } }),
          ]);
          if (!B) throw new 拦下("被并的客户已清出回收站，不能撤回");
          if (!A) throw new 拦下("留下的客户已彻底删除，不能撤回");
          if (A.deletedAt) throw new 拦下(`「${名(A)}」在回收站里，先恢复再撤回合并`);
          结 = await 挪回(tx, m.detail, A.id, B.id, A.poolReturns);
          await tx.customer.update({ where: { id: B.id }, data: { deletedAt: null } });
          await 重算最近跟进(tx, A.id);
          await 重算最近跟进(tx, B.id);
          await 跟着项目重算(tx, 开, [A.id, B.id]);
          await tx.entCustomerMerge.update({ where: { id: m.id }, data: { status: "已撤回", undoneAt: 现在, undoneById: me.id, undoLeft: 结.length ? JSON.stringify(结) : null } });
          const 留话 = 结.length ? `；${结.length} 条之后被改过，留在原处` : "";
          await tx.auditLog.createMany({
            data: [
              { userId: me.id, userName: me.name, action: "merge-undo", entity: "Customer", entityId: A.id, at: 现在, summary: `撤回合并：「${名(B)}」已拆回${留话}`, detail: JSON.stringify({ mergeId: m.id, 没还原: 结 }) },
              { userId: me.id, userName: me.name, action: "merge-undo", entity: "Customer", entityId: B.id, at: 现在, summary: `撤回合并：从「${名(A)}」拆回，已从回收站恢复${留话}`, detail: JSON.stringify({ mergeId: m.id }) },
            ],
          });
          两家 = [A.id, B.id];
        }, { timeout: 60_000 }),
      ),
    );
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    throw e;
  }
  忘掉企业版范围();
  if (两家) await 存沟通后重算三态(两家, 现在).catch((e) => console.warn("[撤回合并] 三态没重算上：", e instanceof Error ? e.message : e));
  return { ok: true, 没还原: 结 };
}

async function 挪回(tx: Tx, 原文: string, A: string, B: string, A退回: number): Promise<没还原[]> {
  const 明 = JSON.parse(原文) as 合并明细;
  const 留: 没还原[] = [];
  const 留下 = (类: string, ids: string[], 原因: string) => ids.forEach((id) => 留.push({ 类, id, 原因 }));
  const 改过话 = "合并之后被改过（换了客户或删了）";

  // 联系人一组：主客户还是 A、去掉的关键标还空着
  for (const c of 明.联系人) {
    const 现 = await tx.contact.findUnique({ where: { id: c.id }, select: { customerId: true, isPrimary: true } });
    if (!现) { 留下("联系人", [c.id], "已彻底删除"); continue; }
    if (现.customerId !== A || (c.去关键 && 现.isPrimary)) { 留下("联系人", [c.id], 改过话); continue; }
    await tx.contact.update({ where: { id: c.id }, data: { customerId: B, ...(c.去关键 ? { isPrimary: true } : {}) } });
  }
  // 项目一组：所属客户、补的来源、重复咨询
  for (const p of 明.项目) {
    const 现 = await tx.project.findUnique({ where: { id: p.id }, select: { customerId: true, channelId: true, repeatOfCustomerId: true, repeatSeq: true } });
    if (!现) { 留下("项目", [p.id], "已彻底删除"); continue; }
    const 对 = (!p.挪客户 || 现.customerId === A) && (!p.补来源 || 现.channelId === p.补来源) && (!p.重复 || (现.repeatOfCustomerId === A && 现.repeatSeq === p.重复.新序));
    if (!对) { 留下("项目", [p.id], 改过话); continue; }
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
  for (const [键, ids] of Object.entries(明.改指)) {
    const [t, 列] = 键.split(".") as [改指表名, string];
    for (const 段 of 分段(ids)) {
      await 表(tx, t).updateMany({ where: { id: { in: 段 }, [列]: A }, data: { [列]: B } });
      const 没回 = (await 表(tx, t).findMany({ where: { id: { in: 段 }, NOT: { [列]: B } }, select: { id: true } })).map((r) => r.id as string);
      const 在 = new Set((await 表(tx, t).findMany({ where: { id: { in: 段 } }, select: { id: true } })).map((r) => r.id as string));
      留下(键, 没回, 改过话);
      留下(键, 段.filter((id) => !在.has(id)), "已彻底删除");
    }
  }
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
  const 现A = await tx.customer.findUnique({ where: { id: A }, select: { ...Object.fromEntries([...补空客户格, ...地址格].map((k) => [k, true])), extra: { select: { country: true, website: true, level: true } } } }) as Record<string, unknown> & { extra: Record<string, unknown> | null };
  const 清: Record<string, null> = {};
  for (const [k, v] of Object.entries(明.补空.客户)) {
    if (现A[k] === v) 清[k] = null;
    else 留.push({ 类: "客户资料", id: (地址格 as readonly string[]).includes(k) ? "客户地址" : (格叫法[k] ?? k), 原因: "合并之后被改过，保留现在的值" });
  }
  await tx.customer.update({ where: { id: A }, data: { ...清, poolReturns: Math.max(0, A退回 - 明.退回次数) } });
  const 清档: Record<string, null> = {};
  for (const [k, v] of Object.entries(明.补空.档案)) {
    if (现A.extra?.[k] === v) 清档[k] = null;
    else 留.push({ 类: "客户资料", id: 格叫法[k] ?? k, 原因: "合并之后被改过，保留现在的值" });
  }
  if (Object.keys(清档).length) await tx.customerExtra.updateMany({ where: { customerId: A }, data: 清档 });
  // 档案行是合并时新建的、清完又全空了：删掉，回到合并前「没有这一行」
  if (明.补空.档案新建) {
    const 行 = await tx.customerExtra.findUnique({ where: { customerId: A } });
    if (行 && Object.entries(行).every(([k, v]) => k === "customerId" || v === null)) await tx.customerExtra.delete({ where: { customerId: A } });
  }
  return 留;
}
