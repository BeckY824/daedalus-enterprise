/**
 * 企业版软删与回收站 · 动作（P9，2026-10-29）。读的时候怎么滤掉见 soft-delete-core.ts。
 *
 *   - 删客户：客户和名下的联系人、项目、沟通记录记同一个 deletedAt（客户连带），一起进回收站
 *   - 恢复客户：同一时刻删的那些一起回来；早些时候单独删的那几条照旧留在回收站
 *   - 单独删的联系人 / 项目 / 沟通记录：所属客户也在回收站里的，先恢复客户
 *   - 谁能看、能恢复：系统管理员、回收站副手（V3.5.1，permissions.ts 能恢复）；看的范围照各自平时看得到的
 *   - 谁能删：系统管理员；销售、销管、渠运删自己负责的（V3.5.1，permissions.ts 能删除）
 *   - 彻底删除：只有系统管理员（permissions.ts 能真删）
 *   - 到期清理：删了满 30 天的真删掉，夜扫的钟上每天一次（project/nightly.ts）
 *   - 真删沟通记录：上面的卡点先脱开、照旧留着（11-01 卡点 B13）；老库脱不开的那几条留在回收站不删
 *
 * 不是企业版：这些都不开（删除照旧是真删）。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "../prisma";
import { dayjs } from "../utils";
import { 看全部 } from "../team-scope";
import { 企业版 } from "./switch";
import { 权限组织 } from "./org";
import { 能删除, 能删一些, 能真删, 能恢复 } from "./permissions";
import { 看已删, 回收站保留天数, 客户连带, type 软删表名 } from "./soft-delete-core";
import { 客户状态自动, 跟着项目重算 } from "./cust-status-auto-db";
import { 卡点脱离沟通 } from "../project/blocker";
import { 忘掉企业版范围 } from "./visibility";
import { 回收站里查号, 回收站里带号的联系人, type 验好的号 } from "./contact-dedupe";
import { 换负责人 } from "@/lib/project/owner-write";
import { 验证中不能改派 } from "@/lib/project/lead-verify-guard";

export { 看已删, 回收站保留天数, 软删表, type 软删表名 } from "./soft-delete-core";

type 谁 = { id: string; role: string };
type Tx = Prisma.TransactionClient;
type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** 删除走软删吗：企业版就是 */
export function 软删开着(): boolean {
  return 企业版();
}

/** 看回收站、恢复：系统管理员、回收站副手（V3.5.1） */
export async function 能管回收站(me: 谁): Promise<boolean> {
  if (!企业版()) return false;
  return 能恢复(me, await 权限组织());
}

/** 彻底删除：只有系统管理员（V3.5.1） */
export async function 能彻底删除(me: 谁): Promise<boolean> {
  return 企业版() && 能真删(me, await 权限组织());
}

/** 企业版删除（客户、联系人、项目、线索进回收站或真删）被拦时那一句 */
export const 只有总管理能删话 = "只有负责人本人或系统管理员能删除";
/**
 * 删除前过一下（V3.5.1）：系统管理员都能删；销售、销管、渠运只删自己负责的；回 null = 放行。
 * 负责人们 = 要删的每一行的负责人（客户 salesOwnerId，其余 ownerId）；不传 = 只问摆不摆删除按钮（能删一些）。
 * 不是企业版不拦（照旧按各自的范围）
 */
export async function 删除挡(me: 谁, 负责人们?: readonly (string | null | undefined)[]): Promise<string | null> {
  if (!企业版()) return null;
  const org = await 权限组织();
  if (!负责人们) return 能删一些(me, org) ? null : 只有总管理能删话;
  return 负责人们.every((x) => 能删除(me, org, x)) ? null : 只有总管理能删话;
}

/** 没有回收站、删了就真没了的（线索、商机）：企业版只给系统管理员（V3.5.1 真删只给系统管理员） */
export async function 真删挡(me: 谁): Promise<string | null> {
  if (!企业版()) return null;
  return 能真删(me, await 权限组织()) ? null : "这类记录没有回收站，只有系统管理员能删除";
}

export const 回收站叫法: Record<软删表名, string> = { Customer: "客户", Project: "项目", Contact: "联系人", FollowUp: "沟通记录" };

const 截止 = (现在: Date) => new Date(现在.getTime() - 回收站保留天数 * 86_400_000);

/** 表名 → 这张表的 delegate（同一个事务里） */
function 表(tx: Tx, t: 软删表名) {
  const m = { Customer: tx.customer, Project: tx.project, Contact: tx.contact, FollowUp: tx.followUp }[t];
  return m as unknown as {
    updateMany(a: { where: object; data: object }): Promise<{ count: number }>;
    deleteMany(a: { where: object }): Promise<{ count: number }>;
    findUnique(a: { where: { id: string }; select: object }): Promise<Record<string, unknown> | null>;
  };
}

/**
 * 删客户（软删）：客户 + 客户连带的几张表记同一个时刻。只有还没删的才记（早些时候单独删的保留原来的时刻）。
 * 权限、虚线只读、推荐链这些由调用方（customers/actions deleteCustomers）先查过；连带的子行不再过一遍业务员范围
 */
export async function 软删客户(tx: Tx, ids: string[], 时刻 = new Date()): Promise<number> {
  if (!ids.length) return 0;
  const n = (await tx.customer.updateMany({ where: { id: { in: ids } }, data: { deletedAt: 时刻 } })).count;
  if (!n) return 0;
  const 删了的 = (await 看已删(() => tx.customer.findMany({ where: { id: { in: ids }, deletedAt: 时刻 }, select: { id: true } }))).map((c) => c.id);
  await 看全部(async () => {
    for (const t of 客户连带) await 表(tx, t).updateMany({ where: { customerId: { in: 删了的 } }, data: { deletedAt: 时刻 } });
  });
  return n;
}

/** 单独删一条联系人 / 项目 / 沟通记录（软删）。调用方先查过权限 */
export async function 软删一条(tx: Tx, t: Exclude<软删表名, "Customer">, id: string, 时刻 = new Date()): Promise<boolean> {
  return (await 表(tx, t).updateMany({ where: { id }, data: { deletedAt: 时刻 } })).count > 0;
}

/** 最近跟进时间按没删的沟通记录重算（删 / 恢复沟通记录、恢复客户后） */
async function 重算最近跟进(tx: Tx, customerId: string) {
  const latest = await tx.followUp.findFirst({ where: { customerId, occurredAt: { lte: new Date() } }, orderBy: { occurredAt: "desc" }, select: { occurredAt: true } });
  await tx.customer.updateMany({ where: { id: customerId }, data: { lastFollowAt: latest?.occurredAt ?? null } });
}

/**
 * 从回收站恢复一条。客户：同一时刻连带删的一起回来。别的：所属客户还在回收站里就不让（先恢复客户）。
 * 关键联系人：回来的那位原来是关键、客户这会儿已经另有关键的，回来的那位不再标关键（一位客户只留一个关键）
 */
export async function 恢复(me: 谁, t: 软删表名, id: string): Promise<结果<恢复了>> {
  if (!(await 能管回收站(me))) return { ok: false, error: "只有系统管理员或回收站副手能恢复" };
  return 恢复一条(t, id, me.id);
}

/** 恢复一条，不查谁能恢复：回收站页（恢复，先查权限）、查重捞回（查重撞上才给）共用 */
async function 恢复一条(t: 软删表名, id: string, 操作人 = ""): Promise<结果<恢复了>> {
  const r = await 只恢复(t, id, 操作人);
  if (!r.ok || t !== "Customer" || !企业版()) return r;
  // P-删-06：原负责人已停用 → 清空负责人进客户公海（例外留在他名下）。恢复那笔提交了再办，pool-link 引着 project/db、project/db 引着本文件，按需取
  const { 恢复后停用负责人去向 } = await import("./restore-inactive-owner");
  const 停用负责人 = await 恢复后停用负责人去向(id, 操作人);
  if (停用负责人?.进了公海) 忘掉企业版范围();
  return { ...r, 停用负责人 };
}

/** 停用负责人：恢复的是客户、原负责人已停用时才有（P-删-06），进了公海没有、原负责人是谁，调用方发通知用 */
export type 恢复了 = { 连带: number; customerId: string | null; 停用负责人?: { 原: string; 进了公海: boolean } | null };

async function 只恢复(t: 软删表名, id: string, 操作人 = ""): Promise<结果<{ 连带: number; customerId: string | null }>> {
  // 客户状态跟着项目算：项目回来了（单条或随客户连带）要重算，开关事务外读
  const 状态开 = (t === "Customer" || t === "Project") && (await 客户状态自动());
  // P-删-09：企业版单条恢复项目跟客户现负责人走（project/db 引着本文件，转让痕按需取，免得互相引用）
  const 项目跟客户 = t === "Project" && 企业版();
  const { 记转让 } = 项目跟客户 ? await import("../project/db") : { 记转让: null };
  return prisma.$transaction((tx) => 看已删(async () => {
    const 行 = await 表(tx, t).findUnique({ where: { id }, select: t === "Customer" ? { id: true, deletedAt: true } : { id: true, deletedAt: true, customerId: true } });
    const 时刻 = 行?.deletedAt as Date | null | undefined;
    if (!行 || !时刻) return { ok: false as const, error: "这一条已经不在回收站里了，刷新看看" };
    const customerId = t === "Customer" ? id : String(行.customerId);
    if (t !== "Customer") {
      const c = await tx.customer.findUnique({ where: { id: customerId }, select: { name: true, deletedAt: true } });
      if (!c) return { ok: false as const, error: "所属客户已经不在了，恢复不了" };
      if (c.deletedAt) return { ok: false as const, error: `所属客户「${c.name}」也在回收站里，先恢复客户` };
    }
    // P-删-09：客户在客户公海就拦（不然客户在公海、项目有人）；不在公海、项目不在项目公海的，归客户现负责人
    let 改归: { p: { id: string; phase: string; node: string; result: string | null }; 从: string; 到: string } | null = null;
    if (项目跟客户) {
      const c = await tx.customer.findUnique({ where: { id: customerId }, select: { name: true, salesOwnerId: true, pool: { select: { customerId: true } } } });
      if (c?.pool) return { ok: false as const, error: `所属客户「${c.name}」在客户公海里，先把客户领出来或分给销售，再恢复项目` };
      const p = await tx.project.findUnique({ where: { id }, select: { id: true, phase: true, node: true, result: true, ownerId: true, pooledAt: true } });
      const 到 = c?.salesOwnerId ?? "";
      if (p && !p.pooledAt && 到 && p.ownerId !== 到) {
        // 要换负责人的（跟客户现负责人）在验证中就不恢复（X-77）：先撤回验证再恢复
        if (await 验证中不能改派(tx, id)) return { ok: false as const, error: "这条线索在验证中，恢复要换成客户现负责人、验证中不能改负责人：先撤回验证再恢复" };
        改归 = { p, 从: p.ownerId, 到 };
      }
    }
    await 表(tx, t).updateMany({ where: { id, deletedAt: 时刻 }, data: { deletedAt: null } });
    if (改归 && 记转让) {
      await tx.project.update({ where: { id }, data: 换负责人(改归.到) });
      await 记转让(tx, 改归.p, 操作人 || 改归.到, 改归.从 || null, 改归.到, "transfer", "从回收站恢复，跟客户现负责人");
    }
    let 连带 = 0;
    if (t === "Customer") {
      for (const x of 客户连带) 连带 += (await 看全部(() => 表(tx, x).updateMany({ where: { customerId: id, deletedAt: 时刻 }, data: { deletedAt: null } }))).count;
    }
    if (t === "Customer" || t === "Contact") await 只留一个关键(tx, customerId, t === "Contact" ? id : null);
    if (t === "Customer" || t === "FollowUp") await 重算最近跟进(tx, customerId);
    await 跟着项目重算(tx, 状态开, [customerId]);
    return { ok: true as const, 连带, customerId };
  })).then((r) => { if (r.ok && (t === "Customer" || t === "Project")) 忘掉企业版范围(); return r; }); // 项目回来了，组员看得到的客户名单跟着变
}

/**
 * 查重撞上回收站里的号码，就地捞回（客户 11-05：「可以捞回且只有查重触发时可以捞回」）。
 * 不另查权限：谁查重撞上谁能捞（企业版里录入的人都会查重）；号码由服务端重新查一遍，不信前端给的 id。
 *   1. 撞上的是删了的客户 → 客户连同同一时刻删的联系人、项目、跟进一起回来（恢复一条 Customer），负责人、公海照原样；
 *      原负责人已停用的清空负责人进客户公海（P-删-06，同回收站页）
 *   2. 客户还在、带这个号的联系人删了 → 那位联系人回来
 * 回收站页（系统管理员、回收站副手）照旧，这里只是查重时的入口
 */
export type 捞回的 = { t: "Customer" | "Contact"; id: string; 名: string; 连带: number; 停用负责人?: { 原: string; 进了公海: boolean } | null };
export async function 查重捞回(号: 验好的号, 操作人 = ""): Promise<结果<{ 回来的: 捞回的[] }>> {
  return 看全部(async () => {
    const 没了 = { ok: false as const, error: "回收站里已经没有这个号码了，刷新看看" };
    const ids = await 回收站里查号(prisma, 号.类型, 号.值, 号.键);
    if (!ids.length) return 没了;
    const 回来的: 捞回的[] = [];
    const 删了的 = await 看已删(() => prisma.customer.findMany({ where: { id: { in: ids }, deletedAt: { not: null } }, select: { id: true, name: true } }));
    for (const c of 删了的) {
      const r = await 恢复一条("Customer", c.id, 操作人);
      if (!r.ok) return r;
      回来的.push({ t: "Customer", id: c.id, 名: c.name, 连带: r.连带, 停用负责人: r.停用负责人 });
    }
    // 客户回来了，带号的联系人可能是更早单独删的：再查一遍，剩下的都是「客户在、联系人删了」
    const 还剩 = await 回收站里查号(prisma, 号.类型, 号.值, 号.键);
    const 联系人们 = await 回收站里带号的联系人(prisma, 号, 还剩);
    const 名们 = new Map((await 看已删(() => prisma.contact.findMany({ where: { id: { in: 联系人们 } }, select: { id: true, name: true } }))).map((c) => [c.id, c.name]));
    for (const cid of 联系人们) {
      const r = await 恢复一条("Contact", cid, 操作人);
      if (!r.ok) return r;
      回来的.push({ t: "Contact", id: cid, 名: 名们.get(cid) ?? "", 连带: r.连带 });
    }
    if (!回来的.length) return 没了;
    return { ok: true as const, 回来的 };
  });
}

/** 恢复之后一位客户有两位关键联系人：留原来在的那位，回来的取消关键 */
async function 只留一个关键(tx: Tx, customerId: string, 回来的: string | null) {
  const 关键 = await tx.contact.findMany({ where: { customerId, isPrimary: true, deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (关键.length < 2) return;
  const 留 = 关键.find((c) => c.id !== 回来的) ?? 关键[0];
  await tx.contact.updateMany({ where: { customerId, isPrimary: true, deletedAt: null, id: { not: 留.id } }, data: { isPrimary: false } });
}

/** 真删一批客户之前：从线索转来的线索退回「跟进中」（同 customers/actions 搬走并删 的老规矩） */
async function 线索退回(tx: Tx, customerIds: string[]) {
  if (!customerIds.length) return;
  await tx.lead.updateMany({ where: { customerId: { in: customerIds } }, data: { customerId: null, status: "跟进中", convertedAt: null } });
}

/** 彻底删除回收站里的一条：只有系统管理员。客户连同名下的一起真删（外键级联） */
export async function 彻底删除(me: 谁, t: 软删表名, id: string): Promise<结果<{ name: string }>> {
  if (!(await 能彻底删除(me))) return { ok: false, error: "只有系统管理员能彻底删除" };
  return prisma.$transaction((tx) => 看已删(async () => {
    const 行 = await 表(tx, t).findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    if (!行?.deletedAt) return { ok: false as const, error: "这一条不在回收站里了，刷新看看" };
    const name = await 叫什么(tx, t, id);
    if (t === "Customer") await 看全部(() => 线索退回(tx, [id]));
    if (t === "FollowUp" && (await 卡点脱离沟通(tx, [id])).size) {
      return { ok: false as const, error: "这条沟通上发过卡点，卡点要留着，这条先留在回收站" };
    }
    await 看全部(() => 表(tx, t).deleteMany({ where: { id } }));
    return { ok: true as const, name };
  }));
}

async function 叫什么(tx: Tx, t: 软删表名, id: string): Promise<string> {
  if (t === "FollowUp") {
    const f = await tx.followUp.findUnique({ where: { id }, select: { title: true, content: true } });
    return (f?.title || f?.content || "").slice(0, 40);
  }
  const r = await 表(tx, t).findUnique({ where: { id }, select: { name: true } });
  return String(r?.name ?? "");
}

/** 到期清理：删了满 30 天的真删掉。先子后父，客户那一层先退线索。返回各表清了几条 */
export async function 清过期(现在: Date = new Date()): Promise<Record<软删表名, number>> {
  const 线 = 截止(现在);
  const 数 = { FollowUp: 0, Contact: 0, Project: 0, Customer: 0 } as Record<软删表名, number>;
  if (!企业版()) return 数;
  await 看全部(() => 看已删(() => prisma.$transaction(async (tx) => {
    // 沟通上的卡点先脱开（卡点照旧在）；老库脱不开的沟通这次跳过
    const 到期沟通 = (await tx.followUp.findMany({ where: { deletedAt: { lt: 线 } }, select: { id: true } })).map((f) => f.id);
    const 留 = await 卡点脱离沟通(tx, 到期沟通);
    数.FollowUp = (await tx.followUp.deleteMany({ where: { deletedAt: { lt: 线 }, ...(留.size ? { id: { notIn: [...留] } } : {}) } })).count;
    for (const t of ["Contact", "Project"] as const) 数[t] = (await 表(tx, t).deleteMany({ where: { deletedAt: { lt: 线 } } })).count;
    const 客户 = (await tx.customer.findMany({ where: { deletedAt: { lt: 线 } }, select: { id: true } })).map((c) => c.id);
    await 线索退回(tx, 客户);
    if (客户.length) 数.Customer = (await tx.customer.deleteMany({ where: { id: { in: 客户 } } })).count;
  })));
  return 数;
}

const g = globalThis as unknown as { __entTrashPurgedDay?: string };
/** 夜扫的钟每分钟调一次：同一天只清一遍（服务器重启后再清一遍也无妨，清过的就没了） */
export async function 每天清一次(现在: Date = new Date()): Promise<Record<软删表名, number> | null> {
  if (!企业版()) return null;
  const 天 = dayjs(现在).format("YYYY-MM-DD");
  if (g.__entTrashPurgedDay === 天) return null;
  const r = await 清过期(现在);
  g.__entTrashPurgedDay = 天;
  return r;
}

export type 回收站条目 = {
  表: 软删表名;
  id: string;
  名称: string;
  /** 所属客户（客户自己这一条是 null） */
  客户: { id: string; name: string; 也删了: boolean } | null;
  deletedAt: string;
  /** 还剩几天自动清掉（不足一天算 1） */
  剩几天: number;
  /** 客户这一条：同一时刻一起进回收站的 */
  连带?: { 联系人: number; 项目: number; 沟通记录: number };
};

/**
 * 回收站列表：近 30 天删的，新删的在前。看的范围照各自平时看得到的（业务员限定照旧套着）。
 * 随客户一起删的子行不单列，算在客户那一条的「连带」里；单独删的才列出来
 */
export async function 回收站列表(me: 谁, 现在: Date = new Date()): Promise<回收站条目[]> {
  if (!(await 能管回收站(me))) return [];
  const 线 = 截止(现在);
  const 窗 = { deletedAt: { gte: 线 } };
  const 客户选 = { select: { id: true, name: true, deletedAt: true } } as const;
  return 看已删(async () => {
    const [客户们, 项目们, 联系人们, 记录们] = await Promise.all([
      prisma.customer.findMany({ where: 窗, select: { id: true, name: true, deletedAt: true }, orderBy: { deletedAt: "desc" }, take: 500 }),
      prisma.project.findMany({ where: 窗, select: { id: true, name: true, deletedAt: true, customer: 客户选 }, orderBy: { deletedAt: "desc" }, take: 500 }),
      prisma.contact.findMany({ where: 窗, select: { id: true, name: true, deletedAt: true, customer: 客户选 }, orderBy: { deletedAt: "desc" }, take: 500 }),
      prisma.followUp.findMany({ where: 窗, select: { id: true, title: true, content: true, deletedAt: true, customer: 客户选 }, orderBy: { deletedAt: "desc" }, take: 500 }),
    ]);
    const 剩 = (d: Date) => Math.max(1, Math.ceil((d.getTime() + 回收站保留天数 * 86_400_000 - 现在.getTime()) / 86_400_000));
    const 连带键 = (customerId: string, d: Date) => `${customerId}|${d.getTime()}`;
    const 连带数 = new Map<string, { 联系人: number; 项目: number; 沟通记录: number }>();
    const out: 回收站条目[] = [];
    const 子 = (t: Exclude<软删表名, "Customer">, 键: "联系人" | "项目" | "沟通记录", 行: { id: string; deletedAt: Date | null; customer: { id: string; name: string; deletedAt: Date | null } }, 名称: string) => {
      const d = 行.deletedAt!;
      const c = 行.customer;
      // 随客户一起删的：同一个时刻
      if (c.deletedAt && c.deletedAt.getTime() === d.getTime()) {
        const k = 连带键(c.id, d);
        const 计 = 连带数.get(k) ?? { 联系人: 0, 项目: 0, 沟通记录: 0 };
        计[键]++;
        连带数.set(k, 计);
        return;
      }
      out.push({ 表: t, id: 行.id, 名称, 客户: { id: c.id, name: c.name, 也删了: !!c.deletedAt }, deletedAt: d.toISOString(), 剩几天: 剩(d) });
    };
    for (const p of 项目们) 子("Project", "项目", p, p.name);
    for (const c of 联系人们) 子("Contact", "联系人", c, c.name);
    for (const f of 记录们) 子("FollowUp", "沟通记录", f, (f.title || f.content).slice(0, 40));
    for (const c of 客户们) {
      out.push({ 表: "Customer", id: c.id, 名称: c.name, 客户: null, deletedAt: c.deletedAt!.toISOString(), 剩几天: 剩(c.deletedAt!), 连带: 连带数.get(连带键(c.id, c.deletedAt!)) ?? { 联系人: 0, 项目: 0, 沟通记录: 0 } });
    }
    return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  });
}

/** 撤销刚删的那一条（界面上「撤销」）：企业版软删的行还在，清掉 deletedAt 就回来了。不在回收站里返回 false，调用方照老办法建回来 */
export async function 撤销软删(t: Exclude<软删表名, "Customer">, id: string): Promise<boolean> {
  if (!企业版()) return false;
  return 看已删(async () => (await 表(prisma as unknown as Tx, t).updateMany({ where: { id, deletedAt: { not: null } }, data: { deletedAt: null } })).count > 0);
}
