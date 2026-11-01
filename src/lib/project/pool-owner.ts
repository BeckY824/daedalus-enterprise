/**
 * 项目公海里的负责人（企业版，11-01 会议 C-01）：项目进公海就清空负责人，原负责人只记在留痕里。
 *   - 清空：Project.ownerId 是非空列、没有外键（迁移只能加不能改约束，见 migrations/README.md），所以写空串 = 没人负责；
 *   - 历史负责人 = 最后一次进公海前的负责人 = 最近一条 pool-release 的 fromOwnerId（放回、超时回收、离职放进公海都记这一行）；
 *   - 历史负责人领不回（pool-rules 原负责人能领回）、看不到（原负责人看得到公海项目），没做完的待办进公海时关掉。
 * 开关都在 lib/enterprise/pool-rules.ts；不是企业版 ownerId 照旧留着放回去的人，历史负责人照样按留痕认（两边一样）
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 公海规则, 进公海关待办尾 } from "@/lib/enterprise/pool-rules";
import { 看全部 } from "@/lib/team-scope";
import { 管全队客户 } from "@/lib/constants";

/** 项目在公海里时 ownerId 写这个 */
export const 公海无负责人 = "";

/** 企业版、且规则要进公海清负责人 */
export function 进公海清负责人(): boolean {
  return 企业版() && 公海规则.进公海清负责人;
}

/** 项目进公海时 ownerId 改成什么：清负责人就是空串，不然照旧留着原来那位 */
export function 进公海后负责人(原: string): string {
  return 进公海清负责人() ? 公海无负责人 : 原;
}

/** 企业版、且规则不让历史负责人看公海里的这个项目 */
export function 原负责人回避(): boolean {
  return 企业版() && !公海规则.原负责人看得到公海项目;
}

type 读痕 = Pick<Prisma.TransactionClient, "projectNodeLog">;

/** 几个项目各自的历史负责人（最近一条 pool-release 的 fromOwnerId）。没放回过的不在里面 */
export async function 历史负责人们(db: 读痕, projectIds: string[]): Promise<Map<string, string>> {
  const 们 = new Map<string, string>();
  if (!projectIds.length) return 们;
  const 行 = await 看全部(() => db.projectNodeLog.findMany({
    where: { projectId: { in: [...new Set(projectIds)] }, kind: "pool-release" },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { projectId: true, fromOwnerId: true },
  }));
  const 看过 = new Set<string>();
  for (const l of 行) {
    if (看过.has(l.projectId)) continue;
    看过.add(l.projectId);
    if (l.fromOwnerId) 们.set(l.projectId, l.fromOwnerId);
  }
  return 们;
}

/** 一个项目的历史负责人；没放回过 / 留痕没记人返回 null */
export async function 历史负责人(db: 读痕, projectId: string): Promise<string | null> {
  return (await 历史负责人们(db, [projectId])).get(projectId) ?? null;
}

/**
 * 现在在公海里、历史负责人是这几位之一的项目 id（只认最后一次进公海：放回过、后来被别人领走再放回的不算）。
 * 复盘按人数「退回公海」用（企业版负责人已清空，按 ownerId 数不到了）
 */
export async function 公海里历史负责人是(db: 读痕, 人们: readonly string[]): Promise<string[]> {
  if (!人们.length) return [];
  const 放过 = await 看全部(() => db.projectNodeLog.findMany({
    where: { kind: "pool-release", fromOwnerId: { in: [...人们] }, project: { pooledAt: { not: null }, deletedAt: null } },
    select: { projectId: true },
  }));
  if (!放过.length) return [];
  const 现 = await 历史负责人们(db, 放过.map((l) => l.projectId));
  const 是 = new Set(人们);
  return [...现].filter(([, uid]) => 是.has(uid)).map(([id]) => id);
}

/**
 * 现在在公海里、我是历史负责人的项目 id（原负责人回避开着才算，不然空）。列表、统一公海页用来把这些行剔掉
 */
export async function 我回避的公海项目(db: 读痕, meId: string): Promise<string[]> {
  if (!原负责人回避()) return [];
  return 公海里历史负责人是(db, [meId]);
}

/**
 * 项目刚进公海（同一笔事务里、单项目客户跟进公海 之后调）：原负责人在这个项目上没做完的待办标成已完成，记录留着。
 * 待办挂在客户上、不挂项目：客户也进了公海或客户本来就不归他 → 他在这位客户上没做完的都关；
 * 客户还归他（名下别的项目留着客户）→ 只关标题里点了这个项目名的（「项目名」，超时提醒、回收前一天提醒都是这样写的）。
 * 标题后面接一句 进公海关待办尾。返回关了几条
 */
export async function 进公海关待办(
  tx: Prisma.TransactionClient,
  p: { customerId: string; name: string },
  原: string,
  at: Date = new Date(),
): Promise<number> {
  if (!企业版() || !公海规则.进公海关原负责人待办 || !原) return 0;
  return 看全部(async () => {
    const c = await tx.customer.findUnique({ where: { id: p.customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
    const 全关 = !c || !!c.pool || c.salesOwnerId !== 原;
    const 们 = await tx.task.findMany({
      where: { customerId: p.customerId, ownerId: 原, done: false, ...(全关 ? {} : { title: { contains: `「${p.name}」` } }) },
      select: { id: true, title: true },
    });
    for (const t of 们) {
      await tx.task.update({
        where: { id: t.id },
        data: { done: true, doneAt: at, ...(t.title.endsWith(进公海关待办尾) ? {} : { title: `${t.title}${进公海关待办尾}` }) },
      });
    }
    return 们.length;
  });
}

/**
 * 这个项目在公海里、我是它的历史负责人、回避开着、我又不是老板 / 主管 → 挡（对它没有任何权限，C-01）。
 * 详情页、附件接口等按单个项目认权限的地方用；列表用 我回避的公海项目 一次剔
 */
export async function 原负责人挡着(db: 读痕, me: { id: string; role?: string | null }, p: { id: string; pooledAt?: Date | null }): Promise<boolean> {
  if (!p.pooledAt || !原负责人回避() || 管全队客户(me.role)) return false;
  return (await 历史负责人(db, p.id)) === me.id;
}
