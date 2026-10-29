import { scheduleValue } from "@/lib/schedule-date";
import { prisma, defaultClient } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { dayjs } from "@/lib/utils";
import { 带币种, 签约金额, 签约合计, 签约币种 } from "@/lib/money-db";
import { 客户关键词条件, 客户关键词SQL, 客户id集合 } from "@/lib/search-keyword";
import { 读的我 } from "@/lib/team-scope";
import { 取档案 } from "@/lib/customer-extra-db";
import { 未分级 } from "./query-shared";
import { 读团队 } from "@/lib/sync/client";
import { 部门里的人 } from "@/lib/sync/dept-policy";
import { 企业版 } from "@/lib/enterprise/switch";

/**
 * 客户列表的查询条件、取哪些字段、怎么变成一行——列表页和「导出」共用这一份（2026-10-02 排查）。
 * 原来导出拿的是当前这一页的 rows（默认 20 条），文件名却像整张表；拆出来以后导出按同样的条件取全部。
 */

export type 客户条件 = {
  keyword?: string;
  grade?: string;
  followStatus?: string;
  decisionStatus?: string;
  /** 客户状态（企业版字典 custStatus，10-28） */
  custStatus?: string;
  /** 客户类型（企业版字典 custType，2026-10-29 P13，迁移 092） */
  customerType?: string;
  salesOwnerId?: string;
  channelOwnerId?: string;
  createdWithin?: string;
  directOf?: string;
  batch?: string;
  /**
   * 「1」= 「公海」页签：只看公海里的（第 6 块）。
   * 不是「1」= 「客户」页签：**不含**公海里的（2026-10-13：公海和自己的分开摆）；子集入口例外，见 在看子集
   */
  pool?: string;
  /** 外贸档案的国家 / 来源（2026-10-05） */
  country?: string;
  source?: string;
  /** 客户等级（2026-10-16）：A / B / C / D，或「未分级」= 没填的 */
  level?: string;
  /** 团队版部门（1b，2026-10-23）：负责人在这个部门（连下级）里的。没有部门数据（个人版、老云端）时不筛 */
  dept?: string;
};

/** 等级筛选：A–D 按字母筛；「未分级」= 没有档案行或等级空着的。别的值不筛（地址栏手改的） */
function 等级条件(level: string | undefined): Prisma.CustomerWhereInput | null {
  if (!level) return null;
  if (level === 未分级) return { OR: [{ extra: { is: null } }, { extra: { is: { level: null } } }] };
  // 企业版级别多一档 S（定稿 P5 第 23 条）；C 连带还没改过来的 D 一起筛（启动时会把 D 改成 C，这里兜底）
  if (level === "S") return { extra: { is: { level } } };
  if (level === "C" && 企业版()) return { extra: { is: { level: { in: ["C", "D"] } } } };
  return /^[ABCD]$/.test(level) ? { extra: { is: { level } } } : null;
}

/**
 * 部门筛选：销售或渠道负责人在这个部门里的（两人分在两个部门时两边都算，和云端隔离一个口径）。
 * 选的是默认一级部门时，负责人都不在团队里的（已离队、本机老账号）也算进来
 */
function 部门条件(dept: string | undefined): Prisma.CustomerWhereInput | null {
  const 编制 = dept ? 读团队()?.编制 : undefined;
  if (!dept || !编制?.部门.some((d) => d.id === dept)) return null;
  const 圈 = 部门里的人(编制, dept);
  const 号 = (xs: string[]) => xs.map((a) => `acct_${a}`);
  const 全员 = 号(圈.全员);
  return {
    OR: [
      { salesOwnerId: { in: 号(圈.人) } },
      { channelOwnerId: { in: 号(圈.人) } },
      ...(圈.含无主
        ? [{ salesOwnerId: { notIn: 全员 }, OR: [{ channelOwnerId: null }, { channelOwnerId: { notIn: 全员 } }] }]
        : []),
    ],
  };
}

/**
 * 三种「从一个数走进来」的子集：导入「看这一批」、数据页「本月新增」、渠道页「直接推荐」。
 * 那几个数本来就把公海里的算在内，点进来要对得上——子集里不分页签，公海里的照样列出来（带 pool=1 才只看公海）。
 * 列表页据此不摆「客户 / 公海」页签。
 */
export function 在看子集(sp: Pick<客户条件, "batch" | "createdWithin" | "directOf">): boolean {
  return Boolean(sp.batch || sp.directOf || sp.createdWithin === "本月");
}

/** 公海这一层：「公海」页签只要公海里的；子集里不分；其余（「客户」页签）不含公海里的 */
function 公海条件(sp: 客户条件): Prisma.CustomerWhereInput {
  if (sp.pool === "1") return { pool: { isNot: null } };
  if (在看子集(sp)) return {};
  return { pool: { is: null } };
}

/**
 * 这份条件除了页签本身什么都没筛：给「客户」/「公海」两个字之一，筛了别的给 null。
 * 列表页拿它省一次 count——没筛时列表总数就是页签上的数（lib/pool-db.ts 客户页签数），不用再数一遍
 */
export function 只按页签(where: Prisma.CustomerWhereInput): "非公海" | "公海" | null {
  const { AND, pool, ...别的 } = where;
  if (Object.keys(别的).length) return null;
  if (!Array.isArray(AND) || AND.some((x) => Object.keys(x).length)) return null;
  if (pool && "is" in pool && pool.is === null && Object.keys(pool).length === 1) return "非公海";
  if (pool && "isNot" in pool && pool.isNot === null && Object.keys(pool).length === 1) return "公海";
  return null;
}

export async function 客户筛选条件(
  sp: 客户条件,
  /** 关键词按谁的字段权限搜（电话藏着就不按号码匹配）；不给 = 当前登录的人。AI 助手经 MCP 调时没有 cookie，要传 */
  userId?: string,
): Promise<Prisma.CustomerWhereInput> {
  // 这一批导入动过的人。撤销过的批次不算（那些人已经删了 / 还原了）
  const 本批 = sp.batch
    ? await prisma.importRow.findMany({
        where: { batchId: sp.batch, batch: { revertedAt: null } },
        select: { customerId: true },
      })
    : null;

  const keyword = await 客户关键词条件(sp.keyword, false, userId);

  const 等级 = 等级条件(sp.level);
  const 部门 = 部门条件(sp.dept);
  return {
    AND: [keyword, ...(本批 ? [客户id集合(本批.map(r => r.customerId))] : []), ...(等级 ? [等级] : []), ...(部门 ? [部门] : [])],
    ...(sp.grade ? { grade: sp.grade } : {}),
    ...(sp.followStatus ? { followStatus: sp.followStatus } : {}),
    ...(sp.decisionStatus ? { decisionStatus: sp.decisionStatus } : {}),
    // 客户状态只有企业版认；开关关着地址栏带了也当没带
    ...(sp.custStatus && 企业版() ? { custStatus: sp.custStatus } : {}),
    ...(sp.customerType && 企业版() ? { customerType: sp.customerType } : {}),
    ...(sp.salesOwnerId ? { salesOwnerId: sp.salesOwnerId } : {}),
    ...(sp.channelOwnerId ? { channelOwnerId: sp.channelOwnerId } : {}),
    ...(sp.createdWithin === "本月"
      ? { createdAt: { gte: dayjs().startOf("month").toDate() } }
      : {}),
    /*
    渠道页「直接推荐 5 人」点进来：渠道对得上、且没有上游学员，和 渠道汇总() 的 directCustomers 一个口径。
    原来链接用 keyword=渠道名，而关键词不搜渠道，点进去基本是 0 条（2026-10-01 排查 C1）
  */
    ...(sp.directOf
      ? { channelId: sp.directOf, referrerCustomerId: null }
      : {}),
    ...公海条件(sp),
    ...(sp.country || sp.source
      ? { extra: { is: { ...(sp.country ? { country: sp.country } : {}), ...(sp.source ? { source: sp.source } : {}) } } }
      : {}),
  };
}

export const 客户行字段 = {
  id: true,
  name: true,
  phone: true,
  school: true,
  grade: true,
  major: true,
  followStatus: true,
  decisionStatus: true,
  custStatus: true,
  // 企业版客户改版（定稿 P5，迁移 072）：简称、地址、分配方式。别的版本这几格都是空
  shortName: true,
  addrCountry: true,
  addrProvince: true,
  addrCity: true,
  addrDistrict: true,
  assignWay: true,
  customerType: true,
  expectedSignAt: true,
  expectedSignOn: true,
  lastFollowAt: true,
  remark: true,
  referrerCustomerId: true,
  channelId: true,
  salesOwnerId: true,
  channelOwnerId: true,
  updatedAt: true,
  salesOwner: { select: { name: true } },
  channelOwner: { select: { name: true } },
  channel: { select: { name: true } },
  referrerCustomer: { select: { name: true } },
  attributionChannel: { select: { name: true } },
  attributionCustomer: { select: { name: true } },
  contracts: { select: { amount: true, ...带币种.签约 } },
  pool: { select: { reason: true } },
  extra: true,
} satisfies Prisma.CustomerSelect;

type 取到的行 = Prisma.CustomerGetPayload<{ select: typeof 客户行字段 }>;

/** 全范围按一种币种排序，再取页。扫描不带档案正文，避免把整库完整行交给浏览器。 */
export async function 客户金额分页(where: Prisma.CustomerWhereInput, order: "amount-asc" | "amount-desc", currency: string, page: number, pageSize: number): Promise<取到的行[]> {
  const amounts: { id: string; amount: number; createdAt: number }[] = [];
  let after: string | undefined;
  for (;;) {
    const batch = await prisma.customer.findMany({
      where: after ? { AND: [where, { id: { gt: after } }] } : where,
      orderBy: { id: "asc" }, take: 1000,
      select: { id: true, createdAt: true, contracts: { select: { amount: true, ...带币种.签约 } } },
    });
    for (const row of batch) amounts.push({ id: row.id, createdAt: row.createdAt.getTime(), amount: row.contracts.reduce((sum, c) => sum + (签约币种(c) === currency ? 签约金额(c) : 0), 0) });
    if (batch.length < 1000) break;
    after = batch[batch.length - 1].id;
  }
  const direction = order === "amount-asc" ? 1 : -1;
  amounts.sort((a, b) => direction * (a.amount - b.amount) || b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const ids = amounts.slice((page - 1) * pageSize, page * pageSize).map(row => row.id);
  if (!ids.length) return [];
  const rows = await prisma.customer.findMany({ where: { AND: [where, { id: { in: ids } }] }, select: 客户行字段 });
  const positions = new Map(ids.map((id, index) => [id, index]));
  return rows.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
}

/** 快路径接得住的本表等值筛选（列名固定，值参数绑定） */
const 等值列 = ["grade", "followStatus", "decisionStatus", "custStatus", "customerType", "salesOwnerId", "channelOwnerId"] as const;
/** 等值列里只有企业版认的（开关关着地址栏带了也当没带） */
const 企业版才筛: readonly string[] = ["custStatus", "customerType"];

/**
 * 带关键词的列表：总数、钳过的页码和这一页的 id 用一条 SQL 出（P2，2026-10-28）。
 * 原来关键词先查出全部 id、拼成每 500 个一块的 IN（宽词时 10 万个参数），count 和 findMany 各带一遍，
 * 10 万客户搜「138」要 1.6–1.9 s；这样写 60–75 ms（老板）、7–10 ms（业务员）。
 *
 * 范围和 lib/team-scope.ts 的 可见客户(读的我) ∧ 公海条件 是同一个口径，化简后：
 * 「客户」页签 = 我负责（销售或渠道）∧ 不在公海；「公海」页签 = 在公海（公海人人看得到）；老板只剩页签条件。
 * **那边的可见范围改了，这里要跟着改**（customer-keyword-page.test.ts 拿 Prisma 老路逐页对拍守着）。
 * 这里只给 id，行由调用方经限定层再取一次：范围就算写宽了，也只会多算总数，不会多给行。
 *
 * 接不住的组合（等级、部门、批次、国家来源、本月、直推）返回 null，调用方走老路
 */
export async function 关键词分页(sp: 客户条件, 请求页: number, pageSize: number): Promise<{ total: number; page: number; ids: string[] } | null> {
  if (sp.batch || sp.level || sp.dept || sp.createdWithin || sp.directOf || sp.country || sp.source) return null;
  const kw = await 客户关键词SQL(sp.keyword);
  if (!kw) return null;
  const 公海 = sp.pool === "1";
  const 谁 = await 读的我(defaultClient);
  // 回收站里的客户（企业版软删，P9）不进列表：裸 SQL 不过 Prisma 扩展，这里自己带上
  const 段 = [kw.sql, 'c."deletedAt" IS NULL'];
  const 值: unknown[] = [...kw.values];
  if (公海) 段.push('EXISTS (SELECT 1 FROM "CustomerPool" p WHERE p."customerId" = c.id)');
  else {
    if (谁) {
      const ids = typeof 谁 === "string" ? [谁] : [...谁];
      const q = ids.map(() => "?").join(", ");
      段.push(`(c."salesOwnerId" IN (${q}) OR c."channelOwnerId" IN (${q}))`);
      值.push(...ids, ...ids);
    }
    段.push('NOT EXISTS (SELECT 1 FROM "CustomerPool" p WHERE p."customerId" = c.id)');
  }
  for (const col of 等值列) if (sp[col] && (!企业版才筛.includes(col) || 企业版())) { 段.push(`c."${col}" = ?`); 值.push(sp[col]); }
  // a 放每页条数和请求页，下面的 ? 按出现顺序绑定；页码钳在 SQL 里做（越界页回最后一页，0 条回第 1 页），和 page.tsx 原来的公式一样。
  // m 必须 MATERIALIZED：不然 SQLite 会把它内联两次，扫两遍；关键词命中一次扫完记下来，数和排序都在 m 上做
  const rows = await prisma.$queryRawUnsafe<{ total: number | bigint; id: string | null }[]>(
    `WITH a(sz, pg) AS (SELECT ?, ?),
m AS MATERIALIZED (SELECT c.id, c."createdAt" FROM "Customer" c WHERE ${段.join(" AND ")}),
n AS (SELECT COUNT(*) AS total FROM m)
SELECT n.total AS total, p.id AS id FROM n LEFT JOIN (
  SELECT id, "createdAt" FROM m ORDER BY "createdAt" DESC, id DESC
  LIMIT (SELECT sz FROM a) OFFSET (SELECT MAX(0, MIN(pg, (total + sz - 1) / sz) - 1) * sz FROM n, a)
) p ON 1 ORDER BY p."createdAt" DESC, p.id DESC`,
    pageSize, 请求页, ...值,
  );
  const total = Number(rows[0]?.total ?? 0);
  const page = Math.min(请求页, Math.max(1, Math.ceil(total / pageSize)));
  return { total, page, ids: rows.flatMap((r) => (r.id ? [r.id] : [])) };
}

/** 按给定的 id 顺序取行（经限定层）。关键词快路径用 */
export async function 按序取客户行(ids: string[]): Promise<取到的行[]> {
  if (!ids.length) return [];
  const 行 = await prisma.customer.findMany({ where: { id: { in: ids } }, select: 客户行字段 });
  const 位 = new Map(ids.map((id, i) => [id, i]));
  return 行.sort((a, b) => 位.get(a.id)! - 位.get(b.id)!);
}

export function 成客户行(r: 取到的行, 号: (p: string) => string) {
  return {
    id: r.id,
    name: r.name,
    phone: 号(r.phone),
    school: r.school,
    grade: r.grade,
    major: r.major,
    followStatus: r.followStatus,
    decisionStatus: r.decisionStatus,
    custStatus: r.custStatus,
    shortName: r.shortName,
    addrCountry: r.addrCountry,
    addrProvince: r.addrProvince,
    addrCity: r.addrCity,
    addrDistrict: r.addrDistrict,
    assignWay: r.assignWay,
    customerType: r.customerType,
    expectedSignAt: scheduleValue(r.expectedSignAt, r.expectedSignOn),
    lastFollowAt: r.lastFollowAt?.toISOString() ?? null,
    remark: r.remark,
    referrerCustomerId: r.referrerCustomerId,
    channelId: r.channelId,
    channelName: r.channel?.name ?? null,
    // 推荐人可能是渠道，也可能是已有学员
    referrerName: r.referrerCustomer?.name ?? r.channel?.name ?? null,
    // 渠道归属：往上两代的计算结果
    attributionName:
      r.attributionChannel?.name ?? r.attributionCustomer?.name ?? null,
    channelOwnerId: r.channelOwnerId,
    channelOwnerName: r.channelOwner?.name ?? null,
    salesOwnerId: r.salesOwnerId,
    salesOwnerName: r.salesOwner.name,
    signedAmount: r.contracts.reduce((s, c) => s + 签约金额(c), 0),
    signedTotals: 签约合计(r.contracts),
    /** 在公海里：负责人那一格写「公海（原 X）」，行上能领取。null = 不在 */
    pool: r.pool ? { reason: r.pool.reason } : null,
    /** 外贸档案：国家、WhatsApp、微信、邮箱、来源（2026-10-05） */
    // WhatsApp 也是号码：共享试用区和电话一样打码
    extra: (() => { const x = 取档案(r.extra); return { ...x, whatsapp: x.whatsapp && 号(x.whatsapp) }; })(),
    // 并发闸门：编辑框拿它作为「我看到的是哪一版」
    updatedAt: r.updatedAt.toISOString(),
  };
}

export type 客户行 = ReturnType<typeof 成客户行>;
