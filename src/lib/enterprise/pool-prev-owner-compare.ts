/**
 * 回避名单根因（E-417 包 1）上 c2 回填后的只读对拍：对每位在职员工，
 *   旧算法（现在代码里的回避集合：留痕现算，visibility.ts 公海回避of 的口径、不设名单上限）
 *   和 新口径（在公海里且 poolPrevOwnerId 是我，含客户 / 项目连带）
 * 两个集合必须完全相同。只读，不写库。脚本 scripts/pool-prev-owner-compare.ts。
 *
 * 旧：
 *   项目 = 我最近放回的公海项目 ∪ 他负责的公海客户 / 他最近一次放走的公海客户 名下没删的项目
 *   客户 = 他负责的公海客户 ∪ 他最近一次放走的公海客户 ∪ 他最近放回的公海项目挂着的公海客户
 * 新（读改按列的包 2 要用的写法）：
 *   项目 = 没删、（项目在公海且 项目.poolPrevOwnerId = 我）或（所在客户在公海且 客户.poolPrevOwnerId = 我）
 *   客户 = 没删、在公海、（客户.poolPrevOwnerId = 我 或 下面有在公海的、没删的项目 poolPrevOwnerId = 我）
 * 可空列的坑：poolPrevOwnerId 为空的行，SQL 里 NOT (列 = 我) 是 NULL、会被一起挡掉，所以「不是我」要写成「为空或不是我」。
 * 这里每位员工另做一遍互补核对：{为空或不是我} 的行数 + {是我} 的行数 = 在公海的总行数，等式不成立就是写错了。
 */
import type { PrismaClient } from "@/generated/prisma";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 去掉合并挪来的 } from "./merge-moved-logs";
import { 去掉导入写的 } from "./pool-prev-owner-backfill";

export type 对拍不一致 = { userId: string; 实体: "项目" | "客户"; 旧多出: string[]; 新多出: string[] };
export type 对拍结果 = {
  在职人数: number;
  不一致人数: number;
  不一致: 对拍不一致[];
  /** 互补核对（为空或不是我 + 是我 = 总数）不成立的人数 */
  互补不成立人数: number;
  数于: Date;
};

const 分段 = <T,>(a: T[], n: number): T[][] => {
  const 出: T[][] = [];
  for (let i = 0; i < a.length; i += n) 出.push(a.slice(i, i + n));
  return 出;
};

/**
 * 旧算法的取法（visibility.ts 回避读的 公海里历史负责人是 / 公海客户原负责人是：只认最近一条），
 * 区别只有一处：先去掉导入写的留痕（E-462，导入不是员工放回），和回填 / 按列算的口径一致，对拍才不会多出导入那三万多行
 */
async function 放回的项目们(db: PrismaClient, id: string): Promise<string[]> {
  const 候选 = await db.projectNodeLog.findMany({ where: { kind: "pool-release", fromOwnerId: id, project: { pooledAt: { not: null }, deletedAt: null } }, select: { projectId: true } });
  const 出: string[] = [];
  for (const 段 of 分段([...new Set(候选.map((l) => l.projectId))], 400)) {
    const 行 = await 去掉导入写的(db, "opportunity", await db.projectNodeLog.findMany({
      where: { projectId: { in: 段 }, kind: "pool-release" },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { projectId: true, fromOwnerId: true, at: true },
    }), (x) => x.projectId);
    const 看过 = new Set<string>();
    for (const l of 行) {
      if (看过.has(l.projectId)) continue;
      看过.add(l.projectId);
      if (l.fromOwnerId === id) 出.push(l.projectId);
    }
  }
  return 出;
}

async function 放走的客户们(db: PrismaClient, id: string): Promise<string[]> {
  const 占位 = (await db.user.findUnique({ where: { email: 无负责人占位邮箱 }, select: { id: true } }))?.id;
  if (!占位) return [];
  const 候选 = await db.customer.findMany({
    where: { salesOwnerId: 占位, pool: { isNot: null }, deletedAt: null, ownerLogs: { some: { toOwnerId: 占位, fromOwnerId: id } } },
    select: { id: true },
  });
  const 出: string[] = [];
  for (const 段 of 分段(候选.map((c) => c.id), 400)) {
    const 记录 = await 去掉导入写的(db, "customer", await 去掉合并挪来的(db, await db.customerOwnerLog.findMany({
      where: { customerId: { in: 段 }, toOwnerId: 占位 },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      select: { id: true, customerId: true, fromOwnerId: true, at: true },
    })), (x) => x.customerId);
    const 看过 = new Set<string>();
    for (const r of 记录) {
      if (看过.has(r.customerId)) continue;
      看过.add(r.customerId);
      if (r.fromOwnerId === id) 出.push(r.customerId);
    }
  }
  return 出;
}

/** 旧算法：这个人的回避项目、回避客户（完整集合，不设名单上限） */
export async function 旧回避集合(db: PrismaClient, id: string): Promise<{ 项目: Set<string>; 客户: Set<string> }> {
  const 放回的 = await 放回的项目们(db, id);
  const 放走的 = await 放走的客户们(db, id);
  const 他的 = (await db.customer.findMany({ where: { salesOwnerId: id, pool: { isNot: null }, deletedAt: null }, select: { id: true } })).map((c) => c.id);
  const 客户 = new Set<string>([...他的, ...放走的]);
  for (const 段 of 分段(放回的, 400)) {
    const 行 = await db.project.findMany({ where: { id: { in: 段 }, customer: { salesOwnerId: { not: id }, pool: { isNot: null }, deletedAt: null } }, select: { customerId: true } });
    for (const r of 行) 客户.add(r.customerId);
  }
  const 项目 = new Set<string>(放回的);
  for (const 段 of 分段([...new Set([...他的, ...放走的])], 400)) {
    const 行 = await db.project.findMany({ where: { customerId: { in: 段 }, deletedAt: null }, select: { id: true } });
    for (const r of 行) 项目.add(r.id);
  }
  return { 项目, 客户 };
}

/** 新口径：这个人的回避项目、回避客户（只靠 poolPrevOwnerId） */
export async function 新回避集合(db: PrismaClient, id: string): Promise<{ 项目: Set<string>; 客户: Set<string> }> {
  const 项目 = await db.project.findMany({
    where: { deletedAt: null, OR: [{ pooledAt: { not: null }, poolPrevOwnerId: id }, { customer: { pool: { isNot: null }, deletedAt: null, poolPrevOwnerId: id } }] },
    select: { id: true },
  });
  const 客户 = await db.customer.findMany({
    where: { deletedAt: null, pool: { isNot: null }, OR: [{ poolPrevOwnerId: id }, { projects: { some: { pooledAt: { not: null }, deletedAt: null, poolPrevOwnerId: id } } }] },
    select: { id: true },
  });
  return { 项目: new Set(项目.map((r) => r.id)), 客户: new Set(客户.map((r) => r.id)) };
}

/**
 * 「不是我」这一支的写法（拼进 where）。包 2 要用的是 Prisma 的 NOT {…} / not: 这一类：列可空，SQL 里 NOT (col = 我) 遇到空值得 NULL，
 * 空列的行会被挡掉（Prisma 的 { not: 我 }、NOT { col: 我 } 都一样），所以必须显式写「为空或不是我」。默认写法就是包 2 要用的这句
 */
export type 不是我写法 = (id: string) => Record<string, unknown>;
export const 为空或不是我: 不是我写法 = (id) => ({ OR: [{ poolPrevOwnerId: null }, { NOT: { poolPrevOwnerId: id } }] });

/**
 * 互补核对：在公海的项目 / 客户里，按「不是我」写法数出来的行数 + {是我} 的行数 = 总数。
 * 写法漏了空值（空列被错挡）时 看到 + 是我 < 总数，报不成立。写法可注入（测试用最朴素的 NOT { col: 我 } 验证这里报得出来）
 */
export async function 互补成立(db: PrismaClient, id: string, 写法: 不是我写法 = 为空或不是我): Promise<boolean> {
  const 项目在 = { pooledAt: { not: null }, deletedAt: null };
  const 客户在 = { pool: { isNot: null }, deletedAt: null };
  const [总p, 是p, 否p, 总c, 是c, 否c] = await Promise.all([
    db.project.count({ where: 项目在 }),
    db.project.count({ where: { ...项目在, poolPrevOwnerId: id } }),
    db.project.count({ where: { ...项目在, ...写法(id) } }),
    db.customer.count({ where: 客户在 }),
    db.customer.count({ where: { ...客户在, poolPrevOwnerId: id } }),
    db.customer.count({ where: { ...客户在, ...写法(id) } }),
  ]);
  return 是p + 否p === 总p && 是c + 否c === 总c;
}

export async function 对拍(db: PrismaClient): Promise<对拍结果> {
  const 数于 = new Date();
  const 人们 = await db.user.findMany({ where: { active: true }, select: { id: true }, orderBy: { id: "asc" } });
  const 不一致: 对拍不一致[] = [];
  const 有问题 = new Set<string>();
  let 互补不成立人数 = 0;
  for (const { id } of 人们) {
    const [旧, 新] = await Promise.all([旧回避集合(db, id), 新回避集合(db, id)]);
    for (const 实体 of ["项目", "客户"] as const) {
      const 旧多出 = [...旧[实体]].filter((x) => !新[实体].has(x));
      const 新多出 = [...新[实体]].filter((x) => !旧[实体].has(x));
      if (旧多出.length || 新多出.length) {
        有问题.add(id);
        不一致.push({ userId: id, 实体, 旧多出: 旧多出.slice(0, 5), 新多出: 新多出.slice(0, 5) });
      }
    }
    if (!(await 互补成立(db, id))) 互补不成立人数++;
  }
  return { 在职人数: 人们.length, 不一致人数: 有问题.size, 不一致, 互补不成立人数, 数于 };
}
