"use server";

/**
 * 企业版统一公海的两个新动作（2026-10-29，P7）：标无效客户、恢复有效客户。领取照用原来的（客户公海 领取、项目公海 领取项目）。
 * 10-30 交互改版补两个：老板、主管把项目行分给同事（分配公海项目，客户行照用 分配公海）；领 / 分项目行的撤销（撤销公海项目，规则 B）。
 * 规矩：老板、主管能标无效；只有老板能恢复。只认还在客户公海里的客户（项目行的客户归别人，不在这里标）。
 * 先拦权限、再看参数：权限矩阵拿空参数调，得先说「无权」（tests/permissions/matrix.test.ts）
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 管全队客户 } from "@/lib/constants";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import { 看全部 } from "@/lib/team-scope";
import { 查完再写 } from "@/lib/check-then-write";
import { 记转让, 超上限 } from "@/lib/project/db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 单项目客户跟着领 } from "@/lib/enterprise/pool-link";
import { 撤回项目公海 } from "@/lib/enterprise/pool-undo";

export type 标记结果 = { ok: true; updated: number; unchanged: number } | { ok: false; error: string };

const 只企业版项目模式 = { ok: false as const, error: "统一公海只在企业版项目模式里有" };

async function 开着(): Promise<boolean> {
  return 企业版() && (await getBusiness()).projectMode === true;
}

/** 参数规整：只认字符串 id，去重，最多 500 个（一页最多 100 行，留余量给以后批量） */
function 规整ids(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 500);
}

function 刷新() {
  revalidatePath("/pool");
  revalidatePath("/customers");
  revalidatePath("/projects");
}

/** 老板、主管把公海里的客户标成无效：标了的领不了、分不了。已经是无效的算没变 */
export async function 标无效客户(ids: string[]): Promise<标记结果> {
  const me = await requireUser();
  if (!管全队客户(me.role)) return { ok: false, error: "只有老板和主管能标无效客户" };
  if (!(await 开着())) return 只企业版项目模式;
  const 们 = 规整ids(ids);
  if (!们.length) return { ok: true, updated: 0, unchanged: 0 };
  // 只改还在公海里、还没标的：领走了的不标（标了也没意义，还会在他以后再进公海时冒出来）
  const r = await prisma.customer.updateMany({ where: { id: { in: 们 }, pool: { isNot: null }, poolInvalidAt: null }, data: { poolInvalidAt: new Date() } });
  if (r.count) {
    await recordAudit({
      user: me, action: "pool-invalid", entity: "Customer", entityId: 们.length === 1 ? 们[0] : null,
      summary: `把公海里 ${r.count} 名客户标成无效客户`,
      detail: { ids: 们 },
    });
    刷新();
  }
  return { ok: true, updated: r.count, unchanged: 们.length - r.count };
}

/** 只有老板能恢复：清掉无效标记，客户还在公海里，照常能领 */
export async function 恢复有效客户(ids: string[]): Promise<标记结果> {
  const me = await requireUser();
  if (me.role !== "ADMIN") return { ok: false, error: "只有老板能恢复无效客户" };
  if (!(await 开着())) return 只企业版项目模式;
  const 们 = 规整ids(ids);
  if (!们.length) return { ok: true, updated: 0, unchanged: 0 };
  const r = await prisma.customer.updateMany({ where: { id: { in: 们 }, poolInvalidAt: { not: null } }, data: { poolInvalidAt: null } });
  if (r.count) {
    await recordAudit({
      user: me, action: "pool-restore", entity: "Customer", entityId: 们.length === 1 ? 们[0] : null,
      summary: `把 ${r.count} 名无效客户恢复成有效`,
      detail: { ids: 们 },
    });
    刷新();
  }
  return { ok: true, updated: r.count, unchanged: 们.length - r.count };
}

export type 分项目结果 =
  | { ok: true; 分到: string[]; 没分到: { id: string; 原因: string }[]; 给谁: { id: string; name: string } }
  | { ok: false; error: string };

/**
 * 老板、主管把项目公海里的项目分给同事（10-30，P0 #6）：权限同客户公海的 分配公海，持有上限照拦指派（超上限）。
 * 规矩同 领取公海项目：标了无效的客户的项目分不了；记一行 pool-claim（操作人 = 我，到 = 给的那位），撤销认的就是这一行；
 * 客户在客户公海里、名下只有这一个项目的，客户跟着一起过去。一个一个分，分不了的说原因，不整批失败
 */
export async function 分配公海项目(ids: string[], userId: string): Promise<分项目结果> {
  const me = await requireUser();
  if (!管全队客户(me.role)) return { ok: false, error: "只有老板和业务主管能把公海里的项目分给同事" };
  if (!(await 开着())) return 只企业版项目模式;
  const 给 = await prisma.user.findFirst({ where: { id: String(userId ?? ""), active: true }, select: { id: true, name: true } });
  if (!给) return { ok: false, error: "这位同事不在了或已停用，换一位" };
  const 们 = 规整ids(ids);
  const 规则 = await 生效组织规则();
  const 分到: string[] = [];
  const 没分到: { id: string; 原因: string }[] = [];
  for (const id of 们) {
    const 原因 = await 看全部(() => 查完再写(async (tx) => {
      const p = await tx.project.findUnique({ where: { id }, select: { id: true, phase: true, node: true, result: true, ownerId: true, pooledAt: true, customerId: true } });
      if (!p) return "这个项目已经不在了";
      if (!p.pooledAt) return "已经被人领走了";
      const c = await tx.customer.findUnique({ where: { id: p.customerId }, select: { poolInvalidAt: true, pool: { select: { customerId: true } } } });
      if (c?.pool && c.poolInvalidAt) return "客户标了无效，要老板先恢复";
      const 超 = await 超上限(tx, 规则, 给.id, p);
      if (超) return 超;
      await tx.project.update({ where: { id }, data: { ownerId: 给.id, pooledAt: null, nextStepAt: null, nextStepText: null } });
      await 记转让(tx, p, me.id, p.ownerId, 给.id, "pool-claim");
      await 单项目客户跟着领(tx, p.customerId, 给.id);
      return null;
    }));
    if (原因) 没分到.push({ id, 原因 });
    else 分到.push(id);
  }
  if (分到.length) {
    await recordAudit({
      user: me, action: "pool-assign", entity: "Project", entityId: 分到.length === 1 ? 分到[0] : null,
      summary: `把项目公海里 ${分到.length} 个项目分给 ${给.name}`,
      detail: { ids: 分到, 给: 给.id },
    });
    刷新();
  }
  return { ok: true, 分到, 没分到, 给谁: 给 };
}

/**
 * 撤销刚才从项目公海领 / 分走的项目（规则 B，6 秒内点）：项目回项目公海，负责人还给原来那位。
 * 认不认看留痕（撤回项目公海）：得是我在撤销时限内领 / 分给 现 的那一下。撤分配只有老板、主管能点
 */
export async function 撤销公海项目(动作: "领取" | "分配", ids: string[], 给谁?: string): Promise<标记结果> {
  const me = await requireUser();
  if (动作 === "分配" && (!管全队客户(me.role) || !给谁)) return { ok: false, error: "只有老板和业务主管能撤销分配" };
  if (!(await 开着())) return 只企业版项目模式;
  const 现 = 动作 === "分配" ? String(给谁) : me.id;
  const 们 = 规整ids(ids);
  let 撤了 = 0;
  for (const id of 们) {
    if (await 看全部(() => 查完再写((tx) => 撤回项目公海(tx, id, 现, me.id)))) 撤了++;
  }
  if (撤了) {
    await recordAudit({
      user: me, action: "update", entity: "Project", entityId: 们.length === 1 ? 们[0] : null,
      summary: `撤销${动作}：${撤了} 个项目放回项目公海`,
      detail: { ids: 们 },
    });
    刷新();
  }
  return { ok: true, updated: 撤了, unchanged: 们.length - 撤了 };
}
