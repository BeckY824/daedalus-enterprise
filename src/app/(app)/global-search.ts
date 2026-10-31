"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 客户关键词条件, 搜索词, 号码片段, 号码藏着 } from "@/lib/search-keyword";
import { 号码脱敏器 } from "@/lib/shared-ws/current";

/**
 * 顶部全局搜索（U-项目-04，企业版项目模式）：⌘K / 左栏搜索框里打两个字以上，顺带搜客户、项目、联系人。
 *
 * 范围不另写：三张表都走 prisma（lib/team-scope.ts 的 加上限定），按角色只出看得到的——
 * 业务员只出自己的、上级出自己 + 下属的、老板全出；项目公海里的项目谁都看得到（本来就能领）。
 * 回收站里的（deletedAt）由软删那一层滤掉。号码照样打码；电话设成「藏」的人不按号码搜（Y27）。
 * 不是企业版一律给空：桌面端 / 团队版的 ⌘K 只跳页面，行为不变。
 */

export type 搜到的一条 = { id: string; name: string; 附注: string | null; 去: string };
export type 全局搜索结果 = { 客户: 搜到的一条[]; 项目: 搜到的一条[]; 联系人: 搜到的一条[] };

const 空: 全局搜索结果 = { 客户: [], 项目: [], 联系人: [] };
/** 每组最多几条：跳转单里摆得下，要看全的点进各自列表页去搜 */
const 每组上限 = 6;

export async function 全局搜索(关键词: string): Promise<全局搜索结果> {
  const me = await requireUser();
  if (!企业版() || typeof 关键词 !== "string") return 空;
  const 词 = 搜索词(关键词.trim().slice(0, 50));
  if (!词 || 词.length < 2) return 空;
  const [客户条件, 藏号, 号] = await Promise.all([客户关键词条件(词, true, me.id), 号码藏着(me.id), 号码脱敏器(me.id)]);
  const 号码条件 = 藏号 ? [] : [{ phone: { contains: 号码片段(词) ?? 词 } }];

  const [客户们, 项目们, 联系人们] = await Promise.all([
    prisma.customer.findMany({
      where: 客户条件,
      orderBy: [{ lastFollowAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 每组上限,
      select: { id: true, name: true, school: true, phone: true },
    }),
    prisma.project.findMany({
      where: { OR: [{ name: { contains: 词 } }, { customer: { name: { contains: 词 } } }] },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 每组上限,
      select: { id: true, name: true, phase: true, node: true, customer: { select: { name: true } } },
    }),
    prisma.contact.findMany({
      where: { OR: [{ name: { contains: 词 } }, ...号码条件, { wechat: { contains: 词 } }] },
      orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: 每组上限,
      select: { id: true, name: true, position: true, phone: true, customerId: true, customer: { select: { name: true } } },
    }),
  ]);

  const 拼 = (...xs: (string | null | undefined)[]) => xs.filter(Boolean).join(" · ") || null;
  return {
    客户: 客户们.map((c) => ({ id: c.id, name: c.name, 附注: 拼(c.school, 号(c.phone)), 去: `/customers/${c.id}` })),
    项目: 项目们.map((p) => ({ id: p.id, name: p.name, 附注: 拼(p.customer?.name, p.phase, p.node), 去: `/projects/${p.id}` })),
    // 联系人没有自己的详情页，点了去所属客户
    联系人: 联系人们.map((c) => ({ id: c.id, name: c.name, 附注: 拼(c.customer?.name, c.position, 号(c.phone)), 去: `/customers/${c.customerId}` })),
  };
}
