/**
 * 企业版顶部全局搜索（U-项目-04）的角色范围，真库、走真的组织架构范围（visibility.ts + 加上限定），不 mock 范围：
 *   - 销售 A 只搜得到自己的客户、项目、联系人；销售 B 的一条都不出
 *   - A 的直属上级搜得到 A 的，搜不到 B 的
 *   - 总管理员全搜得到
 *   - 回收站里的不出；一个字不搜；不是企业版一律给空（桌面端 / 团队版 ⌘K 只跳页面）
 * 用拷出来的一份库、显式单连接，不碰共用的测试库（同 ent-contact-link-scope.test.ts）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-gsearch-scope-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), getCurrentUser: async () => 登录.user, requireUser: async () => 登录.user }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 全局搜索, type 全局搜索结果 } from "@/app/(app)/global-search";

const 销售A = "gs_a";
const 销售B = "gs_b";
const 上级 = "gs_mgr";
const 老板 = "gs_boss";

const 搜 = (id: string, q: string, role = "SALES") => {
  登录.user = { ...登录.user, id, name: id, email: `${id}@x.com`, role };
  return 以谁的身份(id, () => 全局搜索(q));
};
const 名字们 = (r: 全局搜索结果) => ({
  客户: r.客户.map((x) => x.name).sort(),
  项目: r.项目.map((x) => x.name).sort(),
  联系人: r.联系人.map((x) => x.name).sort(),
});

let 甲: string;

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ContactCustomer", "ContactMethod", "Attachment", "ProjectNodeLog", "ProjectMember", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [销售A, 销售B, 上级]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  await raw.user.create({ data: { id: 老板, email: `${老板}@x.com`, name: 老板, password: "x", role: "ADMIN" } });
  await raw.entMember.createMany({
    data: [{ userId: 上级, bizRole: "sales_mgr" }, { userId: 销售A, managerId: 上级 }, { userId: 销售B }, { userId: 老板, bizRole: "director" }],
  });
  甲 = (await raw.customer.create({ data: { name: "QA搜索-甲公司", phone: "13800003001", salesOwnerId: 销售A } })).id;
  const 乙 = (await raw.customer.create({ data: { name: "QA搜索-乙公司", phone: "13800003002", salesOwnerId: 销售B } })).id;
  await raw.project.create({ data: { customerId: 甲, ownerId: 销售A, creatorId: 销售A, name: "QA搜索-甲一期", phase: "商机", node: "明确需求" } });
  await raw.project.create({ data: { customerId: 乙, ownerId: 销售B, creatorId: 销售B, name: "QA搜索-乙一期", phase: "商机", node: "明确需求" } });
  const 甲的人 = (await raw.contact.create({ data: { customerId: 甲, name: "QA搜索-甲联系人", phone: "13900003001" } })).id;
  const 乙的人 = (await raw.contact.create({ data: { customerId: 乙, name: "QA搜索-乙联系人", phone: "13900003002" } })).id;
  await raw.contactCustomer.createMany({ data: [{ contactId: 甲的人, customerId: 甲 }, { contactId: 乙的人, customerId: 乙 }] });
  // 回收站里的一位（企业版软删）：谁搜都不出
  await raw.customer.create({ data: { name: "QA搜索-已删公司", phone: "13800003009", salesOwnerId: 销售A, deletedAt: new Date() } });
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
  忘掉企业版范围();
});

beforeEach(() => {
  process.env.CRM_ENTERPRISE = "1";
  忘掉企业版范围();
});

afterAll(async () => {
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

const 只有甲 = { 客户: ["QA搜索-甲公司"], 项目: ["QA搜索-甲一期"], 联系人: ["QA搜索-甲联系人"] };
const 只有乙 = { 客户: ["QA搜索-乙公司"], 项目: ["QA搜索-乙一期"], 联系人: ["QA搜索-乙联系人"] };

describe("全局搜索按角色限定范围（U-项目-04）", () => {
  it("销售 A 只出自己的客户、项目、联系人；B 的一条不出，回收站里的不出", async () => {
    expect(名字们(await 搜(销售A, "QA搜索"))).toEqual(只有甲);
  });

  it("销售 B 只出自己的", async () => {
    expect(名字们(await 搜(销售B, "QA搜索"))).toEqual(只有乙);
  });

  it("按名字搜 B 的客户、项目、联系人，A 一条都搜不到（不能越权）", async () => {
    for (const q of ["乙公司", "乙一期", "乙联系人", "13900003002"]) {
      expect(名字们(await 搜(销售A, q))).toEqual({ 客户: [], 项目: [], 联系人: [] });
    }
  });

  it("A 的直属上级搜得到 A 的，搜不到 B 的", async () => {
    expect(名字们(await 搜(上级, "QA搜索"))).toEqual(只有甲);
  });

  it("总管理员全搜得到", async () => {
    expect(名字们(await 搜(老板, "QA搜索", "ADMIN"))).toEqual({
      客户: ["QA搜索-乙公司", "QA搜索-甲公司"].sort(),
      项目: ["QA搜索-乙一期", "QA搜索-甲一期"].sort(),
      联系人: ["QA搜索-乙联系人", "QA搜索-甲联系人"].sort(),
    });
  });

  it("按客户名也搜得到名下项目；结果带去处：客户、项目进详情，联系人去所属客户", async () => {
    const r = await 搜(销售A, "甲公司");
    expect(r.项目.map((x) => x.name)).toEqual(["QA搜索-甲一期"]);
    expect(r.项目[0].去).toMatch(/^\/projects\//);
    expect(r.客户[0].去).toBe(`/customers/${甲}`);
    const 人 = await 搜(销售A, "13900003001");
    expect(人.联系人.map((x) => [x.name, x.去])).toEqual([["QA搜索-甲联系人", `/customers/${甲}`]]);
  });

  it("一个字不搜；不是企业版一律给空", async () => {
    expect(名字们(await 搜(老板, "Q", "ADMIN"))).toEqual({ 客户: [], 项目: [], 联系人: [] });
    process.env.CRM_ENTERPRISE = "";
    expect(名字们(await 搜(老板, "QA搜索", "ADMIN"))).toEqual({ 客户: [], 项目: [], 联系人: [] });
  });
});
