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
import { 同事项目几个话 } from "@/lib/carry-over";

type 客户 = { id: string; salesOwnerId: string };

/** 这批客户里，名下有同事负责、还没结束的项目的那几位（客户 id）。看全部：同事的项目调用方本来就看不到 */
export async function 有同事在推的客户(db: Pick<Prisma.TransactionClient, "project">, 们: readonly 客户[]): Promise<Set<string>> {
  return new Set((await 同事在推项目(db, 们)).keys());
}

type 同事项目 = { ownerId: string };

/** 客户 id → 名下同事负责、还没结束的项目。挡放公海的提示只要个数，其余只看有没有 */
async function 同事在推项目(db: Pick<Prisma.TransactionClient, "project">, 们: readonly 客户[]): Promise<Map<string, 同事项目[]>> {
  const 主 = new Map(们.map((c) => [c.id, c.salesOwnerId]));
  const 有 = new Map<string, 同事项目[]>();
  const ids = [...主.keys()];
  for (let i = 0; i < ids.length; i += 500) {
    const 项目 = await 看全部(() =>
      db.project.findMany({ where: { customerId: { in: ids.slice(i, i + 500) }, ...在推项目条件 }, select: { customerId: true, ownerId: true } }),
    );
    for (const p of 项目) if (p.ownerId && p.ownerId !== 主.get(p.customerId)) 有.set(p.customerId, [...(有.get(p.customerId) ?? []), p]);
  }
  return 有;
}

/**
 * 放公海被拦时说拦住的同事项目（P-看-12 例外、M-公海-02，Even C4 推翻用户 11-09「写名字」）：只写个数，不写项目名和负责人。
 * 一位：「有 2 个同事在推的项目」；多位：「客户A」有 2 个同事在推的项目；「客户B」有 1 个…，没有的客户不列。句子见 同事项目几个话
 */
export async function 同事在推项目说法(db: Pick<Prisma.TransactionClient, "project">, 们: readonly (客户 & { name: string })[], 带客户名 = 们.length > 1): Promise<string> {
  const 有 = await 同事在推项目(db, 们);
  return 们
    .filter((c) => 有.get(c.id)?.length)
    .map((c) => `${带客户名 ? `「${c.name}」` : ""}${同事项目几个话(有.get(c.id)!.length)}`)
    .join("；");
}

/** P-删-05 挡删的话：一位说名字，多位说几位 */
export function 同事在推不能删话(名: string[], 客户叫法 = "客户"): string {
  return 名.length === 1
    ? `「${名[0]}」名下有同事负责、还没结束的项目，先转走或让负责人删`
    : `${名.length} 位${客户叫法}名下有同事负责、还没结束的项目，整批已阻止。先转走或让负责人删`;
}

/** P-公海-06 挡放进公海的话；项目 = 同事在推项目说法（拦住的同事项目个数） */
export function 同事在推不能放公海话(名: string[], 客户叫法 = "客户", 项目 = ""): string {
  if (名.length === 1) return `「${名[0]}」名下${项目 || "有同事负责、还没结束的项目"}，先转走或结束再放进公海`;
  return `${名.length} 位${客户叫法}名下有同事负责、还没结束的项目${项目 ? `：${项目}` : ""}，先转走或结束再放进公海`;
}

/** 放公海被拦的订单项目怎么说（P-看-12 例外）：点的人自己负责的写名字（最多 3 个，再多说「等 N 个」），别人负责的只给个数（同事项目几个话） */
export function 订单项目说法(们: readonly { name: string; ownerId: string }[], 我: string): string {
  const 我的 = 们.filter((p) => p.ownerId === 我).map((p) => `「${p.name}」`);
  const 别人 = 们.length - 我的.length;
  return [
    我的.length ? `${我的.slice(0, 3).join("")}${我的.length > 3 ? ` 等 ${我的.length} 个` : ""}` : "",
    别人 ? `${我的.length ? "另外" : ""}${同事项目几个话(别人)}` : "",
  ].filter(Boolean).join("；");
}
