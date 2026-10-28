/**
 * 跟进记录页的总数（2026-10-28 企业版，lib/scope-sql.ts 看得到的跟进数，customerId IN 看得到的客户）在「按组织看客户」
 * 开着 / 关着、开关关着时逐个身份、逐种筛选（不筛 / 类型 / 负责人 / 两个都筛）和 Prisma 老路对拍。
 * 用拷出来的一份库、显式单连接，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-followup-count-"));
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
import { 看得到的跟进数 } from "@/lib/scope-sql";

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
const 类型们 = ["PHONE", "VISIT", "EMAIL"];

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
  // 60 位：负责人轮着来、每 7 位一位渠道是经理的、每 5 位一位进公海；每位两三条跟进，记的人故意错开一位
  // （自己记的、挂在看不到的客户上的不该数进去：跟进的范围只看客户）
  for (let i = 0; i < 60; i++) {
    const o = 负责人们[i % 负责人们.length];
    const c = await raw.customer.create({
      data: { name: `客户${i}`, phone: `139${String(i).padStart(8, "0")}`, salesOwnerId: o, ...(i % 7 === 0 ? { channelOwnerId: 经理 } : {}) },
    });
    if (i % 5 === 0) await raw.customerPool.create({ data: { customerId: c.id } });
    for (let k = 0; k < 2 + (i % 2); k++)
      await raw.followUp.create({
        data: { type: 类型们[(i + k) % 类型们.length], title: "跟进", content: `跟进${i}-${k}`, occurredAt: new Date(现在.getTime() - (i * 3 + k) * 60_000), customerId: c.id, ownerId: 负责人们[(i + k) % 负责人们.length] },
      });
  }
});

beforeEach(() => 忘掉企业版范围());

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

const 筛法们 = [{}, { type: "VISIT" }, { ownerId: 小王 }, { type: "PHONE", ownerId: 外人 }, { ownerId: "ghost" }];

/** 逐个身份、逐种筛法：新数 = 钩子限定下 Prisma 老路数出来的 */
async function 对拍() {
  for (const 谁 of 谁们)
    await 以谁的身份(谁, async () => {
      for (const 筛 of 筛法们) expect({ 谁, 筛, n: await 看得到的跟进数(筛) }).toEqual({ 谁, 筛, n: await db.followUp.count({ where: 筛 }) });
    });
}

describe("跟进记录页总数：裸 SQL = Prisma 老路", () => {
  it("按组织看客户开着：逐个身份", async () => {
    await raw.setting.create({ data: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
    try {
      await 对拍();
      // 钉几个绝对值，免得两边一起错还对得上
      const 全部 = await raw.followUp.count();
      expect(await 以谁的身份(老板, () => 看得到的跟进数({}))).toBe(全部);
      const 外人看 = await raw.followUp.count({ where: { customer: { OR: [{ salesOwnerId: 外人 }, { channelOwnerId: 外人 }, { pool: { isNot: null } }] } } });
      expect(await 以谁的身份(外人, () => 看得到的跟进数({}))).toBe(外人看);
      expect(外人看).toBeLessThan(全部);
      const 公海的 = await raw.followUp.count({ where: { customer: { pool: { isNot: null } } } });
      expect(await 以谁的身份("ghost", () => 看得到的跟进数({}))).toBe(公海的);
      // 外人自己记的、挂在别人客户上的不数
      const 外人记的 = await raw.followUp.count({ where: { ownerId: 外人 } });
      expect(await 以谁的身份(外人, () => 看得到的跟进数({ ownerId: 外人 }))).toBeLessThan(外人记的);
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
      expect(await 看得到的跟进数({})).toBe(await raw.followUp.count());
    } finally {
      process.env.CRM_ENTERPRISE = "1";
      忘掉企业版范围();
    }
  });
});
