/**
 * 项目换负责人时原负责人的待办（企业版，11-01 C-06：「交给新负责人时，增加一个负责人选项，可以手动关掉」）。
 * 三个入口都在同一笔事务里、换完负责人以后调 换负责人待办，返回碰了几条，调用方写进这次换人的留痕（待办痕）：
 *   - 转让（改项目 换负责人、分配线索 指给别人）：原负责人在这个项目上没做完的待办——勾着改给新负责人，不勾关掉（转让关待办尾）；
 *   - 出公海（领取、分配，含跟着客户一起领出来的项目）：最近一次进公海时 进公海关待办 关掉的那一批——勾着重新打开给新负责人，不勾照旧关着。
 * 那一批怎么认：最近一条 pool-release 的 fromOwnerId（原负责人）+ at（进公海那一刻，放回 / 超时回收把 pooledAt 同一刻写进留痕和 doneAt），
 * 再加标题结尾 进公海关待办尾。关哪些在进公海那一刻定（进公海关待办），这里不重算：领取时他的项目、客户归属都可能变了。
 * 同一刻进公海的几个项目（超时回收一次扫的、客户整包）是同一批：标题只点了别的项目名的留给那个项目，没点名的、同时点了这个项目的谁先出公海谁带走。
 * 已经做完的待办（doneAt 对不上、标题没那句尾巴）不会被重新打开。
 * 开关在 lib/enterprise/pool-rules.ts（换负责人带待办、带待办默认勾）；不是企业版、开关关着、调用方没传勾都不碰。
 * 没传勾的有两种：自动分配；市场首次分给销售（X-18，手动、自动都算，分项目给 不看弹窗的勾，待办、计划还归原负责人，P-转-10）
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 公海规则, 进公海关待办尾, 转让关待办尾 } from "@/lib/enterprise/pool-rules";
import { 看全部 } from "@/lib/team-scope";
import { 撞号提醒尾 } from "@/lib/enterprise/contact-format";

/** 界面上出不出「待办一起转」这个勾 */
export function 换人带待办开着(): boolean {
  return 企业版() && 公海规则.换负责人带待办;
}

/** 入口收到的勾：true / false 照用，没传（老界面）按默认勾 */
export function 带待办勾(v: unknown): boolean {
  return typeof v === "boolean" ? v : 公海规则.带待办默认勾;
}

/**
 * 换负责人后原负责人的待办怎么办（同一笔事务里调）。返回碰了几条；不碰（不是企业版、开关关着、没传勾）返回 null。
 * p.pooledAt 是换人之前的：有值 = 这次是出公海，按进公海那一批来；没有 = 转让
 */
export async function 换负责人待办(
  tx: Prisma.TransactionClient,
  p: { id: string; customerId: string; name: string; pooledAt: Date | null },
  原: string | null,
  新: string,
  带?: boolean,
  at: Date = new Date(),
): Promise<number | null> {
  if (带 === undefined || !换人带待办开着()) return null;
  if (p.pooledAt) return 带 ? 出公海带回待办(tx, p, 新) : 0;
  if (!原 || 原 === 新) return 0;
  return 转让带待办(tx, p, 原, 新, 带, at);
}

/** 写进换人那行留痕的一句（带了 / 关了几条）；不碰待办返回 null */
export function 待办痕(带: boolean | undefined, 几条: number | null): string | null {
  if (几条 === null || 带 === undefined) return null;
  if (带) return `原负责人没做完的待办带过来 ${几条} 条`;
  return 几条 ? `原负责人没做完的待办没带，关掉 ${几条} 条` : "原负责人没做完的待办没带";
}

/**
 * 市场首次分给销售（X-18）时跟着客户走的项目，转让痕的 reason 记这一句。
 * 这些项目不写分配记录（不占额度），「我分出去的」（lead-assign.ts）靠这一句认；项目详情的换人记录里也原样淡色显示
 */
export const 随客户痕 = "随客户转走";

/** 留痕原来的说明后面接上 待办痕 */
export function 接上待办痕(reason: string | null, 痕: string | null): string | null {
  return [reason, 痕].filter(Boolean).join("；") || null;
}

/**
 * 出公海：把最近一次进公海时关掉的那一批重新打开、交给新负责人，标题去掉 进公海关待办尾，到期日、内容不动。
 * 同一刻一起进公海的别的项目，标题点了它们名字、又没点这个项目的不带。返回几条
 */
async function 出公海带回待办(tx: Prisma.TransactionClient, p: { id: string; customerId: string; name: string }, 新: string): Promise<number> {
  return 看全部(async () => {
    const 放 = await tx.projectNodeLog.findFirst({
      where: { projectId: p.id, kind: "pool-release" },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { at: true, fromOwnerId: true },
    });
    if (!放?.fromOwnerId) return 0;
    const 同刻 = await tx.projectNodeLog.findMany({
      where: { kind: "pool-release", at: 放.at, fromOwnerId: 放.fromOwnerId, projectId: { not: p.id }, project: { customerId: p.customerId } },
      select: { project: { select: { name: true } } },
    });
    const 别的点名 = 同刻.filter((l) => l.project.name !== p.name).map((l) => `「${l.project.name}」`);
    const 一批 = await tx.task.findMany({
      where: { customerId: p.customerId, ownerId: 放.fromOwnerId, done: true, doneAt: 放.at, title: { endsWith: 进公海关待办尾 } },
      select: { id: true, title: true },
    });
    const 们 = 一批.filter((t) => t.title.includes(`「${p.name}」`) || !别的点名.some((名) => t.title.includes(名)));
    for (const t of 们) {
      await tx.task.update({ where: { id: t.id }, data: { done: false, doneAt: null, ownerId: 新, title: t.title.slice(0, -进公海关待办尾.length) } });
    }
    return 们.length;
  });
}

/**
 * 转让：原负责人在这个项目上没做完的待办。认法同 进公海关待办（待办挂客户、不挂项目）：
 * 客户不归他（或在公海里）、他在这位客户下也没有别的项目 → 他在这位客户上没做完的都算；
 * 不然（客户还归他、或他还管着这位客户别的项目）只算标题里点了这个项目名的（「项目名」）。
 * 带：改给新负责人，别的不动；不带：标成已完成、标题接 转让关待办尾。返回几条
 */
async function 转让带待办(
  tx: Prisma.TransactionClient,
  p: { id: string; customerId: string; name: string },
  原: string, 新: string, 带: boolean, at: Date,
): Promise<number> {
  return 看全部(async () => {
    const c = await tx.customer.findUnique({ where: { id: p.customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
    const 别的项目 = await tx.project.count({ where: { customerId: p.customerId, ownerId: 原, id: { not: p.id } } });
    const 全算 = (!c || !!c.pool || c.salesOwnerId !== 原) && !别的项目;
    const 们 = await tx.task.findMany({
      // AI 建档撞号的提醒是给原负责人本人的，转让时不带也不关（同 carry-over-db 带走一位）
      where: { customerId: p.customerId, ownerId: 原, done: false, NOT: { title: { endsWith: 撞号提醒尾 } }, ...(全算 ? {} : { title: { contains: `「${p.name}」` } }) },
      select: { id: true, title: true },
    });
    if (!们.length) return 0;
    if (带) {
      await tx.task.updateMany({ where: { id: { in: 们.map((t) => t.id) } }, data: { ownerId: 新 } });
      return 们.length;
    }
    for (const t of 们) {
      await tx.task.update({
        where: { id: t.id },
        data: { done: true, doneAt: at, ...(t.title.endsWith(转让关待办尾) ? {} : { title: `${t.title}${转让关待办尾}` }) },
      });
    }
    return 们.length;
  });
}
