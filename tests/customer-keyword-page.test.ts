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
  const raw = new PrismaClient<import("@/generated/prisma").Prisma.PrismaClientOptions>({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
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
import { 来源未填, 触点前缀 } from "@/lib/enterprise/customer-source-filter";

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
    // 11-01 权限只认业务角色：老板（账号 ADMIN）也要有总管理，业务员要有销售，不然只看公海
    data: [
      { userId: 老板, bizRole: "director" },
      { userId: 总管, bizRole: "director" },
      { userId: 经理, bizRole: "sales_mgr" },
      { userId: 小王, managerId: 经理, bizRole: "sales" },
      { userId: 小张, dottedManagerId: 经理, bizRole: "sales" },
      { userId: 小赵, managerId: 小张, bizRole: "sales" },
      { userId: 外人, bizRole: "sales" },
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
        // 简称（11-17 PR-0）：两个字的走整表 GLOB、三个字以上的走部分索引，范围照样要对
        ...(i % 8 === 1 ? { shortName: `恒信达${i}` } : i % 8 === 5 ? { shortName: "恒信" } : {}),
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

const 关键词 = ["甲", "138", "kwmail", "联系人丙", "客户1", "没有这个人", "恒信", "恒信达"];
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

  it("简称（11-17 PR-0）只在看得到的范围里搜得到：外人只出自己的和公海的，没认出的人「客户」页签为空，老板全出", async () => {
    const 全部有简称 = await raw.customer.findMany({ where: { shortName: { startsWith: "恒信" } }, select: { id: true, salesOwnerId: true, pool: { select: { customerId: true } } } });
    expect(全部有简称.length).toBe(25);
    for (const keyword of ["恒信", "恒信达"]) {
      const 老板看 = (await 以谁的身份(老板, () => 关键词分页({ keyword }, 1, 100)))!;
      const 外人看 = (await 以谁的身份(外人, () => 关键词分页({ keyword }, 1, 100)))!;
      const 外人公海 = (await 以谁的身份(外人, () => 关键词分页({ keyword, pool: "1" }, 1, 100)))!;
      const 应 = (f: (c: (typeof 全部有简称)[number]) => boolean) => 全部有简称.filter(f).map((c) => c.id).sort();
      // 「恒信」两种简称都中，「恒信达」只中三个字以上那一种
      const 中 = new Set((await raw.customer.findMany({ where: { shortName: { contains: keyword } }, select: { id: true } })).map((c) => c.id));
      const 在中 = (c: (typeof 全部有简称)[number]) => 中.has(c.id);
      expect(老板看.ids.slice().sort()).toEqual(应((c) => 在中(c) && !c.pool));
      expect(外人看.ids.slice().sort()).toEqual(应((c) => 在中(c) && !c.pool && c.salesOwnerId === 外人));
      expect(外人看.total).toBeGreaterThan(0);
      expect(外人看.total).toBeLessThan(老板看.total);
      // 公海页签：在公海的都算，原负责人是外人的那几位回避掉（11-03）
      expect(外人公海.ids.slice().sort()).toEqual(应((c) => 在中(c) && !!c.pool && c.salesOwnerId !== 外人));
      expect(应((c) => 在中(c) && !!c.pool && c.salesOwnerId === 外人).length).toBeGreaterThan(0);
      expect((await 以谁的身份("ghost", () => 关键词分页({ keyword }, 1, 100)))!.total).toBe(0);
    }
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

  it("文字关键词、号码关键词那句都能进只读通道（号码带的 replace() 是字符串函数，11-14 起不再当写回主连接）", async () => {
    const 那句 = async (keyword: string) => {
      临时.裸SQL.length = 0;
      await 以谁的身份(小王, () => 关键词分页({ keyword, grade: "高一" }, 1, 20));
      const s = 临时.裸SQL.find((x) => x.includes("MATERIALIZED"));
      expect(s).toBeTruthy();
      return s!;
    };
    expect(只读SQL(await 那句("甲"))).toBe(true);
    expect(只读SQL(await 那句("138"))).toBe(true);
  });

  it("客户来源（11-06）：关键词 + 来源和老路对拍，只出这个来源的；没开企业版时当没带", async () => {
    const 渠道 = await raw.channel.create({ data: { name: "来源筛选用", channelOwnerId: 经理 } });
    const 挂上的 = (await raw.customer.findMany({ where: { name: { startsWith: "甲" }, pool: null }, select: { id: true }, orderBy: { id: "asc" } })).slice(0, 6).map((c) => c.id);
    await raw.customer.updateMany({ where: { id: { in: 挂上的 } }, data: { channelId: 渠道.id } });
    try {
      const sp: 客户条件 = { keyword: "甲", channelId: 渠道.id };
      for (const 谁 of [老板, 经理, 小王, 外人]) {
        const 老 = await 以谁的身份(谁, () => 老路(sp, 1, 20));
        const 快 = await 以谁的身份(谁, () => 关键词分页(sp, 1, 20));
        // 关键词分页接不住这个组合时回 null，走老路：那样结果就是老路本身
        if (快) expect(快).toEqual(老);
        expect(老.ids.every((id) => 挂上的.includes(id))).toBe(true);
      }
      expect((await 以谁的身份(老板, () => 老路(sp, 1, 20))).ids.slice().sort()).toEqual(挂上的.slice().sort());

      delete process.env.CRM_ENTERPRISE;
      忘掉企业版范围();
      try {
        const where = await 客户筛选条件({ channelId: 渠道.id });
        const 全 = await 客户筛选条件({});
        expect(await raw.customer.count({ where })).toBe(await raw.customer.count({ where: 全 }));
      } finally {
        process.env.CRM_ENTERPRISE = "1";
        忘掉企业版范围();
      }
    } finally {
      await raw.customer.updateMany({ where: { id: { in: 挂上的 } }, data: { channelId: null } });
      await raw.channel.delete({ where: { id: 渠道.id } });
    }
  });

  it("客户来源「未填」「按触点」（F-049，11-25）：快路径和老路逐身份对拍，单独筛、和等级 / 跟进状态 / 公海页签组合都一样", async () => {
    const 渠道 = await raw.channel.create({ data: { name: "F049 渠道", channelOwnerId: 经理 } });
    const 甲们 = (await raw.customer.findMany({ where: { name: { startsWith: "甲" } }, select: { id: true }, orderBy: { id: "asc" } })).map((c) => c.id);
    // 甲 25 位：前 5 位挂渠道、接着 4 位公司资源、3 位客户介绍、2 位触点是空串（算未填），1 位渠道 + 触点都有，其余两格都空
    const 挂渠道 = 甲们.slice(0, 5), 公司资源 = 甲们.slice(5, 9), 客户介绍 = 甲们.slice(9, 12), 空串 = 甲们.slice(12, 14), 都有 = 甲们.slice(14, 15);
    await raw.customer.updateMany({ where: { id: { in: 挂渠道 } }, data: { channelId: 渠道.id } });
    await raw.customer.updateMany({ where: { id: { in: 公司资源 } }, data: { touchpoint: "公司资源" } });
    await raw.customer.updateMany({ where: { id: { in: 客户介绍 } }, data: { touchpoint: "客户介绍" } });
    await raw.customer.updateMany({ where: { id: { in: 空串 } }, data: { touchpoint: "" } });
    await raw.customer.updateMany({ where: { id: { in: 都有 } }, data: { channelId: 渠道.id, touchpoint: "公司资源" } });
    try {
      const 值们 = [来源未填, `${触点前缀}公司资源`, `${触点前缀}客户介绍`, 渠道.id];
      const 组合: 客户条件[] = [{}, { grade: "高一" }, { followStatus: "跟进中" }, { pool: "1" }, { salesOwnerId: 小王 }];
      for (const 谁 of [老板, 经理, 小王, 外人])
        for (const channelId of 值们)
          for (const f of 组合)
            for (const 页 of [1, 2]) {
              const sp: 客户条件 = { keyword: "甲", channelId, ...f };
              const 老 = await 以谁的身份(谁, () => 老路(sp, 页, 5));
              const 快 = await 以谁的身份(谁, () => 关键词分页(sp, 页, 5));
              expect(快, JSON.stringify({ 谁, sp, 页 })).toEqual(老);
            }
      // 老板看全：每种值筛出来的就是那几位（不分页签时两边各数一遍相加）
      const 全部 = async (channelId: string) => {
        const ids: string[] = [];
        for (const pool of [undefined, "1"]) ids.push(...(await 以谁的身份(老板, () => 老路({ keyword: "甲", channelId, pool }, 1, 100))).ids);
        return ids.sort();
      };
      const 未填该有 = 甲们.filter((id) => ![...挂渠道, ...公司资源, ...客户介绍, ...都有].includes(id)).sort();
      expect(await 全部(来源未填)).toEqual(未填该有);
      expect(未填该有).toEqual(expect.arrayContaining(空串));
      expect(await 全部(`${触点前缀}公司资源`)).toEqual([...公司资源, ...都有].sort());
      expect(await 全部(`${触点前缀}客户介绍`)).toEqual(客户介绍.slice().sort());
      expect(await 全部(渠道.id)).toEqual([...挂渠道, ...都有].sort());
      // 不带关键词（走老路）也是同一个数：未填 = 全库两格都空的
      const 无词 = async (channelId: string) => {
        let n = 0;
        for (const pool of [undefined, "1"]) n += await 以谁的身份(老板, async () => db.customer.count({ where: await 客户筛选条件({ channelId, pool }) }));
        return n;
      };
      expect(await 无词(来源未填)).toBe(await raw.customer.count({ where: { channelId: null, OR: [{ touchpoint: null }, { touchpoint: "" }] } }));
      expect(await 无词(`${触点前缀}公司资源`)).toBe(公司资源.length + 都有.length);
      // 「触点:」后面没字 = 当没筛
      expect(await 无词(触点前缀)).toBe(await 无词(""));

      // 没开企业版：三种值都当没带
      delete process.env.CRM_ENTERPRISE;
      忘掉企业版范围();
      try {
        const 全 = await raw.customer.count({ where: await 客户筛选条件({}) });
        for (const channelId of 值们) expect(await raw.customer.count({ where: await 客户筛选条件({ channelId }) })).toBe(全);
        expect(await 关键词分页({ keyword: "甲", channelId: 来源未填 }, 1, 10)).toEqual(await 关键词分页({ keyword: "甲" }, 1, 10));
      } finally {
        process.env.CRM_ENTERPRISE = "1";
        忘掉企业版范围();
      }
    } finally {
      await raw.customer.updateMany({ where: { id: { in: 甲们 } }, data: { channelId: null, touchpoint: null } });
      await raw.channel.delete({ where: { id: 渠道.id } });
    }
  }, 60_000);

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

/**
 * 组员的客户（可见范围修复单 11-24 审查）：快路「客户」页签原来只按负责人算，本人以组员身份进了别人负责的项目，
 * 那位客户不带关键词看得到（Prisma 限定层带组员那支）、带关键词搜不出。组员只认本人（11-24 ②）：下属进组上级不跟着看。
 * 名单（≤300 位）和过上限退回子查询两种写法都对拍老路。放在最后：前面几组的数按没有项目算
 */
describe("关键词分页 = 老路（项目组员的客户）", () => {
  const 项目们: string[] = [];
  const 多的: string[] = [];
  let 那位: { id: string; name: string };
  beforeAll(async () => {
    // 外人负责、不在公海的一位：小王（经理的实线下属）以组员身份进了它的项目
    那位 = (await raw.customer.findFirst({ where: { salesOwnerId: 外人, pool: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }))!;
    const 在公海的 = (await raw.customer.findFirst({ where: { salesOwnerId: 外人, pool: { isNot: null } }, select: { id: true } }))!;
    const 别的 = (await raw.customer.findFirst({ where: { salesOwnerId: 外人, pool: null, id: { not: 那位.id } }, select: { id: true } }))!;
    const 建 = async (customerId: string, 组员: [string, string][]) => {
      const p = await raw.project.create({ data: { name: `组员项目${项目们.length}`, customerId, ownerId: 外人, creatorId: 外人 } });
      项目们.push(p.id);
      for (const [userId, inviteStatus] of 组员) await raw.projectMember.create({ data: { projectId: p.id, userId, inviteStatus } });
    };
    await 建(那位.id, [[小王, "JOINED"], [小张, "INVITED"]]);
    await 建(在公海的.id, [[小王, "JOINED"]]);
    // 经理自己进的组：他看得到；小张只是邀请着，不算
    await 建(别的.id, [[经理, "JOINED"], [小张, "DECLINED"]]);
    // 小赵进了 310 位客户的组：过上限（300）退回子查询那一路
    const 基 = Date.UTC(2026, 5, 1);
    for (let i = 0; i < 310; i++) 多的.push(`kwm_${String(i).padStart(3, "0")}`);
    await raw.customer.createMany({ data: 多的.map((id, i) => ({ id, name: `丁组员${i}`, phone: `1770000${String(i).padStart(4, "0")}`, salesOwnerId: 外人, createdAt: new Date(基 + i * 1000) })) });
    await raw.project.createMany({ data: 多的.map((customerId, i) => ({ id: `kwmp_${i}`, name: `丁项目${i}`, customerId, ownerId: 外人, creatorId: 外人 })) });
    await raw.projectMember.createMany({ data: 多的.map((_, i) => ({ projectId: `kwmp_${i}`, userId: 小赵, inviteStatus: "JOINED" })) });
    // 其中一个项目删了（进回收站）：挂着的客户不算
    await raw.project.update({ where: { id: "kwmp_0" }, data: { deletedAt: new Date() } });
  });
  afterAll(async () => {
    await raw.project.deleteMany({ where: { OR: [{ id: { in: 项目们 } }, { id: { startsWith: "kwmp_" } }] } });
    await raw.customer.deleteMany({ where: { id: { in: 多的 } } });
  });

  it("同一个销售：不带关键词看得到的组员客户，带关键词（命中客户名）也搜得到", async () => {
    await 以谁的身份(小王, async () => {
      const 不带 = await db.customer.findMany({ where: await 客户筛选条件({}), select: { id: true } });
      expect(不带.map((c) => c.id)).toContain(那位.id);
      const 带 = await 关键词分页({ keyword: 那位.name }, 1, 20);
      expect(带).not.toBeNull();
      expect(带!.ids).toContain(那位.id);
      expect(带).toEqual(await 老路({ keyword: 那位.name }, 1, 20));
    });
    // 下属进组上级不跟着看（只认本人）
    await 以谁的身份(经理, async () => {
      expect((await 关键词分页({ keyword: 那位.name }, 1, 20))!.ids).not.toContain(那位.id);
      expect((await db.customer.findMany({ where: await 客户筛选条件({}), select: { id: true } })).map((c) => c.id)).not.toContain(那位.id);
    });
    // 过上限那一路：309 位（删了一个项目）都搜得到
    const 小赵的 = (await 以谁的身份(小赵, () => 关键词分页({ keyword: "丁组员" }, 1, 500)))!;
    expect(小赵的.total).toBe(309);
    expect(小赵的.ids).not.toContain("kwm_000");
  });

  it("逐身份 × 两个页签 × 关键词 × 等值筛选 × 页码", async () => {
    let 比过 = 0;
    for (const 谁 of 谁们)
      await 以谁的身份(谁, async () => {
        for (const keyword of [那位.name, "客户", "丁组员", "丁组员30", "甲"])
          for (const pool of [undefined, "1"])
            for (const f of [{}, { salesOwnerId: 外人 }, { grade: "高一" }] as 客户条件[])
              for (const 页 of [1, 2, 99999]) {
                const sp = { keyword, pool, ...f };
                const 新 = await 关键词分页(sp, 页, 20);
                expect(新).not.toBeNull();
                expect({ 谁, sp, 页, ...新 }).toEqual({ 谁, sp, 页, ...(await 老路(sp, 页, 20)) });
                比过++;
              }
      });
    expect(比过).toBe(谁们.length * 5 * 2 * 3 * 3);
  }, 120_000);
});
