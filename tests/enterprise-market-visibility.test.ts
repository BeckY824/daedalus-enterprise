/**
 * 企业版「市场成员」（2026-10-31，lib/enterprise/market.ts + visibility.ts + team-scope）。
 * 钉的是：市场部门（没设 = 名字带「市场」的部门和下级；设了按设的）的人，自己建的、建过项目的、负责的客户转给销售后还看得到，
 * 连同项目，只能看（改、转、记沟通都拦）；市场管理看得到所有市场成员看得到的；市场部门以外的人照旧；
 * 本来能改的不降（自己负责的客户、自己负责的项目）；「按组织看客户」关着不起作用；市场部门只有老板和总管理员能改。
 * 用拷出来的一份库、显式单连接，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-mkt-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir };
});
const 登录 = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => 登录.user }));
vi.mock("@/lib/shared-ws/current", () => ({ 当前是共享区: async () => false }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { prisma as db, defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 建组织 } from "@/lib/enterprise/org-core";
import { 市场部门们, 市场成员们, 规整市场部门, 市场部门key, 市场只读话 } from "@/lib/enterprise/market";
import { 只读客户, 只读话, 有市场只读 } from "@/lib/team-scope";
import { 规则 } from "@/lib/enterprise/rules";
import { assignSalesOwner, patchCustomer } from "@/app/(app)/customers/actions";
import { 设市场部门 } from "@/app/(app)/settings/org-actions";

const 老板 = "m_boss";
const 总管 = "m_dir";
const 市场经理 = "m_mgr"; // 市场管理，在市场部
const 小市 = "m_a"; // 市场一组（市场部的下级）
const 小场 = "m_b"; // 市场部
const 销售 = "m_sales"; // 销售部
const 外人 = "m_other"; // 销售部
const 品宣 = "m_brand"; // 品牌部：名字不带「市场」
const 走了 = "m_gone"; // 市场部、已停用

const 部 = { 市场: "d_mkt", 市场一组: "d_mkt1", 销售: "d_sales", 品牌: "d_brand" };

const 作为 = <T,>(id: string, f: () => Promise<T>) => 以谁的身份(id, f);
const 名单 = async (id: string) => (await 作为(id, () => db.customer.findMany({ orderBy: { name: "asc" } }))).map((c) => c.name);
const 项目名单 = async (id: string) => (await 作为(id, () => db.project.findMany({ orderBy: { name: "asc" } }))).map((p) => p.name);
const 客户 = (name: string) => raw.customer.findFirstOrThrow({ where: { name }, include: { pool: true } });
const 项目 = (name: string) => raw.project.findFirstOrThrow({ where: { name } });
const 存设置 = async (key: string, v: unknown) => {
  await raw.setting.upsert({ where: { key }, update: { value: JSON.stringify(v) }, create: { key, value: JSON.stringify(v) } });
  忘掉企业版范围();
};
const 开规则 = (on: boolean) => 存设置(规则.按组织看客户.key, on);
const 设市场 = (ids: string[] | null) => 存设置(市场部门key, ids);
const 当 = (id: string, role = "SALES") => { 登录.user = { ...登录.user, id, name: id, role }; };

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ProjectNodeLog", "ProjectMember", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerPool", "CustomerClaim", "CustomerCreator", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  const 人 = (id: string, role = "SALES", active = true) => raw.user.create({ data: { id, email: `${id}@x.com`, name: id, password: "x", role, active } });
  await 人(老板, "ADMIN");
  for (const id of [总管, 市场经理, 小市, 小场, 销售, 外人, 品宣]) await 人(id);
  await 人(走了, "SALES", false);
  await raw.entDept.createMany({
    data: [
      { id: 部.市场, name: "市场部" },
      { id: 部.市场一组, name: "一组", parentId: 部.市场 },
      { id: 部.销售, name: "销售部" },
      { id: 部.品牌, name: "品牌部" },
    ],
  });
  await raw.entMember.createMany({
    data: [
      { userId: 总管, bizRole: "director" },
      { userId: 市场经理, bizRole: "marketing_mgr", deptId: 部.市场 },
      { userId: 小市, bizRole: "channel_ops", deptId: 部.市场一组 },
      { userId: 小场, bizRole: "channel_ops", deptId: 部.市场 },
      { userId: 销售, bizRole: "sales", deptId: 部.销售 },
      { userId: 外人, bizRole: "sales", deptId: 部.销售 },
      { userId: 品宣, bizRole: "channel_ops", deptId: 部.品牌 },
      { userId: 走了, bizRole: "channel_ops", deptId: 部.市场 },
    ],
  });
  const 建客户 = async (name: string, salesOwnerId: string, 创建人?: string) => {
    const c = await raw.customer.create({ data: { name, phone: `139${String(name.charCodeAt(0)).padStart(8, "0")}`, salesOwnerId } });
    if (创建人) await raw.customerCreator.create({ data: { customerId: c.id, userId: 创建人 } });
    return c.id;
  };
  const 建项目 = (name: string, customerId: string, creatorId: string, ownerId: string) =>
    raw.project.create({ data: { name, customerId, creatorId, ownerId, phase: "商机", node: "明确需求" } });
  // A：小市建的客户和项目，转给了销售
  const A = await 建客户("A小市建的", 销售, 小市);
  await 建项目("PA小市建的", A, 小市, 销售);
  // B：销售建的，项目交给小场负责
  const B = await 建客户("B小场负责项目", 销售);
  await 建项目("PB小场负责的", B, 销售, 小场);
  // C：跟市场无关
  const C = await 建客户("C销售自己的", 销售);
  await 建项目("PC销售自己的", C, 销售, 销售);
  // D：品牌部的人建的（默认不算市场）
  await 建客户("D品宣建的", 销售, 品宣);
  // E：小市自己负责
  await 建客户("E小市负责的", 小市);
  // F：停用的市场成员建的
  await 建客户("F走了的人建的", 销售, 走了);
  // H：销售建的，项目是小场建的（建过项目也算）
  const H = await 建客户("H小场建过项目", 销售);
  await 建项目("PH小场建的", H, 小场, 销售);
  await 开规则(true);
});

beforeEach(() => 忘掉企业版范围());
// 改了全局规则的测试：恢复成「按组织看客户」开着、市场部门没设
afterEach(async () => {
  await raw.setting.deleteMany({ where: { key: 市场部门key } });
  await 开规则(true);
});

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("市场部门们 / 市场成员们（纯函数）", () => {
  const 部门 = new Map([
    ["a", { id: "a", name: "市场部", parentId: null }],
    ["a1", { id: "a1", name: "一组", parentId: "a" }],
    ["a11", { id: "a11", name: "小队", parentId: "a1" }],
    ["b", { id: "b", name: "销售部", parentId: null }],
    ["c", { id: "c", name: "品牌部", parentId: null }],
    ["x", { id: "x", name: "环一", parentId: "y" }],
    ["y", { id: "y", name: "环二", parentId: "x" }],
  ]);
  it("没设：名字带「市场」的部门连下级（多层）", () => {
    expect([...市场部门们(部门, null)].sort()).toEqual(["a", "a1", "a11"]);
    expect([...市场部门们(部门, [])].sort()).toEqual(["a", "a1", "a11"]);
  });
  it("设了按设的连下级，不再按名字；设的部门都不在了退回默认", () => {
    expect([...市场部门们(部门, ["c", "a1"])].sort()).toEqual(["a1", "a11", "c"]);
    expect([...市场部门们(部门, ["已删"])].sort()).toEqual(["a", "a1", "a11"]);
  });
  it("部门成环也只走一遍", () => {
    expect([...市场部门们(部门, ["x"])].sort()).toEqual(["x", "y"]);
  });
  it("规整：不是数组 = null；去重、去空", () => {
    expect(规整市场部门("a")).toBeNull();
    expect(规整市场部门(null)).toBeNull();
    expect(规整市场部门(["a", " a ", "", 3, "b"])).toEqual(["a", "b"]);
  });
  it("市场成员：在职、部门在市场部门里的人；停用的不算", () => {
    const org = 建组织(
      [{ id: "u1", role: "SALES", active: true }, { id: "u2", role: "SALES", active: true }, { id: "u3", role: "SALES", active: false }, { id: "u4", role: "SALES", active: true }],
      [
        { userId: "u1", deptId: "a11", bizRole: "channel_ops", line: null, managerId: null, dottedManagerId: null },
        { userId: "u2", deptId: "b", bizRole: "sales", line: null, managerId: null, dottedManagerId: null },
        { userId: "u3", deptId: "a", bizRole: "channel_ops", line: null, managerId: null, dottedManagerId: null },
        { userId: "u4", deptId: null, bizRole: "channel_ops", line: null, managerId: null, dottedManagerId: null },
      ],
      [...部门.values()].map((d) => ({ ...d, sort: 0 })),
    );
    expect([...市场成员们(org, null)]).toEqual(["u1"]);
    expect([...市场成员们(org, ["b"])]).toEqual(["u2"]);
  });
});

describe("默认市场部门（名字带「市场」）", () => {
  it("市场成员：自己建的（客户 / 项目）、负责的（客户 / 项目）都看得到，连项目；无关的看不到", async () => {
    expect(await 名单(小市)).toEqual(["A小市建的", "E小市负责的"]);
    expect(await 项目名单(小市)).toEqual(["PA小市建的"]);
    expect(await 名单(小场)).toEqual(["B小场负责项目", "H小场建过项目"]);
    expect(await 项目名单(小场)).toEqual(["PB小场负责的", "PH小场建的"]);
  });

  it("转给销售后的客户和项目：只能看，改、转、记沟通都拦，给市场那句", async () => {
    const a = await 客户("A小市建的");
    const pa = await 项目("PA小市建的");
    expect(await 作为(小市, () => 只读客户(raw, a))).toBe("全");
    expect(await 作为(小市, () => 只读话(raw))).toBe(市场只读话);
    await expect(作为(小市, () => db.customer.update({ where: { id: a.id }, data: { major: "x" } }))).rejects.toThrow(/市场成员/);
    await expect(作为(小市, () => db.customer.update({ where: { id: a.id }, data: { salesOwnerId: 小市 } }))).rejects.toThrow(/市场成员/);
    await expect(作为(小市, () => db.project.update({ where: { id: pa.id }, data: { remark: "x" } }))).rejects.toThrow(/市场成员/);
    await expect(作为(小市, () => db.followUp.create({ data: { customerId: a.id, title: "x", content: "x", type: "PHONE", ownerId: 小市 } }))).rejects.toThrow();
    当(小市);
    expect(await 作为(小市, () => patchCustomer(a.id, "major", "改"))).toEqual({ ok: false, error: 市场只读话 });
    expect(await 作为(小市, () => assignSalesOwner([a.id], 小市))).toEqual({ ok: false, error: 市场只读话 });
    const 后 = await 客户("A小市建的");
    expect(后.salesOwnerId).toBe(销售);
    expect(后.major).toBe(a.major);
    expect((await 项目("PA小市建的")).remark).toBe(pa.remark);
    expect(await raw.followUp.count({ where: { customerId: a.id } })).toBe(0);
  });

  it("原来能改的不降：自己负责的客户照常改，自己负责的项目照常改", async () => {
    const e = await 客户("E小市负责的");
    expect(await 作为(小市, () => 只读客户(raw, e))).toBe(false);
    await 作为(小市, () => db.customer.update({ where: { id: e.id }, data: { major: "改了" } }));
    const pb = await 项目("PB小场负责的");
    // 自己负责项目的客户不算只读档（不然项目上记沟通被挡），客户本身照旧改不了
    expect(await 作为(小场, async () => 只读客户(raw, await 客户("B小场负责项目")))).toBe(false);
    await 作为(小场, () => db.project.update({ where: { id: pb.id }, data: { remark: "改了" } }));
    expect((await 项目("PB小场负责的")).remark).toBe("改了");
    await expect(作为(小场, () => db.customer.update({ where: { id: pb.customerId }, data: { major: "x" } }))).rejects.toThrow();
  });

  it("市场管理：所有市场成员相关的都看得到（停用的人不算），只能看", async () => {
    expect(await 名单(市场经理)).toEqual(["A小市建的", "B小场负责项目", "E小市负责的", "H小场建过项目"]);
    expect(await 项目名单(市场经理)).toEqual(["PA小市建的", "PB小场负责的", "PH小场建的"]);
    const a = await 客户("A小市建的");
    expect(await 作为(市场经理, () => 只读客户(raw, a))).toBe("全");
    await expect(作为(市场经理, () => db.customer.update({ where: { id: a.id }, data: { major: "x" } }))).rejects.toThrow(/市场成员/);
  });

  it("市场部门以外的人照旧：销售看、改自己的；别的销售、品牌部的人看不到", async () => {
    expect(await 名单(销售)).toEqual(["A小市建的", "B小场负责项目", "C销售自己的", "D品宣建的", "F走了的人建的", "H小场建过项目"]);
    expect(await 作为(销售, () => 有市场只读(raw))).toBe(false);
    const a = await 客户("A小市建的");
    await 作为(销售, () => db.customer.update({ where: { id: a.id }, data: { remark: "销售改的" } }));
    expect(await 名单(外人)).toEqual([]);
    expect(await 名单(品宣)).toEqual([]);
    expect(await 作为(外人, () => 有市场只读(raw))).toBe(false);
  });

  it("老板、总管理员照旧看全部、能改", async () => {
    expect((await 名单(老板)).length).toBe(7);
    expect((await 名单(总管)).length).toBe(7);
    const a = await 客户("A小市建的");
    expect(await 作为(总管, () => 只读客户(raw, a))).toBe(false);
  });
});

describe("手动设的市场部门", () => {
  it("设成品牌部：品牌部的人算市场成员，市场部的人不算了；市场管理跟着新的成员走", async () => {
    await 设市场([部.品牌]);
    expect(await 名单(品宣)).toEqual(["D品宣建的"]);
    const d = await 客户("D品宣建的");
    expect(await 作为(品宣, () => 只读客户(raw, d))).toBe("全");
    await expect(作为(品宣, () => db.customer.update({ where: { id: d.id }, data: { major: "x" } }))).rejects.toThrow(/市场成员/);
    expect(await 名单(小市)).toEqual(["E小市负责的"]);
    expect(await 名单(小场)).toEqual([]);
    expect(await 名单(市场经理)).toEqual(["D品宣建的"]);
  });

  it("设成下级部门：只算这一组（连它的下级）", async () => {
    await 设市场([部.市场一组]);
    expect(await 名单(小市)).toEqual(["A小市建的", "E小市负责的"]);
    expect(await 名单(小场)).toEqual([]);
  });
});

describe("「按组织看客户」关着不起作用", () => {
  it("关着：照旧看全部，没有市场只读；市场成员对转给销售的客户和团队版一样", async () => {
    await 开规则(false);
    expect((await 名单(小市)).length).toBe(7);
    expect(await 作为(小市, () => 有市场只读(raw))).toBe(false);
    const a = await 客户("A小市建的");
    expect(await 作为(小市, () => 只读客户(raw, a))).not.toBe("全");
    expect(await 作为(小市, () => 只读话(raw))).not.toBe(市场只读话);
  });
});

describe("设市场部门：只有老板和总管理员能改", () => {
  it("市场管理、销售改不了，一行不写", async () => {
    for (const id of [市场经理, 销售, 小市]) {
      当(id);
      expect(await 设市场部门([部.品牌])).toMatchObject({ ok: false, error: expect.stringContaining("只有老板或总管理员") });
    }
    expect(await raw.setting.findUnique({ where: { key: 市场部门key } })).toBeNull();
  });

  it("老板、总管理员能改；空 = 恢复默认；不在的部门、不是数组挡住", async () => {
    当(老板, "ADMIN");
    expect(await 设市场部门([部.品牌, 部.品牌])).toEqual({ ok: true });
    expect(JSON.parse((await raw.setting.findUniqueOrThrow({ where: { key: 市场部门key } })).value)).toEqual([部.品牌]);
    expect(await 名单(品宣)).toEqual(["D品宣建的"]);
    当(总管);
    expect(await 设市场部门([部.市场一组])).toEqual({ ok: true });
    expect(JSON.parse((await raw.setting.findUniqueOrThrow({ where: { key: 市场部门key } })).value)).toEqual([部.市场一组]);
    expect(await 设市场部门(["不存在"])).toMatchObject({ ok: false });
    expect(await 设市场部门("x")).toMatchObject({ ok: false });
    expect(await 设市场部门([])).toEqual({ ok: true });
    expect(JSON.parse((await raw.setting.findUniqueOrThrow({ where: { key: 市场部门key } })).value)).toBeNull();
    expect(await 名单(小场)).toEqual(["B小场负责项目", "H小场建过项目"]);
    expect(await raw.auditLog.count({ where: { entityId: 市场部门key } })).toBe(3);
  });
});
