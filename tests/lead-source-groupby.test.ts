/**
 * 线索页「来源」下拉的去重从 findMany({ distinct }) 换成 groupBy（2026-10-28 企业版性能 P3）。
 * 范围扩展（lib/team-scope.ts 加上限定）对 groupBy 和 findMany 加的是同一个 where，这里逐个身份对拍：
 * 按组织看客户开着 / 关着、市场管理开着线索分配（线索全看）、企业版开关关着，两种写法拿到的来源集合一样。
 * 用拷出来的一份库、显式单连接，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-lead-source-"));
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

const 老板 = "s_boss";
const 总管 = "s_dir";
const 市场 = "s_mkt";
const 经理 = "s_mgr";
const 小王 = "s_wang"; // 经理的实线下属
const 小张 = "s_zhang"; // 经理的虚线下属
const 外人 = "s_other";
const 谁们 = [老板, 总管, 市场, 经理, 小王, 小张, 外人, "ghost"];
const 负责人们 = [老板, 市场, 经理, 小王, 小张, 外人];

const 新写法 = async () => (await db.lead.groupBy({ by: ["source"] })).map((l) => l.source).sort();
const 老写法 = async () => [...new Set((await db.lead.findMany({ distinct: ["source"], select: { source: true } })).map((l) => l.source))].sort();
const 全部来源 = async () => [...new Set((await raw.lead.findMany({ select: { source: true } })).map((l) => l.source))].sort();

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "TradeOrder", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerExtra", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "Supplier", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  const 人 = (id: string, name: string, role = "SALES") => raw.user.create({ data: { id, email: `${id}@x.com`, name, password: "x", role } });
  await 人(老板, "老板", "ADMIN");
  for (const [id, n] of [[总管, "总管"], [市场, "市场"], [经理, "经理"], [小王, "小王"], [小张, "小张"], [外人, "外人"]]) await 人(id, n);
  await raw.entMember.createMany({
    data: [
      { userId: 总管, bizRole: "director" },
      { userId: 市场, bizRole: "marketing_mgr" },
      { userId: 经理, bizRole: "sales_mgr" },
      { userId: 小王, managerId: 经理 },
      { userId: 小张, dottedManagerId: 经理 },
      { userId: 外人 },
    ],
  });
  // 每位负责人有一种只有自己用的来源，再有几种大家共用的；一部分线索挂在客户上（客户的负责人错开一位、
  // 每 5 位进公海），还有没负责人的。这样各身份看到的来源集合互不相同
  for (let i = 0; i < 48; i++) {
    const o = 负责人们[i % 负责人们.length];
    const 挂客户 = i % 3 === 0;
    const c = 挂客户
      ? await raw.customer.create({ data: { name: `客户${i}`, phone: `139${String(i).padStart(8, "0")}`, salesOwnerId: 负责人们[(i + 1) % 负责人们.length] } })
      : null;
    if (c && i % 5 === 0) await raw.customerPool.create({ data: { customerId: c.id } });
    await raw.lead.create({
      data: { name: `线索${i}`, ownerId: i % 13 === 0 ? null : o, source: i % 2 ? `${o}的来源` : ["微信", "官网注册", "转介绍"][i % 3], customerId: c?.id },
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

async function 对拍() {
  const 各人 = new Map<string, string[]>();
  for (const 谁 of 谁们)
    await 以谁的身份(谁, async () => {
      const 新 = await 新写法();
      expect({ 谁, 来源: 新 }).toEqual({ 谁, 来源: await 老写法() });
      各人.set(谁, 新);
    });
  return 各人;
}

describe("线索来源去重：groupBy = distinct（逐个身份）", () => {
  it("按组织看客户开着", async () => {
    await raw.setting.create({ data: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
    try {
      const 各人 = await 对拍();
      // 钉绝对值，免得两边一起错还对得上：老板看全部，外人只看得到一部分
      expect(各人.get(老板)).toEqual(await 全部来源());
      expect(各人.get(外人)!.length).toBeLessThan((await 全部来源()).length);
      expect(各人.get(外人)).toContain(`${外人}的来源`);
      // 外人：自己名下的线索 + 挂在看得到的客户（自己的、公海的）上的线索
      const 外人看 = await raw.lead.findMany({
        where: { OR: [{ ownerId: 外人 }, { customer: { OR: [{ salesOwnerId: 外人 }, { channelOwnerId: 外人 }, { pool: { isNot: null } }] } }] },
        select: { source: true },
      });
      expect(各人.get(外人)).toEqual([...new Set(外人看.map((l) => l.source))].sort());
    } finally {
      await raw.setting.deleteMany({ where: { key: 规则.按组织看客户.key } });
    }
  });

  it("按组织看客户关着", async () => {
    await 对拍();
  });

  it("市场管理开着线索分配（线索不限定）：市场管理看全部来源，别人照旧", async () => {
    await raw.setting.create({ data: { key: 规则.线索分配.key, value: JSON.stringify(true) } });
    try {
      const 各人 = await 对拍();
      expect(各人.get(市场)).toEqual(await 全部来源());
    } finally {
      await raw.setting.deleteMany({ where: { key: 规则.线索分配.key } });
    }
  });

  it("企业版开关关着：不限定，两种写法都拿到全部来源", async () => {
    delete process.env.CRM_ENTERPRISE;
    忘掉企业版范围();
    try {
      for (const 谁 of [老板, 外人])
        await 以谁的身份(谁, async () => {
          expect(await 新写法()).toEqual(await 老写法());
          expect(await 新写法()).toEqual(await 全部来源());
        });
    } finally {
      process.env.CRM_ENTERPRISE = "1";
      忘掉企业版范围();
    }
  });
});
