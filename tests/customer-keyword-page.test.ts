/**
 * 客户列表关键词快路径（customers/query.ts 关键词分页，P2，2026-10-28）和 Prisma 老路
 * （客户筛选条件 → count → 钳页 → findMany 按 createdAt、id 倒序）逐身份、逐页签、逐页对拍：总数、页码、这一页的 id 都要一样。
 * 企业版「按组织看客户」开着；范围写在快路径的 SQL 里，可见范围一改这里就红。
 * 用拷出来的一份库、显式单连接，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-kw-page-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir, 裸SQL: [] as string[] };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  const 限定 = 加上限定(raw);
  // 记下发出去的裸 SQL：快路径那句要能进只读通道
  const prisma = new Proxy(限定, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      if (p !== "$queryRawUnsafe" || typeof v !== "function") return v;
      return (sql: string, ...args: unknown[]) => { 临时.裸SQL.push(sql); return v.call(t, sql, ...args); };
    },
  });
  return { prisma, defaultClient: raw };
});

import { prisma as db, defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 只读SQL } from "@/lib/read-pool";
import { 客户筛选条件, 关键词分页, 按序取客户行, type 客户条件 } from "@/app/(app)/customers/query";

const 老板 = "e_boss";
const 总管 = "e_dir";
const 经理 = "e_mgr";
const 小王 = "e_wang"; // 经理的实线下属
const 小张 = "e_zhang"; // 经理的虚线下属
const 小赵 = "e_zhao"; // 小张的实线下属
const 外人 = "e_other";
const 谁们 = [老板, 总管, 经理, 小王, 小张, 小赵, 外人, "ghost"];
const 负责人 = [老板, 经理, 小王, 小张, 小赵, 外人];

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerExtra", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  const 人 = (id: string, name: string, role = "SALES") => raw.user.create({ data: { id, email: `${id}@x.com`, name, password: "x", role } });
  await 人(老板, "老板", "ADMIN");
  for (const [id, n] of [[总管, "总管"], [经理, "经理"], [小王, "小王"], [小张, "小张"], [小赵, "小赵"], [外人, "外人"]]) await 人(id, n);
  await raw.entMember.createMany({
    data: [
      { userId: 总管, bizRole: "director" },
      { userId: 经理, bizRole: "sales_mgr" },
      { userId: 小王, managerId: 经理 },
      { userId: 小张, dottedManagerId: 经理 },
      { userId: 小赵, managerId: 小张 },
      { userId: 外人 },
    ],
  });
  // 100 位：负责人轮着来、每 7 位一位渠道是经理的、每 5 位一位进公海；createdAt 每 3 位同一刻（排序要靠 id 定）
  const 基 = Date.UTC(2026, 0, 1);
  for (let i = 0; i < 100; i++) {
    const c = await raw.customer.create({
      data: {
        name: `${i % 4 === 0 ? "甲" : "乙"}客户${i}`,
        phone: `1${i % 2 ? "38" : "59"}0000${String(i).padStart(4, "0")}`,
        grade: i % 3 === 0 ? "高一" : "高二",
        followStatus: i % 6 === 0 ? "跟进中" : "待跟进",
        salesOwnerId: 负责人[i % 负责人.length],
        ...(i % 7 === 0 ? { channelOwnerId: 经理 } : {}),
        createdAt: new Date(基 + Math.floor(i / 3) * 60_000),
      },
    });
    if (i % 5 === 0) await raw.customerPool.create({ data: { customerId: c.id } });
    if (i % 9 === 0) await raw.customerExtra.create({ data: { customerId: c.id, email: `kwmail${i}@x.com` } });
    if (i % 11 === 0) await raw.contact.create({ data: { customerId: c.id, name: `联系人丙${i}` } });
  }
  await raw.setting.create({ data: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
});

beforeEach(() => 忘掉企业版范围());

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

/** page.tsx 原来的三步 */
async function 老路(sp: 客户条件, 请求页: number, pageSize: number) {
  const where = await 客户筛选条件(sp);
  const total = await db.customer.count({ where });
  const page = Math.min(请求页, Math.max(1, Math.ceil(total / pageSize)));
  const ids = (await db.customer.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true } })).map((r) => r.id);
  return { total, page, ids };
}

const 关键词 = ["甲", "138", "kwmail", "联系人丙", "客户1", "没有这个人"];
const 筛选: 客户条件[] = [{}, { grade: "高一" }, { followStatus: "跟进中" }, { salesOwnerId: 小王 }, { channelOwnerId: 经理 }];

describe("关键词分页 = 老路", () => {
  it("逐身份 × 两个页签 × 关键词 × 等值筛选 × 页码 × 每页条数", async () => {
    let 比过 = 0;
    for (const 谁 of 谁们)
      await 以谁的身份(谁, async () => {
        for (const keyword of 关键词)
          for (const pool of [undefined, "1"])
            for (const f of 筛选)
              for (const pageSize of [10, 20]) {
                const sp = { keyword, pool, ...f };
                const 末页 = Math.max(1, Math.ceil((await 老路(sp, 1, pageSize)).total / pageSize));
                for (const 页 of [1, 2, 末页, 末页 + 7, 99999]) {
                  const 新 = await 关键词分页(sp, 页, pageSize);
                  expect({ 谁, sp, 页, pageSize, ...新 }).toEqual({ 谁, sp, 页, pageSize, ...(await 老路(sp, 页, pageSize)) });
                  比过++;
                }
              }
      });
    expect(比过).toBe(谁们.length * 关键词.length * 2 * 筛选.length * 2 * 5);
  }, 120_000);

  it("范围对：外人只看到自己的和公海；没认出的人「客户」页签为空；老板看全", async () => {
    const 外人客户 = await 以谁的身份(外人, () => 关键词分页({ keyword: "客户" }, 1, 100));
    const 外人的 = await raw.customer.count({ where: { OR: [{ salesOwnerId: 外人 }, { channelOwnerId: 外人 }], pool: { is: null } } });
    expect(外人客户!.total).toBe(外人的);
    expect(外人的).toBeGreaterThan(0);
    expect((await 以谁的身份("ghost", () => 关键词分页({ keyword: "客户" }, 1, 100)))!.total).toBe(0);
    expect((await 以谁的身份("ghost", () => 关键词分页({ keyword: "客户", pool: "1" }, 1, 100)))!.total).toBe(20);
    expect((await 以谁的身份(老板, () => 关键词分页({ keyword: "客户" }, 1, 100)))!.total).toBe(80);
  });

  it("按序取客户行：顺序和给的 id 一样，看不到的不给", async () => {
    const 全 = (await 以谁的身份(老板, () => 关键词分页({ keyword: "客户" }, 1, 30)))!.ids;
    expect((await 以谁的身份(老板, () => 按序取客户行(全))).map((r) => r.id)).toEqual(全);
    const 外人能看 = await 以谁的身份(外人, () => 按序取客户行(全));
    expect(外人能看.length).toBeLessThan(全.length);
    expect(外人能看.every((r) => r.salesOwnerId === 外人 || r.channelOwnerId === 外人)).toBe(true);
    expect(await 按序取客户行([])).toEqual([]);
  });

  it("接不住的组合回 null，调用方走老路", async () => {
    for (const sp of [{}, { keyword: "  " }, { keyword: "甲", batch: "b" }, { keyword: "甲", level: "A" }, { keyword: "甲", dept: "d" }, { keyword: "甲", createdWithin: "month" }, { keyword: "甲", directOf: "x" }, { keyword: "甲", country: "CN" }, { keyword: "甲", source: "s" }] as 客户条件[])
      expect(await 以谁的身份(老板, () => 关键词分页(sp, 1, 20))).toBeNull();
  });

  it("文字关键词那句能进只读通道；号码关键词带 replace() 归一化，和老路一样回主连接", async () => {
    const 那句 = async (keyword: string) => {
      临时.裸SQL.length = 0;
      await 以谁的身份(小王, () => 关键词分页({ keyword, grade: "高一" }, 1, 20));
      const s = 临时.裸SQL.find((x) => x.includes("MATERIALIZED"));
      expect(s).toBeTruthy();
      return s!;
    };
    expect(只读SQL(await 那句("甲"))).toBe(true);
    expect(只读SQL(await 那句("138"))).toBe(false);
  });

  it("开关关着（没开企业版）也和老路一样", async () => {
    delete process.env.CRM_ENTERPRISE;
    忘掉企业版范围();
    try {
      for (const sp of [{ keyword: "甲" }, { keyword: "138", pool: "1" }, { keyword: "kwmail", grade: "高一" }] as 客户条件[])
        for (const 页 of [1, 2, 99999]) expect(await 关键词分页(sp, 页, 10)).toEqual(await 老路(sp, 页, 10));
    } finally {
      process.env.CRM_ENTERPRISE = "1";
      忘掉企业版范围();
    }
  });
});
