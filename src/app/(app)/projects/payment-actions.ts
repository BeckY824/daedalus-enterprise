"use server";

/**
 * 企业版项目回款的写（2026-10-31，迁移 100）：记一笔、删一笔。项目模式没开、不是企业版：直接拦，一行不写、不记操作记录。
 * 读写和谁能改在 lib/project/payment-db.ts，这里只管登录、开关、操作记录和刷新
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import { 金额 } from "@/lib/currency";
import { dayjs } from "@/lib/utils";
import { 记回款 as 记, 删回款 as 删, type 回款提交 } from "@/lib/project/payment-db";
import { 记自动推进 } from "@/lib/project/auto-advance";

const 没开 = { ok: false as const, error: "项目模式没开：请老板在「设置 → 业务配置」里打开" };
const 不是企业版 = { ok: false as const, error: "回款是企业版的功能" };

async function 开着(): Promise<boolean> {
  return (await getBusiness()).projectMode === true;
}

function 刷新项目(projectId: string, customerId?: string) {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

// 按业务时区的日历日（parseDateInput 存的是业务时区零点，toISOString 会差一天）
const 日 = (d: Date) => dayjs(d).format("YYYY-MM-DD");

/** 记一笔回款：时间、币种、金额都必填 */
export async function 记回款(projectId: string, x: 回款提交) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return 不是企业版;
    const r = await 记(me, projectId, x);
    if (!r.ok) return r;
    await recordAudit({
      user: me, action: "create", entity: "EntProjectPayment", entityId: r.id ?? projectId,
      summary: `项目「${r.name}」记了一笔回款：${日(r.笔.paidAt)} ${金额(r.笔.amount, r.笔.currency)}`,
      detail: { projectId, 回款时间: 日(r.笔.paidAt), 币种: r.笔.currency, 金额: r.笔.amount },
    });
    await 记自动推进(me, [{ id: projectId, name: r.name, 到: r.自动推到 ?? [] }]);
    刷新项目(projectId, r.customerId);
    return { ok: true as const, ...(r.自动推到?.length ? { 自动推到: r.自动推到 } : {}) };
  } catch (e) { return 不在了(e); }
}

/** 删一笔回款（记错了删掉重记） */
export async function 删回款(paymentId: string) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return 不是企业版;
    const r = await 删(me, paymentId);
    if (!r.ok) return r;
    await recordAudit({
      user: me, action: "delete", entity: "EntProjectPayment", entityId: paymentId,
      summary: `项目「${r.name}」删了一笔回款：${日(r.笔.paidAt)} ${金额(r.笔.amount, r.笔.currency)}`,
      detail: { projectId: r.projectId, 回款时间: 日(r.笔.paidAt), 币种: r.笔.currency, 金额: r.笔.amount },
    });
    刷新项目(r.projectId ?? "", r.customerId);
    return { ok: true as const };
  } catch (e) { return 不在了(e); }
}
