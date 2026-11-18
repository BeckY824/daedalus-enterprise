/**
 * 分配方向（11-18，customer-region.ts 默认分配方向）要读库的那几样：客户 / 项目上的号、某位客户的默认方向。
 * 服务端用（自动分配、客户转让框取默认、建档向导算默认）；别在客户端 import
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 读线部门 } from "./assign-eta";
import type { 组织 } from "./org-core";
import { 默认分配方向, 本人事业部, type 分配方向, type 定线号 } from "./customer-region";
import type { 线 } from "./lead-assign";

/**
 * 客户的号，按这个顺序：客户电话、联系方式子表里的手机、各位联系人的电话（主要联系人先）；
 * 后面跟 WhatsApp（客户 WhatsApp、子表里 kind=whatsapp 的，审核 11-18 P1-6：只留了 WhatsApp 的客户电话那步原来判不出）。读不到 = 空
 */
export async function 客户号们(customerId: string): Promise<定线号[]> {
  const c = await 看全部(() => prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      phone: true,
      extra: { select: { whatsapp: true } },
      contactMethods: { where: { kind: { in: ["phone", "whatsapp"] } }, select: { kind: true, value: true }, orderBy: { createdAt: "asc" } },
      contacts: { where: { deletedAt: null }, select: { phone: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
    },
  }));
  if (!c) return [];
  const 电话 = [c.phone, ...c.contactMethods.filter((m) => m.kind === "phone").map((m) => m.value), ...c.contacts.map((x) => x.phone)].filter((x): x is string => !!x);
  const WA = [c.extra?.whatsapp, ...c.contactMethods.filter((m) => m.kind === "whatsapp").map((m) => m.value)].filter((x): x is string => !!x).map((whatsapp) => ({ whatsapp }));
  return [...电话, ...WA];
}

/** 项目所属客户的号 */
export async function 项目号们(projectId: string): Promise<定线号[]> {
  const p = await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { customerId: true } }));
  return p ? 客户号们(p.customerId) : [];
}

/** 录入人本人的事业部（读线部门设置） */
export async function 本人线of(org: Pick<组织, "成员" | "部门">, userId: string): Promise<线 | null> {
  return 本人事业部(org, await 读线部门(), userId);
}

const 址 = { addrCountry: true, addrProvince: true, addrCity: true, addrDistrict: true } as const;

/**
 * 某位客户给市场成员自动分配时的默认方向（客户转让框）：客户地址 → 名下那条项目的所在地（有 projectId 才看）→ 客户的号 → 我的事业部
 */
export async function 客户默认分配方向(org: Pick<组织, "成员" | "部门">, customerId: string, userId: string, projectId?: string | null): Promise<分配方向> {
  const [c, p] = await Promise.all([
    看全部(() => prisma.customer.findUnique({ where: { id: customerId }, select: 址 })),
    projectId ? 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: 址 })) : null,
  ]);
  return 默认分配方向({ 客户: c, 项目: p, 号们: await 客户号们(customerId), 本人线: await 本人线of(org, userId) });
}
