/**
 * 补记 2026-11 市场成员新建时直接指定的分配记录（scripts/backfill-direct-assign-202611.cjs，口径同 lib/enterprise/direct-assign.ts）：
 *   - 以项目为单位；建的人是市场成员（业务角色）、初始负责人（最早一条换负责人留痕的 from，没有就是现负责人）≠ 建的人
 *   - 只补新建那一下（和客户一起建、或客户页新增项目带首条沟通）；已有分配记录、导入、已删、不在本月（北京时间）的不补
 *   - 真写一个事务，核对不过整批回滚；补完再跑没有要补的
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 本月已分 } from "@/lib/enterprise/lead-assign";

const 脚本 = path.resolve(__dirname, "../scripts/backfill-direct-assign-202611.cjs");
const 库 = String(process.env.DATABASE_URL).replace(/^file:/, "");
type 计划行 = { projectId: string; 接手人: string; line: string | null; month: string; createdAt: number };
/**
 * 脚本的函数放到子进程里跑：同一个进程里 node:sqlite 和 prisma 各带一份 SQLite，
 * 一边关库会连带放掉另一边的 POSIX 锁（WAL 被当成没人用了），后面读写就对不上
 */
function 子进程跑<T>(体: string): T {
  const 码 = `const 补 = require(${JSON.stringify(脚本)}); const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(${JSON.stringify(库)}); db.exec("PRAGMA busy_timeout = 5000");
let 出; try { ${体} } catch (e) { 出 = { 错: String(e && e.message || e) }; } finally { db.close(); }
process.stdout.write(JSON.stringify(出));`;
  const r = spawnSync(process.execPath, ["--no-warnings", "-e", 码], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout) as T;
}
const 算计划 = () => 子进程跑<{ 计划: 计划行[]; 排除: Record<string, number>; 客户层: { 没有项目: string[] } }>("出 = 补.算计划(db); 出.人名 = undefined;");

afterAll(() => prisma.$disconnect());

let 市场: string, 销售A: string, 销售B: string;
const 时 = (s: string) => new Date(s);
const 本月 = 时("2026-11-10T02:00:00Z");
let 号 = 0;
const 客户 = async (createdAt: Date, 补: Record<string, unknown> = {}) =>
  (await prisma.customer.create({ data: { name: `客户${++号}`, phone: `1380000${String(号).padStart(4, "0")}`, salesOwnerId: 市场, createdAt, ...补 } })).id;
const 项目 = async (customerId: string, ownerId: string, creatorId: string, createdAt: Date, 补: Record<string, unknown> = {}) =>
  (await prisma.project.create({ data: { name: `项目${++号}`, customerId, ownerId, creatorId, createdAt, ...补 } })).id;
const 转过 = (projectId: string, from: string, to: string, at: Date) =>
  prisma.projectNodeLog.create({ data: { projectId, userId: from, toPhase: "线索", toNode: "潜客培育", kind: "transfer", fromOwnerId: from, toOwnerId: to, at } });

let 该补: Record<string, { 给: string; line: string | null }>;

beforeEach(async () => {
  await resetDb();
  号 = 0;
  const 人 = async (email: string, bizRole: string | null, 补: { deptId?: string; line?: string } = {}) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } })).id;
    if (bizRole) await prisma.entMember.create({ data: { userId: id, bizRole, ...补 } });
    return id;
  };
  const 外贸部 = (await prisma.entDept.create({ data: { name: "外贸事业部" } })).id;
  市场 = await 人("mkt", "channel_ops,marketing_mgr");
  销售A = await 人("sa", "sales", { line: "内贸" });
  销售B = await 人("sb", "sales", { deptId: 外贸部 });
  const 占位 = await 人("no-owner@placeholder.local", null);

  // 补：建档向导指定（项目和客户一起建）
  const c1 = await 客户(本月);
  const p1 = await 项目(c1, 销售A, 市场, 本月, { bizLine: "内贸" });
  // 补：客户页新增项目（老客户，项目带建的人同一刻的首条沟通）；业务线暂不分配 → 按客户区域（美国）外贸
  const c2 = await 客户(时("2026-10-01T00:00:00Z"), { addrCountry: "美国" });
  const p2 = await 项目(c2, 销售B, 市场, 本月, { bizLine: "暂不分配" });
  const f2 = await prisma.followUp.create({ data: { customerId: c2, ownerId: 市场, type: "PHONE", title: "", content: "首条", createdAt: 本月 } });
  await prisma.followUpProject.create({ data: { followUpId: f2.id, projectId: p2, node: "潜客培育" } });
  // 补：建给 A、后来转给 B → 记初始负责人 A；没业务线、没地址，按客户的号（国外）外贸
  const c6 = await 客户(本月, { phone: "+14155550123" });
  const p6 = await 项目(c6, 销售B, 市场, 本月);
  await 转过(p6, 销售A, 销售B, 时("2026-11-12T00:00:00Z"));
  // 补：北京时间 11-01 00:00 整（边界）；什么都判不出 → 接手人 B 的事业部（部门名带外贸）
  const c11 = await 客户(时("2026-10-31T16:00:00Z"), { phone: "" });
  const p11 = await 项目(c11, 销售B, 市场, 时("2026-10-31T16:00:00Z"));
  该补 = { [p1]: { 给: 销售A, line: "内贸" }, [p2]: { 给: 销售B, line: "外贸" }, [p6]: { 给: 销售A, line: "外贸" }, [p11]: { 给: 销售B, line: "外贸" } };

  // 不补：已有分配记录（走过自动分配）
  const p3 = await 项目(await 客户(本月), 销售A, 市场, 本月);
  await prisma.entLeadAssign.create({ data: { projectId: p3, toUserId: 销售A, byUserId: 市场, fromUserId: 市场, month: "2026-11", way: "自动分配" } });
  // 不补：销售自建
  await 项目(await 客户(本月), 销售A, 销售A, 本月);
  // 不补：市场建给自己、后来转出（转的那次走分配线索）
  const p5 = await 项目(await 客户(本月), 销售B, 市场, 本月);
  await 转过(p5, 市场, 销售B, 时("2026-11-11T00:00:00Z"));
  // 不补：公海领取 / 分配时补的潜客培育（老客户、没有首条沟通）
  await 项目(await 客户(时("2026-09-01T00:00:00Z")), 销售A, 市场, 本月);
  // 不补：导入
  await 项目(await 客户(本月), 销售A, 市场, 本月, { importBatch: "b1" });
  // 不补：已删
  await 项目(await 客户(本月), 销售A, 市场, 本月, { deletedAt: 本月 });
  // 不补：北京时间 10-31 23:59:59（上个月）
  const c10 = await 客户(时("2026-10-31T15:59:59Z"));
  await 项目(c10, 销售A, 市场, 时("2026-10-31T15:59:59Z"));
  // 不补：初始负责人是公海占位
  await 项目(await 客户(本月), 占位, 市场, 本月);
  // 客户层参考：市场建档、没项目
  const 空客户 = await 客户(本月, { salesOwnerId: 销售A });
  await prisma.customerCreator.create({ data: { customerId: 空客户, userId: 市场 } });
});

describe("算计划（演练）", () => {
  it("只取该补的 4 个项目：接手人 = 初始负责人，line 按 业务线 → 区域 → 号 → 接手人事业部", async () => {
    const r = 算计划();
    expect(Object.fromEntries(r.计划.map((x) => [x.projectId, { 给: x.接手人, line: x.line }]))).toEqual(该补);
    expect(r.计划.every((x) => x.month === "2026-11")).toBe(true);
    expect(r.排除).toMatchObject({ 已有分配记录: 1, 建的人不是市场成员: 1, 初始负责人就是建的人: 1, 不是新建那一下: 1, 导入或同步: 1, 已删: 1, 初始负责人推不出: 1 });
    expect(r.客户层.没有项目).toHaveLength(1);
  });

  it("命令行默认演练：退出 0、库不动；没给 --db 退出 1", async () => {
    const r = spawnSync(process.execPath, ["--no-warnings", 脚本, "--db", 库], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("要补 4 条");
    expect(r.stdout).toContain("总条数：4");
    expect(await prisma.entLeadAssign.count()).toBe(1);
    expect(spawnSync(process.execPath, ["--no-warnings", 脚本], { encoding: "utf8" }).status).toBe(1);
  });
});

describe("真写", () => {
  it("写 4 条：字段齐、createdAt = 项目建档时间；本月已分跟着变；再跑没有要补的", async () => {
    const r = spawnSync(process.execPath, ["--no-warnings", 脚本, "--db", 库, "--write"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain("写前 1 条、写后 5 条（+4）");
    const 们 = await prisma.entLeadAssign.findMany({ where: { projectId: { in: Object.keys(该补) } } });
    expect(们).toHaveLength(4);
    for (const x of 们) {
      const p = await prisma.project.findUniqueOrThrow({ where: { id: x.projectId! } });
      expect(x).toMatchObject({ toUserId: 该补[x.projectId!].给, line: 该补[x.projectId!].line, byUserId: 市场, fromUserId: 市场, leadId: "", kind: "营销", way: "指定分配", counted: true, month: "2026-11" });
      expect(x.createdAt.getTime()).toBe(p.createdAt.getTime());
      expect(x.id).toMatch(/^c[0-9a-z]{24}$/);
    }
    expect([await 本月已分(销售A, "2026-11"), await 本月已分(销售B, "2026-11")]).toEqual([3, 2]);
    expect(算计划().计划).toHaveLength(0);
  });

  it("核对不过（写的时候多出一条）：整批回滚、抛错，库不动", async () => {
    // 每插一条就多插一条（只在脚本这条连接上的临时触发器）：写后条数对不上
    const r = 子进程跑<{ 错?: string }>(`db.exec(\`CREATE TEMP TRIGGER 多一条 AFTER INSERT ON "EntLeadAssign" WHEN NEW."id" NOT LIKE 'x%' BEGIN
      INSERT INTO "EntLeadAssign" ("id", "leadId", "projectId", "toUserId", "byUserId", "kind", "counted", "month", "createdAt")
      VALUES ('x' || NEW."id", '', NEW."projectId", NEW."toUserId", NEW."byUserId", '营销', 1, NEW."month", NEW."createdAt"); END\`);
      出 = 补.写入(db);`);
    expect(r.错).toMatch(/已回滚/);
    expect(await prisma.entLeadAssign.count()).toBe(1);
  });
});
