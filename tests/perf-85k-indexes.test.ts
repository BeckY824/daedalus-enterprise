/**
 * 迁移 137（8.5 万客户提速，11-14）的七个索引：建上了、查询计划真用上了、换写法的号码搜索结果和原来一模一样。
 * 计划这几条是先写的：没有这几个索引时 SQLite（没统计信息）会挑 deletedAt 索引再整表排序、号码搜索每行现算 20 层 replace。
 * 「Prisma 实际发出的语句」那组拿另开的、记 query 日志的客户端截下真句子再 EXPLAIN：(deletedAt, createdAt, id)、(deletedAt, occurredAt)
 * 会把「按负责人筛」「跟进按类型筛」带去顺着扫再挑（审查 11-14），两条带等值列打头的索引把它们拉回来，这里钉住。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 号键SQL, 号键索引名 } from "@/lib/phone-dedupe";
import { 号键 } from "@/lib/phone";
import { 包含模式, 客户号码SQL, 客户关键词SQL } from "@/lib/search-keyword";
import { PrismaClient } from "@/generated/prisma";
import { 加上限定 } from "@/lib/team-scope";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 客户筛选条件 } from "@/app/(app)/customers/query";

const 迁移 = fs.readFileSync(new URL("../migrations/137-perf-85k-indexes.sql", import.meta.url), "utf8");
const 迁移138 = fs.readFileSync(new URL("../migrations/138-perf-85k-indexes-2.sql", import.meta.url), "utf8");

async function 计划(sql: string, ...值: unknown[]): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<{ detail: string }[]>(`EXPLAIN QUERY PLAN ${sql}`, ...值);
  return rows.map((r) => r.detail).join("\n");
}

const 号们 = ["138 0013 8000", "138-0013-8001", "（139）0013８002", "+86 13900138003", "13700138004", "137—0013—8005", "", "abc 138"];

beforeAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  await resetDb();
  await prisma.user.create({ data: { id: "u-idx", email: "idx@x.com", name: "我", password: "x", role: "ADMIN" } });
  for (const [i, phone] of 号们.entries()) {
    const c = await prisma.customer.create({ data: { name: `客户${i}`, phone, salesOwnerId: "u-idx" } });
    const t = await prisma.contact.create({ data: { customerId: c.id, name: `联系人${i}` } });
    // 子表：挂在联系人上的手机 / WhatsApp 算，邮箱和客户本身的号（contactId 空）不算
    await prisma.contactMethod.create({ data: { customerId: c.id, contactId: t.id, kind: i % 2 ? "whatsapp" : "phone", value: 号们[(i + 3) % 号们.length] || "1", numberKey: "k" } });
    await prisma.contactMethod.create({ data: { customerId: c.id, contactId: null, kind: "phone", value: "15500138009", numberKey: "k" } });
    await prisma.contactMethod.create({ data: { customerId: c.id, contactId: t.id, kind: "email", value: "13800138000@x.com", numberKey: "k" } });
    await prisma.customerPool.create({ data: { customerId: c.id, at: new Date(Date.UTC(2026, 9, 1 + (i % 3))) } });
    await prisma.followUp.create({ data: { customerId: c.id, type: "PHONE", ownerId: "u-idx", title: "跟进", content: "跟进", occurredAt: new Date(Date.UTC(2026, 9, 1 + i)) } });
  }
});

afterAll(async () => {
  await resetDb();
});

describe("迁移 137 的索引", () => {
  it("七个都建上了；号码子表那个的式子和 号键SQL('\"value\"') 原样一致", async () => {
    const 有 = (await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type = 'index'`)).map((r) => r.name);
    for (const n of ["CustomerPool_at_customerId_idx", "Customer_deletedAt_createdAt_id_idx", "Customer_salesOwnerId_deletedAt_createdAt_id_idx", "FollowUp_deletedAt_occurredAt_idx", "FollowUp_type_deletedAt_occurredAt_ownerId_idx", "FollowUp_customerId_deletedAt_type_ownerId_idx", "ContactMethod_kind_valueKey_idx"]) expect(有).toContain(n);
    expect(迁移).toContain(`ON "ContactMethod"("kind", ${号键SQL('"value"')}, "customerId", "contactId");`);
    // 迁移 138（第二轮）
    expect(有).toContain("Customer_referrerCustomerId_deletedAt_createdAt_idx");
    expect(迁移138).toContain(`CREATE INDEX IF NOT EXISTS "Customer_referrerCustomerId_deletedAt_createdAt_idx" ON "Customer"("referrerCustomerId", "deletedAt", "createdAt");`);
  });

  it("查询计划：公海按入池时间翻页、客户按建档时间翻页、跟进按发生时间取前几条都顺着新索引走，不整表排序", async () => {
    const 公海 = await 计划(`SELECT c.id FROM "CustomerPool" p CROSS JOIN "Customer" c WHERE c.id = p."customerId" AND c."deletedAt" IS NULL ORDER BY p."at" DESC, p."customerId" ASC LIMIT 20 OFFSET 0`);
    expect(公海).toContain("CustomerPool_at_customerId_idx");
    expect(公海).not.toContain("TEMP B-TREE");
    const 客户 = await 计划(`SELECT id FROM "Customer" WHERE "deletedAt" IS NULL ORDER BY "createdAt" DESC, "id" DESC LIMIT 20 OFFSET 0`);
    expect(客户).toContain("Customer_deletedAt_createdAt_id_idx");
    expect(客户).not.toContain("TEMP B-TREE");
    const 跟进 = await 计划(`SELECT id FROM "FollowUp" WHERE "deletedAt" IS NULL ORDER BY "occurredAt" DESC LIMIT 300`);
    expect(跟进).toContain("FollowUp_deletedAt_occurredAt_idx");
    expect(跟进).not.toContain("TEMP B-TREE");
    const 公海跟进 = await 计划(`SELECT COUNT(*) FROM "CustomerPool" p CROSS JOIN "Customer" c CROSS JOIN "FollowUp" f WHERE c.id = p."customerId" AND f."customerId" = p."customerId" AND c."deletedAt" IS NULL AND f."deletedAt" IS NULL AND f."type" = ?`, "PHONE");
    expect(公海跟进).toMatch(/COVERING INDEX FollowUp_customerId_deletedAt_type_ownerId_idx/);
  });

  it("查询计划：号码搜索的客户电话读号键索引、联系人子表读新的表达式索引", async () => {
    const w = (await 客户号码SQL("138 0013"))!;
    const p = await 计划(`SELECT c.id FROM "Customer" c WHERE ${w.sql}`, ...w.values);
    expect(p).toContain(号键索引名);
    expect(p).toContain("ContactMethod_kind_valueKey_idx");
  });
});

describe("查询计划：Prisma 实际发出的语句", () => {
  type 句 = { query: string; params: string };
  const 截 = new PrismaClient({ datasourceUrl: `${process.env.DATABASE_URL}?connection_limit=1`, log: [{ emit: "event", level: "query" }] });
  const 句们: 句[] = [];
  (截 as unknown as { $on: (e: "query", f: (q: 句) => void) => void }).$on("query", (q) => 句们.push({ query: q.query, params: q.params }));
  const 限 = 加上限定(截);
  const 业务员 = "u-idx-sales";

  beforeAll(async () => {
    await prisma.user.create({ data: { id: 业务员, email: "idx-sales@x.com", name: "业务员", password: "x", role: "SALES" } });
    await prisma.entMember.create({ data: { userId: 业务员, bizRole: "sales" } });
    await prisma.setting.create({ data: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
  });
  afterAll(async () => {
    delete process.env.CRM_ENTERPRISE;
    忘掉企业版范围();
    await 截.$disconnect();
  });

  /** 以某人身份跑一次，截下最后一句查 表 的 SELECT，EXPLAIN 它 */
  async function 真计划(谁: string, 表: "Customer" | "FollowUp", fn: () => Promise<unknown>): Promise<{ sql: string; 计划: string }> {
    process.env.CRM_ENTERPRISE = "1";
    忘掉企业版范围();
    句们.length = 0;
    await 以谁的身份(谁, fn);
    const 主 = 句们.filter((q) => q.query.startsWith("SELECT") && q.query.includes(`FROM \`main\`.\`${表}\``)).at(-1);
    expect(主, `没截到查 ${表} 的句子`).toBeTruthy();
    return { sql: 主!.query, 计划: await 计划(主!.query, ...JSON.parse(主!.params)) };
  }
  const 客户页 = (sp: Record<string, string>) => async () => 限.customer.findMany({ where: await 客户筛选条件(sp), orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: 0, take: 20, select: { id: true } });
  const 跟进页 = (where: Record<string, string>) => () => 限.followUp.findMany({ where, orderBy: { occurredAt: "desc" }, take: 300, select: { id: true } });

  it("客户列表：没设角色的、业务员「我的客户」走负责人打头的、不整表排序；按负责人筛走负责人打头的索引", async () => {
    // u-idx 在「按组织看客户」开着时没设业务角色 = 只看公海；第二轮（11-14）起带「不在公海」只剩「负责人 IN 空名单」，走负责人打头的、直接空。
    // 看全部的人顺 (deletedAt, createdAt, id) 那条由下面「他推荐来的人」里的总管理钉着
    const 老板 = await 真计划("u-idx", "Customer", 客户页({}));
    expect(老板.计划).toContain("Customer_salesOwnerId_deletedAt_createdAt_id_idx");
    expect(老板.计划).not.toContain("TEMP B-TREE");
    // 业务员：第二轮（11-14）起查询带「不在公海」时限定层不再拼「OR 在公海」那支，只剩「负责人是我」——走负责人打头的，不整表排序
    const 我的 = await 真计划(业务员, "Customer", 客户页({}));
    expect(我的.sql).toMatch(/`salesOwnerId` IN \(\?\)/);
    expect(我的.sql).not.toMatch(/`salesOwnerId` IN \(\?\) OR/);
    expect(我的.计划).toContain("Customer_salesOwnerId_deletedAt_createdAt_id_idx");
    expect(我的.计划).not.toContain("TEMP B-TREE");
    // 按负责人筛（老板挑一个人 / 业务员自己筛自己）：salesOwnerId = ? 不带 OR，必须走负责人打头的，不能顺 (deletedAt, createdAt, id) 扫再挑人
    for (const [谁, 筛谁] of [["u-idx", 业务员], [业务员, 业务员]]) {
      const 按人 = await 真计划(谁, "Customer", 客户页({ salesOwnerId: 筛谁 }));
      expect(按人.sql).toContain("`salesOwnerId` = ?");
      expect(按人.计划).toContain("Customer_salesOwnerId_deletedAt_createdAt_id_idx");
      expect(按人.计划).not.toContain("Customer_deletedAt_createdAt_id_idx");
      expect(按人.计划).not.toContain("TEMP B-TREE");
    }
  });

  it("跟进记录页：不筛顺 (deletedAt, occurredAt)；按类型筛走类型打头的、不顺 (deletedAt, occurredAt) 扫；类型 + 成员照旧走 (ownerId, occurredAt)", async () => {
    for (const 谁 of ["u-idx", 业务员]) {
      const 不筛 = await 真计划(谁, "FollowUp", 跟进页({}));
      expect(不筛.计划).toContain("FollowUp_deletedAt_occurredAt_idx");
      expect(不筛.计划).not.toContain("TEMP B-TREE");
      const 按类型 = await 真计划(谁, "FollowUp", 跟进页({ type: "VISIT" }));
      expect(按类型.sql).toContain("`type` = ?");
      expect(按类型.计划).toContain("FollowUp_type_deletedAt_occurredAt_ownerId_idx");
      expect(按类型.计划).not.toContain("FollowUp_deletedAt_occurredAt_idx");
      expect(按类型.计划).not.toContain("TEMP B-TREE");
      const 类型成员 = await 真计划(谁, "FollowUp", 跟进页({ type: "PHONE", ownerId: "u-idx" }));
      expect(类型成员.计划).toContain("FollowUp_ownerId_occurredAt_idx");
    }
    // 看得到的跟进数不限定的那句（lib/scope-sql.ts 走 Prisma count）：类型 + 成员同样不被类型那条抢走
    const 数 = await 真计划("u-idx", "FollowUp", () => 限.followUp.count({ where: { type: "PHONE", ownerId: "u-idx" } }));
    expect(数.计划).toContain("FollowUp_ownerId_occurredAt_idx");
  });

  /** 第二轮（11-14）：业务员名下几位不在公海的客户 + 一位看全部的总管理，两种身份都能看到这几位 */
  const 总管理 = "u-idx-boss";
  async function 备名下客户(): Promise<string[]> {
    if (!(await prisma.user.findUnique({ where: { id: 总管理 } }))) {
      await prisma.user.create({ data: { id: 总管理, email: "idx-boss@x.com", name: "总管理", password: "x", role: "SALES" } });
      await prisma.entMember.create({ data: { userId: 总管理, bizRole: "director" } });
    }
    const 有 = await prisma.customer.findMany({ where: { salesOwnerId: 业务员, pool: null }, select: { id: true }, orderBy: { id: "asc" } });
    if (有.length) return 有.map((c) => c.id);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await prisma.customer.create({ data: { name: `名下${i}`, phone: `1370000010${i}`, salesOwnerId: 业务员 } })).id);
    return ids;
  }

  it("记录页窄名单每位最近一条跟进（@pane/panes.tsx，第二轮 11-14）：先按 customerId 排走 (customerId, …) 索引，不顺 (deletedAt, occurredAt) 扫全部跟进；截出来的那条不变", async () => {
    const 客户们 = await 备名下客户();
    // 每位挂三条、时间打乱：最近那条必须是 occurredAt 最大的
    for (const [i, id] of 客户们.entries()) {
      for (const d of [3, 20 - i, 9]) await prisma.followUp.create({ data: { customerId: id, type: "VISIT", ownerId: 业务员, title: `第${d}天`, content: `第${d}天`, occurredAt: new Date(Date.UTC(2026, 9, d)) } });
    }
    const 取 = (orderBy: object) => async () => 限.customer.findMany({ where: { id: { in: 客户们 } }, select: { id: true, followUps: { orderBy: orderBy as never, take: 1, select: { content: true, type: true } } } });
    for (const 谁 of [总管理, 业务员]) {
      // 改前那种写法确实会被 (deletedAt, occurredAt) 抢走：这条红了说明 SQLite 选法变了，下面那条也要重看
      const 旧 = await 真计划(谁, "FollowUp", 取({ occurredAt: "desc" }));
      expect(旧.计划).toContain("FollowUp_deletedAt_occurredAt_idx");
      const 新 = await 真计划(谁, "FollowUp", 取([{ customerId: "asc" }, { occurredAt: "desc" }]));
      expect(新.sql).toMatch(/`customerId` IN \(/);
      expect(新.计划).not.toContain("FollowUp_deletedAt_occurredAt_idx");
      expect(新.计划).toMatch(/FollowUp_customerId_/);
    }
    // 截出来的那条：和只按时间排时一样，都是各位 occurredAt 最大的那条
    const 新行 = await 以谁的身份(业务员, 取([{ customerId: "asc" }, { occurredAt: "desc" }]));
    const 旧行 = await 以谁的身份(业务员, 取({ occurredAt: "desc" }));
    expect(新行.length).toBe(客户们.length);
    const 按id = (rs: typeof 新行) => Object.fromEntries(rs.map((r) => [r.id, r.followUps[0]?.content ?? null]));
    expect(按id(新行)).toEqual(按id(旧行));
    const 全 = await prisma.followUp.findMany({ where: { customerId: { in: 客户们 } }, select: { customerId: true, content: true, occurredAt: true } });
    for (const id of 客户们) expect(按id(新行)[id]).toBe(全.filter((f) => f.customerId === id).sort((a, b) => +b.occurredAt - +a.occurredAt)[0].content);
  });

  it("客户详情「他推荐来的人」（迁移 138）：referrerCustomerId IN (?) ORDER BY createdAt 走 (referrerCustomerId, deletedAt, createdAt)，不顺 (deletedAt, createdAt, id) 扫；客户列表翻页、按负责人筛照旧", async () => {
    const [上家] = await 备名下客户();
    await prisma.customer.create({ data: { name: "下家", phone: "13900000099", salesOwnerId: 业务员, referrerCustomerId: 上家 } });
    for (const 谁 of [总管理, 业务员]) {
      const r = await 真计划(谁, "Customer", () => 限.customer.findUnique({ where: { id: 上家 }, include: { referrals: { select: { id: true, name: true, followStatus: true }, orderBy: { createdAt: "desc" } } } }));
      expect(r.sql).toMatch(/`referrerCustomerId` IN \(\?\)/);
      expect(r.计划).toContain("Customer_referrerCustomerId_deletedAt_createdAt_idx");
      // 列表第 1 页、按负责人筛：不被新索引带走（同上面那条）
      const 页 = await 真计划(谁, "Customer", 客户页({}));
      // 总管理顺 (deletedAt, createdAt, id)；业务员（第二轮去掉「OR 在公海」后）走负责人打头的
      expect(页.计划).toContain(谁 === 总管理 ? "Customer_deletedAt_createdAt_id_idx" : "Customer_salesOwnerId_deletedAt_createdAt_id_idx");
      expect(页.计划).not.toContain("TEMP B-TREE");
      expect(页.计划).not.toContain("Customer_referrerCustomerId_deletedAt_createdAt_idx");
      const 按人 = await 真计划(谁, "Customer", 客户页({ salesOwnerId: 业务员 }));
      expect(按人.计划).toContain("Customer_salesOwnerId_deletedAt_createdAt_id_idx");
    }
    // 渠道页「直接推荐」（channelId = ? AND referrerCustomerId IS NULL）：照旧顺 (deletedAt, createdAt, id)，不换到新索引上扫全部没推荐人的
    const 直推 = await 真计划(总管理, "Customer", 客户页({ directOf: "ch-x" }));
    expect(直推.sql).toContain("`referrerCustomerId` IS NULL");
    expect(直推.计划).toContain("Customer_deletedAt_createdAt_id_idx");
  });
});

describe("号码搜索换写法：结果和原来一模一样", () => {
  /** 原来客户电话那一段的写法：外层每行现算号键 */
  const 原客户电话 = (p: string) => prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT c.id FROM "Customer" c WHERE ${号键SQL('c."phone"')} GLOB ?`, p);
  const 词们 = ["138", "0013", "13800138000", "8002", "139 0013", "+86 139", "86139", "（137）", "abc", "00138"];

  it("客户电话（rowid 子查询读索引）= 原来逐行现算 = 照 号键 在内存里比", async () => {
    const 全 = await prisma.customer.findMany({ select: { id: true, phone: true } });
    for (const k of 词们) {
      const w = (await 客户号码SQL(k))!;
      if (!w.values.length) continue;
      const 新 = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT c.id FROM "Customer" c WHERE c.rowid IN (SELECT x.rowid FROM "Customer" x WHERE ${号键SQL('x."phone"')} GLOB ?)`, w.values[0])).map((r) => r.id).sort();
      const 旧 = (await 原客户电话(w.values[0])).map((r) => r.id).sort();
      expect({ k, 新 }).toEqual({ k, 新: 旧 });
      const 片 = w.values[0].replace(/^\*|\*$/g, "");
      if (!/[[\]]/.test(片)) expect({ k, 新 }).toEqual({ k, 新: 全.filter((c) => 号键(c.phone ?? "").includes(片)).map((c) => c.id).sort() });
    }
  });

  it("整句号码搜索 / 关键词搜索：新写法的客户 id 集合和把客户电话那段换回原来写法的一样", async () => {
    for (const k of 词们) {
      for (const 取 of [() => 客户号码SQL(k), () => 客户关键词SQL(k)]) {
        const w = await 取();
        if (!w) continue;
        const 新 = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT c.id FROM "Customer" c WHERE ${w.sql}`, ...w.values)).map((r) => r.id).sort();
        const 原sql = w.sql.replace(`c.rowid IN (SELECT x.rowid FROM "Customer" x WHERE ${号键SQL('x."phone"')} GLOB ?)`, `${号键SQL('c."phone"')} GLOB ?`);
        const 旧 = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT c.id FROM "Customer" c WHERE ${原sql}`, ...w.values)).map((r) => r.id).sort();
        expect({ k, 新 }).toEqual({ k, 新: 旧 });
      }
    }
  });

  it("联系人子表那一段：走表达式索引的结果 = 照 号键 在内存里比（只算挂在没删联系人上的手机 / WhatsApp）", async () => {
    const 行 = await prisma.contactMethod.findMany({ where: { kind: { in: ["phone", "whatsapp"] }, contactId: { not: null }, contact: { deletedAt: null } }, select: { customerId: true, value: true } });
    for (const k of ["138", "0013", "8001", "139"]) {
      const p = 包含模式(k);
      const 库 = (await prisma.$queryRawUnsafe<{ customerId: string }[]>(`SELECT DISTINCT m."customerId" FROM "ContactMethod" m JOIN "Contact" mt ON mt.id = m."contactId" WHERE mt."deletedAt" IS NULL AND m.kind IN ('phone', 'whatsapp') AND ${号键SQL("m.value")} GLOB ?`, p)).map((r) => r.customerId).sort();
      const 内存 = [...new Set(行.filter((r) => 号键(r.value).includes(k)).map((r) => r.customerId))].sort();
      expect({ k, 库 }).toEqual({ k, 库: 内存 });
      expect(库.length).toBeGreaterThan(0);
    }
  });
});
