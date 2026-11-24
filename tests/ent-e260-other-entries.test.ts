/**
 * E-260 审查修复单「单 B」（11-24）：客户没有电话，号一律在联系人上——除导入 / 同步以外的几个入口跟着改。
 *   3   AI 找人（find_person）客户那张的电话取主联系人的号
 *   4b  回收站捞回客户：数据脚本只挪了没删的客户，回收站里的客户电话、客户本身的号码行捞回时落到主联系人，客户电话清空
 *   5   saveCustomer 新建：没选号码类型、填在电话格的号，建档事务里也全公司复查一次
 *   6   新建弹窗电话失焦查重（checkDuplicate）按联系人号码查
 *   8   AI 改客户卡：企业版不收电话，提示去改联系人
 *   12  主联系人第一个号口径统一（get_customer、客户详情背调电话）：主联系人优先、再按建的先后和 id，主表电话格空着取号码行里第一个号码类
 *   13  AI 背调新建客户：企业版邮箱照旧写客户档案（需求只说电话）
 * 号码、名字全是编造的
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "tester-id", name: "测试员", email: "t", role: "SALES", title: "" }, 漏查: false }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
// 第 5 条：模拟「保存前那次查重和建档之间」别的窗口刚建了同号——保存前那几次（同号协同、全公司查号）都查不到，只能靠事务里那次
vi.mock("@/lib/enterprise/customer-phone-db", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/customer-phone-db")>();
  return { ...m, 客户电话撞号: (async (...a: Parameters<typeof m.客户电话撞号>) => (mocks.漏查 ? null : m.客户电话撞号(...a))) as typeof m.客户电话撞号 };
});

vi.mock("@/lib/enterprise/same-number-collab", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/same-number-collab")>();
  return { ...m, 同号再次录入: (async (...a: Parameters<typeof m.同号再次录入>) => (mocks.漏查 ? { 走: false } : m.同号再次录入(...a))) as typeof m.同号再次录入 };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 找人详 } from "@/lib/agent/find-name";
import { TOOLS, proposalVocab } from "@/lib/agent/tools";
import { buildProposal } from "@/lib/agent/proposals";
import { saveCustomer, checkDuplicate } from "@/app/(app)/customers/actions";
import { 软删客户, 软删一条, 恢复 } from "@/lib/enterprise/soft-delete";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 详情背调电话 } from "@/lib/enterprise/primary-contact-phone";
import { 新建客户并存背调 } from "@/lib/research/actions";
import { 初始状态 } from "@/lib/research/state";
import { DEFAULT_BUSINESS } from "@/lib/business-config";

const 原样 = (p: string | null) => p;
let 别人: string;
let 序 = 0;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  mocks.漏查 = false;
  忘掉企业版范围();
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "SALES", password: "x" } });
  别人 = (await prisma.user.create({ data: { email: "o@t", name: "别人", role: "SALES", password: "x" } })).id;
  await prisma.user.create({ data: { id: "boss-id", email: "b@t", name: "老板", role: "ADMIN", password: "x" } });
  await prisma.entMember.createMany({ data: [{ userId: "tester-id", bizRole: "sales" }, { userId: 别人, bizRole: "sales" }, { userId: "boss-id", bizRole: "director" }] });
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(() => prisma.$disconnect());

const 客户 = (data: { name?: string; phone?: string; salesOwnerId?: string } = {}) =>
  prisma.customer.create({ data: { name: data.name ?? `测试客户${++序}`, phone: data.phone ?? "", salesOwnerId: data.salesOwnerId ?? "tester-id" } });
const 隔 = () => new Promise((r) => setTimeout(r, 5));

describe("3 AI 找人：客户那张的电话取主联系人的号", () => {
  it("客户主表电话空着，主联系人有号：找人结果里客户电话是主联系人的号（不是早建的非主联系人）", async () => {
    const c = await 客户({ name: "青松贸易" });
    await prisma.contact.create({ data: { name: "早建的", phone: "13900000002", customerId: c.id } });
    await 隔();
    await prisma.contact.create({ data: { name: "主联系人", phone: "13800000001", isPrimary: true, customerId: c.id } });
    const r = await 找人详("青松贸易", 原样, (v) => v, "tester-id");
    const 客户张 = r.命中.find((h) => h.表 === "客户");
    expect(客户张?.记录[0]).toMatchObject({ 电话: "13800000001" });
  });
});

describe("4b 回收站捞回客户：客户电话、客户本身的号码行落到主联系人", () => {
  const 管 = { id: "boss-id", role: "ADMIN" };
  async function 删了(customerId: string) {
    await prisma.$transaction((tx) => 软删客户(tx, [customerId]));
  }

  it("没联系人：按客户名拆名建主联系人，电话进他的电话格，客户本身的微信行挂到他身上；客户电话清空", async () => {
    const c = await 客户({ name: "张伟", phone: "13811112222" });
    await prisma.contactMethod.create({ data: { customerId: c.id, contactId: null, kind: "wechat", value: "wx_zw01", numberKey: "wx_zw01" } });
    await 删了(c.id);
    const r = await 恢复(管, "Customer", c.id);
    expect(r.ok).toBe(true);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).phone).toBe("");
    const 们 = await prisma.contact.findMany({ where: { customerId: c.id } });
    expect(们).toHaveLength(1);
    expect(们[0]).toMatchObject({ isPrimary: true, phone: "13811112222", wechat: "wx_zw01" });
    expect(await prisma.contactCustomer.count({ where: { contactId: 们[0].id, customerId: c.id } })).toBe(1);
    const 行 = await prisma.contactMethod.findMany({ where: { customerId: c.id }, orderBy: { kind: "asc" } });
    expect(行.every((m) => m.contactId === 们[0].id)).toBe(true);
    expect(行.map((m) => m.kind).sort()).toEqual(["phone", "wechat"]);
  });

  it("有联系人（随客户一起删的）：号落到主联系人身上，他电话格有别的号就进号码行；已在联系人身上的客户本身那行摘掉", async () => {
    const c = await 客户({ phone: "13833334444" });
    const 主 = await prisma.contact.create({ data: { name: "李主", phone: "13700000000", isPrimary: true, customerId: c.id } });
    await prisma.contactMethod.create({ data: { customerId: c.id, contactId: 主.id, kind: "phone", value: "13700000000", numberKey: "13700000000" } });
    // 客户本身那行和主联系人身上那行同号：摘掉，不重复挂
    await prisma.contactMethod.create({ data: { customerId: c.id, contactId: null, kind: "phone", value: "13700000000", numberKey: "13700000000" } });
    await prisma.contactMethod.create({ data: { customerId: c.id, contactId: null, kind: "email", value: "a@b.com", numberKey: "a@b.com" } });
    await 删了(c.id);
    expect((await 恢复(管, "Customer", c.id)).ok).toBe(true);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).phone).toBe("");
    expect(await prisma.contact.count({ where: { customerId: c.id } })).toBe(1);
    expect(await prisma.contactMethod.count({ where: { customerId: c.id, contactId: null } })).toBe(0);
    const 行 = await prisma.contactMethod.findMany({ where: { customerId: c.id, contactId: 主.id }, select: { kind: true, value: true } });
    expect(行).toEqual(expect.arrayContaining([
      { kind: "phone", value: "13700000000" }, { kind: "phone", value: "13833334444" }, { kind: "email", value: "a@b.com" },
    ]));
    expect(行).toHaveLength(3);
    // 主表空着的邮箱格补上，有值的电话格不动
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: 主.id } })).toMatchObject({ phone: "13700000000", email: "a@b.com" });
  });

  it("复审 2：主联系人是原系统同步来的（对照表连着）、电话格空着：不补他的电话格（下次同步会记冲突），号进号码行挂他身上", async () => {
    const c = await 客户({ phone: "13855556666" });
    const 主 = await prisma.contact.create({ data: { name: "同步来的", isPrimary: true, customerId: c.id } });
    await prisma.entExternalRef.create({ data: { source: "excel", entity: "contact", externalId: "P1", targetId: 主.id, fingerprint: "f", written: "{}", raw: "{}" } });
    // 客户本身的邮箱行改挂过去时也一样：他主表邮箱格不补
    await prisma.contactMethod.create({ data: { customerId: c.id, contactId: null, kind: "email", value: "s@b.com", numberKey: "s@b.com" } });
    await 删了(c.id);
    expect((await 恢复(管, "Customer", c.id)).ok).toBe(true);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).phone).toBe("");
    expect(await prisma.contact.findUniqueOrThrow({ where: { id: 主.id } })).toMatchObject({ phone: null, email: null });
    expect(await prisma.contactMethod.findMany({ where: { customerId: c.id }, select: { contactId: true, kind: true, value: true }, orderBy: { kind: "asc" } })).toEqual([
      { contactId: 主.id, kind: "email", value: "s@b.com" },
      { contactId: 主.id, kind: "phone", value: "13855556666" },
    ]);
  });

  it("复审 3：同号只在一位早先单独删掉的联系人身上：不算已有，号落到没删的主联系人身上", async () => {
    const c = await 客户({ phone: "13866667777" });
    const 主 = await prisma.contact.create({ data: { name: "主联系人", phone: "13700000000", isPrimary: true, customerId: c.id } });
    const 旧 = await prisma.contact.create({ data: { name: "早删的", phone: "13866667777", customerId: c.id } });
    await prisma.contactMethod.create({ data: { customerId: c.id, contactId: 旧.id, kind: "phone", value: "13866667777", numberKey: "13866667777" } });
    await prisma.$transaction((tx) => 软删一条(tx, "Contact", 旧.id, new Date(Date.now() - 60_000)));
    await 删了(c.id);
    expect((await 恢复(管, "Customer", c.id)).ok).toBe(true);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).phone).toBe("");
    // 主联系人电话格有别的号：号进号码行挂他身上（不是只剩在回收站里那位身上）
    expect(await prisma.contactMethod.count({ where: { customerId: c.id, contactId: 主.id, kind: "phone", numberKey: "13866667777" } })).toBe(1);
    // 早删的那位还在回收站，他那行不动（回收站里的要包在 看已删 里才看得到）
    expect(await 看已删(() => prisma.contactMethod.count({ where: { customerId: c.id, contactId: 旧.id } }))).toBe(1);
    expect((await 看已删(() => prisma.contact.findUniqueOrThrow({ where: { id: 旧.id } }))).deletedAt).not.toBeNull();
  });

  it("复审 4：查重键空着的客户本身号码行（老数据）不互相当重复删掉，都改挂到主联系人；同类型同值的才算同一个", async () => {
    const c = await 客户({ name: "王芳" });
    for (const value of ["wx_a", "wx_b", "wx_b"]) await prisma.contactMethod.create({ data: { customerId: c.id, contactId: null, kind: "wechat", value, numberKey: "" } });
    await 删了(c.id);
    expect((await 恢复(管, "Customer", c.id)).ok).toBe(true);
    const [主] = await prisma.contact.findMany({ where: { customerId: c.id } });
    const 行 = await prisma.contactMethod.findMany({ where: { customerId: c.id }, select: { contactId: true, value: true }, orderBy: { value: "asc" } });
    expect(行).toEqual([{ contactId: 主.id, value: "wx_a" }, { contactId: 主.id, value: "wx_b" }]);
  });

  it("客户电话、号码行都空的：照旧恢复，不建联系人", async () => {
    const c = await 客户();
    await 删了(c.id);
    expect((await 恢复(管, "Customer", c.id)).ok).toBe(true);
    expect(await prisma.contact.count({ where: { customerId: c.id } })).toBe(0);
  });
});

describe("5 saveCustomer 新建：电话格交来的号，建档事务里也全公司复查", () => {
  it("保存前那次没查到（别的窗口刚建），事务里撞上联系人号码就不建", async () => {
    const 老 = await 客户({ salesOwnerId: 别人 });
    await prisma.contact.create({ data: { name: "老联系人", phone: "13700001111", isPrimary: true, customerId: 老.id } });
    mocks.漏查 = true;
    const r = await saveCustomer({
      name: "新来的", phone: "13700001111", school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: "tester-id", channelId: null, referrerCustomerId: null, 企业资料: { bizLine: "内贸" },
    } as Parameters<typeof saveCustomer>[0]);
    expect(r.ok).toBe(false);
    expect(await prisma.customer.count({ where: { name: "新来的" } })).toBe(0);
  });
});

describe("6 新建弹窗电话失焦查重按联系人号码查", () => {
  it("号在别人客户的联系人身上：提示撞了、说出负责人", async () => {
    const 老 = await 客户({ name: "老客户", salesOwnerId: 别人 });
    await prisma.contact.create({ data: { name: "老联系人", phone: "13700002222", isPrimary: true, customerId: 老.id } });
    const hit = await checkDuplicate("137 0000 2222");
    expect(hit).toMatchObject({ salesOwnerName: "别人" });
  });
  it("号在联系人号码行里（主表格空着）也认", async () => {
    const 老 = await 客户({ salesOwnerId: 别人 });
    const p = await prisma.contact.create({ data: { name: "老联系人", isPrimary: true, customerId: 老.id } });
    await prisma.contactMethod.create({ data: { customerId: 老.id, contactId: p.id, kind: "phone", value: "13700003333", numberKey: "13700003333" } });
    expect(await checkDuplicate("13700003333")).toMatchObject({ salesOwnerName: "别人" });
  });
  it("没撞：null", async () => {
    expect(await checkDuplicate("13700009999")).toBeNull();
  });
});

describe("8 AI 改客户卡：企业版不收电话", () => {
  it("changes 里带 phone 当场拒，指去改联系人；能改的字段里不列电话", () => {
    const r = buildProposal("p1", "update_customer", { id: "c1", name: "x" }, { changes: { phone: "13800000001" }, reason: "补号" }, DEFAULT_BUSINESS);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("联系人");
    // 复审 1：不指向任何工具（propose_contact_update 不改号码、也只在项目模式有），叫人到客户详情的联系人卡上改
    expect(!r.ok && r.error).not.toMatch(/propose_|工具/);
    expect(!r.ok && r.error).toContain("AI 不改号码");
    expect(!r.ok && r.error).toContain("客户详情的联系人卡上改");
    expect(proposalVocab(DEFAULT_BUSINESS)).not.toContain("phone（");
    // 别的字段照旧
    expect(buildProposal("p2", "update_customer", { id: "c1", name: "x" }, { changes: { remark: "备注" }, reason: "r" }, DEFAULT_BUSINESS).ok).toBe(true);
  });
  it("不是企业版：电话照旧能改", () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(buildProposal("p1", "update_customer", { id: "c1", name: "x" }, { changes: { phone: "13800000001" }, reason: "补号" }, DEFAULT_BUSINESS).ok).toBe(true);
    expect(proposalVocab(DEFAULT_BUSINESS)).toContain("phone（");
  });
});

describe("12 主联系人第一个号口径统一", () => {
  const 用 = (name: string) => TOOLS.find((x) => x.name === name)!;
  it("get_customer：主联系人电话格空着取他号码行里第一个号码类（微信不算）；删了的联系人不算", async () => {
    const c = await 客户();
    await prisma.contact.create({ data: { name: "删了的", phone: "13600000000", isPrimary: true, customerId: c.id, deletedAt: new Date() } });
    await 隔();
    const 主 = await prisma.contact.create({ data: { name: "主联系人", isPrimary: true, customerId: c.id } });
    await prisma.contactMethod.create({ data: { customerId: c.id, contactId: 主.id, kind: "wechat", value: "wx_1", numberKey: "wx_1" } });
    await 隔();
    await prisma.contactMethod.create({ data: { customerId: c.id, contactId: 主.id, kind: "landline", value: "021-55556666", numberKey: "02155556666" } });
    const r = await 用("get_customer").run({ id: c.id }, { userId: "tester-id", userName: "测试员", b: DEFAULT_BUSINESS, recordOffset: 0, proposals: [] });
    const d = r.data as { profile: string };
    expect(d.profile).toContain("021-55556666");
    expect(d.profile).not.toContain("13600000000");
  });
  it("客户详情背调电话：挂来的不算，主联系人优先，电话格空取号码行", () => {
    expect(详情背调电话([
      { phone: "13900000009", isPrimary: false, 挂靠: { linkId: "l" } },
      { phone: null, isPrimary: true, 号码们: [{ kind: "wechat", value: "wx" }, { kind: "phone", value: "13800000001" }] },
      { phone: "13700000007", isPrimary: false },
    ])).toBe("13800000001");
    expect(详情背调电话([{ phone: "13900000009", isPrimary: false, 挂靠: { linkId: "l" } }])).toBe("");
    expect(详情背调电话([{ phone: null, isPrimary: false }, { phone: "13700000007", isPrimary: false }])).toBe("");
  });
});

describe("13 AI 背调新建客户：企业版邮箱照旧写客户档案", () => {
  it("有电话有邮箱：电话落主联系人，邮箱进客户档案（不进联系人）", async () => {
    const s = { ...初始状态({ name: "Acme GmbH" }), done: true };
    const r = await 新建客户并存背调({ name: "Acme GmbH", email: "info@acme.example", phone: "13800005555" }, s);
    expect(r.ok).toBe(true);
    const id = (r as { id: string }).id;
    expect((await prisma.customerExtra.findUnique({ where: { customerId: id } }))?.email).toBe("info@acme.example");
    const 们 = await prisma.contact.findMany({ where: { customerId: id } });
    expect(们.map((c) => c.phone)).toEqual(["13800005555"]);
    expect(们[0].email ?? null).toBeNull();
  });
});
