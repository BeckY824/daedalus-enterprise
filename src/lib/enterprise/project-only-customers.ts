/**
 * 只负责项目的人看客户（用户 11-12 定，客户方已同意；机制总表 P-看-10 / P-看-13 的放宽）。
 *
 * 「乙」= 项目负责人是本人、项目不在公海，而项目所属客户他按现有规则看不到（不是负责人、不是上级、不是组员……）。
 * 企业版且项目模式开着才有。这位客户进乙的看板，乙点进 /customers/<id> 是受限详情（customers/[id]/restricted.ts）。
 *
 * 不扩大限定层（lib/team-scope.ts 一行不动）：这里是一份独立的「仅项目」集合，只在看板、受限详情、路由处显式并入；
 * 导出、全局搜索、页签计数、批量、/contacts、AI 查询照旧走限定层，自然不带这类客户。
 * 绕开限定层读的地方一律写明 select 白名单。
 */
import { cache } from "react";
import type { Prisma } from "@/generated/prisma";
import { prisma, defaultClient } from "@/lib/prisma";
import { 看全部, 限定的我 } from "@/lib/team-scope";
import { 搜索词 } from "@/lib/search-keyword";
import { 看得到的客户 } from "@/lib/project/db";
import type { 客户条件 } from "@/app/(app)/customers/query";
import { 企业版只用项目 } from "./project-only";
import { 权限组织 } from "./org";
import { 能看项目, type 谁 } from "./permissions";
import { 市场进不了详情的 } from "./market-view-db";

/** 一次请求一份（React cache；测试里直通，每次现算） */
const 按人算 = cache(async (meId: string, role: string): Promise<Map<string, string[]>> => {
  const 空 = new Map<string, string[]>();
  if (!(await 企业版只用项目())) return 空;
  // 不限定（老板、按组织看客户关着）：客户本来都看得到，没有「仅项目」这回事
  if (!(await 限定的我(defaultClient))) return 空;
  // 候选：本人负责、没进公海、没在等分配（等分配期间只是先占着负责人一格，P-转-21）的项目；客户没进公海、没删
  const 候选 = await 看全部(() => prisma.project.findMany({
    where: { ownerId: meId, pooledAt: null, deletedAt: null, awaitAssignAt: null, customer: { deletedAt: null, pool: { is: null } } },
    select: { id: true, customerId: true, ownerId: true, creatorId: true, pooledAt: true, bizLine: true, members: { where: { inviteStatus: "JOINED" }, select: { userId: true } } },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  }));
  if (!候选.length) return 空;
  // 本来就看得到的客户走原来的客户详情，不进这份集合
  const [看得到, org, 市场挡] = await Promise.all([
    看得到的客户(候选.map((p) => p.customerId)),
    权限组织(),
    市场进不了详情的(meId, 候选.map((p) => p.id)),
  ]);
  const me: 谁 = { id: meId, role };
  const 表 = new Map<string, string[]>();
  for (const p of 候选) {
    if (看得到.has(p.customerId) || 市场挡.has(p.id)) continue;
    if (!能看项目(me, { ...p, 已加入: p.members.map((m) => m.userId) }, org)) continue;
    表.set(p.customerId, [...(表.get(p.customerId) ?? []), p.id]);
  }
  return 表;
});

/** 我「仅项目」看得到的客户：客户 id → 我在这位客户名下的项目 id（最近改过的在前）。非企业版、项目模式关、本来看全部 = 空 */
export function 仅项目客户们(me: { id: string; role: string }): Promise<Map<string, string[]>> {
  return 按人算(me.id, me.role);
}

/** 这位客户我是不是「仅项目」看得到：是 = 我在他名下的项目 id；不是（看不到，或本来就看得到）= null */
export async function 仅项目可见(me: { id: string; role: string }, customerId: string): Promise<string[] | null> {
  return (await 仅项目客户们(me)).get(customerId) ?? null;
}

/**
 * 客户条件每个键对「仅项目」行的口径：认 = 按安全的写法翻过来；挡 = 有值时这类行整个不参与（防拿筛选反推）。
 * 写成 Record<keyof 客户条件>：客户条件新加一个键不在这里登记，tsc 就过不了（测试另有一份名单对拍）
 */
export const 仅项目筛选口径: Record<keyof Required<客户条件>, "认" | "挡"> = {
  keyword: "认",
  customerType: "认",
  pool: "认",
  grade: "挡",
  followStatus: "挡",
  decisionStatus: "挡",
  custStatus: "挡",
  archiveTier: "挡",
  salesOwnerId: "挡",
  channelOwnerId: "挡",
  createdWithin: "挡",
  directOf: "挡",
  batch: "挡",
  country: "挡",
  source: "挡",
  level: "挡",
  dept: "挡",
  channelId: "挡",
  createdFrom: "挡",
  createdTo: "挡",
  phone: "挡",
  // 阶段 / 进程：客户页按「名下有我能看的项目在这一步」筛，这里不另写一份，保守起见整个不参与
  phase: "挡",
  node: "挡",
  triState: "挡",
};

/** 客户页的排序里，不按这几种排就安全（金额、级别、创建时间都能拿来反推） */
const 安全排序 = new Set([""]);

/**
 * 「仅项目」客户在客户页 / 看板上参与筛选时的条件（白名单）：只认关键词（只比客户名、简称、公司）、客户类型、「客户」页签。
 * 任何别的筛选有值，或按金额 / 级别 / 创建时间排，给 null = 这类行不参与（不然输个号码、选个级别，看卡留不留就试得出来）。
 * 什么都没筛 = {}（不收窄）
 */
export function 仅项目安全条件(sp: 客户条件 & { sort?: string | null }): Prisma.CustomerWhereInput | null {
  if (sp.sort != null && !安全排序.has(String(sp.sort))) return null;
  for (const [键, 口径] of Object.entries(仅项目筛选口径) as [keyof 客户条件, "认" | "挡"][]) {
    if (口径 === "挡" && 有值(sp[键])) return null;
  }
  // 地址栏手改的、没登记的键：有值一律不参与
  for (const [键, v] of Object.entries(sp)) {
    if (键 === "sort" || 键 in 仅项目筛选口径) continue;
    if (有值(v)) return null;
  }
  // 「公海」页签：这类客户不在公海
  if (sp.pool === "1") return null;
  if (有值(sp.pool) && typeof sp.pool !== "string") return null;
  const 且: Prisma.CustomerWhereInput[] = [];
  if (有值(sp.keyword)) {
    if (typeof sp.keyword !== "string") return null;
    const 词 = 搜索词(sp.keyword);
    if (词) 且.push({ OR: [{ name: { contains: 词 } }, { shortName: { contains: 词 } }, { school: { contains: 词 } }] });
  }
  if (有值(sp.customerType)) {
    if (typeof sp.customerType !== "string") return null;
    且.push({ customerType: sp.customerType });
  }
  return 且.length ? { AND: 且 } : {};
}

function 有值(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * 客户页看板的客户条件上挂着的「仅项目」安全条件（board-query.ts 登记，lib/project/list.ts 列表条件 取）。
 * 用对象本身当键：客户条件对象从 board-query 一路原样传到 列表条件（客户页 page.tsx、board-page.tsx、board-actions.ts 都不拷贝），
 * 中间几层不用各加一个参数。没登记过的客户条件 = null = 这类行不参与
 */
const 挂着的 = new WeakMap<object, Prisma.CustomerWhereInput | null>();
export function 挂上仅项目条件<T extends object>(客户: T, 条件: Prisma.CustomerWhereInput | null): T {
  挂着的.set(客户, 条件);
  return 客户;
}
export function 仅项目条件of(客户: object | null | undefined): Prisma.CustomerWhereInput | null {
  return 客户 ? 挂着的.get(客户) ?? null : null;
}
