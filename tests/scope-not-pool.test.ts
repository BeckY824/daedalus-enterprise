/**
 * 「不在公海」的客户查询去掉范围里「OR 在公海」那一支（8.5 万客户提速第二轮，11-14，lib/team-scope.ts 限在非公海）：
 * 改前改后结果集逐身份完全一致。「改前」= 同一句把 pool: { is: null } 换成等价的 NOT: { pool: { isNot: null } }——
 * 限定层认不出它（只认 AND 链上的 pool is null），照原样带着公海那支；「改后」= 原句，限定层化简。两边都过同一个限定层。
 * 对拍：客户列表逐页（按建档时间正 / 倒序、几种筛选）、计数、按 grade 分组计数、看得到的客户数（= 改前的 prisma.customer.count()）。
 * 身份：系统管理员、总管理、条线总管理、只读管理员、按线只读、销售管理（实线 / 虚线下属）、带组员的销售、普通销售、名下全在公海的销售、
 * 渠道运营、项目运营、市场管理、市场成员、没设角色、停用、没认出人、原负责人回避（名单正常 / 名单过上限）；
 * 按组织看客户开 / 关 × 有没有项目组员。用拷出来的一份库、显式单连接，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-scope-not-pool-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir, 句: [] as string[] };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1`, log: [{ emit: "event", level: "query" }] });
  (raw as unknown as { $on: (e: "query", f: (q: { query: string }) => void) => void }).$on("query", (q) => 临时.句.push(q.query));
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { prisma as db, defaultClient as raw } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 看得到的客户数 } from "@/lib/scope-sql";
import { 限在非公海 } from "@/lib/team-scope";
import { 客户筛选条件 } from "@/app/(app)/customers/query";

const 系管 = "n_sys", 总管 = "n_dir", 线总 = "n_line", 只读 = "n_ro", 线读 = "n_rol", 经理 = "n_mgr", 小王 = "n_wang", 小张 = "n_zhang", 小赵 = "n_zhao";
const 外人 = "n_other", 渠运 = "n_chan", 项运 = "n_pops", 市管 = "n_mkt", 市员 = "n_mkt1", 组员 = "n_pm", 回避人 = "n_back", 多回避 = "n_backmany";
const 全公海 = "n_allpool", 没角色 = "n_none", 停用 = "n_off", 占位 = "n_hold";
const 谁们 = [系管, 总管, 线总, 只读, 线读, 经理, 小王, 小张, 小赵, 外人, 渠运, 项运, 市管, 市员, 组员, 回避人, 多回避, 全公海, 没角色, 停用, "ghost"];
const 负责人们 = [经理, 小王, 小张, 小赵, 外人, 渠运, 项运, 市员, 组员, 回避人, 系管, 线总, 全公海];
const 外人的: string[] = [];

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ProjectMember", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerOwnerLog", "CustomerCreator", "CustomerPool", "CustomerClaim", "CustomerExtra", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [系管, 总管, 线总, 只读, 线读, 经理, 小王, 小张, 小赵, 外人, 渠运, 项运, 市管, 市员, 组员, 回避人, 多回避, 全公海, 没角色, 停用]) {
    await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: id === 系管 ? "ADMIN" : "SALES", active: id !== 停用 } });
  }
  await raw.user.create({ data: { id: 占位, email: 无负责人占位邮箱, name: "占位", password: "x", role: "SALES" } });
  await raw.entMember.createMany({
    data: [
      { userId: 系管, bizRole: "director" },
      { userId: 总管, bizRole: "director" },
      { userId: 线总, bizRole: "director", line: "内贸" },
      { userId: 只读, bizRole: "admin" },
      { userId: 线读, bizRole: "admin", line: "外贸" },
      { userId: 经理, bizRole: "sales_mgr", line: "内贸" },
      { userId: 小王, managerId: 经理, bizRole: "sales", line: "内贸" },
      { userId: 小张, dottedManagerId: 经理, bizRole: "sales" },
      { userId: 小赵, managerId: 小张, bizRole: "sales" },
      { userId: 外人, bizRole: "sales", line: "外贸" },
      { userId: 渠运, bizRole: "channel_ops" },
      { userId: 项运, bizRole: "project_ops", line: "内贸" },
      { userId: 市管, bizRole: "marketing_mgr" },
      { userId: 市员, managerId: 市管, bizRole: "channel_ops" },
      { userId: 组员, bizRole: "sales" },
      { userId: 回避人, managerId: 经理, bizRole: "sales" },
      { userId: 多回避, bizRole: "sales" },
      { userId: 全公海, bizRole: "sales" },
      { userId: 停用, bizRole: "sales" },
    ],
  });
  const 日 = (d: number, h = 0) => new Date(Date.UTC(2026, 9, d, h));
  const 编号: string[] = [];
  for (let i = 0; i < 负责人们.length * 9; i++) {
    const o = 负责人们[i % 负责人们.length];
    const c = await raw.customer.create({
      data: {
        name: `客户${i}`,
        phone: `138${String(i).padStart(8, "0")}`,
        salesOwnerId: o,
        grade: ["甲", "乙", null, "丙"][i % 4],
        followStatus: i % 3 ? "跟进中" : "新",
        ...(i % 4 === 0 ? { creator: { create: { userId: 市员 } } } : {}),
        ...(i % 6 === 0 ? { channelOwnerId: 经理 } : {}),
        // 同一建档时刻有好几位：翻页的先后靠 id 定
        createdAt: 日(1 + (i % 5), i % 2),
        deletedAt: i % 13 === 0 ? 日(9) : null,
      },
    });
    编号.push(c.id);
    if (o === 外人) 外人的.push(c.id);
  }
  // 公海：各家的都有；「名下全在公海」那位的全进
  const 进公海 = 编号.filter((id, i) => i % 4 === 1 || i % 7 === 0 || 负责人们[i % 负责人们.length] === 全公海);
  await raw.customerPool.createMany({ data: 进公海.map((customerId, k) => ({ customerId, userId: k % 3 ? 经理 : null, at: 日(1 + (k % 5)) })) });
  // 回避名单：回避人 3 位（正常）、多回避 105 位（过上限 100，退回按关联写的条件）；进公海时负责人换成占位的
  for (const [人, 几位] of [[回避人, 3], [多回避, 105]] as const) {
    for (let k = 0; k < 几位; k++) {
      const c = await raw.customer.create({ data: { name: `放走的${人}${k}`, phone: `137${String(k).padStart(4, "0")}${人.length}000`, salesOwnerId: 占位, grade: k % 2 ? "甲" : "丁", createdAt: 日(2) } });
      await raw.customerPool.create({ data: { customerId: c.id, userId: 人, reason: "手动" } });
      await raw.customerOwnerLog.create({ data: { customerId: c.id, userId: 人, fromOwnerId: 人, toOwnerId: 占位, kind: "pool-release" } });
    }
  }
  // 回避人、多回避名下还各有几位不在公海的（名单那段在「客户」页签里照样要排）
  for (const 人 of [回避人, 多回避]) for (let k = 0; k < 3; k++) await raw.customer.create({ data: { name: `名下${人}${k}`, phone: `136${String(k).padStart(4, "0")}${人.length}111`, salesOwnerId: 人, createdAt: 日(3) } });
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
  for (let k = 0; k < 几位; k++) {
    const p = await raw.project.create({ data: { name: `项目${k}`, customerId: 外人的[k], ownerId: 外人, creatorId: 外人, deletedAt: k === 1 ? new Date() : null } });
    await raw.projectMember.create({ data: { projectId: p.id, userId: 组员, inviteStatus: k === 2 ? "INVITED" : "JOINED" } });
  }
  忘掉企业版范围();
}

/** 改前的写法：把 AND 链上的 pool: { is: null } 换成等价的 NOT: { pool: { isNot: null } }（限定层认不出，照原样带着公海那支） */
function 改前(w: Prisma.CustomerWhereInput): Prisma.CustomerWhereInput {
  const { pool, AND, ...别的 } = w as Record<string, unknown>;
  const 链 = AND === undefined ? undefined : Array.isArray(AND) ? AND.map((x) => 改前(x as Prisma.CustomerWhereInput)) : 改前(AND as Prisma.CustomerWhereInput);
  const 是非公海 = pool === null || (pool && typeof pool === "object" && "is" in pool && (pool as { is: unknown }).is === null && Object.keys(pool).length === 1);
  return {
    ...别的,
    ...(链 === undefined ? {} : { AND: 链 }),
    ...(是非公海 ? { NOT: { pool: { isNot: null } } } : pool === undefined ? {} : { pool }),
  } as Prisma.CustomerWhereInput;
}

const 筛们: Record<string, string>[] = [{}, { followStatus: "跟进中" }, { grade: "甲" }, { salesOwnerId: 小王 }];
const 页大小 = 7;

/** 一个身份：改前改后逐页、计数、分组计数、看得到的客户数 */
async function 对拍(谁: string): Promise<boolean> {
  return 以谁的身份(谁, async () => {
    let 化简了 = false;
    for (const sp of 筛们) {
      const 新w = await 客户筛选条件(sp);
      expect(限在非公海(新w)).toBe(true);
      const 旧w = 改前(新w);
      expect(限在非公海(旧w)).toBe(false);
      for (const 序 of [[{ createdAt: "desc" as const }, { id: "desc" as const }], [{ createdAt: "asc" as const }, { id: "asc" as const }]]) {
        const 在公海支 = (q: string) => (q.match(/NOT \(`j\d+`\.`customerId` IS NULL\)/g) ?? []).length;
        const 末句 = () => 临时.句.filter((q) => q.startsWith("SELECT") && q.includes("FROM `main`.`Customer`")).at(-1) ?? "";
        临时.句.length = 0;
        const 全旧 = (await db.customer.findMany({ where: 旧w, orderBy: 序, select: { id: true } })).map((r) => r.id);
        const 旧句 = 末句();
        临时.句.length = 0;
        const 全新 = (await db.customer.findMany({ where: 新w, orderBy: 序, select: { id: true } })).map((r) => r.id);
        // 化简真发生了：新句子里「在公海」的支比改前少（按线只读那段自己带的公海条件不动，所以比个数）
        if (在公海支(末句()) < 在公海支(旧句)) 化简了 = true;
        expect({ 谁, sp, 全: 全新 }).toEqual({ 谁, sp, 全: 全旧 });
        for (let 页 = 0; 页 * 页大小 <= 全旧.length; 页++) {
          const 取 = (w: Prisma.CustomerWhereInput) => db.customer.findMany({ where: w, orderBy: 序, skip: 页 * 页大小, take: 页大小, select: { id: true } }).then((rs) => rs.map((r) => r.id));
          expect({ 谁, sp, 页, 行: await 取(新w) }).toEqual({ 谁, sp, 页, 行: await 取(旧w) });
        }
      }
      expect({ 谁, sp, n: await db.customer.count({ where: 新w }) }).toEqual({ 谁, sp, n: await db.customer.count({ where: 旧w }) });
      const 分组 = async (w: Prisma.CustomerWhereInput) =>
        (await db.customer.groupBy({ by: ["grade"], where: { AND: [w, { grade: { not: null } }] }, _count: { _all: true } })).map((g) => `${g.grade}:${g._count._all}`).sort();
      expect({ 谁, sp, 组: await 分组(新w) }).toEqual({ 谁, sp, 组: await 分组(旧w) });
    }
    // 看得到的客户数：改前（裸 SQL 接不住时）就是 prisma.customer.count()
    expect({ 谁, n: await 看得到的客户数() }).toEqual({ 谁, n: await db.customer.count() });
    // grade 下拉（不带公海条件，范围里公海那支照带）：不受影响，只是顺手核一遍和没限定的子集关系
    const 下拉 = (await db.customer.groupBy({ by: ["grade"], where: { grade: { not: null } } })).map((g) => g.grade);
    expect(下拉.length).toBeGreaterThan(0);
    return 化简了;
  });
}

async function 全对拍() {
  const 化简 = {} as Record<string, boolean>;
  for (const 谁 of 谁们) {
    忘掉企业版范围();
    化简[谁] = await 对拍(谁);
  }
  return 化简;
}

describe("不在公海的客户查询去掉「OR 在公海」：改前改后逐身份一致", () => {
  it("限在非公海 只认 AND 链上的 pool is null", () => {
    expect(限在非公海({ pool: { is: null } })).toBe(true);
    expect(限在非公海({ pool: null })).toBe(true);
    expect(限在非公海({ AND: [{ name: "x" }, { AND: { pool: { is: null } } }] })).toBe(true);
    expect(限在非公海({ OR: [{ pool: { is: null } }, { name: "x" }] })).toBe(false);
    expect(限在非公海({ NOT: { pool: { is: null } } })).toBe(false);
    expect(限在非公海({ pool: { isNot: null } })).toBe(false);
    expect(限在非公海({ pool: { is: { reason: "x" } } })).toBe(false);
    expect(限在非公海({})).toBe(false);
  });

  it("按组织看客户开着、没有项目组员：逐个身份", async () => {
    await 开规则(true);
    await 设组员(0);
    const 化简 = await 全对拍();
    // 带范围的人真的化简了（不限定的人没有公海那支，本来就没得化简）
    for (const 谁 of [经理, 小王, 小张, 外人, 全公海, 回避人, 多回避, 渠运, 项运, 市管, 市员, 线读, 没角色, "ghost"]) expect({ 谁, 化简: 化简[谁] }).toEqual({ 谁, 化简: true });
  });

  it("按组织看客户开着、有项目组员：逐个身份", async () => {
    await 开规则(true);
    await 设组员(4);
    const 化简 = await 全对拍();
    expect(化简[组员]).toBe(true);
  });

  it("按组织看客户关着（只加原负责人回避那一段）、有没有项目组员：逐个身份", async () => {
    await 开规则(false);
    await 设组员(0);
    await 全对拍();
    await 设组员(4);
    await 全对拍();
  });
});
