import { prisma } from "@/lib/prisma";
import { 搜索词 } from "@/lib/search-keyword";
import { 负责人候选 } from "@/lib/owners";
import type { 项目行 } from "./board";
import type { 阶段 } from "./nodes";
import { 看得到的客户, 露客户, 公海超时收回, 待我回的邀请 } from "./db";
import { 企业版 } from "@/lib/enterprise/switch";
import { 生效组织规则 } from "./org-rules-store";
import { 数收回次数, 合收回次数, 收回次数筛 } from "./recycle-count";

export type 项目筛选 = { keyword?: string; ownerId?: string; pool?: string; recycled?: string };

/** 一页最多列这么多个项目（按最近改过排），更早的靠搜索 */
export const 项目上限 = 500;

/**
 * 项目页和企业版「新线索」页共用的取数：先跑超时回收，再按筛选取项目、拼成 项目行。
 * 只看阶段 = "线索" 时只取还在线索阶段的（含已线索流失的），企业版 /leads 用。
 */
export async function 读项目列表(me: Parameters<typeof 公海超时收回>[0] & Parameters<typeof 待我回的邀请>[0], sp: 项目筛选, 只看阶段?: 阶段) {
  // 企业版超时回收：先收再列，列表里看到的就是收完的样子
  await 公海超时收回(me).catch((e) => console.error("[超时回收] 扫的时候出错，这次先不收", e));
  const 词 = 搜索词(sp.keyword);
  const rows = await prisma.project.findMany({
    where: {
      ...(只看阶段 ? { phase: 只看阶段 } : {}),
      ...(词 ? { OR: [{ name: { contains: 词 } }, { customer: { name: { contains: 词 } } }] } : {}),
      ...(typeof sp.ownerId === "string" && sp.ownerId ? { ownerId: sp.ownerId } : {}),
      ...(sp.pool === "1" ? { pooledAt: { not: null } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 项目上限,
    include: { customer: { select: { name: true } }, exceptionCategory: { select: { name: true } } },
  });
  const 企 = 企业版();
  // 企业版「收回次数」：从留痕里数；按次数筛只在企业版的项目公海里生效
  const 收回筛 = 企 && sp.pool === "1" ? 收回次数筛(sp.recycled) : "";
  const [人, users, 可见, 邀请, 收回] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerId))] } }, select: { id: true, name: true } }),
    负责人候选(),
    看得到的客户(rows.map((r) => r.customerId)),
    待我回的邀请(me),
    企 ? 数收回次数(rows.map((r) => r.id), prisma) : Promise.resolve(null),
  ]);
  const 名字 = new Map(人.map((u) => [u.id, u.name]));
  // 公海里同事客户的项目：不露客户名；按客户名搜也不该搜出它（否则等于拿名字试出来）
  const 露 = (p: (typeof rows)[number]) => 露客户(me, p, 可见);
  const 行: 项目行[] = rows.filter((p) => (!词 || p.name.toLowerCase().includes(词.toLowerCase()) || 露(p)) && 合收回次数(收回?.get(p.id) ?? 0, 收回筛)).map((p) => ({
    id: p.id, name: p.name, customerId: p.customerId, customerName: 露(p) ? p.customer.name : null,
    ownerId: p.ownerId, ownerName: 名字.get(p.ownerId) ?? "已不在的成员",
    phase: p.phase, node: p.node, result: p.result, exceptionCategory: p.exceptionCategory?.name ?? null, exceptionReason: p.exceptionReason,
    pooled: !!p.pooledAt,
    ...(收回 ? { 收回次数: 收回.get(p.id) ?? 0 } : {}),
    amount: p.amount, currency: p.currency, updatedAt: p.updatedAt.toISOString(),
  }));
  return {
    行,
    取到上限: rows.length >= 项目上限,
    // 结局叫法跟着字典：企业版组织规则里改过的出口叫法
    企业版: 企,
    出口叫法: 企 ? (await 生效组织规则()).阶段.出口叫法 : undefined,
    users,
    邀请们: 邀请.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    filters: { keyword: 词, ownerId: typeof sp.ownerId === "string" ? sp.ownerId : "", pool: sp.pool === "1" ? "1" : "", recycled: 收回筛 },
  };
}
