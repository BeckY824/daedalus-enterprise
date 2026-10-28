/**
 * 企业版联系人附件的权限，真库、不 mock 身份和只读名单（2026-10-28，#39 补口子）。
 * contact-attachments.test.ts 整个 mock 了 同事的客户，只钉接口挡不挡；这里走真的组织架构范围（visibility.ts + 加上限定）：
 *   - 销售 B 列、取、传、删销售 A 线索 / 联系人上的附件：一律 404（看不到那条线索、那位客户），附件原样还在
 *   - A 的虚线上级：看得到、取得到；传、删 403（客户下的联系人、没转客户的线索都一样），附件原样还在
 *   - 项目页入口 联系人附件入口：A = 个数 + 能改；虚线上级 = 只读；B = 没有入口
 *   - 开关关着（个人版、团队版）：leadId / contactId 参数 400，取、删 404，入口 null
 * 用拷出来的一份库、显式单连接，不碰共用的测试库（同 enterprise-visibility.test.ts）。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-catt-scope-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
// 只换「这个请求是谁」，范围、只读名单都走真的
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
import { GET as 列, POST as 传 } from "@/app/api/attachments/route";
import { GET as 取, DELETE as 删 } from "@/app/api/attachments/[id]/route";
import { 联系人附件入口 } from "@/app/api/attachments/access";

process.env.CRM_DATA_DIR = 临时.dir;

const 销售A = "ca_a";
const 销售B = "ca_b";
const 虚线上级 = "ca_dot"; // A 的虚线上级：A 的客户、线索只能看

const 字节 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
const 作为 = <T,>(id: string, f: () => Promise<T>) => {
  登录.user = { ...登录.user, id, name: id, email: `${id}@x.com` };
  return 以谁的身份(id, f);
};
const 传一个 = (q: string, 名字 = "名片.jpg") => {
  const 体 = 字节(名字);
  return 传(new Request(`http://x/api/attachments?${q}&name=${encodeURIComponent(名字)}`, {
    method: "POST",
    body: 体,
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(体.byteLength) },
  }));
};
const 列出 = (q: string) => 列(new Request(`http://x/api/attachments?${q}`));
const 带编号 = (id: string) => ({ params: Promise.resolve({ id }) });
const 取一个 = (id: string) => 取(new Request(`http://x/api/attachments/${id}`), 带编号(id));
const 删一个 = (id: string) => 删(new Request(`http://x/api/attachments/${id}`, { method: "DELETE" }), 带编号(id));
const 还在 = async (id: string) => !!(await raw.attachment.findUnique({ where: { id } }));

let 线索id: string;
let 联系人id: string;
let 线索附件: string;
let 联系人附件: string;

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["Attachment", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "Supplier", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const id of [销售A, 销售B, 虚线上级]) await raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role: "SALES" } });
  await raw.entMember.createMany({ data: [{ userId: 虚线上级, bizRole: "sales_mgr" }, { userId: 销售A, dottedManagerId: 虚线上级 }, { userId: 销售B }] });
  // 超长公司名照样走（界面折行在项目页另核）
  const 客户 = await raw.customer.create({ data: { name: "QA-一家名字特别特别长的测试用有限责任公司华东区域分公司", phone: "13800001001", salesOwnerId: 销售A } });
  联系人id = (await raw.contact.create({ data: { customerId: 客户.id, name: "QA-张联系人" } })).id;
  线索id = (await raw.lead.create({ data: { name: "QA-A的线索", phone: "13900001001", ownerId: 销售A } })).id;
  await raw.setting.upsert({ where: { key: 规则.按组织看客户.key }, update: { value: "true" }, create: { key: 规则.按组织看客户.key, value: "true" } });
  忘掉企业版范围();

  // A 自己在线索、联系人上各传一张
  await 作为(销售A, async () => {
    const 一 = await 传一个(`leadId=${线索id}`, "线索.jpg");
    const 二 = await 传一个(`contactId=${联系人id}`, "联系人.jpg");
    expect([一.status, 二.status]).toEqual([200, 200]);
    线索附件 = ((await 一.json()) as { 附件: { id: string } }).附件.id;
    联系人附件 = ((await 二.json()) as { 附件: { id: string } }).附件.id;
  });
});

beforeEach(() => {
  process.env.CRM_ENTERPRISE = "1";
  忘掉企业版范围();
});

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  delete process.env.CRM_DATA_DIR;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("企业版：附件跟着线索 / 联系人的可见范围走（真库、真组织架构）", () => {
  it("A 自己：列得到、取得到，入口 = 1 张能改", async () => {
    await 作为(销售A, async () => {
      for (const q of [`leadId=${线索id}`, `contactId=${联系人id}`]) {
        const r = await 列出(q);
        expect(r.status).toBe(200);
        expect(((await r.json()) as { 附件: unknown[] }).附件).toHaveLength(1);
      }
      expect((await 取一个(联系人附件)).status).toBe(200);
      expect(await 联系人附件入口(联系人id)).toEqual({ 个数: 1, 只读: false });
    });
  });

  it("销售 B：A 的线索、联系人上的附件列、取、传、删一律 404，附件原样还在，也没有入口", async () => {
    await 作为(销售B, async () => {
      for (const q of [`leadId=${线索id}`, `contactId=${联系人id}`]) {
        expect((await 列出(q)).status).toBe(404);
        expect((await 传一个(q)).status).toBe(404);
      }
      for (const id of [线索附件, 联系人附件]) {
        expect((await 取一个(id)).status).toBe(404);
        expect((await 删一个(id)).status).toBe(404);
      }
      expect(await 联系人附件入口(联系人id)).toBeNull();
    });
    expect(await 还在(线索附件)).toBe(true);
    expect(await 还在(联系人附件)).toBe(true);
    expect(await raw.attachment.count()).toBe(2);
  });

  it("A 的虚线上级：看得到、取得到；联系人、没转客户的线索上都不能传不能删（403），入口只读", async () => {
    await 作为(虚线上级, async () => {
      for (const q of [`leadId=${线索id}`, `contactId=${联系人id}`]) {
        const r = await 列出(q);
        expect(r.status).toBe(200);
        expect(((await r.json()) as { 附件: unknown[] }).附件).toHaveLength(1);
        const 传了 = await 传一个(q);
        expect(传了.status).toBe(403);
        expect(((await 传了.json()) as { error: string }).error).toMatch(/只能看/);
      }
      for (const id of [线索附件, 联系人附件]) {
        expect((await 取一个(id)).status).toBe(200);
        expect((await 删一个(id)).status).toBe(403);
      }
      expect(await 联系人附件入口(联系人id)).toEqual({ 个数: 1, 只读: true });
    });
    expect(await 还在(线索附件)).toBe(true);
    expect(await 还在(联系人附件)).toBe(true);
    expect(await raw.attachment.count()).toBe(2);
  });
});

describe("开关关着（个人版、团队版）：线索 / 联系人附件整个不认", () => {
  it("参数 400，取、删 404，入口 null，附件原样还在", async () => {
    process.env.CRM_ENTERPRISE = "";
    await 作为(销售A, async () => {
      for (const q of [`leadId=${线索id}`, `contactId=${联系人id}`]) {
        expect((await 列出(q)).status).toBe(400);
        expect((await 传一个(q)).status).toBe(400);
      }
      for (const id of [线索附件, 联系人附件]) {
        expect((await 取一个(id)).status).toBe(404);
        expect((await 删一个(id)).status).toBe(404);
      }
      expect(await 联系人附件入口(联系人id)).toBeNull();
    });
    expect(await raw.attachment.count()).toBe(2);
  });
});
