import { cache } from "react";
import { 看得到的客户 } from "./db";

/** 这一次请求里问过的客户看不看得到（React cache：一次请求一份；测试里直通就是每次新表，照样对） */
const 本次可见客户 = cache(() => new Map<string, Promise<boolean>>());

/**
 * 页面渲染用的 看得到的客户（11-12 客户详情速度：客户页 + 项目区为同一位客户问了 6 遍，每遍一句）：同一次请求里同一位只查一次，
 * 一起问的几位合成一句。只走默认的带限定 prisma；事务里、写完要重新判的照旧用 看得到的客户。
 * 放在 db.ts 外面：调的是 db 模块导出的 看得到的客户（用例按模块换掉它时这里也跟着换）
 */
export async function 页面看得到的客户(customerIds: readonly string[]): Promise<Set<string>> {
  const 表 = 本次可见客户();
  const 缺 = [...new Set(customerIds)].filter((id) => !表.has(id));
  if (缺.length) {
    const 查 = 看得到的客户(缺);
    查.catch(() => undefined);
    for (const id of 缺) 表.set(id, 查.then((见) => 见.has(id)));
  }
  const 结果 = await Promise.all(customerIds.map(async (id) => [id, await 表.get(id)!] as const));
  return new Set(结果.filter(([, 见]) => 见).map(([id]) => id));
}
