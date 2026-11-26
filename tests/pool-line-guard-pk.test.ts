/**
 * 4 核提速 B（11-16）：公海操作按线校验（pool-line-guard.ts 公海别线的）四句 id IN (…) 改按主键取。
 * 改前带着 deletedAt IS NULL，没统计信息的 SQLite 放着主键不走、顺 deletedAt 索引把整张客户表逐个比 id（8.5 万客户单句 ~6 ms）；
 * 改后「没删」挪到内存里滤（按主键取没删的）。这里钉两件事：
 *   - 结果和改前那四句（直接查、限定层补 deletedAt IS NULL）同一批行：内贸 / 外贸两条线 × 标签、负责人、公海历史负责人、说不清、回收站里的
 *   - 截下真发出去的四句：顶层不带 deletedAt、计划走主键，不走 deletedAt 打头的索引
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { PrismaClient } from "@/generated/prisma";
import { resetDb } from "./reset";
import { 等日志齐 } from "./query-log";
import { 加上限定, 看全部 } from "@/lib/team-scope";
import { 建组织, 填组织设置, type 组织 } from "@/lib/enterprise/org-core";
import { 公海别线的, 公海操作限线 } from "@/lib/enterprise/pool-line-guard";
import { 客户属线条件, 客户说不清线, 项目属线条件, 项目说不清线 } from "@/lib/enterprise/line-viewer";
import type { 业务线 } from "@/lib/sync/dept-policy";

const 人们 = [
  { id: "plg-in-mgr", bizRole: "sales_mgr", line: "内贸" },
  { id: "plg-out-mgr", bizRole: "sales_mgr", line: "外贸" },
  { id: "plg-in", bizRole: "sales", line: "内贸" },
  { id: "plg-out", bizRole: "sales", line: "外贸" },
  { id: "plg-boss", bizRole: "director", line: null },
];
const org: 组织 = 填组织设置(
  建组织(
    人们.map((m) => ({ id: m.id, role: "SALES", active: true })),
    人们.map((m) => ({ userId: m.id, deptId: null, bizRole: m.bizRole, line: m.line, managerId: null, dottedManagerId: null })),
    [],
  ),
  null, null, null,
);
const 外贸们 = 人们.filter((m) => m.line === "外贸").map((m) => m.id);

const 客户ids: string[] = [];
const 项目ids: string[] = [];

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  await resetDb();
  for (const m of 人们) await prisma.user.create({ data: { id: m.id, email: `${m.id}@x.com`, name: m.id, password: "x", role: "SALES" } });
  // 各种情形各来几位：标签内贸 / 外贸 / 暂不分配 / 没填 × 负责人内贸 / 外贸 × 在不在公海、谁放进来的 × 回收站里的
  const 标签们 = ["内贸", "外贸", "暂不分配", null, "坏值"];
  const 负责人们 = ["plg-in", "plg-out", "plg-boss"];
  for (let i = 0; i < 30; i++) {
    const 删 = i % 7 === 3;
    const c = await prisma.customer.create({
      data: { name: `线${i}`, phone: `1390000${String(i).padStart(4, "0")}`, salesOwnerId: 负责人们[i % 3], bizLine: 标签们[i % 5], deletedAt: 删 ? new Date() : null },
    });
    客户ids.push(c.id);
    if (i % 4 === 1) {
      await prisma.customerPool.create({ data: { customerId: c.id, reason: "手动" } });
      await prisma.customerOwnerLog.create({ data: { customerId: c.id, userId: "plg-boss", fromOwnerId: i % 8 === 1 ? "plg-out" : "plg-in", kind: "pool-release" } });
    }
    const p = await prisma.project.create({
      data: {
        name: `线项目${i}`, customerId: c.id, ownerId: 负责人们[(i + 1) % 3], creatorId: "plg-boss", bizLine: 标签们[(i + 2) % 5],
        pooledAt: i % 5 === 2 ? new Date() : null, deletedAt: i % 6 === 4 ? new Date() : null,
      },
    });
    项目ids.push(p.id);
    if (i % 5 === 2) await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: "plg-boss", toPhase: "公海", toNode: "公海", kind: "pool-release", fromOwnerId: i % 10 === 2 ? "plg-out" : "plg-in" } });
  }
  // 没在库里的编号也混进去（同改前：查不到就不算别线的）
  客户ids.push("plg-no-such-customer");
  项目ids.push("plg-no-such-project");
});

afterAll(async () => {
  await resetDb();
  delete process.env.CRM_ENTERPRISE;
});

/** 改前那四句的写法：直接查，限定层补 deletedAt IS NULL */
async function 改前(线: 业务线, ids: { 客户: string[]; 项目: string[] }) {
  const 差 = <T extends { id: string }>(全: T[], 放行: { id: string }[]) => 全.filter((x) => !new Set(放行.map((r) => r.id)).has(x.id));
  return 看全部(async () => ({
    客户: 差(
      await prisma.customer.findMany({ where: { id: { in: ids.客户 } }, select: { id: true, name: true } }),
      await prisma.customer.findMany({ where: { id: { in: ids.客户 }, OR: [客户属线条件(线, 外贸们), 客户说不清线] }, select: { id: true } }),
    ),
    项目: 差(
      await prisma.project.findMany({ where: { id: { in: ids.项目 } }, select: { id: true, name: true } }),
      await prisma.project.findMany({ where: { id: { in: ids.项目 }, OR: [项目属线条件(线, 外贸们), 项目说不清线] }, select: { id: true } }),
    ),
  }));
}
const 按id = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));

describe("公海别线的：按主键取，结果和改前同一批行", () => {
  it("内贸、外贸两条线的销售管理，整批 / 半批 / 只客户 / 只项目", async () => {
    let 有别线的 = 0;
    for (const me of ["plg-in-mgr", "plg-out-mgr"]) {
      const 线 = 公海操作限线({ id: me, role: "SALES" }, org)!;
      expect(线).toBeTruthy();
      for (const ids of [
        { 客户: 客户ids, 项目: 项目ids },
        { 客户: 客户ids.slice(0, 11), 项目: 项目ids.slice(9) },
        { 客户: 客户ids.slice(5), 项目: [] },
        { 客户: [], 项目: 项目ids.slice(3, 20) },
      ]) {
        const 新 = await 公海别线的(prisma, { id: me, role: "SALES" }, org, ids);
        const 旧 = await 改前(线, ids);
        expect({ me, 客户: 按id(新.客户), 项目: 按id(新.项目) }).toEqual({ me, 客户: 按id(旧.客户), 项目: 按id(旧.项目) });
        // 回收站里的不算别线的（查不到 = 放行，同改前）
        const 删了的 = new Set((await 看全部(() => prisma.customer.findMany({ where: { deletedAt: { not: null } }, select: { id: true } }))).map((c) => c.id));
        expect(新.客户.filter((c) => 删了的.has(c.id))).toEqual([]);
        有别线的 += 新.客户.length + 新.项目.length;
      }
    }
    // 数据真覆盖到了「有别线的」那一支
    expect(有别线的).toBeGreaterThan(0);
  });

  it("不限线的人（总管理）照旧两个空数组、一句不查", async () => {
    expect(await 公海别线的(prisma, { id: "plg-boss", role: "SALES" }, org, { 客户: 客户ids, 项目: 项目ids })).toEqual({ 客户: [], 项目: [] });
  });
});

describe("公海别线的：真发出去的四句走主键", () => {
  type 句 = { query: string; params: string };
  const 截 = new PrismaClient<import("@/generated/prisma").Prisma.PrismaClientOptions>({ datasourceUrl: `${process.env.DATABASE_URL}?connection_limit=1`, log: [{ emit: "event", level: "query" }] });
  const 句们: 句[] = [];
  (截 as unknown as { $on: (e: "query", f: (q: 句) => void) => void }).$on("query", (q) => 句们.push({ query: q.query, params: q.params }));
  const 限 = 加上限定(截);
  afterAll(() => 截.$disconnect());

  it("客户、项目各两句：顶层不带 deletedAt IS NULL，计划走主键、不顺 deletedAt 索引扫", async () => {
    // query 日志可能比结果晚到（见 tests/query-log.ts）：清之前先等前面的到齐，跑完再等齐了才找
    await 等日志齐(截, 句们);
    句们.length = 0;
    await 公海别线的(限, { id: "plg-in-mgr", role: "SALES" }, org, { 客户: 客户ids, 项目: 项目ids });
    await 等日志齐(截, 句们);
    for (const 表 of ["Customer", "Project"]) {
      const 主 = 句们.filter((q) => q.query.startsWith("SELECT") && q.query.includes(`FROM \`main\`.\`${表}\` `) && q.query.includes(`\`${表}\`.\`id\` IN (`));
      expect(主.length, 表).toBe(2);
      for (const q of 主) {
        expect(q.query).not.toContain(`\`${表}\`.\`deletedAt\` IS NULL)`);
        const 计划 = (await prisma.$queryRawUnsafe<{ detail: string }[]>(`EXPLAIN QUERY PLAN ${q.query}`, ...JSON.parse(q.params))).map((r) => r.detail).join("\n");
        const 顶层 = 计划.split("\n").find((l) => l.includes(`${表} USING`) || l.startsWith(`SCAN ${表}`))!;
        expect(顶层, `${表}: ${计划}`).toMatch(new RegExp(`SEARCH (main\\.)?${表} USING INDEX sqlite_autoindex_${表}_1 \\(id=\\?\\)`));
      }
    }
  });
});
