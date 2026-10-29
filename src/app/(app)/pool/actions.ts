"use server";

/**
 * 企业版统一公海的两个新动作（2026-10-29，P7）：标无效客户、恢复有效客户。领取照用原来的（客户公海 领取、项目公海 领取项目）。
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
