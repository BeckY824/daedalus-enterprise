/**
 * 一位客户下挂着同事负责的项目（企业版，V3.5.1 X-05「一位客户多个项目分属不同人」，11-05）：
 *   - P-删-05：同事负责、还没结束的项目挡住删客户（系统管理员除外）；结束了的跟着客户进回收站
 *   - P-公海-06 / M-公海-02 例外二：同事负责、还没结束的项目挡住客户进公海（放进公海、项目退回带客户、超时回收都算）
 * 「还没结束」照 在推项目条件（没结局、不在项目公海），不另起一套。
 * 「同事」= 负责人不是客户负责人；项目公海里没负责人（空串）的不算。Prisma 比不了两列，取出来在内存里比
 */
import type { Prisma } from "@/generated/prisma";
import { 在推项目条件 } from "@/lib/project/active";
import { 看全部 } from "@/lib/team-scope";

type 客户 = { id: string; salesOwnerId: string };

/** 这批客户里，名下有同事负责、还没结束的项目的那几位（客户 id）。看全部：同事的项目调用方本来就看不到 */
export async function 有同事在推的客户(db: Pick<Prisma.TransactionClient, "project">, 们: readonly 客户[]): Promise<Set<string>> {
  const 主 = new Map(们.map((c) => [c.id, c.salesOwnerId]));
  const 有 = new Set<string>();
  const ids = [...主.keys()];
  for (let i = 0; i < ids.length; i += 500) {
    const 项目 = await 看全部(() =>
      db.project.findMany({ where: { customerId: { in: ids.slice(i, i + 500) }, ...在推项目条件 }, select: { customerId: true, ownerId: true } }),
    );
    for (const p of 项目) if (p.ownerId && p.ownerId !== 主.get(p.customerId)) 有.add(p.customerId);
  }
  return 有;
}

/** P-删-05 挡删的话：一位说名字，多位说几位 */
export function 同事在推不能删话(名: string[], 客户叫法 = "客户"): string {
  return 名.length === 1
    ? `「${名[0]}」名下有同事负责、还没结束的项目，先转走或让负责人删`
    : `${名.length} 位${客户叫法}名下有同事负责、还没结束的项目，整批已阻止。先转走或让负责人删`;
}

/** P-公海-06 挡放进公海的话 */
export function 同事在推不能放公海话(名: string[], 客户叫法 = "客户"): string {
  return 名.length === 1
    ? `「${名[0]}」名下有同事负责、还没结束的项目，先转走或结束再放进公海`
    : `${名.length} 位${客户叫法}名下有同事负责、还没结束的项目，先转走或结束再放进公海`;
}
