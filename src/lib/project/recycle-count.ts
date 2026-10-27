/**
 * 企业版项目公海「收回次数」（10-27 批注）：一个项目被收回公海几次。
 * 不另加字段，从留痕里数：放回公海、超时回收都记一行 kind = pool-release（db.ts 记转让）。
 * 项目页（客户端）也引这个文件拿筛选项，所以这里不引 prisma，查库的 db 由调用方传
 */
import type { Prisma } from "@/generated/prisma";

/** 列表筛选的取值：空 = 不筛；"3" = 3 次及以上 */
export const 收回次数筛们 = [
  { value: "", label: "收回次数不限" },
  { value: "0", label: "没收回过" },
  { value: "1", label: "收回 1 次" },
  { value: "2", label: "收回 2 次" },
  { value: "3", label: "收回 3 次及以上" },
] as const;

export const 收回次数筛 = (v: unknown): string => (typeof v === "string" && 收回次数筛们.some((o) => o.value === v) ? v : "");

/** 次数合不合筛选；筛 不认识或为空都算合 */
export function 合收回次数(n: number, 筛: string): boolean {
  if (!筛) return true;
  return 筛 === "3" ? n >= 3 : n === Number(筛);
}

/** 这些项目各被收回过几次（没收回过的不在表里，按 0 算） */
export async function 数收回次数(projectIds: string[], db: Pick<Prisma.TransactionClient, "projectNodeLog">): Promise<Map<string, number>> {
  const 次数 = new Map<string, number>();
  if (!projectIds.length) return 次数;
  const 行 = await db.projectNodeLog.findMany({ where: { projectId: { in: [...new Set(projectIds)] }, kind: "pool-release" }, select: { projectId: true } });
  for (const r of 行) 次数.set(r.projectId, (次数.get(r.projectId) ?? 0) + 1);
  return 次数;
}
