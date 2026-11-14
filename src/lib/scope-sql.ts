import { cache } from "react";
import { prisma, defaultClient } from "@/lib/prisma";
import { 读的我, 有市场只读, 现在的公海回避, 现在的组员客户, 客户读条件 } from "@/lib/team-scope";
import { 缓存分组数 } from "@/lib/enterprise/pool-count-cache";
import { 在看已删, 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 企业版 } from "@/lib/enterprise/switch";

/**
 * 业务员（企业版按组织看、团队版没开互看）看得到的客户，用裸 SQL 数和挑，不走 Prisma 那层 where。
 *
 * lib/team-scope 的 可见客户 = 负责人是我 OR 渠道负责人是我（企业版不算，11-04）OR 在公海。Prisma 把「在公海」展开成
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
async function 看得到的(): Promise<{ where: string; 参数: string[]; 名下: { where: string; 参数: string[] }; 回避: { sql: string; 参数: string[] } } | null> {
  const 我 = await 读的我(defaultClient);
  // 企业版市场成员（10-31）另外看得到他们相关的客户：这里只按负责人算不全，回 null 让调用方走 Prisma（限定层带着那一段）
  if (!我 || (await 有市场只读(defaultClient))) return null;
  const 们 = typeof 我 === "string" ? [我] : [...我];
  if (!们.length) 们.push("__无");
  const 占 = 们.map(() => "?").join(",");
  const 回避 = await 现在的公海回避(defaultClient);
  if (回避?.客户 === null) return null;
  const 避 = 回避 ? 回避段(回避.本人, 回避.客户 ?? []) : { sql: "", 参数: [] as string[] };
  // 企业版项目组员（V3.5.1）：加入的项目挂的客户也看得到，同 team-scope 限定条件——算好的编号名单；过上限（null）退回子查询；不是组员不加
  const 组员名单 = 企业版() ? await 现在的组员客户(defaultClient) : undefined;
  const 组员 = 组员名单 === null
    ? { sql: ` OR c.id IN (SELECT p."customerId" FROM "Project" p JOIN "ProjectMember" m ON m."projectId" = p.id WHERE m."userId" IN (${占}) AND m."inviteStatus" = 'JOINED' AND p."deletedAt" IS NULL)`, 参数: 们 }
    : 组员名单?.length ? { sql: ` OR c.id IN (${组员名单.map(() => "?").join(",")})`, 参数: 组员名单 } : { sql: "", 参数: [] as string[] };
  // 企业版不认渠道负责人（11-04，同 team-scope 可见客户）
  const 渠道 = 企业版() ? { sql: "", 参数: [] as string[] } : { sql: ` OR c."channelOwnerId" IN (${占})`, 参数: 们 };
  // 回避的名单（不含「负责人是他的公海客户」那一半）：名下这一路不在公海，只剩名单这一段
  const 名单 = 回避?.客户?.length ? { sql: ` AND c.id NOT IN (${回避.客户.map(() => "?").join(",")})`, 参数: 回避.客户 } : { sql: "", 参数: [] as string[] };
  return {
    // 回收站里的客户（企业版软删，P9）不算：裸 SQL 不过 Prisma 扩展，自己带上。外层是 AND，三段 OR 照旧各走各的索引
    where: `(c."salesOwnerId" IN (${占})${渠道.sql} OR c.id IN (SELECT "customerId" FROM "CustomerPool")${组员.sql}) AND c."deletedAt" IS NULL${避.sql}`,
    参数: [...们, ...渠道.参数, ...组员.参数, ...避.参数],
    /**
     * 拆成两路（8.5 万客户提速，11-14）：上面那句 = 「名下」∪「公海」，两路不相交（在不在公海表里）。
     * 公海有 6.6 万位时，带着「OR 在公海」的那句每次都要把 6.8 万位看得到的客户整个列出来（计数 20 ms、跟进数 110 ms）；
     * 名下这一路只走负责人（渠道负责人、组员名单）的索引，只碰自己那几千位。公海那一路人人一样（只差回避的那几位），各处另数。
     * 回避的 NOT (负责人是他 AND 在公海) 在名下这一路恒真，不带；名单那段照带。tests/scope-sql-split.test.ts 逐个身份对拍拆前拆后
     */
    名下: {
      // 带 OR（组员名单 / 渠道负责人）时 deletedAt 前加 +（第二轮 11-14）：不然没统计信息的 SQLite 嫌 OR 两段贵、改挑 deletedAt 索引扫整表（销售管理带组员 11–13 ms），
      // 加了只能走 MULTI-INDEX OR 各取一段（<1 ms）。只按负责人的不加：那时 (salesOwnerId, deletedAt, …) 两列都用得上
      where: `(c."salesOwnerId" IN (${占})${渠道.sql}${组员.sql}) AND ${组员.sql || 渠道.sql ? "+" : ""}c."deletedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "CustomerPool" p WHERE p."customerId" = c.id)${名单.sql}`,
      参数: [...们, ...渠道.参数, ...组员.参数, ...名单.参数],
    },
    回避: 避,
  };
}

/** 范围那几句原样给测试对拍用（tests/scope-sql-split.test.ts：拆前那句 vs 拆后两路）；null = 调用方走 Prisma */
export function 看得到的范围SQL() {
  return 看得到的();
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
  if (!范围) {
    // 不限定的人：一句数完（只走 deletedAt 索引）
    if (!(await 读的我(defaultClient))) return prisma.customer.count();
    // 限定了但裸 SQL 接不住的（看得到的() 只对这两种回 null：有市场只读、原负责人回避名单过上限）：照样拆两路（第二轮 11-14）——不在公海的走 Prisma，
    // 限定层见到「不在公海」会去掉「OR 在公海」那支（team-scope 限在非公海）；公海那头 = 公海页签数。原来一句带 OR 整表扫，市场相关的人 50 ms
    const [非公海, 公海] = await Promise.all([prisma.customer.count({ where: { pool: { is: null } } }), 看得到的公海数()]);
    return 非公海 + 公海;
  }
  // 名下（不在公海）+ 公海里看得到的（= 公海页签数，走主键、只减回避的那几位），两路不相交，相加就是原来那句的数
  const [[r], 公海] = await Promise.all([
    prisma.$queryRawUnsafe<{ n: bigint | number }[]>(`SELECT COUNT(*) AS n FROM "Customer" c WHERE ${范围.名下.where}`, ...范围.名下.参数),
    看得到的公海数(),
  ]);
  return Number(r.n) + 公海;
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
 * 回避的人减掉他回避的那几位：负责人走 salesOwnerId 索引、名单走主键，只碰他自己那点行，不扫公海表。名单过上限走 Prisma。
 * 一次渲染里只数一遍（React cache；第二轮 11-14：客户页的页签数和左栏角标里的看得到的客户数各数一遍）；Server Action、路由处理器里照常每次现数
 */
export const 看得到的公海数 = cache(公海数现数);

async function 公海数现数(): Promise<number> {
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
  const { 筛段, 筛值 } = 跟进筛SQL(筛, true);
  if (!范围) {
    // 不限定的人：一句数完
    if (!(await 读的我(defaultClient))) return prisma.followUp.count({ where: 跟进筛条件(筛) });
    /*
      限定了但裸 SQL 接不住的（市场成员 / 市场管理、回避名单过上限）：同样拆两路（第三轮 11-14）。原来 Prisma 那句
      FollowUp LEFT JOIN Customer … OR 在公海 OR 市场相关…，只能顺 (deletedAt, occurredAt) 把 25 万条跟进整个扫一遍（单句 340–500 ms，冷的 2.3 s）。
      名下：不在公海的看得到的客户编号交给限定层挑（客户这头见到「不在公海」会去掉「OR 在公海」那支，同 看得到的客户数），
      再按 customerId 索引数跟进；公海：同下（公海跟进数）。
      原来那句只排跟进自己进了回收站的、不看客户删没删（快路的裸 SQL 排掉回收站里的客户，两边本来就差这一截）：
      这里照原来那句——客户编号在 看已删 里挑，公海那路也不排回收站里的客户，数和原来一模一样
    */
    const [名下客户, 公海] = await Promise.all([看已删(() => prisma.customer.findMany({ where: { pool: { is: null } }, select: { id: true } })), 公海跟进数(筛, true)]);
    const [r] = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(
      `SELECT COUNT(*) AS n FROM "FollowUp" f WHERE f."customerId" IN (SELECT value FROM json_each(?)) AND +f."deletedAt" IS NULL${筛段.join("")}`,
      JSON.stringify(名下客户.map((c) => c.id)),
      ...筛值,
    );
    return Number(r.n) + 公海;
  }
  // 拆两路（11-14，8.5 万客户 25 万条跟进：原来 110–150 ms）：
  //   名下：客户走负责人索引、跟进走 customerId 索引（+ 号让 deletedAt 不去抢 FollowUp_deletedAt_occurredAt_idx，没统计信息时 SQLite 会挑它整表扫）
  //   公海：见 公海跟进数。第三轮（11-14）起两路分成两句，公海那句人人一样（只差回避的那几位），进短时缓存
  const [[r], 公海] = await Promise.all([
    prisma.$queryRawUnsafe<{ n: bigint | number }[]>(
      `SELECT COUNT(*) AS n FROM "FollowUp" f WHERE f."customerId" IN (SELECT c.id FROM "Customer" c WHERE ${范围.名下.where}) AND +f."deletedAt" IS NULL${筛段.join("")}`,
      ...范围.名下.参数,
      ...筛值,
    ),
    公海跟进数(筛),
  ]);
  return Number(r.n) + 公海;
}

/** 跟进记录页的两个筛选：Prisma 写法 / 裸 SQL 写法（表别名 f） */
function 跟进筛条件(筛: { type?: string; ownerId?: string }) {
  return { ...(筛.type ? { type: 筛.type } : {}), ...(筛.ownerId ? { ownerId: 筛.ownerId } : {}) };
}
/**
 * 名下 = 按 customerId 编号数：这时两个筛选列前加 +（第三轮 11-14），不然 SQLite 改挑 type / (ownerId, occurredAt) 的索引、
 * 把这一类型的跟进全扫一遍再挑客户。值照样从 (customerId, deletedAt, type, ownerId) 里读，不回表。
 * 公海全部那句从公海表出发（CROSS JOIN 定死先后），不加
 */
function 跟进筛SQL(筛: { type?: string; ownerId?: string }, 名下 = false): { 筛段: string[]; 筛值: string[] } {
  const 加 = 名下 ? "+" : "";
  const 筛段: string[] = [];
  const 筛值: string[] = [];
  if (筛.type) {
    筛段.push(` AND ${加}f."type" = ?`);
    筛值.push(筛.type);
  }
  if (筛.ownerId) {
    筛段.push(` AND ${加}f."ownerId" = ?`);
    筛值.push(筛.ownerId);
  }
  return { 筛段, 筛值 };
}

/**
 * 公海里看得到的客户的跟进几条。看得到的 ∩ 在公海 = 未删的公海客户减掉回避的那几位（范围里「在公海」那一支人人都有），
 * 所以照 公海数现数 的办法：全部公海客户的跟进数（人人一样）减掉他回避的那几位的跟进数。
 *   - 全部：从公海表出发逐位数（CROSS JOIN 定死先后），跟进那头走 (customerId, deletedAt, type, ownerId) 覆盖索引（迁移 137），20 万条 ~35 ms；
 *     整句 + 参数进短时缓存（enterprise/pool-count-cache.ts，写过库就作废），只看筛选，30 人只算一次（第三轮 11-14）
 *   - 回避的：负责人是他（走负责人索引）或名单上的（走主键）、又在公海里的那几位，只碰他自己那点行。
 *     回避段 在公海里 = NOT (负责人是他) AND 不在名单（salesOwnerId 非空），减掉的正好是这一块
 * 回避名单过上限（null）走 Prisma（限定层带着回避那段）。
 * 含删了的客户：给 Prisma 老路那头对齐用（那句不看客户删没删，见 看得到的跟进数）
 */
async function 公海跟进数(筛: { type?: string; ownerId?: string }, 含删了的客户 = false): Promise<number> {
  const 回避 = await 现在的公海回避(defaultClient);
  if (回避?.客户 === null) return prisma.followUp.count({ where: { ...跟进筛条件(筛), customer: { pool: { isNot: null } } } });
  const { 筛段, 筛值 } = 跟进筛SQL(筛);
  const 客户没删 = 含删了的客户 ? "" : ` AND c."deletedAt" IS NULL`;
  const 全部sql = `SELECT COUNT(*) AS n FROM "CustomerPool" p CROSS JOIN "Customer" c CROSS JOIN "FollowUp" f WHERE c.id = p."customerId" AND f."customerId" = p."customerId"${客户没删} AND f."deletedAt" IS NULL${筛段.join("")}`;
  const 全部 = 缓存分组数(全部sql, 筛值, async () => {
    const [r] = await prisma.$queryRawUnsafe<{ n: bigint | number }[]>(全部sql, ...筛值);
    return Number(r.n);
  });
  if (!回避) return 全部;
  const 他的 = 跟进筛SQL(筛, true);
  const 名单 = 回避.客户 ?? [];
  const 或名单 = 名单.length ? ` OR c.id IN (${名单.map(() => "?").join(",")})` : "";
  const [n, [r]] = await Promise.all([
    全部,
    prisma.$queryRawUnsafe<{ n: bigint | number }[]>(
      `SELECT COUNT(*) AS n FROM "FollowUp" f WHERE f."customerId" IN (SELECT c.id FROM "Customer" c WHERE (c."salesOwnerId" = ?${或名单})${客户没删} AND c.id IN (SELECT "customerId" FROM "CustomerPool")) AND +f."deletedAt" IS NULL${他的.筛段.join("")}`,
      回避.本人,
      ...名单,
      ...他的.筛值,
    ),
  ]);
  return n - Number(r.n);
}

/**
 * 客户页国家 / grade 筛选下拉的去重值（= 原来那两句 groupBy 的结果，原样同序）。8.5 万客户时每次 5–20 ms，
 * 每个客户页都要算两遍、值又几乎不变：进程内缓存 60 秒，写过库就作废（同公海分组缓存，enterprise/pool-count-cache.ts）。
 * 键 = 列 + 企业版 / 看不看已删 + 这个人读客户时限定层并进去的那一整句条件（客户读条件：组织范围、市场、组员、回避名单全在里面），
 * 条件一样的两个人本来就数出同一份值；条件不同就是不同的键，不会拿到按别人范围算的值。多租户、测试里不缓存（同那边）
 */
export async function 看得到的下拉值(列: "grade" | "country"): Promise<string[]> {
  const 条件 = await 客户读条件(defaultClient);
  const 查 = async () =>
    列 === "grade"
      ? (await prisma.customer.groupBy({ by: ["grade"], where: { grade: { not: null } } })).map((r) => r.grade!)
      : (await prisma.customerExtra.groupBy({ by: ["country"], where: { country: { not: null } }, orderBy: { country: "asc" } })).map((r) => r.country!);
  return 缓存分组数(`下拉:${列}`, [企业版(), 在看已删(), 条件], 查, 60_000);
}

/**
 * 看得到的客户里**不在公海的**最近跟进的前 n 位的编号，顺序同 orderBy [lastFollowAt desc, createdAt desc]（同一列、同一个 ORDER BY，
 * 没跟进过的照 SQLite 排在最后）。null = 不限定，调用方照旧用 Prisma 排（条件用客户列表的 客户筛选条件）。
 * 只给记录页窄名单用：公海只在公海页签出现（P-看-03），不在公海的写法同客户列表 query.ts 关键词分页
 */
export async function 最近跟进的客户(n: number): Promise<string[] | null> {
  const 范围 = await 看得到的();
  if (!范围) return null;
  // 不在公海的 = 名下那一路（11-14 拆两路）：原来那句先把 6.8 万位看得到的列出来再排掉公海，8.5 万客户 ~30 ms
  const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT c.id FROM "Customer" c WHERE ${范围.名下.where} ORDER BY c."lastFollowAt" DESC, c."createdAt" DESC LIMIT ?`,
    ...范围.名下.参数,
    n,
  );
  return rows.map((r) => r.id);
}
