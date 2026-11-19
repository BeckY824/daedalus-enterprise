/**
 * 企业版沟通「已修改」小字（11-19 记录人 30 分钟内能改）：哪几条沟通改过 = 操作日志里有这条的「改了沟通」（entity FollowUp、action update）。
 * 留痕只在 saveFollowUp 改了格子、改项目沟通 跟着改了下一步时写（一格没变不写），所以有痕就是真改过。
 * 一页一句，走 AuditLog (entity, entityId) 索引；不是企业版调用方别调
 */
import { defaultClient } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";

export async function 改过的沟通们(ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await 看全部(() => defaultClient.auditLog.findMany({
    where: { entity: "FollowUp", action: "update", entityId: { in: [...ids] } },
    distinct: ["entityId"],
    select: { entityId: true },
  }));
  return new Set(rows.flatMap((r) => (r.entityId ? [r.entityId] : [])));
}
