/**
 * 企业版项目合并（合并客户第二批 2a）· 合并之后 30 天内的保护：别的入口问这里，项目在不在一张没撤回、没过期的项目合并单里。
 *
 * 单独一个小文件，只引 Prisma 类型：改节点（lib/project/db.ts）、线索验证、项目换客户都引它，不能把合并本身那一大串依赖带进去（会成环）。
 *   - 被并掉的项目：重启、改结局、线索验证改判、换客户都拦，提示「已并入 → 留下的项目，要动先撤回合并」
 *   - 留下的项目：只拦换客户（换走了两个项目就不在同一位客户名下，撤回时沟通会回到另一位客户的项目上）
 * 过了 30 天不能撤，也就不再拦（规划「合并之后 30 天内的保护」，我方定）。不是企业版一律不拦
 */
import type { Prisma } from "@/generated/prisma";
import { 企业版 } from "./switch";
import { 回收站保留天数 } from "./soft-delete-core";

/** 合并单 kind：项目合并（同一张 EntCustomerMerge，fromId / intoId 是项目 id） */
export const 项目单 = "项目";
/** 项目合并单撤回期限（天）：同客户合并 */
export const 项目合并撤回天数 = 回收站保留天数;

type 读单 = Pick<Prisma.TransactionClient, "entCustomerMerge">;
export type 在合并单里 = { mergeId: string; 被并: string; 留下: string; 留下名: string; 被并名: string; at: Date };

const 期限起 = (现在: Date) => new Date(现在.getTime() - 项目合并撤回天数 * 86_400_000);

function 留下名of(detail: string): string {
  try {
    const v = (JSON.parse(detail) as { 留下名?: unknown }).留下名;
    return typeof v === "string" ? v : "";
  } catch { return ""; }
}

/**
 * 这几个项目所在的、没撤回、没过 30 天的项目合并单（被并的或留下的都算），按项目 id 分：
 * 一个项目同时是一张单的留下、另一张的被并时，被并那张优先（被并掉的拦得更多）
 */
export async function 项目合并单们(db: 读单, projectIds: readonly string[], 现在: Date = new Date()): Promise<Map<string, 在合并单里 & { 我是: "被并" | "留下" }>> {
  const 出 = new Map<string, 在合并单里 & { 我是: "被并" | "留下" }>();
  if (!企业版() || !projectIds.length) return 出;
  const ids = [...new Set(projectIds)];
  const 们 = await db.entCustomerMerge.findMany({
    where: { kind: 项目单, status: "已合并", at: { gte: 期限起(现在) }, OR: [{ fromId: { in: ids } }, { intoId: { in: ids } }] },
    orderBy: { at: "desc" },
    select: { id: true, fromId: true, intoId: true, fromName: true, detail: true, at: true },
  });
  for (const m of 们) {
    const 单 = { mergeId: m.id, 被并: m.fromId, 留下: m.intoId, 留下名: 留下名of(m.detail), 被并名: m.fromName, at: m.at };
    if (ids.includes(m.fromId)) 出.set(m.fromId, { ...单, 我是: "被并" });
    if (ids.includes(m.intoId) && 出.get(m.intoId)?.我是 !== "被并") 出.set(m.intoId, { ...单, 我是: "留下" });
  }
  return 出;
}

export const 已并入拦话 = (留下名: string) => `这个项目已并入${留下名 ? `「${留下名}」` : "另一个项目"}，要动先撤回合并`;
export const 留下换客户拦话 = (被并名: string) =>
  `${被并名 ? `「${被并名}」` : "另一个项目"}并进了这个项目，换客户前先撤回那次合并（换走了两个项目就不在同一位客户名下，撤回会对不上）`;

/** 被并掉的项目（30 天内）：重启、改结局、线索验证改判拦下的那句；不在单里 null */
export async function 被并项目拦(db: 读单, projectId: string, 现在: Date = new Date()): Promise<string | null> {
  const 单 = (await 项目合并单们(db, [projectId], 现在)).get(projectId);
  return 单?.我是 === "被并" ? 已并入拦话(单.留下名) : null;
}

/** 项目换客户：被并掉的、留下的（30 天内）都拦；不在单里 null */
export async function 换客户合并拦(db: 读单, projectId: string, 现在: Date = new Date()): Promise<string | null> {
  const 单 = (await 项目合并单们(db, [projectId], 现在)).get(projectId);
  if (!单) return null;
  return 单.我是 === "被并" ? 已并入拦话(单.留下名) : 留下换客户拦话(单.被并名);
}
