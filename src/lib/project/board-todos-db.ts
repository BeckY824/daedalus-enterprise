import { prisma, defaultClient } from "@/lib/prisma";
import { 限定的我 } from "@/lib/team-scope";
import { 缓存着 } from "@/lib/home-cache";
import { 未完成轻列表, 取详情 } from "@/lib/plans-page";
import { dayjs } from "@/lib/utils";
import { 挑一页, 复盘待办每页, type 复盘待办, type 复盘待办行, type 待办卡, type 待办类型 } from "./board-todos";

/**
 * 复盘页「待办」页签取数（P15）。查询全走带限定的 prisma：业务员看不到别人客户上的事项，和「数据」页签同一层限定；
 * 只看 再按负责人筛（业务员由 看板的人 强制成本人）。
 * 不限定时轻列表走计划页同一个短时缓存（同一个键），30 人同时开复盘页不各查一遍。
 * 分页在服务端：轻列表上挑出当页的 20 条（挑一页），只取这 20 条的详情和它们客户的进行中项目。
 */
/**
 * 只要四张卡的条数时（首页「今日待办」卡）：同一份轻列表、同一层限定、同一个 挑一页，
 * 所以首页卡上的数 = 点进 /overview?f=today（或 f=overdue）列出来的条数。不取详情
 */
export async function 复盘待办计数(只看?: string, now: ReturnType<typeof dayjs> = dayjs()): Promise<复盘待办["计数"]> {
  const 共用 = (await 限定的我(defaultClient)) ? undefined : 缓存着;
  return 挑一页(await 未完成轻列表(prisma, 共用), { 只看, now }).计数;
}

export async function 复盘待办of(
  只看?: string,
  q: { 类型?: 待办类型; 卡?: 待办卡; 页?: number; now?: ReturnType<typeof dayjs>; 每页?: number } = {},
): Promise<复盘待办> {
  const 共用 = (await 限定的我(defaultClient)) ? undefined : 缓存着;
  const 全部 = await 未完成轻列表(prisma, 共用);
  const { 计数, 总数, 页, 要 } = 挑一页(全部, { 只看, 类型: q.类型, 卡: q.卡, 页: q.页, now: q.now ?? dayjs(), 每页: q.每页 ?? 复盘待办每页 });
  if (!要.length) return { 计数, 总数, 页, 行: [] };

  const { plans, tasks } = await 取详情(prisma, 要.map((x) => x.key));
  const 客户们 = [...new Set([...plans.map((p) => p.customerId), ...tasks.map((t) => t.customerId)])];
  // Task / FollowPlan 不挂项目：客户有进行中的项目就带它的名字、点了去项目页；同一个客户几个都在进行的，取最近动过的那个
  const 项目们 = await prisma.project.findMany({
    where: { customerId: { in: 客户们 }, result: null },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, name: true, customerId: true },
  });
  const 项目of = new Map<string, { id: string; name: string }>();
  for (const p of 项目们) if (!项目of.has(p.customerId)) 项目of.set(p.customerId, p);
  const 挂 = (customerId: string) => {
    const p = 项目of.get(customerId);
    return {
      projectName: p?.name ?? null,
      去: p ? `/projects/${encodeURIComponent(p.id)}` : `/customers/${encodeURIComponent(customerId)}`,
    };
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
  const 行 = 要.flatMap((x) => {
    const d = 详.get(x.key);
    return d ? [{ ...d, 组: x.组 }] : [];
  });
  return { 计数, 总数, 页, 行 };
}
