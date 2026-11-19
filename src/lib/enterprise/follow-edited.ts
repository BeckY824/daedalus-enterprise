/**
 * 企业版沟通「已修改」小字（11-19 记录人 30 分钟内能改）：哪几条沟通改过 = 操作日志里有这条的「改了沟通」（entity FollowUp、action update）。
 * 留痕只在 saveFollowUp 改了格子、改项目沟通 跟着改了下一步时写（一格没变不写），所以有痕就是真改过。
 * 只认这次起的新格式（summary 以「改了沟通」开头，或 detail 里有 "改了" 那一格）：老格式「修改…跟进」那种不算，
 * 免得上线后历史上改过的沟通一片「已修改」。一页一句，走 AuditLog (entity, entityId) 索引；不是企业版调用方别调
 */
import { defaultClient } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";

export async function 改过的沟通们(ids: readonly string[]): Promise<Set<string>> {
  return (await 沟通留痕们(ids, null)).改过的;
}

/**
 * 项目详情一页一句（客户详情查询条数有上限）：改过的沟通们 + 顺带问 看下一步id 那条写没写过下一步（写过下一步 同口径）。
 * 看下一步id 空 = 不问
 */
export async function 沟通留痕们(ids: readonly string[], 看下一步id: string | null): Promise<{ 改过的: Set<string>; 写过下一步: boolean }> {
  if (!ids.length && !看下一步id) return { 改过的: new Set(), 写过下一步: false };
  const 改过 = { action: "update", entityId: { in: [...ids] }, OR: [{ summary: { startsWith: "改了沟通" } }, { detail: { contains: '"改了":' } }] };
  const rows = await 看全部(() => defaultClient.auditLog.findMany({
    where: { entity: "FollowUp", ...(看下一步id ? { OR: [改过, { action: "create", entityId: 看下一步id, detail: { contains: '"写了下一步":true' } }] } : 改过) },
    distinct: ["entityId", "action"],
    select: { entityId: true, action: true },
  }));
  return {
    改过的: new Set(rows.flatMap((r) => (r.action === "update" && r.entityId ? [r.entityId] : []))),
    写过下一步: rows.some((r) => r.action === "create" && r.entityId === 看下一步id),
  };
}

/** 记项目沟通 写了下一步时，那条「记了一条沟通」日志 detail 里带的标记（下一步跟着改of 认它，审核中-1） */
export const 写了下一步标记 = { 写了下一步: true } as const;

/** 这条沟通记的时候写过项目上的下一步没有（按 写了下一步标记 认；标记之前记的、别的入口记的一律算没写过） */
export async function 写过下一步(followUpId: string): Promise<boolean> {
  return (await 看全部(() => defaultClient.auditLog.count({ where: { entity: "FollowUp", action: "create", entityId: followUpId, detail: { contains: '"写了下一步":true' } } }))) > 0;
}
