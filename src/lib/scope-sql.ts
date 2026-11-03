import { prisma, defaultClient } from "@/lib/prisma";
import { 读的我, 有市场只读, 现在的公海回避 } from "@/lib/team-scope";

/**
 * 业务员（企业版按组织看、团队版没开互看）看得到的客户，用裸 SQL 数和挑，不走 Prisma 那层 where。
 *
 * lib/team-scope 的 可见客户 = 负责人是我 OR 渠道负责人是我 OR 在公海。Prisma 把「在公海」展开成
 * Customer LEFT JOIN CustomerPool，OR 起来 SQLite 用不上负责人的索引，只能整张客户表扫一遍：
 * 10 万客户一次计数 ~20 ms，30 人同时开页面时排在只读连接上要等上百毫秒（2026-10-26 企业版 p95）。
 * 这里把「在公海」写成 id IN (SELECT customerId FROM CustomerPool)（customerId 是外键，硬删客户才连带删；软删的公海行还在，外层的 deletedAt 条件把它们排掉），
 * 三个条件都能走索引，SQLite 用 MULTI-INDEX OR 各取一段再合起来，只碰看得到的那几千行。
 * 试过三段 UNION：计数也快，但挑前 n 位时要把几万个编号先攒出来再排，经理（看四五万位）反而比原来慢一倍。
 *
 * 范围用 读的我()：和钩子给 Customer 读加的那一句同一个名单（企业版虚线下属算「读」）；null = 不限定，
 * 调用方照旧走 Prisma（不限定时 Prisma 那句本来就快）。tests/scope-sql.test.ts 逐个身份拿 Prisma 对拍。
 * 原负责人回避（11-03，见 team-scope 公海回避）：要回避的人多两个 AND，别人的 SQL 一个字不变；名单过上限回 null 走 Prisma
 */
async function 看得到的(): Promise<{ where: string; 参数: string[] } | null> {
  const 我 = await 读的我(defaultClient);
  // 企业版市场成员（10-31）另外看得到他们相关的客户：这里只按负责人算不全，回 null 让调用方走 Prisma（限定层带着那一段）
  if (!我 || (await 有市场只读(defaultClient))) return null;
  const 们 = typeof 我 === "string" ? [我] : [...我];
  if (!们.length) 们.push("__无");
  const 占 = 们.map(() => "?").join(",");
  const 回避 = await 现在的公海回避(defaultClient);
  if (回避?.客户 === null) return null;
  const 避 = 回避 ? 回避段(回避.本人, 回避.客户 ?? []) : { sql: "", 参数: [] as string[] };
  return {
    // 回收站里的客户（企业版软删，P9）不算：裸 SQL 不过 Prisma 扩展，自己带上。外层是 AND，三段 OR 照旧各走各的索引
    where: `(c."salesOwnerId" IN (${占}) OR c."channelOwnerId" IN (${占}) OR c.id IN (SELECT "customerId" FROM "CustomerPool")) AND c."deletedAt" IS NULL${避.sql}`,
    参数: [...们, ...们, ...避.参数],
  };
}

/** 回避的那段：负责人是他的公海客户 + 名单上的客户。salesOwnerId 非空，NOT (... ) 不踩 NULL */
function 回避段(本人: string, 客户: string[]): { sql: string; 参数: string[] } {
  const 名单 = 客户.length ? ` AND c.id NOT IN (${客户.map(() => "?").join(",")})` : "";
  return {
    sql: ` AND NOT (c."salesOwnerId" = ? AND c.id IN (SELECT "customerId" FROM "CustomerPool"))${名单}`,
    参数: [本人, ...客户],
  };
}

/** 看得到的客户一共几位（= prisma.customer.count()） */
export async function 看得到的客户数(): Promise<number> {
  const 范围 = await 看得到的();
  if (!范围) return prisma.customer.count();
  const [r] = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(`SELECT COUNT(*) AS n FROM "Customer" c WHERE ${范围.where}`, ...范围.参数);
  return Number(r.n);
}

/**
 * 公海里未删的客户几位。软删（进回收站）不动公海表，那一行还留着等恢复，直接数公海表会把回收站里的算进去。
 * 不从公海表 JOIN 客户数没删的（Prisma 的 customer: { deletedAt: null } 和裸 SQL 都试过，10 万客户、3 万公海一次 14–16 ms，
 * 原来只数公海表 0.7 ms）：公海总数走主键，回收站那头走 deletedAt 索引（写 > 0 才走，IS NOT NULL 这版 SQLite 不走、整表扫），
 * 只碰回收站里那些行，同样的量一次 2 ms。回收站本来就小，tests/customer-tabs-scope.test.ts 逐个身份对拍
 */
export async function 未删公海数(): Promise<number> {
  const [r] = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(
    `SELECT (SELECT COUNT(*) FROM "CustomerPool") - (SELECT COUNT(*) FROM "Customer" c JOIN "CustomerPool" p ON p."customerId" = c.id WHERE c."deletedAt" > 0) AS n`,
  );
  return Number(r.n);
}

/**
 * 这个人的「公海」页签数（= 公海列表条数）。不用回避的人就是 未删公海数（走主键，不 JOIN）；
 * 回避的人减掉他回避的那几位：负责人走 salesOwnerId 索引、名单走主键，只碰他自己那点行，不扫公海表。名单过上限走 Prisma
 */
export async function 看得到的公海数(): Promise<number> {
  const 回避 = await 现在的公海回避(defaultClient);
  if (!回避) return 未删公海数();
  if (回避.客户 === null) return prisma.customer.count({ where: { pool: { isNot: null } } });
  const 名单 = 回避.客户;
  const 或名单 = 名单.length ? ` OR c.id IN (${名单.map(() => "?").join(",")})` : "";
  const [全部, [r]] = await Promise.all([
    未删公海数(),
    prisma.$queryRawUnsafe<{ n: bigint | number }[]>(
      `SELECT COUNT(*) AS n FROM "Customer" c WHERE c."deletedAt" IS NULL AND (c."salesOwnerId" = ?${或名单}) AND c.id IN (SELECT "customerId" FROM "CustomerPool")`,
      回避.本人,
      ...名单,
    ),
  ]);
  return 全部 - Number(r.n);
}

/**
 * 看得到的跟进记录几条（= prisma.followUp.count({ where: { type?, ownerId? } })），跟进记录页不带关键词时的总数。
 * Prisma 那句是 FollowUp LEFT JOIN Customer LEFT JOIN CustomerPool 再 OR，20 万条跟进整表扫：压测时 106 次平均 422 ms，
 * 单查业务员 79 ms、经理 91 ms（2026-10-28 企业版 B 库）。写成 customerId IN (看得到的客户)：业务员 9.5 ms，经理 47–64 ms。
 * 试过 EXISTS：计数 95 ms，不用。取前 300 条那句 Prisma 本来就 1–4 ms（顺着 occurredAt 索引倒着找），不改
 */
export async function 看得到的跟进数(筛: { type?: string; ownerId?: string }): Promise<number> {
  const 范围 = await 看得到的();
  if (!范围) return prisma.followUp.count({ where: { ...(筛.type ? { type: 筛.type } : {}), ...(筛.ownerId ? { ownerId: 筛.ownerId } : {}) } });
  const 条件 = [`f."customerId" IN (SELECT c.id FROM "Customer" c WHERE ${范围.where})`, `f."deletedAt" IS NULL`];
  const 参数: string[] = [...范围.参数];
  if (筛.type) {
    条件.push(`f."type" = ?`);
    参数.push(筛.type);
  }
  if (筛.ownerId) {
    条件.push(`f."ownerId" = ?`);
    参数.push(筛.ownerId);
  }
  const [r] = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(`SELECT COUNT(*) AS n FROM "FollowUp" f WHERE ${条件.join(" AND ")}`, ...参数);
  return Number(r.n);
}

/**
 * 看得到的客户里最近跟进的前 n 位的编号，顺序同 orderBy [lastFollowAt desc, createdAt desc]（同一列、同一个 ORDER BY，
 * 没跟进过的照 SQLite 排在最后）。null = 不限定，调用方照旧用 Prisma 排
 */
export async function 最近跟进的客户(n: number): Promise<string[] | null> {
  const 范围 = await 看得到的();
  if (!范围) return null;
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT c.id FROM "Customer" c WHERE ${范围.where} ORDER BY c."lastFollowAt" DESC, c."createdAt" DESC LIMIT ?`,
    ...范围.参数,
    n,
  );
  return rows.map((r) => r.id);
}
