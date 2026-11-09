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
  return new Set((await 同事在推项目(db, 们)).keys());
}

type 同事项目 = { name: string; ownerId: string };

/** 客户 id → 名下同事负责、还没结束的项目（按建的先后）。只有挡放公海的提示要项目名，其余只看有没有 */
async function 同事在推项目(db: Pick<Prisma.TransactionClient, "project">, 们: readonly 客户[]): Promise<Map<string, 同事项目[]>> {
  const 主 = new Map(们.map((c) => [c.id, c.salesOwnerId]));
  const 有 = new Map<string, 同事项目[]>();
  const ids = [...主.keys()];
  for (let i = 0; i < ids.length; i += 500) {
    const 项目 = await 看全部(() =>
      db.project.findMany({ where: { customerId: { in: ids.slice(i, i + 500) }, ...在推项目条件 }, select: { customerId: true, ownerId: true, name: true }, orderBy: { createdAt: "asc" } }),
    );
    for (const p of 项目) if (p.ownerId && p.ownerId !== 主.get(p.customerId)) 有.set(p.customerId, [...(有.get(p.customerId) ?? []), p]);
  }
  return 有;
}

/**
 * 放公海被拦时写出拦住的同事项目和负责人（P-看-12 例外，11-09 用户「要写名字-对应的同事」）：
 * 「客户A」项目X（张三）、项目Y（李四）；「客户B」…，最多列 5 个，多了写「等共 N 个」。没有的客户不列；
 * 只拦一位、前面已经说了是哪位时不带客户名
 */
export async function 同事在推项目说法(db: Pick<Prisma.TransactionClient, "project" | "user">, 们: readonly (客户 & { name: string })[], 带客户名 = 们.length > 1): Promise<string> {
  const 有 = await 同事在推项目(db, 们);
  const 人们 = [...new Set([...有.values()].flat().map((p) => p.ownerId))];
  const 人名 = new Map((await 看全部(() => db.user.findMany({ where: { id: { in: 人们 } }, select: { id: true, name: true } }))).map((u) => [u.id, u.name]));
  const 共 = [...有.values()].reduce((n, l) => n + l.length, 0);
  let 剩 = 5;
  const 段: string[] = [];
  for (const c of 们) {
    const 列 = (有.get(c.id) ?? []).slice(0, 剩);
    if (!列.length) continue;
    剩 -= 列.length;
    段.push(`${带客户名 ? `「${c.name}」` : ""}${列.map((p) => `${p.name}（${人名.get(p.ownerId) ?? "同事"}）`).join("、")}`);
  }
  return 段.join("；") + (共 > 5 ? `等共 ${共} 个` : "");
}

/** P-删-05 挡删的话：一位说名字，多位说几位 */
export function 同事在推不能删话(名: string[], 客户叫法 = "客户"): string {
  return 名.length === 1
    ? `「${名[0]}」名下有同事负责、还没结束的项目，先转走或让负责人删`
    : `${名.length} 位${客户叫法}名下有同事负责、还没结束的项目，整批已阻止。先转走或让负责人删`;
}

/** P-公海-06 挡放进公海的话；项目 = 同事在推项目说法（拦住的同事项目名和负责人） */
export function 同事在推不能放公海话(名: string[], 客户叫法 = "客户", 项目 = ""): string {
  const 列 = 项目 ? `：${项目}` : "";
  return 名.length === 1
    ? `「${名[0]}」名下有同事负责、还没结束的项目${列}，先转走或结束再放进公海`
    : `${名.length} 位${客户叫法}名下有同事负责、还没结束的项目${列}，先转走或结束再放进公海`;
}
