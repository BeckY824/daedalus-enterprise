/**
 * 4 核提速 C（11-16）：记录页窄名单「最近 50 位」不限定的人改走裸 SQL（scope-sql.ts 不限定时最近跟进的客户）+ 索引 (lastFollowAt, createdAt, id)（迁移 143）。
 * 钉三件事：
 *   - 只有真不限定的人走新路：总管理、只读管理员、规则关着的人；有市场只读、原负责人回避（名单过上限 / 规则关着带回避）、
 *     业务员、没设角色的都回 null（ids === null 不等于不限定，Fable 评估风险 3），走原来那条路
 *   - 走新路的，50 位和顺序跟改前那句（Prisma：客户筛选条件({}) + orderBy lastFollowAt, createdAt + take 50）一模一样；看已删()、不是企业版也一样
 *   - 计划：新那句顺 (lastFollowAt, createdAt, id) 不排序；名下不到 50 位的销售「我的」那句、名下那句都不被这条索引抢走（风险 5）
 * 用拷出来的一份库、显式单连接，不碰共用的测试库（同 scope-sql-split.test.ts）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-recent-unscoped-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient<import("@/generated/prisma").Prisma.PrismaClientOptions>({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { prisma as db, defaultClient as raw } from "@/lib/prisma";
import { 回填放回人列 } from "./helpers/pool-prev-owner-seed";
import { PrismaClient } from "@/generated/prisma";
import { 等日志齐 } from "./query-log";
import { 加上限定 } from "@/lib/team-scope";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 最近跟进的客户, 不限定时最近跟进的客户, 看得到的范围SQL } from "@/lib/scope-sql";
import { 客户筛选条件 } from "@/app/(app)/customers/query";

const 总管理 = "r_boss", 管理员 = "r_ro", 经理 = "r_mgr", 小王 = "r_wang", 外人 = "r_out", 市管 = "r_mkt", 市员 = "r_mkt1", 回避人 = "r_back", 没角色 = "r_none", 占位 = "r_hold";
const 排序 = [{ lastFollowAt: "desc" as const }, { createdAt: "desc" as const }];
const 新索引 = "Customer_lastFollowAt_createdAt_id_idx";

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ProjectMember", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerOwnerLog", "CustomerCreator", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [总管理, 管理员, 经理, 小王, 外人, 市管, 市员, 回避人, 没角色]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  await raw.user.create({ data: { id: 占位, email: 无负责人占位邮箱, name: "占位", password: "x", role: "SALES" } });
  await raw.entMember.createMany({
    data: [
      { userId: 总管理, bizRole: "director" },
      { userId: 管理员, bizRole: "admin" },
      { userId: 经理, bizRole: "sales_mgr" },
      { userId: 小王, managerId: 经理, bizRole: "sales" },
      { userId: 外人, bizRole: "sales" },
      { userId: 市管, bizRole: "marketing_mgr" },
      { userId: 市员, managerId: 市管, bizRole: "channel_ops" },
      { userId: 回避人, managerId: 经理, bizRole: "sales" },
    ],
  });
  // 不在公海的：外人名下 90 位（超过 50 位，LIMIT 才有意义）、小王 6 位（不到 50 位）、经理 4 位、回避人 3 位；
  // 跟进时间各不相同、有的没跟进过（排最后，按建档时间排）；有几位在回收站里
  const 日 = (d: number, h = 0) => new Date(Date.UTC(2026, 8, 1 + d, h));
  let k = 0;
  const 建 = async (owner: string, n: number) => {
    for (let i = 0; i < n; i++, k++) {
      await raw.customer.create({
        data: {
          name: `客户${k}`, phone: `138${String(k).padStart(8, "0")}`, salesOwnerId: owner,
          createdAt: 日(k % 40, k % 24), lastFollowAt: k % 5 === 4 ? null : 日(40 + ((k * 37) % 90), k % 23),
          deletedAt: k % 11 === 7 ? new Date() : null,
          ...(k % 9 === 0 ? { creator: { create: { userId: 市员 } } } : {}),
        },
      });
    }
  };
  await 建(外人, 90);
  await 建(小王, 6);
  await 建(经理, 4);
  await 建(回避人, 3);
  // 公海：跟进时间最新的那批也进公海（不该出现在名单里）
  const 最新 = await raw.customer.findMany({ where: { salesOwnerId: 外人 }, orderBy: [{ lastFollowAt: "desc" }], take: 12, select: { id: true } });
  await raw.customerPool.createMany({ data: 最新.filter((_, i) => i % 2 === 0).map((c) => ({ customerId: c.id, userId: 经理 })) });
  // 回避名单过上限（> 100）：回避人放进公海、负责人清成占位的 105 位
  for (let i = 0; i < 105; i++) {
    const c = await raw.customer.create({ data: { name: `放走的${i}`, phone: `137${String(i).padStart(8, "0")}`, salesOwnerId: 占位, lastFollowAt: 日(200 + i) } });
    await raw.customerPool.create({ data: { customerId: c.id, userId: 回避人, reason: "手动" } });
    await raw.customerOwnerLog.create({ data: { customerId: c.id, userId: 回避人, fromOwnerId: 回避人, toOwnerId: 占位, kind: "pool-release" } });
  }
  await 回填放回人列(raw); // 直接塞留痕的造数，补两列（回避只认 poolPrevOwnerId，E-417 包 2）
  // 同键（lastFollowAt、createdAt 都一样）的不放：两边都没定同键先后，比不出「同一顺序」
  const 键 = await raw.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM "Customer" GROUP BY "lastFollowAt", "createdAt" HAVING COUNT(*) > 1)`);
  expect(Number(键[0].n)).toBe(0);
});

beforeEach(() => 忘掉企业版范围());

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

async function 开规则(开: boolean) {
  await raw.setting.deleteMany({ where: { key: 规则.按组织看客户.key } });
  if (开) await raw.setting.create({ data: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
  忘掉企业版范围();
}

/** 学员名单取编号那一步（panes.tsx）：走哪条路、取到的 50 位；和改前那句比 */
async function 名单(谁: string, 包 = <T,>(f: () => Promise<T>) => f()) {
  return 以谁的身份(谁, () => 包(async () => {
    const 改前 = (await db.customer.findMany({ where: await 客户筛选条件({}, 谁), orderBy: 排序, take: 50, select: { id: true } })).map((c) => c.id);
    const 范围 = await 最近跟进的客户(50);
    const 不限 = 范围 ? null : await 不限定时最近跟进的客户(50);
    const 路 = 范围 ? "范围裸SQL" : 不限 ? "不限定裸SQL" : "Prisma";
    return { 路, 改前, 新: 范围 ?? 不限 };
  }));
}

describe("学员名单「最近 50 位」：只有真不限定的人走新路，50 位和顺序同改前", () => {
  it("按组织看客户开着：逐个身份", async () => {
    await 开规则(true);
    const 期望: Record<string, string> = {
      [总管理]: "不限定裸SQL", [管理员]: "不限定裸SQL",
      [经理]: "范围裸SQL", [小王]: "范围裸SQL", [外人]: "范围裸SQL", [没角色]: "范围裸SQL",
      // 有市场只读：看得到的() 回 null，不是不限定
      [市管]: "Prisma",
      // 原负责人回避名单过上限：看得到的() 回 null，不是不限定
      [回避人]: "Prisma",
    };
    for (const [谁, 路] of Object.entries(期望)) {
      const r = await 名单(谁);
      expect({ 谁, 路: r.路 }).toEqual({ 谁, 路 });
      if (r.新) expect({ 谁, ids: r.新 }).toEqual({ 谁, ids: r.改前 });
    }
    // 真过了上限、真有市场只读：这两位的 ids === null 和不限定的人一样，靠的是新函数自己再认一遍
    const 回避 = await 以谁的身份(回避人, 看得到的范围SQL);
    expect(回避).toBeNull();
    // 不限定的人取满 50 位，公海的、回收站里的一位不混
    const 总 = await 名单(总管理);
    expect(总.新!.length).toBe(50);
    const 公海 = new Set((await raw.customerPool.findMany({ select: { customerId: true } })).map((p) => p.customerId));
    const 删了 = new Set((await raw.customer.findMany({ where: { deletedAt: { not: null } }, select: { id: true } })).map((c) => c.id));
    expect(总.新!.filter((id) => 公海.has(id) || 删了.has(id))).toEqual([]);
  });

  it("按组织看客户关着：能看全部的、没回避的走新路；带回避的照旧", async () => {
    // 外人名下有几位在公海（负责人还是他）：要回避，限定的我() 为空但带着公海回避，不算不限定
    await 开规则(false);
    for (const [谁, 路] of [[总管理, "不限定裸SQL"], [管理员, "不限定裸SQL"], [经理, "不限定裸SQL"], [小王, "不限定裸SQL"], [外人, "Prisma"], [回避人, "Prisma"]] as const) {
      const r = await 名单(谁);
      expect({ 谁, 路: r.路 }).toEqual({ 谁, 路 });
      if (r.新) expect({ 谁, ids: r.新 }).toEqual({ 谁, ids: r.改前 });
    }
    await 开规则(true);
  });

  it("看已删() 里（连回收站一起看）、不是企业版：同样和改前那句一样", async () => {
    await 开规则(true);
    const 删 = await 名单(总管理, 看已删);
    expect(删.路).toBe("不限定裸SQL");
    expect(删.新).toEqual(删.改前);
    delete process.env.CRM_ENTERPRISE;
    try {
      忘掉企业版范围();
      const 非 = await 名单(总管理);
      expect(非.路).toBe("不限定裸SQL");
      expect(非.新).toEqual(非.改前);
    } finally {
      process.env.CRM_ENTERPRISE = "1";
      忘掉企业版范围();
    }
  });
});

describe("计划：新那句走 (lastFollowAt, createdAt, id)；名下不到 50 位的销售那几句不被它抢走", () => {
  type 句 = { query: string; params: string };
  const 截 = new PrismaClient<import("@/generated/prisma").Prisma.PrismaClientOptions>({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1`, log: [{ emit: "event", level: "query" }] });
  const 句们: 句[] = [];
  (截 as unknown as { $on: (e: "query", f: (q: 句) => void) => void }).$on("query", (q) => 句们.push({ query: q.query, params: q.params }));
  const 限 = 加上限定(截);
  afterAll(() => 截.$disconnect());
  const 计划 = async (sql: string, ...值: unknown[]) => (await raw.$queryRawUnsafe<{ detail: string }[]>(`EXPLAIN QUERY PLAN ${sql}`, ...值)).map((r) => r.detail).join("\n");

  it("迁移 143 的索引建上了；新那句顺它倒着走、不整表排序", async () => {
    const 有 = (await raw.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type = 'index'`)).map((r) => r.name);
    expect(有).toContain(新索引);
    await 开规则(true);
    const 一 = vi.spyOn(db, "$queryRawUnsafe");
    await 以谁的身份(总管理, () => 不限定时最近跟进的客户(50));
    const [sql, ...值] = 一.mock.calls.find((c) => String(c[0]).includes("ORDER BY c.\"lastFollowAt\""))! as [string, ...unknown[]];
    一.mockRestore();
    expect(sql).toContain('+c."deletedAt" IS NULL');
    const p = await 计划(sql, ...值);
    expect(p).toContain(新索引);
    expect(p).not.toContain("TEMP B-TREE");
  });

  it("小王（名下不到 50 位）：「我的」那句和名下那句都不走新索引，照旧走负责人打头的", async () => {
    await 开规则(true);
    expect(await raw.customer.count({ where: { salesOwnerId: 小王, deletedAt: null } })).toBeLessThan(50);
    // query 日志可能比结果晚到（见 tests/query-log.ts）：清之前先等前面的到齐，跑完再等齐了才找
    await 等日志齐(截, 句们);
    句们.length = 0;
    await 以谁的身份(小王, async () => 限.customer.findMany({ where: { AND: [await 客户筛选条件({}, 小王), { salesOwnerId: 小王 }] }, orderBy: 排序, take: 50, select: { id: true } }));
    await 等日志齐(截, 句们);
    const 我的 = 句们.filter((q) => q.query.startsWith("SELECT") && q.query.includes("FROM `main`.`Customer`") && q.query.includes("ORDER BY")).at(-1)!;
    expect(我的, "没截到「我的」那句").toBeTruthy();
    const p我的 = await 计划(我的.query, ...JSON.parse(我的.params));
    expect(p我的).not.toContain(新索引);
    expect(p我的).toContain("Customer_salesOwnerId");
    // 名下那句（最近跟进的客户，裸 SQL）
    const 范围 = (await 以谁的身份(小王, 看得到的范围SQL))!;
    const p名下 = await 计划(`SELECT c.id FROM "Customer" c WHERE ${范围.名下.where} ORDER BY c."lastFollowAt" DESC, c."createdAt" DESC LIMIT ?`, ...范围.名下.参数, 50);
    expect(p名下).not.toContain(新索引);
    expect(p名下).toContain("Customer_salesOwnerId");
    // 不限定的人按负责人筛（客户列表挑一个人）也不被抢走
    await 等日志齐(截, 句们);
    句们.length = 0;
    await 以谁的身份(总管理, async () => 限.customer.findMany({ where: { AND: [await 客户筛选条件({}, 总管理), { salesOwnerId: 小王 }] }, orderBy: 排序, take: 50, select: { id: true } }));
    await 等日志齐(截, 句们);
    const 按人 = 句们.filter((q) => q.query.startsWith("SELECT") && q.query.includes("FROM `main`.`Customer`") && q.query.includes("ORDER BY")).at(-1)!;
    const p按人 = await 计划(按人.query, ...JSON.parse(按人.params));
    expect(p按人).not.toContain(新索引);
    expect(p按人).toContain("Customer_salesOwnerId");
  });
});
