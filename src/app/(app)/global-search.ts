"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 客户关键词条件, 搜索词, 拆搜索词, 号码片段, 号码藏着 } from "@/lib/search-keyword";
import { 号码脱敏器 } from "@/lib/enterprise/phone-mask";
import { 读市场身份, 市场进不了详情的 } from "@/lib/enterprise/market-view-db";
import { 项目链接们 } from "@/lib/project/customer-detail-direct";
import { 客户显名, 显名列 } from "@/lib/enterprise/customer-title";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 并入去向们, 并入后去处 } from "@/lib/enterprise/customer-merge";
import type { Prisma } from "@/generated/prisma";

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
  const [客户条件, 藏号, 号, 市场] = await Promise.all([客户关键词条件(词, true, me.id), 号码藏着(me.id), 号码脱敏器(me.id), 读市场身份(me.id)]);
  // 项目、联系人两组也按拆开的词比，每个词都要中（2F，同客户那一组 客户关键词条件）
  const 词们 = 拆搜索词(词);
  // 客户那一半全称、简称都比（11-19 客户名称选填：没全称的客户按简称也搜得到他的项目，同 relate-actions）
  const 项目条件 = 词们.map((w) => ({ OR: [{ name: { contains: w } }, { customer: { name: { contains: w } } }, { customer: { shortName: { contains: w } } }] }));
  const 联系人条件 = 词们.map((w) => ({ OR: [{ name: { contains: w } }, ...(藏号 ? [] : [{ phone: { contains: 号码片段(w) ?? w } }]), { wechat: { contains: w } }] }));

  const [客户们, 项目们, 联系人们] = await Promise.all([
    prisma.customer.findMany({
      where: 客户条件,
      orderBy: [{ lastFollowAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 每组上限,
      // 企业版客户没有电话（E-260）：附注不带号，号码按联系人那一组搜、那一组带
      select: { ...显名列, school: true },
    }),
    prisma.project.findMany({
      where: { AND: 项目条件 },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      // 市场角色多取几条：已分给圈外的人的那几条下面要去掉（点进去是 404）
      take: 市场 ? 每组上限 * 4 : 每组上限,
      select: { id: true, name: true, phase: true, node: true, customer: { select: 显名列 } },
    }),
    prisma.contact.findMany({
      where: { AND: 联系人条件 },
      orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: 每组上限,
      select: { id: true, name: true, position: true, phone: true, customerId: true, customer: { select: 显名列 } },
    }),
  ]);

  // 合并客户（E-277）：搜中已并入别家的 B（名字、编号），给留下的 A，附注写「已并入」；A 本来就在结果里的不重复
  const 并入的 = 客户们.length < 每组上限 && Object.keys(客户条件).length ? await 搜到并入的(客户条件, new Set(客户们.map((c) => c.id))) : [];

  // 市场角色（11-04 P-看-06）：只看进度的那条不进搜索结果（详情页本来也挡）
  const 市场挡 = 市场 ? await 市场进不了详情的(me.id, 项目们.map((p) => p.id)) : new Set<string>();
  const 能开项目 = 项目们.filter((p) => !市场挡.has(p.id)).slice(0, 每组上限);
  // 进得了客户详情的直接去客户页那个项目页签（第 2 批审查 #3），拿不准的照旧 /projects/<id> 由项目页判
  const 链 = await 项目链接们(me, 能开项目.map((p) => p.id));
  const 拼 = (...xs: (string | null | undefined)[]) => xs.filter(Boolean).join(" · ") || null;
  return {
    // 全称选填（11-19）：名字空着的客户给显名（简称 → 全称 → 客户编号），结果里不出空白行
    客户: [...客户们.map((c) => ({ id: c.id, name: 客户显名(c), 附注: 拼(c.school), 去: `/customers/${c.id}` })), ...并入的].slice(0, 每组上限),
    项目: 能开项目.map((p) => ({ id: p.id, name: p.name, 附注: 拼(p.customer ? 客户显名(p.customer) : null, p.phase, p.node), 去: 链.get(p.id) ?? `/projects/${p.id}` })),
    // 联系人没有自己的详情页，点了去所属客户
    联系人: 联系人们.map((c) => ({ id: c.id, name: c.name, 附注: 拼(c.customer ? 客户显名(c.customer) : null, c.position, 号(c.phone)), 去: `/customers/${c.customerId}` })),
  };
}

/** 回收站里、已并入别家（合并单没撤回）的客户命中了关键词：换成留下那家（看得到的才给） */
async function 搜到并入的(客户条件: Prisma.CustomerWhereInput, 已有: Set<string>): Promise<搜到的一条[]> {
  const 删了的 = await 看已删(() => prisma.customer.findMany({ where: { AND: [客户条件, { deletedAt: { not: null } }] }, take: 每组上限, select: 显名列 }));
  if (!删了的.length) return [];
  const 去向 = await 并入去向们(prisma, 删了的.map((c) => c.id));
  if (!去向.size) return [];
  const 留下 = new Map((await prisma.customer.findMany({ where: { id: { in: [...new Set([...去向.values()].map((x) => x.intoId))] } }, select: 显名列 })).map((c) => [c.id, c]));
  const out: 搜到的一条[] = [];
  for (const b of 删了的) {
    const 去 = 去向.get(b.id);
    const a = 去 && 留下.get(去.intoId);
    if (!去 || !a || 已有.has(a.id)) continue;
    已有.add(a.id);
    out.push({ id: a.id, name: 客户显名(a), 附注: `「${客户显名(b)}」已并入这位客户`, 去: 并入后去处(a.id, b.id) });
  }
  return out;
}
