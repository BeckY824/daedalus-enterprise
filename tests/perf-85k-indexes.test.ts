/**
 * 迁移 137（8.5 万客户提速，11-14）的五个索引：建上了、查询计划真用上了、换写法的号码搜索结果和原来一模一样。
 * 计划这几条是先写的：没有这几个索引时 SQLite（没统计信息）会挑 deletedAt 索引再整表排序、号码搜索每行现算 20 层 replace。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 号键SQL, 号键索引名 } from "@/lib/phone-dedupe";
import { 号键 } from "@/lib/phone";
import { 包含模式, 客户号码SQL, 客户关键词SQL } from "@/lib/search-keyword";

const 迁移 = fs.readFileSync(new URL("../migrations/137-perf-85k-indexes.sql", import.meta.url), "utf8");

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
  it("五个都建上了；号码子表那个的式子和 号键SQL('\"value\"') 原样一致", async () => {
    const 有 = (await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM sqlite_master WHERE type = 'index'`)).map((r) => r.name);
    for (const n of ["CustomerPool_at_customerId_idx", "Customer_deletedAt_createdAt_id_idx", "FollowUp_deletedAt_occurredAt_idx", "FollowUp_customerId_deletedAt_type_ownerId_idx", "ContactMethod_kind_valueKey_idx"]) expect(有).toContain(n);
    expect(迁移).toContain(`ON "ContactMethod"("kind", ${号键SQL('"value"')}, "customerId", "contactId");`);
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
