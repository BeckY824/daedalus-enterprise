/**
 * 可见范围拆两路（8.5 万客户提速，11-14）：拆前那一句（名下 OR 在公海，看得到的范围SQL().where）和拆后两路
 * （名下 + 公海另数，看得到的客户数 / 看得到的跟进数 / 最近跟进的客户）结果集逐个身份完全相同，也和 Prisma 限定层一致。
 * 身份：系统管理员、条线总管理、只读管理员、按线只读、销售管理（实线 / 虚线下属）、普通销售、渠道运营、市场管理、
 * 项目组员、原负责人回避（负责人是他的公海客户 + 占位负责人名单）、没设角色、停用、没认出人；
 * 按组织看客户开 / 关 × 有没有项目组员（含组员名单过上限退回子查询）。用拷出来的一份库、显式单连接，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-scope-split-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { prisma as db, defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 看得到的范围SQL, 看得到的客户数, 看得到的跟进数, 最近跟进的客户 } from "@/lib/scope-sql";

const 系管 = "s_sys", 线总 = "s_line", 只读 = "s_ro", 线读 = "s_rol", 经理 = "s_mgr", 小王 = "s_wang", 小张 = "s_zhang", 小赵 = "s_zhao";
const 外人 = "s_other", 渠运 = "s_chan", 市管 = "s_mkt", 市员 = "s_mkt1", 组员 = "s_pm", 回避人 = "s_back", 没角色 = "s_none", 停用 = "s_off", 占位 = "s_hold";
const 谁们 = [系管, 线总, 只读, 线读, 经理, 小王, 小张, 小赵, 外人, 渠运, 市管, 市员, 组员, 回避人, 没角色, 停用, "ghost"];
const 负责人们 = [经理, 小王, 小张, 小赵, 外人, 渠运, 市员, 组员, 回避人, 系管, 线总];
const 编号: string[] = [];
const 外人的: string[] = [];

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ProjectMember", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerOwnerLog", "CustomerCreator", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [系管, 线总, 只读, 线读, 经理, 小王, 小张, 小赵, 外人, 渠运, 市管, 市员, 组员, 回避人, 没角色, 停用]) {
    await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: id === 系管 ? "ADMIN" : "SALES", active: id !== 停用 } });
  }
  await raw.user.create({ data: { id: 占位, email: 无负责人占位邮箱, name: "占位", password: "x", role: "SALES" } });
  await raw.entMember.createMany({
    data: [
      { userId: 系管, bizRole: "director" },
      { userId: 线总, bizRole: "director", line: "内贸" },
      { userId: 只读, bizRole: "admin" },
      { userId: 线读, bizRole: "admin", line: "外贸" },
      { userId: 经理, bizRole: "sales_mgr", line: "内贸" },
      { userId: 小王, managerId: 经理, bizRole: "sales", line: "内贸" },
      { userId: 小张, dottedManagerId: 经理, bizRole: "sales" },
      { userId: 小赵, managerId: 小张, bizRole: "sales" },
      { userId: 外人, bizRole: "sales", line: "外贸" },
      { userId: 渠运, bizRole: "channel_ops" },
      { userId: 市管, bizRole: "marketing_mgr" },
      { userId: 市员, managerId: 市管, bizRole: "channel_ops" },
      { userId: 组员, bizRole: "sales" },
      { userId: 回避人, managerId: 经理, bizRole: "sales" },
      { userId: 停用, bizRole: "sales" },
    ],
  });
  const 日 = (d: number, h = 0) => new Date(Date.UTC(2026, 9, d, h));
  const 类 = ["PHONE", "MEETING", "VISIT", "OTHER"];
  for (let i = 0; i < 负责人们.length * 9; i++) {
    const o = 负责人们[i % 负责人们.length];
    const c = await raw.customer.create({
      data: {
        name: `客户${i}`,
        phone: `138${String(i).padStart(8, "0")}`,
        salesOwnerId: o,
        ...(i % 4 === 0 ? { creator: { create: { userId: 市员 } } } : {}),
        ...(i % 6 === 0 ? { channelOwnerId: 经理 } : {}),
        lastFollowAt: i % 5 === 0 ? null : 日(1 + (i % 7), i % 2),
        createdAt: 日(1, i % 3),
        // 回收站里的：名下、公海里各有几位，两路都不能算
        deletedAt: i % 13 === 0 ? 日(9) : null,
      },
    });
    编号.push(c.id);
    if (o === 外人) 外人的.push(c.id);
    for (let k = 0; k < 3; k++) {
      await raw.followUp.create({
        data: { customerId: c.id, type: 类[(i + k) % 类.length], ownerId: k === 2 ? 经理 : o, title: "跟进", content: "跟进", occurredAt: 日(1 + k), deletedAt: (i + k) % 11 === 0 ? 日(9) : null },
      });
    }
  }
  // 公海：各家的都有、回避人自己的、回收站里的
  const 进公海 = 编号.filter((_, i) => i % 4 === 1 || i % 7 === 0);
  await raw.customerPool.createMany({ data: 进公海.map((customerId, k) => ({ customerId, userId: k % 3 ? 经理 : null, at: 日(1 + (k % 5)) })) });
  // 回避名单那一半：回避人放进公海、负责人清成占位的（客户侧只认最近一次 pool-release）
  for (let k = 0; k < 3; k++) {
    const c = await raw.customer.create({ data: { name: `放走的${k}`, phone: `137${k}0000000`, salesOwnerId: 占位, createdAt: 日(2) } });
    await raw.customerPool.create({ data: { customerId: c.id, userId: 回避人, reason: "手动" } });
    await raw.customerOwnerLog.create({ data: { customerId: c.id, userId: 回避人, fromOwnerId: 回避人, toOwnerId: 占位, kind: "pool-release" } });
    await raw.followUp.create({ data: { customerId: c.id, type: "PHONE", ownerId: 回避人, title: "跟进", content: "跟进" } });
  }
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

/** 组员：外人名下的几位客户挂项目，组员点了同意的算、没同意的和删了的项目不算 */
async function 设组员(几位: number) {
  await raw.projectMember.deleteMany({});
  await raw.project.deleteMany({});
  // 过上限要的是几百位不同的客户：外人名下不够就补（不跟进、不进公海）
  while (外人的.length < 几位) {
    const c = await raw.customer.create({ data: { name: `补${外人的.length}`, phone: `136${String(外人的.length).padStart(8, "0")}`, salesOwnerId: 外人 } });
    外人的.push(c.id);
  }
  for (let k = 0; k < 几位; k++) {
    const cid = 外人的[k];
    const p = await raw.project.create({ data: { name: `项目${k}`, customerId: cid, ownerId: 外人, creatorId: 外人, deletedAt: k === 1 ? new Date() : null } });
    await raw.projectMember.create({ data: { projectId: p.id, userId: 组员, inviteStatus: k === 2 ? "INVITED" : "JOINED" } });
  }
  忘掉企业版范围();
}

const 数 = (r: { n: bigint | number }[]) => Number(r[0].n);
const 跟进筛们 = [{}, { type: "PHONE" }, { ownerId: 经理 }, { type: "MEETING", ownerId: 外人 }];

/** 一个身份：拆前那句 vs 拆后各函数 vs Prisma。回 "快路" / "Prisma"（拆前也是 null，只能和 Prisma 比） */
async function 对拍(谁: string) {
  return 以谁的身份(谁, async () => {
    const 范围 = await 看得到的范围SQL();
    const 新数 = await 看得到的客户数();
    expect({ 谁, n: 新数 }).toEqual({ 谁, n: await db.customer.count() });
    const 新跟进 = [] as number[];
    for (const 筛 of 跟进筛们) {
      const n = await 看得到的跟进数(筛);
      新跟进.push(n);
      // Prisma 那句不排回收站里客户的跟进（改前裸 SQL 就排，两边本来差这一截，不是这次的事），走快路时对拍补上
      expect({ 谁, 筛, n }).toEqual({ 谁, 筛, n: await db.followUp.count({ where: 范围 ? { ...筛, customer: { deletedAt: null } } : 筛 }) });
    }
    if (!范围) {
      expect(await 最近跟进的客户(1000)).toBeNull();
      return "Prisma" as const;
    }
    // 拆前那句：客户集合
    const 旧集 = (await raw.$queryRawUnsafe<{ id: string }[]>(`SELECT c.id FROM "Customer" c WHERE ${范围.where}`, ...范围.参数)).map((r) => r.id).sort();
    const 名下 = (await raw.$queryRawUnsafe<{ id: string }[]>(`SELECT c.id FROM "Customer" c WHERE ${范围.名下.where}`, ...范围.名下.参数)).map((r) => r.id);
    const 公海 = (await db.customer.findMany({ where: { pool: { isNot: null } }, select: { id: true } })).map((r) => r.id);
    expect(名下.filter((id) => 公海.includes(id))).toEqual([]); // 两路不相交
    expect({ 谁, 集: [...名下, ...公海].sort() }).toEqual({ 谁, 集: 旧集 });
    expect(新数).toBe(旧集.length);
    // 拆前那句的跟进数
    for (const [i, 筛] of 跟进筛们.entries()) {
      const 段: string[] = [`f."customerId" IN (SELECT c.id FROM "Customer" c WHERE ${范围.where})`, `f."deletedAt" IS NULL`];
      const 值: string[] = [...范围.参数];
      if ("type" in 筛 && 筛.type) {
        段.push(`f."type" = ?`);
        值.push(筛.type);
      }
      if ("ownerId" in 筛 && 筛.ownerId) {
        段.push(`f."ownerId" = ?`);
        值.push(筛.ownerId);
      }
      expect({ 谁, 筛, n: 新跟进[i] }).toEqual({ 谁, 筛, n: 数(await raw.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "FollowUp" f WHERE ${段.join(" AND ")}`, ...值)) });
    }
    // 最近跟进（不含公海）：拆前那句加 id 定死同键先后，拆后的同键那组谁先谁后没定，比排序键逐位 + 全量集合
    const 旧排 = await raw.$queryRawUnsafe<{ id: string; k: string }[]>(
      `SELECT c.id, coalesce(c."lastFollowAt", '-') || '|' || c."createdAt" AS k FROM "Customer" c WHERE ${范围.where} AND NOT EXISTS (SELECT 1 FROM "CustomerPool" p WHERE p."customerId" = c.id) ORDER BY c."lastFollowAt" DESC, c."createdAt" DESC, c.id`,
      ...范围.参数,
    );
    const 键of = new Map(旧排.map((r) => [r.id, r.k]));
    for (const n of [3, 20]) {
      const 新 = (await 最近跟进的客户(n))!;
      expect({ 谁, n, 键: 新.map((id) => 键of.get(id) ?? "不在拆前那句里") }).toEqual({ 谁, n, 键: 旧排.slice(0, n).map((r) => r.k) });
    }
    expect({ 谁, 全: (await 最近跟进的客户(100000))!.sort() }).toEqual({ 谁, 全: 旧排.map((r) => r.id).sort() });
    return "快路" as const;
  });
}

async function 全对拍() {
  const 走 = {} as Record<string, string>;
  for (const 谁 of 谁们) {
    忘掉企业版范围();
    走[谁] = await 对拍(谁);
  }
  return 走;
}

describe("可见范围拆两路：拆前拆后结果集完全相同", () => {
  it("按组织看客户开着、没有项目组员：逐个身份", async () => {
    await 开规则(true);
    await 设组员(0);
    const 走 = await 全对拍();
    // 真走了拆后那几句的身份（其余拆前也回 null、走 Prisma，同样和 Prisma 比过）
    for (const 谁 of [经理, 小王, 小张, 小赵, 外人, 回避人, 组员, 线总, "ghost"]) expect({ 谁, 走: 走[谁] }).toEqual({ 谁, 走: "快路" });
    expect(走[系管]).toBe("Prisma");
    expect(走[只读]).toBe("Prisma");
    // 回避人真带上了回避的两段（负责人是他的公海客户 + 名单）
    const 回避 = await 以谁的身份(回避人, 看得到的范围SQL);
    expect(回避!.回避.sql).toContain("NOT IN");
    expect(回避!.名下.where).toContain("NOT IN");
  });

  it("按组织看客户开着、有项目组员（名单）：逐个身份", async () => {
    await 开规则(true);
    await 设组员(4);
    const 走 = await 全对拍();
    expect(走[组员]).toBe("快路");
    const 组员范围 = await 以谁的身份(组员, 看得到的范围SQL);
    expect(组员范围!.名下.where).toMatch(/OR c\.id IN \(\?/);
    // 组员看得到外人的那两位（JOINED、项目没删），没同意的那位看不到
    const 组员看 = await 以谁的身份(组员, 看得到的客户数);
    const 自己的 = await raw.customer.count({ where: { salesOwnerId: 组员, deletedAt: null, pool: null } });
    // 负责人是他的公海客户回避掉（P-公海-04）
    const 公海 = await raw.customer.count({ where: { deletedAt: null, pool: { isNot: null }, salesOwnerId: { not: 组员 } } });
    const 级联 = await raw.customer.count({ where: { id: { in: [外人的[0], 外人的[3]] }, deletedAt: null, pool: null } });
    expect(组员看).toBe(自己的 + 公海 + 级联);
  });

  it("按组织看客户开着、组员名单过上限（退回子查询）：逐个身份", async () => {
    await 开规则(true);
    await 设组员(320);
    const 组员范围 = await 以谁的身份(组员, 看得到的范围SQL);
    expect(组员范围!.名下.where).toContain(`FROM "Project" p JOIN "ProjectMember" m`);
    await 全对拍();
  });

  it("按组织看客户关着、有没有项目组员：逐个身份", async () => {
    await 开规则(false);
    await 设组员(0);
    await 全对拍();
    await 设组员(4);
    await 全对拍();
  });
});
