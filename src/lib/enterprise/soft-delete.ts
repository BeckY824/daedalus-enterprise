/**
 * 企业版软删与回收站 · 动作（P9，2026-10-29）。读的时候怎么滤掉见 soft-delete-core.ts。
 *
 *   - 删客户：客户和名下的联系人、项目、沟通记录记同一个 deletedAt（客户连带），一起进回收站
 *   - 恢复客户：同一时刻删的那些一起回来；早些时候单独删的那几条照旧留在回收站
 *   - 单独删的联系人 / 项目 / 沟通记录：所属客户也在回收站里的，先恢复客户
 *   - 谁能看、能恢复：老板、主管、组织里有管理员类别的（销售管理 / 市场管理 / 总管理员）；看的范围照各自平时看得到的
 *   - 彻底删除：只有最高级管理员（老板或总管理员）
 *   - 到期清理：删了满 30 天的真删掉，夜扫的钟上每天一次（project/nightly.ts）
 *
 * 不是企业版：这些都不开（删除照旧是真删）。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "../prisma";
import { dayjs } from "../utils";
import { 看全部 } from "../team-scope";
import { 企业版 } from "./switch";
import { 管理员类别 } from "./org";
import { 最高管理 } from "./import-perm";
import { 看已删, 回收站保留天数, 客户连带, type 软删表名 } from "./soft-delete-core";

export { 看已删, 回收站保留天数, 客户连带, 软删表, type 软删表名 } from "./soft-delete-core";

type 谁 = { id: string; role: string };
type Tx = Prisma.TransactionClient;
type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** 删除走软删吗：企业版就是 */
export function 软删开着(): boolean {
  return 企业版();
}

/** 看回收站、恢复：老板、主管、有管理员类别的 */
export async function 能管回收站(me: 谁): Promise<boolean> {
  if (!企业版()) return false;
  return me.role === "ADMIN" || me.role === "MANAGER" || (await 管理员类别(me.id)) !== null;
}

/** 彻底删除：老板或总管理员 */
export async function 能彻底删除(me: 谁): Promise<boolean> {
  return 企业版() && (await 最高管理(me));
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
export async function 恢复(me: 谁, t: 软删表名, id: string): Promise<结果<{ 连带: number; customerId: string | null }>> {
  if (!(await 能管回收站(me))) return { ok: false, error: "只有老板和管理员能恢复" };
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
    await 表(tx, t).updateMany({ where: { id, deletedAt: 时刻 }, data: { deletedAt: null } });
    let 连带 = 0;
    if (t === "Customer") {
      for (const x of 客户连带) 连带 += (await 看全部(() => 表(tx, x).updateMany({ where: { customerId: id, deletedAt: 时刻 }, data: { deletedAt: null } }))).count;
    }
    if (t === "Customer" || t === "Contact") await 只留一个关键(tx, customerId, t === "Contact" ? id : null);
    if (t === "Customer" || t === "FollowUp") await 重算最近跟进(tx, customerId);
    return { ok: true as const, 连带, customerId };
  }));
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

/** 彻底删除回收站里的一条：只有老板 / 总管理员。客户连同名下的一起真删（外键级联） */
export async function 彻底删除(me: 谁, t: 软删表名, id: string): Promise<结果<{ name: string }>> {
  if (!(await 能彻底删除(me))) return { ok: false, error: "只有老板和总管理员能彻底删除" };
  return prisma.$transaction((tx) => 看已删(async () => {
    const 行 = await 表(tx, t).findUnique({ where: { id }, select: { id: true, deletedAt: true } });
    if (!行?.deletedAt) return { ok: false as const, error: "这一条不在回收站里了，刷新看看" };
    const name = await 叫什么(tx, t, id);
    if (t === "Customer") await 看全部(() => 线索退回(tx, [id]));
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
    for (const t of ["FollowUp", "Contact", "Project"] as const) 数[t] = (await 表(tx, t).deleteMany({ where: { deletedAt: { lt: 线 } } })).count;
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
