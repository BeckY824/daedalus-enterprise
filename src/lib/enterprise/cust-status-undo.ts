/**
 * 撤销出 / 进公海时客户状态按原样回滚（P-撤销-01；B37「随领取和项目变动自然落库」；复审 11-25）。
 *
 * 原值存在服务端、记在这一下已经写的留痕上，撤销只认留痕，不认浏览器带回来的（带回来的能被改，等于绕过「客户状态不能手改」）：
 *   - 出客户公海（领取 / 分配客户公海、分项目时客户整包出公海）：CustomerClaim.prevCustStatus
 *   - 出线索公海（领取 / 分配公海项目、领客户带出、批量改负责人带出）：那一行 pool-claim 的 ProjectNodeLog.prevCustStatus
 *   - 手动放进公海：CustomerPool.prevCustStatus
 * 存法：NULL = 没记（老留痕、别的路写的），撤销照旧按项目重算；"" = 动手前是空；其余 = 原值。
 *
 * 写回只在「这位客户这次的都撤完了」时做：撤了一半（有项目撤不成、前端少带了几个、刚才另一下出公海还没撤）照旧按重算，
 * 不然客户名下还有项目在外面，状态却写回了没出公海时的样子。
 */
import type { Prisma } from "@/generated/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 撤销时限毫秒 } from "@/lib/owner-log-db";
import { 企业版 } from "./switch";

type 库 = Prisma.TransactionClient;

/** 一批最多几位（SQLite IN 参数别太长） */
const 一批 = 500;

/** 存进留痕：动手前是空（null）存成 ""，NULL 留给「没记」 */
export const 存原状态 = (v: string | null | undefined): string => v ?? "";

/** 从留痕读：NULL = 没记（回 undefined），"" = 动手前是空（回 null） */
export const 读原状态 = (v: string | null | undefined): string | null | undefined => (v == null ? undefined : v || null);

const 去重 = (ids: Iterable<string | null | undefined>) => [...new Set([...ids].filter((x): x is string => !!x))];

/** 这几位客户名下的项目 id（含软删的）：查留痕先落到项目上，走 ProjectNodeLog 的 [projectId, at] 索引，不按 kind 扫全部 pool-claim */
async function 客户的项目们(db: 库, customerIds: string[]): Promise<string[]> {
  return (await db.project.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } })).map((p) => p.id);
}

/** 动手前：这几位客户现在存的状态。不是企业版回空表（不记、不写回） */
export async function 读客户状态(db: 库, customerIds: Iterable<string | null | undefined>): Promise<Map<string, string | null>> {
  const 出 = new Map<string, string | null>();
  const ids = 去重(customerIds);
  if (!企业版() || !ids.length) return 出;
  await 看全部(async () => {
    for (let i = 0; i < ids.length; i += 一批) {
      for (const c of await db.customer.findMany({ where: { id: { in: ids.slice(i, i + 一批) } }, select: { id: true, custStatus: true } })) 出.set(c.id, c.custStatus);
    }
  });
  return 出;
}

/** 动手前：这几个项目的客户（项目级领 / 分要先读客户的原值） */
export async function 项目的客户们(db: 库, projectIds: Iterable<string | null | undefined>): Promise<string[]> {
  const ids = 去重(projectIds);
  if (!企业版() || !ids.length) return [];
  return 看全部(async () => {
    const 出: string[] = [];
    for (let i = 0; i < ids.length; i += 一批) {
      for (const p of await db.project.findMany({ where: { id: { in: ids.slice(i, i + 一批) } }, select: { customerId: true } })) 出.push(p.customerId);
    }
    return 去重(出);
  });
}

/**
 * 动手后、同一笔事务末尾：动手前的值记到这一下写的出公海留痕上——起 之后写的 CustomerClaim、这几位客户名下 起 之后写的 pool-claim。
 * 出线索公海的底层帮手好几处（带走公海项目、客户整包出公海、领一个公海项目……），不一处处传原值，入口事务末尾记一次。
 * 嵌套（公海客户出手 里又调 在事务里领公海项目们）时外层最后记、读得最早，以外层为准
 */
export async function 原状态记到出公海痕(db: 库, 原: Map<string, string | null>, 起: Date): Promise<void> {
  if (!企业版() || !原.size) return;
  // 同一个原值的并成一条 updateMany
  const 按值 = new Map<string, string[]>();
  for (const [id, v] of 原) 按值.set(存原状态(v), [...(按值.get(存原状态(v)) ?? []), id]);
  await 看全部(async () => {
    for (const [值, ids] of 按值) {
      for (let i = 0; i < ids.length; i += 一批) {
        const 段 = ids.slice(i, i + 一批);
        await db.customerClaim.updateMany({ where: { customerId: { in: 段 }, at: { gte: 起 } }, data: { prevCustStatus: 值 } });
        const 项目们 = await 客户的项目们(db, 段);
        for (let j = 0; j < 项目们.length; j += 一批) {
          await db.projectNodeLog.updateMany({ where: { projectId: { in: 项目们.slice(j, j + 一批) }, kind: "pool-claim", at: { gte: 起 } }, data: { prevCustStatus: 值 } });
        }
      }
    }
  });
}

/**
 * 撤销前（撤回项目公海 会删掉那一行）：这几个项目各自最近一条 pool-claim 上记的原值，取最早那条
 * （同一位客户先后几下出公海，最早那下之前的才是原样）。有一个不是记了原值的 pool-claim（老留痕、别的路领的）就回 undefined，按重算
 */
export async function 项目痕原状态(db: 库, projectIds: string[]): Promise<string | null | undefined> {
  if (!企业版() || !projectIds.length) return undefined;
  return 看全部(async () => {
    let 早: { at: Date; 值: string | null } | null = null;
    for (const projectId of projectIds) {
      const 痕 = await db.projectNodeLog.findFirst({ where: { projectId }, orderBy: [{ at: "desc" }, { id: "desc" }], select: { kind: true, at: true, prevCustStatus: true } });
      const 值 = 痕?.kind === "pool-claim" ? 读原状态(痕.prevCustStatus) : undefined;
      if (!痕 || 值 === undefined) return undefined;
      if (!早 || 痕.at < 早.at) 早 = { at: 痕.at, 值 };
    }
    return 早?.值;
  });
}

/**
 * 撤销后：这位客户还有没撤的出公海——撤销时限内、记了原值的 CustomerClaim / pool-claim 还在（撤成了的那几行撤销时已删）。
 * 有 = 这次只撤了一半：有项目撤不成、前端少带了几个、同一位客户刚才另一下出公海还没撤（客户行 + 项目行一起领，先撤的那一半）
 */
export async function 还有没撤的出公海(db: 库, customerId: string): Promise<boolean> {
  const 限 = new Date(Date.now() - 撤销时限毫秒);
  return 看全部(async () => {
    if (await db.customerClaim.findFirst({ where: { customerId, prevCustStatus: { not: null }, at: { gte: 限 } }, select: { customerId: true } })) return true;
    const 项目们 = await 客户的项目们(db, [customerId]);
    for (let i = 0; i < 项目们.length; i += 一批) {
      if (await db.projectNodeLog.findFirst({ where: { projectId: { in: 项目们.slice(i, i + 一批) }, kind: "pool-claim", prevCustStatus: { not: null }, at: { gte: 限 } }, select: { id: true } })) return true;
    }
    return false;
  });
}

/**
 * 撤销出公海的最后一步（同一笔事务里、撤回项目公海 / 撤回补的潜客培育 之后）：读到了原值、这位客户这次的出公海都撤完了，原样写回，回 true。
 * 不是企业版、没读到（老留痕、导入撤回）、撤了一半回 false：调用方照旧按重算（撤回项目公海 里已经算过）
 */
export async function 写回出公海前状态(db: 库, customerId: string, 原: string | null | undefined): Promise<boolean> {
  if (!企业版() || 原 === undefined) return false;
  if (await 还有没撤的出公海(db, customerId)) return false;
  await db.customer.updateMany({ where: { id: customerId }, data: { custStatus: 原 } });
  return true;
}

/**
 * 撤销放进公海的最后一步（同一笔事务里、撤回连带项目 之后）：读到了原值、这一下跟着进线索公海的项目都还回来了，原样写回，回 true。
 * 起 = 这一下放进的时刻（CustomerPool.at，放进时和每行 pool-release 同一个时刻）。还有我那一下 pool-release 的项目留在公海里 = 撤了一半，按重算
 */
export async function 写回进公海前状态(db: 库, customerId: string, 原: string | null | undefined, 起: Date, 操作人: string): Promise<boolean> {
  if (!企业版() || 原 === undefined) return false;
  // 这位名下还在公海里的项目，有没有我这一下（起 之后）放的 pool-release 还留着
  const 在公海 = (await 看全部(() => db.project.findMany({ where: { customerId, pooledAt: { not: null } }, select: { id: true } }))).map((p) => p.id);
  for (let i = 0; i < 在公海.length; i += 一批) {
    const 剩 = await 看全部(() => db.projectNodeLog.findFirst({ where: { projectId: { in: 在公海.slice(i, i + 一批) }, kind: "pool-release", userId: 操作人, at: { gte: 起 } }, select: { id: true } }));
    if (剩) return false;
  }
  await db.customer.updateMany({ where: { id: customerId }, data: { custStatus: 原 } });
  return true;
}
