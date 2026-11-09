import { prisma, defaultClient } from "@/lib/prisma";
import { 限定的我 } from "@/lib/team-scope";
import { 缓存着 } from "@/lib/home-cache";
import { 未完成轻列表, 取详情 } from "@/lib/plans-page";
import { 看得到的客户 } from "@/lib/project/db";
import { 市场进不了详情的 } from "@/lib/enterprise/market-view-db";
import { dayjs } from "@/lib/utils";
import type { 组 } from "@/lib/plans-groups";
import {
  挑一页, 挑看板, 复盘待办每页, 看板列们, 看板每列,
  type 复盘待办, type 复盘待办行, type 复盘看板, type 看板列, type 待办卡,
} from "./board-todos";

/**
 * 复盘页「待办」页签取数（P15）。查询全走带限定的 prisma：业务员看不到别人客户上的事项，和「数据」页签同一层限定；
 * 只看 再按负责人筛：一个人的 id，或 看板的人 给的 谁（一组人；业务员强制成本人、上级是自己 + 下属）——
 * 这一层是服务端兜底，不靠「按组织看客户」开着。
 * 不限定时轻列表走计划页同一个短时缓存（同一个键），30 人同时开复盘页不各查一遍。
 * 分页在服务端：轻列表上挑出当页的 20 条（挑一页），只取这 20 条的详情和它们客户的进行中项目。
 */
/**
 * 只要四张卡的条数时（首页「今日待办」卡）：同一份轻列表、同一层限定、同一个 挑一页，
 * 所以首页卡上的数 = 点进 /overview?f=today（或 f=overdue）列出来的条数。不取详情
 */
export async function 复盘待办计数(只看?: string | readonly string[], now: ReturnType<typeof dayjs> = dayjs()): Promise<复盘待办["计数"]> {
  const 共用 = (await 限定的我(defaultClient)) ? undefined : 缓存着;
  return 挑一页(await 未完成轻列表(prisma, 共用), { 只看, now }).计数;
}

export async function 复盘待办of(
  只看?: string | readonly string[],
  q: { 卡?: 待办卡; 页?: number; now?: ReturnType<typeof dayjs>; 每页?: number; 我id?: string } = {},
): Promise<复盘待办> {
  const 共用 = (await 限定的我(defaultClient)) ? undefined : 缓存着;
  const 全部 = await 未完成轻列表(prisma, 共用);
  const { 计数, 总数, 页, 要 } = 挑一页(全部, { 只看, 卡: q.卡, 页: q.页, now: q.now ?? dayjs(), 每页: q.每页 ?? 复盘待办每页 });
  return { 计数, 总数, 页, 行: await 补详情(要, q.我id) };
}

/** 「全部待办」的三列看板（挑看板）：同一份轻列表、同一层限定，三列各取前几条的详情，一次查 */
export async function 复盘看板of(
  只看?: string | readonly string[],
  q: { now?: ReturnType<typeof dayjs>; 每列?: number; 我id?: string } = {},
): Promise<复盘看板> {
  const 共用 = (await 限定的我(defaultClient)) ? undefined : 缓存着;
  const 全部 = await 未完成轻列表(prisma, 共用);
  const { 计数, 列 } = 挑看板(全部, { 只看, now: q.now ?? dayjs(), 每列: q.每列 ?? 看板每列 });
  const 行们 = await 补详情(看板列们.flatMap((k) => 列[k].要), q.我id);
  const 按键 = new Map(行们.map((r) => [r.key, r]));
  const 摆 = (k: 看板列) => ({ 总数: 列[k].总数, 行: 列[k].要.flatMap((x) => (按键.has(x.key) ? [按键.get(x.key)!] : [])) });
  return { 计数, 列: { overdue: 摆("overdue"), today: 摆("today"), later: 摆("later") } };
}

/** 挑出来的那几条取详情 + 客户的进行中项目（名字、级别、去哪）；顺序照 要 */
async function 补详情(要: readonly { key: string; 组: 组 }[], 我id?: string): Promise<复盘待办行[]> {
  if (!要.length) return [];
  const { plans, tasks } = await 取详情(prisma, 要.map((x) => x.key));
  const 客户们 = [...new Set([...plans.map((p) => p.customerId), ...tasks.map((t) => t.customerId)])];
  // Task / FollowPlan 不挂项目：客户有进行中的项目就带它的名字、点了去项目页；同一个客户几个都在进行的，取最近动过的那个
  const 项目们 = await prisma.project.findMany({
    where: { customerId: { in: 客户们 }, result: null },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, name: true, customerId: true, level: true },
  });
  const 项目of = new Map<string, { id: string; name: string; level: string | null }>();
  for (const p of 项目们) if (!项目of.has(p.customerId)) 项目of.set(p.customerId, p);
  // 没有进行中项目的去客户页，但客户详情不一定进得去（只负责项目的人、把客户分出去的市场，P-转-10）。
  // 进不去的退到自己看得到的最近一个项目（已结束的也算）；市场已分出去的项目详情也进不去（P-看-06）。都没有就不给去处，行上照样能勾完成
  const 进得去 = await 看得到的客户(客户们);
  const 进不去 = 客户们.filter((c) => !项目of.has(c) && !进得去.has(c));
  const 退路 = new Map<string, string>();
  if (进不去.length)
    for (const p of await prisma.project.findMany({
      where: { customerId: { in: 进不去 } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      select: { id: true, customerId: true },
    }))
      if (!退路.has(p.customerId)) 退路.set(p.customerId, p.id);
  const 项目id们 = [...[...项目of.values()].map((p) => p.id), ...退路.values()];
  const 市场挡 = 我id && 项目id们.length ? await 市场进不了详情的(我id, 项目id们) : new Set<string>();
  const 去处 = (customerId: string): string | null => {
    const 项目id = 项目of.get(customerId)?.id ?? 退路.get(customerId);
    if (项目id && !市场挡.has(项目id)) return `/projects/${encodeURIComponent(项目id)}`;
    return 进得去.has(customerId) ? `/customers/${encodeURIComponent(customerId)}` : null;
  };
  const 挂 = (customerId: string) => {
    const p = 项目of.get(customerId);
    return { projectName: p?.name ?? null, projectLevel: p?.level || null, 去: 去处(customerId) };
  };

  const 详 = new Map<string, Omit<复盘待办行, "组">>();
  for (const p of plans)
    详.set(`plan:${p.id}`, {
      key: `plan:${p.id}`, kind: "plan", id: p.id, 时间: p.plannedAt, 明确钟点: p.plannedHasTime, 内容: p.subject,
      customerId: p.customerId, customerName: p.customerName, ownerId: p.ownerId, ownerName: p.ownerName, ...挂(p.customerId),
    });
  for (const t of tasks)
    详.set(`task:${t.id}`, {
      key: `task:${t.id}`, kind: "task", id: t.id, 时间: t.dueAt, 明确钟点: t.dueHasTime, 内容: t.title,
      customerId: t.customerId, customerName: t.customerName, ownerId: t.ownerId, ownerName: t.ownerName, ...挂(t.customerId),
    });
  // 轻列表和详情之间有人完成了的：详情里没有，跳过（条数是轻列表那一刻的）
  return 要.flatMap((x) => {
    const d = 详.get(x.key);
    return d ? [{ ...d, 组: x.组 }] : [];
  });
}
