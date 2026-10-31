/**
 * 企业版项目回款（2026-10-31，迁移 100）：一笔一行（回款时间、币种、金额都必填），项目上的「当前回款」= 按币种加起来，不换汇。
 * 只加、删，不改：记错了删掉重记。谁能动 = 能改这个项目（负责人、老板、主管，公海里的先领取），再看字段权限「商机金额」那组。
 * 记了一笔、传了合同附件，项目配了节点必填（「回款」「合同附件」）就按必填推一次。
 * 这里不管登录、不管开关，界面的写在 app/(app)/projects/payment-actions.ts
 */
import { prisma } from "../prisma";
import { 查完再写 } from "../check-then-write";
import { parseDateInput } from "../date-input";
import { 是币种, 按币种合计, type 币种合计 } from "../currency";
import { 字段权限of, 改不了的话 } from "@/lib/enterprise/field-perm";
import { 客户状态自动, 跟着项目重算 } from "@/lib/enterprise/cust-status-auto-db";
import { 生效组织规则 } from "./org-rules-store";
import { 能管项目, 按必填推进, 带推进 } from "./db";

type 谁 = { id: string; role: string };

export type 回款 = { id: string; paidAt: string; currency: string; amount: number; userId: string | null; createdAt: string };
export type 回款提交 = { paidAt: string; currency: string; amount: number };

/** 一笔最多记到这么大（防手滑多打几个 0 以外，也防 Float 失真） */
export const 单笔上限 = 1e12;

/** 规整一笔回款：日期 YYYY-MM-DD、币种认得、金额 > 0。不对回一句人话 */
export function 规整回款(x: unknown): { paidAt: Date; currency: string; amount: number } | { error: string } {
  const v = (x ?? {}) as Partial<回款提交>;
  const paidAt = parseDateInput(v.paidAt);
  if (!paidAt) return { error: "回款时间要选一天" };
  if (!是币种(v.currency)) return { error: "币种要选一个" };
  const amount = typeof v.amount === "number" ? v.amount : Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0) return { error: "回款金额要大于 0" };
  if (amount > 单笔上限) return { error: "回款金额太大了，看看是不是多打了几个 0" };
  return { paidAt, currency: v.currency, amount: Math.round(amount * 100) / 100 };
}

/** 当前回款：按币种合计（金额大的币种排前） */
export function 当前回款(们: { currency: string; amount: number }[]): 币种合计[] {
  return 按币种合计(们, (r) => r.amount, (r) => r.currency);
}

export async function 列回款(projectId: string): Promise<回款[]> {
  const 们 = await prisma.entProjectPayment.findMany({ where: { projectId }, orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }] });
  return 们.map((r) => ({ id: r.id, paidAt: r.paidAt.toISOString(), currency: r.currency, amount: r.amount, userId: r.userId, createdAt: r.createdAt.toISOString() }));
}

const 不在 = { ok: false as const, error: "这个项目已经不在了，刷新看看" };
const 管不了 = (p: { pooledAt: Date | null }) => ({ ok: false as const, error: p.pooledAt ? "这个项目在公海里，先领取再改" : "只有项目负责人、老板或主管能记回款" });

type 写结果 =
  | { ok: false; error: string }
  | { ok: true; name: string; customerId: string; 笔: { paidAt: Date; currency: string; amount: number }; 自动推到?: string[] };

/** 记一笔回款 */
export async function 记回款(me: 谁, projectId: string, x: unknown): Promise<写结果 & { id?: string }> {
  const 好 = 规整回款(x);
  if ("error" in 好) return { ok: false, error: 好.error };
  const 挡 = 改不了的话(await 字段权限of(me.id), ["商机金额"]);
  if (挡) return { ok: false, error: 挡 };
  const 规则 = await 生效组织规则();
  const 状态开 = await 客户状态自动();
  return 查完再写(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: String(projectId ?? "") } });
    if (!p || p.deletedAt) return 不在;
    if (!能管项目(me, p)) return 管不了(p);
    const r = await tx.entProjectPayment.create({ data: { projectId: p.id, ...好, userId: me.id } });
    const 推进 = await 按必填推进(tx, 规则, me, p.id);
    if (推进.length) await 跟着项目重算(tx, 状态开, [p.customerId]);
    return { ok: true as const, id: r.id, name: p.name, customerId: p.customerId, 笔: 好, ...带推进(推进) };
  });
}

/** 删一笔回款（记错了删掉重记）。删了不往回退节点 */
export async function 删回款(me: 谁, paymentId: string): Promise<写结果 & { projectId?: string }> {
  const 挡 = 改不了的话(await 字段权限of(me.id), ["商机金额"]);
  if (挡) return { ok: false, error: 挡 };
  return 查完再写(async (tx) => {
    const r = await tx.entProjectPayment.findUnique({ where: { id: String(paymentId ?? "") }, include: { project: true } });
    if (!r) return { ok: false as const, error: "这笔回款已经不在了，刷新看看" };
    const p = r.project;
    if (p.deletedAt) return 不在;
    if (!能管项目(me, p)) return 管不了(p);
    await tx.entProjectPayment.delete({ where: { id: r.id } });
    return { ok: true as const, projectId: p.id, name: p.name, customerId: p.customerId, 笔: { paidAt: r.paidAt, currency: r.currency, amount: r.amount } };
  });
}

/** 传了一个合同附件或项目方案（10-31）：项目配了节点必填就按必填推一次。返回推到的节点（没推 = 空） */
export async function 合同附件后推进(me: 谁, projectId: string): Promise<string[]> {
  const 规则 = await 生效组织规则();
  const 状态开 = await 客户状态自动();
  return 查完再写(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, customerId: true, ownerId: true, pooledAt: true, deletedAt: true } });
    if (!p || p.deletedAt || !能管项目(me, p)) return [];
    const 推进 = await 按必填推进(tx, 规则, me, p.id);
    if (推进.length) await 跟着项目重算(tx, 状态开, [p.customerId]);
    return 推进;
  });
}
