import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath() {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => ({ id: "export-user", name: "导出测试", role: "ADMIN" }) }));
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 开始完整导出, 读取完整导出批次, 校验完整导出, 导出客户 } from "@/app/(app)/customers/export-action";
import { 客户筛选条件, 关键词分页, 只按页签, 在看子集, type 客户条件 } from "@/app/(app)/customers/query";
import { 客户页签数 } from "@/lib/pool-db";

/*
  11-03：列表 122 条、导出 121 条。导出的客户条件原来多套一层「截止前创建或改过」，
  创建、修改时间都写在未来的旧记录（导入 / 迁移来的）列表里有、导出里没有。
  现在导出和列表用同一份 客户筛选条件；这里照 customers/page.tsx 的三条路数列表总数，和导出两头比
*/
beforeEach(async () => {
  await resetDb();
  await prisma.user.create({ data: { id: "export-user", name: "导出测试", email: "export@local", password: "x", role: "ADMIN" } });
  // 企业版导出只给总管理（lib/enterprise/import-perm.ts）
  await prisma.entMember.create({ data: { userId: "export-user", bizRole: "director" } });
  const at = new Date("2026-01-01");
  const 未来 = new Date(Date.now() + 30 * 86400_000);
  const 客户 = [
    { id: "a", name: "张三公司", phone: "13800000001", followStatus: "跟进中", createdAt: at, updatedAt: at },
    { id: "b", name: "李四公司", phone: "13800000002", followStatus: "跟进中", createdAt: at, updatedAt: at },
    { id: "c", name: "王五", phone: "13800000003", followStatus: "已成交", createdAt: at, updatedAt: at },
    // 两个时间都在未来：原来导出漏掉的就是这种
    { id: "future", name: "未来公司", phone: "13800000004", followStatus: "跟进中", createdAt: 未来, updatedAt: 未来 },
    { id: "pool", name: "公海公司", phone: "13800000005", followStatus: "跟进中", createdAt: at, updatedAt: at },
  ];
  for (const c of 客户) await prisma.customer.create({ data: { ...c, salesOwnerId: "export-user" } });
  await prisma.customerPool.create({ data: { customerId: "pool" } });
  await prisma.followUp.create({ data: { customerId: "future", ownerId: "export-user", type: "PHONE", title: "回电", content: "内容", createdAt: at, updatedAt: at } });
});
afterAll(() => prisma.$disconnect());

/** 照 customers/page.tsx：关键词那条 SQL 接得住就用它的 total，只剩页签就用页签数，否则 count */
async function 列表总数(sp: 客户条件) {
  const 快 = await 关键词分页(sp, 1, 20);
  if (快) return 快.total;
  const where = await 客户筛选条件(sp);
  const 页签 = 在看子集(sp) ? null : 只按页签(where);
  if (页签) return (await 客户页签数())[页签];
  return prisma.customer.count({ where });
}

async function 导出全部(条件: 客户条件) {
  const start = await 开始完整导出(条件);
  const fingerprints: { 类别: "客户" | "跟进"; 指纹: string }[] = [];
  const ids: string[] = [];
  for (const kind of ["客户", "跟进"] as const) {
    let cursor: string | undefined;
    do {
      const r = await 读取完整导出批次(条件, start.截止, kind, cursor);
      if (kind === "客户") ids.push(...r.rows.map((x) => x.id));
      fingerprints.push({ 类别: kind, 指纹: r.指纹 });
      cursor = r.游标 ?? undefined;
    } while (cursor);
  }
  return { start, fingerprints, ids };
}

it.each<[string, 客户条件]>([
  ["不筛", {}],
  ["公海页签", { pool: "1" }],
  ["关键词", { keyword: "公司" }],
  ["跟进状态", { followStatus: "跟进中" }],
  ["关键词 + 跟进状态", { keyword: "公司", followStatus: "跟进中" }],
])("同条件下列表条数 = 导出起点客户数 = 分批读出的行数：%s", async (_, 条件) => {
  const 列表 = await 列表总数(条件);
  const r = await 导出全部(条件);
  expect(r.start.客户数).toBe(列表);
  expect(new Set(r.ids).size).toBe(列表);
  expect(await 校验完整导出(条件, r.start, r.fingerprints)).toEqual({ ok: true });
});

it("两个时间都在未来的客户列表里有，导出里也有", async () => {
  expect(await 列表总数({})).toBe(4);
  const r = await 导出全部({});
  expect(r.ids.sort()).toEqual(["a", "b", "c", "future"]);
  expect(r.start.跟进数).toBe(1);
});

it("校验通过才留审计：谁、导了哪张表、多少行、当时的筛选", async () => {
  const 条件 = { keyword: "公司", followStatus: "跟进中", grade: "" };
  const r = await 导出全部(条件);
  expect(await prisma.auditLog.count({ where: { action: "export" } })).toBe(0);
  await 校验完整导出(条件, r.start, r.fingerprints);
  const logs = await prisma.auditLog.findMany({ where: { action: "export" } });
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ userId: "export-user", userName: "导出测试", entity: "Customer", summary: "导出客户表 3 位、沟通记录 1 条" });
  expect(JSON.parse(logs[0].detail!)).toEqual({ 筛选: { keyword: "公司", followStatus: "跟进中" }, 客户数: 3, 跟进数: 1 });
});

it("校验没过（中途数据变了）不记审计", async () => {
  const r = await 导出全部({});
  await prisma.customer.update({ where: { id: "a" }, data: { remark: "改动", updatedAt: new Date(Date.now() + 10) } });
  await expect(校验完整导出({}, r.start, r.fingerprints)).rejects.toThrow(/变化/);
  expect(await prisma.auditLog.count({ where: { action: "export" } })).toBe(0);
});

it("旧的一次性导出也留审计", async () => {
  const r = await 导出客户({ followStatus: "已成交" });
  expect(r).toMatchObject({ ok: true });
  const logs = await prisma.auditLog.findMany({ where: { action: "export" } });
  expect(logs.map((l) => l.summary)).toEqual(["导出客户表 1 位、沟通记录 0 条"]);
});
