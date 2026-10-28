/**
 * 左栏三个数（2026-10-28 企业版 P1）在「按组织看客户」开着 / 关着时逐个身份和 Prisma 老路对拍：
 * 客户角标（lib/pool-db.ts 客户总数 → 裸 SQL）、商机角标（lib/scope-sql.ts 看得到的在谈商机数，EXISTS）、
 * 跟进红数字（lib/reminders-db.ts 数提醒：名下的人在读的范围里就不再套钩子的范围）。
 * 用拷出来的一份库、显式单连接，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-layout-counts-"));
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
import { 客户总数 } from "@/lib/pool-db";
import { 看得到的在谈商机数 } from "@/lib/scope-sql";
import { 数提醒, 取提醒项 } from "@/lib/reminders-db";
import { 算提醒 } from "@/lib/reminders";

const 老板 = "e_boss";
const 总管 = "e_dir";
const 经理 = "e_mgr";
const 小王 = "e_wang"; // 经理的实线下属
const 小张 = "e_zhang"; // 经理的虚线下属
const 小赵 = "e_zhao"; // 小张的实线下属
const 外人 = "e_other";
const 谁们 = [老板, 总管, 经理, 小王, 小张, 小赵, 外人, "ghost"];
const 负责人们 = [老板, 经理, 小王, 小张, 小赵, 外人];
const 现在 = new Date(Date.UTC(2026, 9, 10, 9, 30));

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "TradeOrder", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerExtra", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "Supplier", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
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
  const 时 = (h: number) => new Date(现在.getTime() + h * 3_600_000);
  // 60 位：负责人轮着来、每 7 位一位渠道是经理的、每 5 位一位进公海；每位两三个商机（在谈 / 赢 / 输），
  // 计划和待办的负责人故意错开一位（自己名下、挂在看不到的客户上的也得数进去）
  for (let i = 0; i < 60; i++) {
    const o = 负责人们[i % 负责人们.length];
    const c = await raw.customer.create({
      data: { name: `客户${i}`, phone: `139${String(i).padStart(8, "0")}`, salesOwnerId: o, ...(i % 7 === 0 ? { channelOwnerId: 经理 } : {}) },
    });
    if (i % 5 === 0) await raw.customerPool.create({ data: { customerId: c.id } });
    for (const [k, status] of (["OPEN", i % 3 ? "WON" : "OPEN", ...(i % 4 ? [] : ["LOST"])] as const).entries())
      await raw.opportunity.create({ data: { name: `商机${i}-${k}`, customerId: c.id, ownerId: o, status } });
    const 办的人 = 负责人们[(i + 1) % 负责人们.length];
    await raw.followPlan.create({ data: { subject: "计划", plannedAt: 时(i % 2 ? -30 : 2), customerId: c.id, ownerId: 办的人 } });
    await raw.task.create({ data: { title: "待办", dueAt: 时(i % 3 ? 1 : -5), customerId: c.id, ownerId: 办的人, done: i % 11 === 0 } });
  }
});

beforeEach(() => 忘掉企业版范围());

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

/** 逐个身份：新数 = 钩子限定下 Prisma 老路数出来的 */
async function 对拍() {
  for (const 谁 of 谁们)
    await 以谁的身份(谁, async () => {
      expect({ 谁, 客户: await 客户总数() }).toEqual({ 谁, 客户: await db.customer.count() });
      expect({ 谁, 商机: await 看得到的在谈商机数() }).toEqual({ 谁, 商机: await db.opportunity.count({ where: { status: "OPEN" } }) });
      const 全拉 = 算提醒(await 取提醒项(谁), 现在);
      expect({ 谁, 提醒: await 数提醒(谁, 现在) }).toEqual({ 谁, 提醒: { 逾期: 全拉.逾期, 今天: 全拉.今天 } });
    });
}

describe("左栏三个数：快路径 = Prisma 老路", () => {
  it("按组织看客户开着：逐个身份", async () => {
    await raw.setting.create({ data: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
    try {
      await 对拍();
      // 钉几个绝对值，免得两边一起错还对得上
      const 在谈 = await raw.opportunity.count({ where: { status: "OPEN" } });
      expect(await 以谁的身份(老板, 看得到的在谈商机数)).toBe(在谈);
      const 外人看 = await raw.opportunity.count({ where: { status: "OPEN", customer: { OR: [{ salesOwnerId: 外人 }, { channelOwnerId: 外人 }, { pool: { isNot: null } }] } } });
      expect(await 以谁的身份(外人, 看得到的在谈商机数)).toBe(外人看);
      expect(外人看).toBeLessThan(在谈);
      const 公海商机 = await raw.opportunity.count({ where: { status: "OPEN", customer: { pool: { isNot: null } } } });
      expect(await 以谁的身份("ghost", 看得到的在谈商机数)).toBe(公海商机);
      // 外人名下的计划 / 待办挂在别人的客户上（负责人错开一位），老路靠「负责人是我」数进去，快路径不套范围也一样
      const 外人的 = 算提醒(await 以谁的身份(外人, () => 取提醒项(外人)), 现在);
      expect(外人的.逾期 + 外人的.今天).toBeGreaterThan(0);
    } finally {
      await raw.setting.deleteMany({ where: { key: 规则.按组织看客户.key } });
    }
  });

  it("按组织看客户关着：和 Prisma 照样一致", async () => {
    await 对拍();
  });

  it("开关关着（没开企业版）也一样", async () => {
    delete process.env.CRM_ENTERPRISE;
    忘掉企业版范围();
    try {
      await 对拍();
      expect(await 看得到的在谈商机数()).toBe(await raw.opportunity.count({ where: { status: "OPEN" } }));
    } finally {
      process.env.CRM_ENTERPRISE = "1";
      忘掉企业版范围();
    }
  });
});
