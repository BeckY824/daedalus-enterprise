"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { 不在了 } from "@/lib/not-there";
import { 订单 } from "@/lib/features";
import { 只用项目挡老入口 } from "@/lib/enterprise/project-only";
import { saveFollowUp } from "../customers/[id]/actions";

/**
 * 订单页还在用的两样（2026-10-28 清理后）：订单详情上记一笔、签约框里选供应商。
 * 节点 / 单据 / 采购 / 改表头 / 删单这些写入口没有页面再调，已删；订单的规则在 lib/order.ts。
 */

function 刷新(订单id?: string, 客户id?: string) {
  revalidatePath("/orders");
  if (订单id) revalidatePath(`/orders/${订单id}`);
  if (客户id) revalidatePath(`/customers/${客户id}`);
}

const 文本 = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * 在订单上记一笔（2026-10-05，节点关着时的订单页）：走记跟进那条原路，再挂到这张订单上（nodeIdx 0 = 整单，不挂某一步）。
 * 外贸客户：「这样就可以对订单执行做跟进的记录了」
 */
export async function addOrderNote(orderId: string, content: string) {
  try {
    await requireUser();
    const 老入口 = await 只用项目挡老入口("订单");
    if (老入口) return { ok: false as const, error: 老入口 };
    if (!订单) return { ok: false as const, error: "此版本未开放订单功能" };
    const 话 = 文本(content, 5000);
    if (!话) return { ok: false as const, error: "写点什么再记" };
    const o = await prisma.tradeOrder.findUnique({ where: { id: String(orderId ?? "") }, select: { id: true, no: true, customerId: true, opportunityId: true } });
    if (!o) return { ok: false as const, error: "这张订单已经不在了" };
    const r = await saveFollowUp({
      customerId: o.customerId,
      type: "OTHER",
      title: `订单 ${o.no}`,
      content: 话,
      status: "已完成",
      occurredAt: new Date().toISOString(),
      orderId: o.id,
    });
    if (!r.ok) return r;
    刷新(o.id, o.customerId);
    return { ok: true as const, id: r.id };
  } catch (e) {
    return 不在了(e);
  }
}

/** 轻订单的候选包含稳定ID；同名档案仍分别可选，不需要开放供应商管理页。 */
export async function 供应商候选(): Promise<{ id: string; name: string }[]> {
  await requireUser();
  if (!订单) return [];
  return prisma.supplier.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }], take: 500, select: { id: true, name: true } });
}
