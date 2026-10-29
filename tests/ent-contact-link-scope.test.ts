/**
 * 企业版联系人挂多位客户的权限，真库、不 mock 范围和只读名单（2026-10-29 P13 第 1 条）。
 * ent-contact-v2.test.ts 用管理员钉功能；这里走真的组织架构范围（visibility.ts + 加上限定）：
 *   - 销售 B：挂 A 的联系人、往 A 的客户上挂、解 A 客户上的挂靠、换 A 联系人的主客户——一律「不在了（或你看不到）」，库里原样
 *   - A 的虚线上级：看得到但只读，挂、解、改说明、换主客户都回只读话，库里原样
 *   - A 自己：在自己两位客户之间挂、改说明、解除都行；往 B 的客户上挂不行
 *   - B 的客户上挂着 A 的联系人（管理员挂的）：B 在自己客户页看得到这位、主客户只露名字不能点；
 *     B 能解除（挂的是自己的客户），不能改到自己名下（主客户 A 那头不能改）
 * 用拷出来的一份库、显式单连接，不碰共用的测试库（同 contact-attachments-scope.test.ts）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-clink-scope-"));
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
import { 挂到客户, 改挂靠说明, 解除挂靠, 换主客户 } from "@/app/(app)/customers/[id]/contact-link-actions";
import { 客户的联系人们 } from "@/lib/enterprise/customer-v2-db";

const 销售A = "cl_a";
const 销售B = "cl_b";
const 虚线上级 = "cl_dot";

const 作为 = <T,>(id: string, f: () => Promise<T>) => {
  登录.user = { ...登录.user, id, name: id, email: `${id}@x.com` };
  return 以谁的身份(id, f);
};
const 挂靠们 = async () => (await raw.contactCustomer.findMany({ select: { contactId: true, customerId: true, note: true } }))
  .map((x) => `${x.contactId}>${x.customerId}:${x.note ?? ""}`).sort();
const 看不到 = { ok: false, error: expect.stringMatching(/不在了（或你看不到）/) };

let 甲: string; // A 的客户
let 丙: string; // A 的另一位客户
let 乙: string; // B 的客户
let A的人: string;
let B的人: string;
let 乙上挂着A的人: string; // 挂靠行 id

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ContactCustomer", "ContactMethod", "Attachment", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [销售A, 销售B, 虚线上级]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  await raw.entMember.createMany({ data: [{ userId: 虚线上级, bizRole: "sales_mgr" }, { userId: 销售A, dottedManagerId: 虚线上级 }, { userId: 销售B }] });
  甲 = (await raw.customer.create({ data: { name: "QA-A的客户甲", phone: "13800002001", salesOwnerId: 销售A } })).id;
  丙 = (await raw.customer.create({ data: { name: "QA-A的客户丙", phone: "13800002003", salesOwnerId: 销售A } })).id;
  乙 = (await raw.customer.create({ data: { name: "QA-B的客户乙", phone: "13800002002", salesOwnerId: 销售B } })).id;
  A的人 = (await raw.contact.create({ data: { customerId: 甲, name: "QA-A的联系人" } })).id;
  B的人 = (await raw.contact.create({ data: { customerId: 乙, name: "QA-B的联系人" } })).id;
  await raw.contactCustomer.createMany({ data: [{ contactId: A的人, customerId: 甲 }, { contactId: B的人, customerId: 乙 }] });
  乙上挂着A的人 = (await raw.contactCustomer.create({ data: { contactId: A的人, customerId: 乙, note: "管理员挂的" } })).id;
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

describe("企业版联系人挂靠：跟着客户的可见范围和只读走（真库、真组织架构）", () => {
  it("销售 B 动不了 A 的客户、A 客户上的挂靠", async () => {
    const 前 = await 挂靠们();
    await 作为(销售B, async () => {
      expect(await 挂到客户(B的人, 甲)).toMatchObject(看不到);
      expect(await 换主客户(B的人, 甲)).toMatchObject(看不到);
      const 甲的主行 = (await raw.contactCustomer.findFirstOrThrow({ where: { contactId: A的人, customerId: 甲 } })).id;
      expect(await 解除挂靠(甲的主行)).toMatchObject({ ok: false });
      expect(await 改挂靠说明(甲的主行, "改一下")).toMatchObject({ ok: false });
    });
    expect(await 挂靠们()).toEqual(前);
  });

  it("虚线上级看得到 A 的客户但只读：挂、解、改说明、换主客户都不行", async () => {
    await 作为(销售A, async () => expect(await 挂到客户(A的人, 丙, "临时")).toEqual({ ok: true }));
    const 前 = await 挂靠们();
    const 丙行 = (await raw.contactCustomer.findFirstOrThrow({ where: { contactId: A的人, customerId: 丙 } })).id;
    await 作为(虚线上级, async () => {
      const 只读 = { ok: false, error: expect.not.stringMatching(/不在了/) };
      expect(await 解除挂靠(丙行)).toMatchObject(只读);
      expect(await 改挂靠说明(丙行, "上级改")).toMatchObject(只读);
      expect(await 换主客户(A的人, 丙)).toMatchObject(只读);
      const 新人 = (await raw.contact.create({ data: { customerId: 丙, name: "QA-丙的联系人" } })).id;
      expect(await 挂到客户(新人, 甲)).toMatchObject(只读);
      await raw.contact.delete({ where: { id: 新人 } });
    });
    expect(await 挂靠们()).toEqual(前);
  });

  it("A 自己：自己客户之间改说明、解除都行；往 B 的客户上挂不行", async () => {
    const 丙行 = (await raw.contactCustomer.findFirstOrThrow({ where: { contactId: A的人, customerId: 丙 } })).id;
    await 作为(销售A, async () => {
      expect(await 改挂靠说明(丙行, "顾问")).toEqual({ ok: true });
      expect(await 解除挂靠(丙行)).toEqual({ ok: true });
      expect(await 挂到客户(A的人, 乙)).toMatchObject({ ok: false });
      expect(await 换主客户(A的人, 乙)).toMatchObject(看不到);
    });
    expect(await raw.contactCustomer.count({ where: { contactId: A的人, customerId: 丙 } })).toBe(0);
  });

  it("B 的客户上挂着 A 的联系人：B 看得到这位、主客户只露名字；能解除，不能改到自己名下", async () => {
    await 作为(销售B, async () => {
      const 列 = await 客户的联系人们(乙);
      expect(列.map((x) => [x.contact.name, x.主客户.name, x.主客户.看得到, x.主客户.能改])).toEqual([["QA-A的联系人", "QA-A的客户甲", false, false]]);
      expect(await 换主客户(A的人, 乙)).toMatchObject({ ok: false });
      expect(await 解除挂靠(乙上挂着A的人)).toEqual({ ok: true });
      expect(await 客户的联系人们(乙)).toEqual([]);
    });
    const A = await raw.contact.findUniqueOrThrow({ where: { id: A的人 } });
    expect(A.customerId).toBe(甲);
  });
});
