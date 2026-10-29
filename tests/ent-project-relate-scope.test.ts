/**
 * 企业版项目关联的可见范围，真库、真组织架构（2026-10-29 P17，src/lib/project/relate.ts）：
 *   - 销售 B：往自己项目上挂 A 的客户、A 的联系人——「不在了（或你看不到）」；动 A 的项目——项目不在了；库里原样
 *   - B 的项目上挂着 A 的客户、A 的联系人（管理员挂的）：B 打开项目只看到「同事的客户 / 同事的联系人 #短号」，没名字没链接；
 *     B 是负责人也不例外（负责人只对主客户那一家开口子）；B 能解除（改的是自己的项目）
 *   - 客户页「参与的项目」：A 看自己的客户，看不到 B 的项目那行
 * 用拷出来的一份库、显式单连接，不碰共用的测试库（同 ent-contact-link-scope.test.ts）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-prel-scope-"));
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

import { defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 团队版字典 } from "@/lib/project/stage-dict";
import { 加关联客户, 改客户身份, 解除关联客户, 加关联联系人, 项目关联们, 客户参与的项目, 看不到的客户, 看不到的联系人 } from "@/lib/project/relate";

const 销售A = "prel_a";
const 销售B = "prel_b";
const A = { id: 销售A, role: "SALES" };
const B = { id: 销售B, role: "SALES" };

let 甲: string; // A 的客户
let 乙: string; // B 的客户
let A的人: string;
let A的项目: string;
let B的项目: string;

const 关联们 = async () => (await raw.projectCustomer.findMany({ select: { projectId: true, customerId: true, roles: true } }))
  .map((x) => `${x.projectId}>${x.customerId}:${x.roles ?? ""}`).sort();
const 看不到 = { ok: false, error: expect.stringMatching(/不在了（或你看不到）/) };

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ProjectContact", "ProjectCustomer", "ContactCustomer", "ContactMethod", "Attachment", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [销售A, 销售B]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  await raw.entMember.createMany({ data: [{ userId: 销售A }, { userId: 销售B }] });
  甲 = (await raw.customer.create({ data: { name: "QA-A的客户甲", phone: "13800001711", salesOwnerId: 销售A } })).id;
  乙 = (await raw.customer.create({ data: { name: "QA-B的客户乙", phone: "13800001712", salesOwnerId: 销售B } })).id;
  A的人 = (await raw.contact.create({ data: { customerId: 甲, name: "王五", gender: "男" } })).id;
  A的项目 = (await raw.project.create({ data: { name: "QA-A的项目", customerId: 甲, ownerId: 销售A, creatorId: 销售A } })).id;
  B的项目 = (await raw.project.create({ data: { name: "QA-B的项目", customerId: 乙, ownerId: 销售B, creatorId: 销售B } })).id;
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
  忘掉企业版范围();
});

beforeEach(() => {
  process.env.CRM_ENTERPRISE = "1";
  忘掉企业版范围();
});

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("企业版项目关联：跟着项目和客户的可见范围走（真库、真组织架构）", () => {
  it("B 往自己项目上挂 A 的客户、A 的联系人：看不到当不在；动 A 的项目：项目不在了；库里原样", async () => {
    const 前 = await 关联们();
    expect(await 以谁的身份(销售B, () => 加关联客户(B, B的项目, 甲, ["总包方"]))).toEqual(看不到);
    expect(await 以谁的身份(销售B, () => 加关联联系人(B, B的项目, A的人))).toEqual(看不到);
    expect(await 以谁的身份(销售B, () => 加关联客户(B, A的项目, 乙))).toMatchObject({ ok: false, error: expect.stringContaining("项目已经不在了") });
    expect(await 以谁的身份(销售B, () => 改客户身份(B, A的项目, 甲, ["业主方"]))).toMatchObject({ ok: false, error: expect.stringContaining("项目已经不在了") });
    expect(await 以谁的身份(销售B, () => 项目关联们(B, A的项目))).toBeNull();
    expect(await 关联们()).toEqual(前);
    expect(await raw.projectContact.count()).toBe(0);
  });

  it("B 的项目上挂着 A 的客户和联系人（管理员挂的）：B 只看到占位，负责人也不露名字；B 能解除", async () => {
    await raw.projectCustomer.create({ data: { projectId: B的项目, customerId: 甲, roles: '["监理方"]' } });
    await raw.projectContact.create({ data: { projectId: B的项目, contactId: A的人, stance: "中立" } });
    const r = (await 以谁的身份(销售B, () => 项目关联们(B, B的项目)))!;
    expect(r.客户们[0]).toMatchObject({ customerId: 乙, 名: "QA-B的客户乙", 主: true, 看得到: true });
    expect(r.客户们[1]).toMatchObject({ customerId: 甲, 主: false, 看得到: false, 全称: "", 身份: ["监理方"] });
    expect(r.客户们[1].名.startsWith(看不到的客户)).toBe(true);
    expect(r.客户们[1].名).not.toContain("QA-A");
    expect(r.联系人们).toHaveLength(1);
    expect(r.联系人们[0]).toMatchObject({ contactId: A的人, 看得到: false, 姓名: "", customerId: null, 立场: "中立" });
    expect(r.联系人们[0].名.startsWith(看不到的联系人)).toBe(true);
    expect(r.联系人们[0].名).not.toContain("王");

    // A 自己看 B 的项目：看不到这个项目
    expect(await 以谁的身份(销售A, () => 项目关联们(A, B的项目))).toBeNull();

    expect(await 以谁的身份(销售B, () => 解除关联客户(B, B的项目, 甲))).toMatchObject({ ok: true });
    expect(await raw.projectCustomer.count({ where: { projectId: B的项目 } })).toBe(0);
  });

  it("客户页「参与的项目」只列我看得到的项目", async () => {
    await raw.projectCustomer.create({ data: { projectId: B的项目, customerId: 甲, roles: '["分包方"]' } });
    await raw.projectCustomer.create({ data: { projectId: A的项目, customerId: 甲, roles: '["业主方"]' } });
    const 行 = (await 以谁的身份(销售A, () => 客户参与的项目(甲, 团队版字典)))!;
    expect(行.map((x) => [x.projectId, x.身份, x.主])).toEqual([[A的项目, ["业主方"], true]]);
  });
});
