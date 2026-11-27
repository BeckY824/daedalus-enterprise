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
 * 可空列的坑：poolPrevOwnerId 为空的行，SQL 里 NOT (列 = 我) 是 NULL、会被一起挡掉，所以「不是我」要写成「为空或不是我」（公共写法在 pool-prev-owner-where.ts，team-scope 的回避条件拼它）。
 * 这里每位员工另做一遍互补核对：以他的身份走限定层数「能看到的公海客户 / 项目」，应等于 总数 − 新回避集合（见 互补成立），
 * 这样才真核到 team-scope 回避条件的写法（包 1 当时只核 compare 自己的式子，恒成立）。
 */
import type { PrismaClient } from "@/generated/prisma";
import { 留痕推算公海里历史负责人是 } from "@/lib/project/pool-owner";
import { 公海客户原负责人是 } from "@/lib/owner-log-db";

export type 对拍不一致 = { userId: string; 实体: "项目" | "客户"; 旧多出: string[]; 新多出: string[] };
export type 对拍结果 = {
  在职人数: number;
  不一致人数: number;
  不一致: 对拍不一致[];
  /** 互补核对（限定层看到的公海行 = 总数 − 新回避集合）不成立的人数 */
  互补不成立人数: number;
  数于: Date;
};

const 分段 = <T,>(a: T[], n: number): T[][] => {
  const 出: T[][] = [];
  for (let i = 0; i < a.length; i += n) 出.push(a.slice(i, i + n));
  return 出;
};

/** 旧算法：这个人的回避项目、回避客户（完整集合，不设名单上限） */
export async function 旧回避集合(db: PrismaClient, id: string): Promise<{ 项目: Set<string>; 客户: Set<string> }> {
  const 放回的 = await 留痕推算公海里历史负责人是(db, [id]);
  const 放走的 = [...(await 公海客户原负责人是(db, [id])).keys()];
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

export { 为空或不是我, type 不是我写法 } from "@/lib/enterprise/pool-prev-owner-where";

/**
 * 互补核对（E-417 包 2 起真核到 team-scope 的回避条件）：以这个人的身份走带限定的客户端（限定层，team-scope 加上限定 / 回避客户条件 / 回避项目条件），
 * 数「他能看到的在公海的客户 / 项目」，应该等于 在公海的总数 − 按列算的回避集合（新回避集合）。
 * 限定层的回避条件写漏了空列（NOT (列 = 我) 遇空得 NULL，空列的行被错挡）时，看到的数 < 应有的数，报不成立。
 * 不受回避的人（系统管理员、只读管理员，P-公海-04）看到的是总数，也算成立——这一项只管「错挡」，不管「没挡」（没挡由守卫测试和各入口用例管）。
 * 限定端默认 = db（不带限定层，只在测试里传 db 自身时退化成总数比）；脚本和测试传 @/lib/prisma 的 prisma。每人范围有 10 秒缓存，改了数据要先 忘掉企业版范围
 */
export async function 互补成立(db: PrismaClient, id: string, 限定端: PrismaClient = db): Promise<boolean> {
  const 项目在 = { pooledAt: { not: null }, deletedAt: null };
  const 客户在 = { pool: { isNot: null }, deletedAt: null };
  // 回避数只数「在公海且回避」的：新回避集合.项目 还含放走的公海客户下面不在公海的项目（已结束等），看p / 总p 不数它们
  const 回避项目条件 = { OR: [{ pooledAt: { not: null }, poolPrevOwnerId: id }, { customer: { pool: { isNot: null }, deletedAt: null, poolPrevOwnerId: id } }] };
  const [总p, 总c, 回避p, 新] = await Promise.all([
    db.project.count({ where: 项目在 }),
    db.customer.count({ where: 客户在 }),
    db.project.count({ where: { AND: [项目在, 回避项目条件] } }),
    新回避集合(db, id),
  ]);
  const { 以谁的身份 } = await import("@/lib/enterprise/visibility");
  const [看p, 看c] = await 以谁的身份(id, () => Promise.all([限定端.project.count({ where: 项目在 }), 限定端.customer.count({ where: 客户在 })]));
  const 对 = (看: number, 总: number, 回避: number) => 看 === 总 - 回避 || 看 === 总;
  return 对(看p, 总p, 回避p) && 对(看c, 总c, 新.客户.size);
}

export async function 对拍(db: PrismaClient, 限定端: PrismaClient = db): Promise<对拍结果> {
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
    if (!(await 互补成立(db, id, 限定端))) 互补不成立人数++;
  }
  return { 在职人数: 人们.length, 不一致人数: 有问题.size, 不一致, 互补不成立人数, 数于 };
}
