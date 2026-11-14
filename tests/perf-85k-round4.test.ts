/**
 * 8.5 万客户提速第四轮（11-14）：改前改后结果一样 + 查询计划钉住。
 *   1. 按主键取没删的（soft-delete-core.ts）：按 id 名单取行时顶层的 deletedAt IS NULL 挪到内存里滤，SQLite 走主键、不顺 deletedAt 索引扫。
 *      逐身份（看全部、销售管理、销售、回避的人、市场成员）× 几种 select（公海补这一页、学员名单、客户列表按序取、收藏、只取 id）对拍直接查；
 *      Prisma 真发出的句子 EXPLAIN：改前走 Customer_deletedAt_idx，改后走主键
 *   2. 公海分组数拆开数（unified-pool-sql.ts 按快捷 / 非线索 / 排掉）：合起来 = 分组数SQL 整句，逐个筛选组合、名单组合对拍；缓存开着也一样
 *   3. 公海全部跟进数（scope-sql.ts）：不连客户表的新写法 = 原来那句，含不含回收站里的客户、几种筛选
 * 用拷出来的一份库、显式单连接，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-perf-r4-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir, 句: [] as { query: string; params: string }[] };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1`, log: [{ emit: "event", level: "query" }] });
  (raw as unknown as { $on: (e: "query", f: (q: { query: string; params: string }) => void) => void }).$on("query", (q) => 临时.句.push({ query: q.query, params: q.params }));
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { prisma as db, defaultClient as raw } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 无负责人占位邮箱, 自动理由 } from "@/lib/pool";
import { 按主键取没删的, 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 测试里开公海分组缓存 } from "@/lib/enterprise/pool-count-cache";
import { 分组数SQL, 按快捷分组数SQL, 非线索分组数SQL, 排掉分组数SQL, 合分组, 减分组, type 客户行筛 } from "@/lib/enterprise/unified-pool-sql";
import { 拆开数分组 } from "@/lib/enterprise/unified-pool-db";
import { 离职理由们 } from "@/lib/enterprise/unified-pool";
import { 公海全部跟进数SQL, 公海全部跟进数SQL_改前 } from "@/lib/scope-sql";
import { 客户行字段 } from "@/app/(app)/customers/query";
import { 看全部 } from "@/lib/team-scope";

const 系管 = "r4_sys", 总管 = "r4_dir", 经理 = "r4_mgr", 小王 = "r4_wang", 回避人 = "r4_back", 市员 = "r4_mkt1", 市管 = "r4_mkt", 占位 = "r4_hold";
const 谁们 = [系管, 总管, 经理, 小王, 回避人, 市员, 市管];
const 全部客户: string[] = [];
const 公海客户: string[] = [];
const 删了的: string[] = [];

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ProjectMember", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerOwnerLog", "CustomerCreator", "CustomerPool", "CustomerClaim", "CustomerExtra", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of 谁们) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: id === 系管 ? "ADMIN" : "SALES" } });
  await raw.user.create({ data: { id: 占位, email: 无负责人占位邮箱, name: "占位", password: "x", role: "SALES" } });
  await raw.entMember.createMany({
    data: [
      { userId: 系管, bizRole: "director" },
      { userId: 总管, bizRole: "director" },
      { userId: 经理, bizRole: "sales_mgr", line: "内贸" },
      { userId: 小王, managerId: 经理, bizRole: "sales", line: "内贸" },
      { userId: 回避人, managerId: 经理, bizRole: "sales" },
      { userId: 市管, bizRole: "marketing_mgr" },
      { userId: 市员, managerId: 市管, bizRole: "channel_ops" },
    ],
  });
  await raw.setting.create({ data: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
  await raw.channel.create({ data: { id: "r4_ch", name: "渠道甲", channelOwnerId: 市员 } });
  const 日 = (d: number) => new Date(Date.UTC(2026, 9, d));
  const 负责人们 = [经理, 小王, 回避人, 市员, 占位];
  for (let i = 0; i < 90; i++) {
    const c = await raw.customer.create({
      data: {
        name: `客户${i}`, phone: `138${String(i).padStart(8, "0")}`, salesOwnerId: 负责人们[i % 负责人们.length],
        followStatus: i % 3 ? "跟进中" : "新", poolReturns: i % 6, poolInvalidAt: i % 11 === 0 ? 日(5) : null,
        channelId: i % 4 === 0 ? "r4_ch" : null,
        ...(i % 5 === 0 ? { creator: { create: { userId: 市员 } } } : {}),
        createdAt: 日(1 + (i % 9)), deletedAt: i % 7 === 3 ? 日(9) : null,
      },
    });
    全部客户.push(c.id);
    if (i % 7 === 3) 删了的.push(c.id);
    // 每位几条跟进，有的自己删了；客户删了跟进跟着删（同删客户时连带）
    for (let k = 0; k < i % 4; k++) {
      await raw.followUp.create({ data: { customerId: c.id, type: k % 2 ? "VISIT" : "PHONE", ownerId: 负责人们[(i + k) % 负责人们.length], title: "跟进", content: `第${k}条`, occurredAt: 日(1 + k), deletedAt: i % 7 === 3 ? 日(9) : k === 2 ? 日(8) : null } });
    }
    if (i % 3 === 0) await raw.followPlan.create({ data: { customerId: c.id, subject: "回访", ownerId: 经理, plannedAt: 日(20 + (i % 5)), done: i % 2 === 0 } });
    // 公海：一半多进；入池方式各种都有（自动、离职交接、没有操作人、主动退回），号码不全的有几位，回收站里的也有几位还挂着公海那一行
    if (i % 3 !== 2) {
      const 理由 = [自动理由(7), 离职理由们[0], "手动", "回收原因：质量不达标", "12 天没跟进，自动放进公海x"][i % 5];
      await raw.customerPool.create({ data: { customerId: c.id, userId: i % 4 === 1 ? null : i % 4 === 2 ? "" : 经理, reason: 理由, at: 日(1 + (i % 6)), phoneIncomplete: i % 8 === 0 ? true : i % 8 === 1 ? false : null } });
      公海客户.push(c.id);
    }
  }
  // 回避人放走的几位（进公海时负责人换成占位的，留痕记着他）
  for (const id of 公海客户.slice(0, 6)) await raw.customerOwnerLog.create({ data: { customerId: id, userId: 回避人, fromOwnerId: 回避人, toOwnerId: 占位, kind: "pool-release" } });
});

beforeEach(() => 忘掉企业版范围());

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

async function 计划(sql: string, params: string): Promise<string> {
  const rows = await raw.$queryRawUnsafe<{ detail: string }[]>(`EXPLAIN QUERY PLAN ${sql}`, ...JSON.parse(params));
  return rows.map((r) => r.detail).join("\n");
}

/** 跑一次，截下按 id 名单查客户表的那句（顶层；限定层自己算范围的句子不算），EXPLAIN 它 */
async function 顶层计划(fn: () => Promise<unknown>): Promise<{ sql: string; 计划: string }> {
  临时.句.length = 0;
  await fn();
  const 主 = 临时.句.filter((q) => q.query.startsWith("SELECT") && q.query.includes("FROM `main`.`Customer` ") && q.query.includes("`main`.`Customer`.`id` IN (")).at(0);
  expect(主, "没截到查客户表的句子").toBeTruthy();
  return { sql: 主!.query, 计划: await 计划(主!.query, 主!.params) };
}

/** 学员名单（@pane/panes.tsx）那份 select，原样抄 */
const 学员名单字段 = {
  id: true, name: true, followStatus: true, custStatus: true, lastFollowAt: true, salesOwnerId: true,
  salesOwner: { select: { name: true } },
  channel: { select: { name: true } },
  addrCountry: true, addrProvince: true, addrCity: true,
  referrerCustomerId: true,
  followUps: { orderBy: [{ customerId: "asc" as const }, { occurredAt: "desc" as const }], take: 1, select: { content: true, type: true } },
  plans: { where: { done: false }, orderBy: [{ plannedAt: "asc" as const }, { id: "asc" as const }], select: { plannedAt: true, plannedOn: true } },
} satisfies Prisma.CustomerSelect;
const 公海补字段 = { id: true, name: true, salesOwnerId: true, lastFollowAt: true, createdAt: true, poolInvalidAt: true, poolReturns: true, channelId: true } satisfies Prisma.CustomerSelect;

type 一种 = { 名: string; where: Prisma.CustomerWhereInput; select: Prisma.CustomerSelect };
const 几种 = (ids: string[]): 一种[] => [
  { 名: "公海补这一页", where: { id: { in: ids }, pool: { isNot: null } }, select: 公海补字段 },
  { 名: "回避的圈", where: { id: { in: ids } }, select: { id: true } },
  { 名: "学员名单", where: { id: { in: ids } }, select: 学员名单字段 },
  { 名: "客户列表按序取", where: { id: { in: ids } }, select: 客户行字段 },
  { 名: "收藏", where: { id: { in: ids } }, select: { id: true, name: true } },
];
const 按id排 = <T extends { id?: unknown }>(rs: T[]) => [...rs].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const 名单们 = () => [全部客户.slice(0, 20), 公海客户.slice(0, 20), [...删了的.slice(0, 5), ...全部客户.slice(30, 45)], 全部客户, [全部客户[3]], ["不存在的", 全部客户[10]]];

describe("按主键取没删的：和直接查一样", () => {
  it("逐身份 × 几种 select × 几种名单：行（含带出来的关联）完全一样；删了的不出", async () => {
    let 有删了的被滤 = false;
    for (const 谁 of 谁们) {
      忘掉企业版范围();
      await 以谁的身份(谁, async () => {
        for (const ids of 名单们()) {
          for (const k of 几种(ids)) {
            const 旧 = await db.customer.findMany({ where: k.where, select: k.select });
            const 新 = await 按主键取没删的(() => db.customer.findMany({ where: k.where, select: { ...k.select, deletedAt: true } }) as Promise<{ deletedAt: Date | null }[]>);
            expect({ 谁, k: k.名, 行: 按id排(新 as { id?: unknown }[]) }).toEqual({ 谁, k: k.名, 行: 按id排(旧 as { id?: unknown }[]) });
            // 不带 deletedAt 的同一句（看已删）确实多出删了的：上面那条滤掉的是真删了的行
            const 连删 = await 看已删(() => db.customer.findMany({ where: k.where, select: { id: true } }));
            if (连删.length > 旧.length) 有删了的被滤 = true;
          }
        }
      });
    }
    expect(有删了的被滤).toBe(true);
  });

  it("关联照样只认没删的：学员名单每位最近一条跟进跳过删了的那条；看已删() 里连回收站一起取；带 take 的照常在库里滤", async () => {
    await 以谁的身份(总管, async () => {
      const ids = 全部客户.slice(0, 30);
      const 新 = await 按主键取没删的(() => db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, deletedAt: true, followUps: { select: { content: true }, orderBy: { occurredAt: "desc" } } } }));
      // 第 2 条（k = 2）是删了的：一条都不能带出来
      expect(新.flatMap((r) => r.followUps.map((f) => f.content))).not.toContain("第2条");
      expect(新.some((r) => r.followUps.length)).toBe(true);
      // 已经在 看已删() 里：不滤，同直接查
      const 回收站 = await 看已删(() => 按主键取没删的(() => db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, deletedAt: true } })));
      const 回收站旧 = await 看已删(() => db.customer.findMany({ where: { id: { in: ids } }, select: { id: true } }));
      expect(按id排(回收站)).toEqual(按id排(回收站旧));
      expect(回收站.length).toBeGreaterThan(新.length);
      // take：库里照常滤（不然先截再滤会少行）
      const 截 = await 按主键取没删的(() => db.customer.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, take: 5, select: { id: true, deletedAt: true } }));
      expect(截).toEqual(await db.customer.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, take: 5, select: { id: true } }));
      // 只管第一句：同一段里第二句照常补「没删」
      const [a, b] = await 按主键取没删的(async () => {
        const x = await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, deletedAt: true } });
        const y = await db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, deletedAt: true } });
        return [x.length, y.filter((r) => r.deletedAt !== null).length].map((n) => ({ n, deletedAt: null }));
      }).then((rs) => rs.map((r) => (r as unknown as { n: number }).n));
      expect(a).toBeGreaterThan(新.length);
      expect(b).toBe(0);
    });
  });

  it("查询计划（Prisma 真发出的句子）：改前顺 deletedAt 打头的索引扫，改后走主键", async () => {
    const ids = 全部客户.slice(0, 20);
    for (const 谁 of [总管, 经理, 小王, 回避人, 市员]) {
      忘掉企业版范围();
      await 以谁的身份(谁, async () => {
        for (const k of 几种(ids)) {
          const 旧 = await 顶层计划(() => db.customer.findMany({ where: k.where, select: k.select }));
          // 这条红了说明 SQLite 选法变了，按主键取的理由要重看
          expect({ 谁, k: k.名, 计划: 旧.计划 }).toMatchObject({ 计划: expect.stringMatching(/USING (COVERING )?INDEX Customer_deletedAt\w*_idx \(deletedAt=\?\)/) });
          const 新 = await 顶层计划(() => 按主键取没删的(() => db.customer.findMany({ where: k.where, select: { ...k.select, deletedAt: true } }) as Promise<{ deletedAt: Date | null }[]>));
          expect(新.sql).not.toMatch(/`main`\.`Customer`\.`deletedAt` IS NULL/);
          expect({ 谁, k: k.名, 计划: 新.计划 }).toMatchObject({ 计划: expect.stringMatching(/SEARCH (main\.)?Customer USING (COVERING )?INDEX sqlite_autoindex_Customer_1 \(id=\?\)/) });
          expect(新.计划).not.toMatch(/Customer_deletedAt\w*_idx/);
        }
      });
    }
  });
});

const 规整 = (rs: readonly { 属性: string; 快捷: string | null; 不全: unknown; n: unknown }[]) =>
  rs.map((r) => `${r.属性}|${r.快捷}|${r.不全 === null || r.不全 === undefined ? "null" : Number(r.不全)}|${Number(r.n)}`).sort();

describe("公海分组数拆开数：合起来 = 分组数SQL 整句", () => {
  const 整句 = async (筛: 客户行筛) => { const q = 分组数SQL(筛); return 规整(await raw.$queryRawUnsafe(q.sql, ...q.值)); };
  const 拆开 = async (筛: 客户行筛) => {
    const a = 按快捷分组数SQL(筛), b = 非线索分组数SQL(筛), x = 排掉分组数SQL(筛);
    const 全 = 合分组(await raw.$queryRawUnsafe(a.sql, ...a.值), await raw.$queryRawUnsafe(b.sql, ...b.值));
    return 规整(筛.排掉.length ? 减分组(全, await raw.$queryRawUnsafe(x.sql, ...x.值)) : 全);
  };
  const 名单组合 = () => {
    const 有 = 公海客户;
    return [
      { 商机: [], 订单: [] },
      { 商机: 有.slice(0, 8), 订单: 有.slice(8, 14) },
      // 两个名单都有的（属性 CASE 认商机）、名单上不在公海的、删了的、重复的
      { 商机: [...有.slice(0, 8), 全部客户[2], ...删了的.slice(0, 2)], 订单: [...有.slice(4, 12), 有[5], "不存在的"] },
      { 商机: [], 订单: 有.slice(20, 40) },
    ];
  };
  const 排掉组合 = () => [[], 公海客户.slice(0, 6), [...公海客户.slice(3, 15), ...删了的.slice(0, 2), 全部客户[2], 公海客户[3]], 公海客户];
  const 筛选组合: Partial<客户行筛>[] = [{}, { 来源: "r4_ch" }, { 号码不全: true }, { 来源: "r4_ch", 号码不全: true }, { 来源: "没有的渠道" }];

  it("逐个名单 × 排掉 × 筛选组合：每一组一样（含号码不全的 null / 0 / 1 分开的组、回收站里还挂着公海那行的）", async () => {
    let 有减掉 = false;
    for (const 名 of 名单组合()) for (const 排掉 of 排掉组合()) for (const 筛 of 筛选组合) {
      const f: 客户行筛 = { ...名, 排掉, ...筛 };
      const 旧 = await 整句(f);
      expect({ f, 组: await 拆开(f) }).toEqual({ f, 组: 旧 });
      if (排掉.length && 旧.join() !== (await 整句({ ...f, 排掉: [] })).join()) 有减掉 = true;
    }
    expect(有减掉).toBe(true);
    // 造的数据真有多种组：三种属性、几种快捷、号码不全三种值
    const 全 = await 整句({ 商机: 公海客户.slice(0, 8), 订单: 公海客户.slice(8, 14), 排掉: [] });
    for (const s of ["商机池|", "订单池|", "线索池|超时回收|", "|null|", "线索池|无效客户|", "线索池|多次退回|"]) expect(全.some((x) => x.includes(s))).toBe(true);
    expect(全.some((x) => x.startsWith("线索池|null|"))).toBe(true); // 离职交接不落快捷
  });

  it("页面用的 拆开数分组：缓存关着 / 开着都和整句一样；开着时经限定层写一笔马上作废", async () => {
    for (const 开 of [false, true]) {
      测试里开公海分组缓存(开);
      try {
        for (const 名 of 名单组合()) for (const 排掉 of 排掉组合()) {
          const f: 客户行筛 = { ...名, 排掉 };
          expect({ 开, f, 组: 规整(await 拆开数分组(f)) }).toEqual({ 开, f, 组: await 整句(f) });
        }
        if (开) {
          const f: 客户行筛 = { 商机: [], 订单: [], 排掉: 公海客户.slice(0, 3) };
          const 前 = 规整(await 拆开数分组(f));
          const 谁 = (await raw.customer.findFirstOrThrow({ where: { id: { in: 公海客户.slice(3) }, deletedAt: null, poolInvalidAt: null }, select: { id: true } })).id;
          await 看全部(() => db.customer.update({ where: { id: 谁 }, data: { poolInvalidAt: new Date() } }));
          const 后 = 规整(await 拆开数分组(f));
          expect(后).toEqual(await 整句(f));
          expect(后).not.toEqual(前);
          await raw.customer.update({ where: { id: 谁 }, data: { poolInvalidAt: null } });
        }
      } finally {
        测试里开公海分组缓存(false);
      }
    }
  });

  it("查询计划：非线索 / 排掉那两句从名单出发逐位走主键，不扫公海表；按快捷那句从公海表出发", async () => {
    const f: 客户行筛 = { 商机: 公海客户.slice(0, 8), 订单: 公海客户.slice(8, 14), 排掉: 公海客户.slice(0, 6), 来源: "r4_ch" };
    for (const q of [非线索分组数SQL(f), 排掉分组数SQL(f)]) {
      const p = await 计划(q.sql, JSON.stringify(q.值));
      expect(p).toMatch(/SEARCH p USING (COVERING )?INDEX sqlite_autoindex_CustomerPool_1 \(customerId=\?\)/);
      expect(p).toMatch(/SEARCH c USING INDEX sqlite_autoindex_Customer_1 \(id=\?\)/);
      expect(p).not.toMatch(/SCAN p\b/);
    }
    const a = 按快捷分组数SQL(f);
    expect(await 计划(a.sql, JSON.stringify(a.值))).toMatch(/SCAN p\b/);
  });
});

describe("公海全部跟进数：不连客户表的新写法 = 原来那句", () => {
  it("含不含回收站里的客户 × 几种筛选：数一样；不含的确实比含的少（回收站里的客户挂着公海行和没删的跟进）", async () => {
    // 回收站里的一位客户再挂两条没删的跟进（只有客户进了回收站，跟进自己没删），不含删了的客户 那路要排掉它们
    const 删的在公海 = 删了的.find((id) => 公海客户.includes(id))!;
    for (const type of ["PHONE", "VISIT"]) await raw.followUp.create({ data: { customerId: 删的在公海, type, ownerId: 经理, title: "跟进", content: "留着的", occurredAt: new Date() } });
    const 筛们: [string, string[]][] = [["", []], [' AND f."type" = ?', ["PHONE"]], [' AND f."ownerId" = ?', [经理]], [' AND f."type" = ? AND f."ownerId" = ?', ["VISIT", 小王]]];
    const 数 = async (sql: string, 值: string[]) => Number((await raw.$queryRawUnsafe<{ n: bigint | number }[]>(sql, ...值))[0].n);
    for (const [段, 值] of 筛们) {
      for (const 含 of [true, false]) {
        const 旧 = await 数(公海全部跟进数SQL_改前(段, 含), 值);
        expect({ 段, 含, n: await 数(公海全部跟进数SQL(段, 含), 含 ? 值 : [...值, ...值]) }).toEqual({ 段, 含, n: 旧 });
      }
    }
    expect(await 数(公海全部跟进数SQL_改前("", false), [])).toBeLessThan(await 数(公海全部跟进数SQL_改前("", true), []));
  });

  it("查询计划：不连客户表逐位查；回收站那头走 deletedAt 索引只碰回收站里的", async () => {
    const p = await 计划(公海全部跟进数SQL(' AND f."type" = ?', false), JSON.stringify(["PHONE", "PHONE"]));
    expect(p).toMatch(/SCAN p USING COVERING INDEX/);
    expect(p).toMatch(/FollowUp_customerId_deletedAt_type_ownerId_idx/);
    expect(p).toMatch(/SEARCH c USING (COVERING )?INDEX Customer_deletedAt\w* \(deletedAt>\?\)/);
    expect(p).not.toMatch(/SEARCH c USING (COVERING )?INDEX sqlite_autoindex_Customer_1/);
  });
});
