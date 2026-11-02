import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能看项目, type 谁 } from "@/lib/enterprise/permissions";
import { 回避豁免, 我回避的公海项目 } from "@/lib/project/pool-owner";

/** 收藏的客户、项目怎么存、怎么读（左栏那两栏，改动在 app/(app)/favorites.ts）。读的这一半不放在 "use server" 文件里：那里导出的每个函数都能被浏览器直接调，一个收 userId 的读函数放过去，就成了「传别人的 id 读别人的收藏」。 */
export const 收藏键 = (userId: string) => `favorites:${userId}`;
export const 项目收藏键 = (userId: string) => `favorites-project:${userId}`;

export type 收藏项 = { id: string; name: string };

export async function 读收藏(userId: string): Promise<收藏项[]> {
  const ids = (await getSetting<string[]>(收藏键(userId))) ?? [];
  if (!Array.isArray(ids) || ids.length === 0) return [];
  // 名字现查：改名跟着变、删了的自然消失。按收藏顺序排，新收的在上
  const rows = await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const 按id = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => 按id.get(id)).filter((x): x is 收藏项 => Boolean(x));
}

export async function 收藏了吗(userId: string, customerId: string): Promise<boolean> {
  const ids = (await getSetting<string[]>(收藏键(userId))) ?? [];
  return Array.isArray(ids) && ids.includes(customerId);
}

/**
 * 这几个项目里，这个人现在点得开的（顺序照传进来的）。删了的、不归他看了的、进了公海而他是要回避的原负责人的都不算：
 * 这些点开是 404，左栏不能留。范围层在「按组织看客户」关着时不筛项目，所以和详情页一样再按业务角色过一遍。
 */
export async function 点得开的项目(me: 谁, ids: string[]): Promise<收藏项[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.project.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, ownerId: true, creatorId: true, pooledAt: true, bizLine: true, members: { where: { inviteStatus: "JOINED" }, select: { userId: true } } },
  });
  const org = await 权限组织();
  const 回避 = new Set((await 回避豁免(me)) ? [] : await 我回避的公海项目(prisma, me.id));
  const 能开 = rows.filter((p) => !回避.has(p.id) && (!企业版() || 能看项目(me, { ...p, 已加入: p.members.map((m) => m.userId) }, org)));
  const 按id = new Map(能开.map((p): [string, 收藏项] => [p.id, { id: p.id, name: p.name }]));
  return ids.map((id) => 按id.get(id)).filter((x): x is 收藏项 => Boolean(x));
}

export async function 读项目收藏(me: 谁): Promise<收藏项[]> {
  const ids = (await getSetting<string[]>(项目收藏键(me.id))) ?? [];
  if (!Array.isArray(ids)) return [];
  return 点得开的项目(me, ids.filter((x) => typeof x === "string"));
}

export async function 项目收藏了吗(userId: string, projectId: string): Promise<boolean> {
  const ids = (await getSetting<string[]>(项目收藏键(userId))) ?? [];
  return Array.isArray(ids) && ids.includes(projectId);
}
