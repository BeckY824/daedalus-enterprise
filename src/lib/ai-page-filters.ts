/**
 * 客户页筛选的协议白名单。只收条件，不接受SQL、权限或任意Prisma表达式。
 * phase / node（11-12 第 3 批「全部阶段」「全部进程」）：名下有一个我能看的、不在公海的项目在这个阶段 / 进程上的客户，和页面同一句（customers/query.ts 项目筛选条件，按 userId 认人）
 */
export const 客户页面筛选键 = ["keyword", "grade", "followStatus", "decisionStatus", "salesOwnerId", "channelOwnerId", "createdWithin", "directOf", "batch", "pool", "country", "source", "level", "dept", "custStatus", "customerType", "channelId", "phase", "node"] as const;
export type 页面客户筛选 = Partial<Record<(typeof 客户页面筛选键)[number], string>>;
export function 收客户页面筛选(value: unknown): 页面客户筛选 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: 页面客户筛选 = {};
  for (const [key, val] of Object.entries(value)) {
    if (!(客户页面筛选键 as readonly string[]).includes(key) || typeof val !== "string" || val.length > 200) return null;
    const text = val.trim();
    if (text) result[key as keyof 页面客户筛选] = text;
  }
  return result;
}
