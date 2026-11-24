/**
 * 建档向导多个号码（员工反馈「客户会留多个电话或者微信号，需要可以新增多个添加框」）：
 * 第一行照旧是客户的号（企业号码：验格式、全公司查重、主号）；下面多加的几行（联系人.号码们，kind + value）
 * 和 AI 新线索卡、联系人表单同一套类型（号码类型字典八种）：手机、邮箱、微信、阿里国际站ID 同第一行全公司查重，
 * 座机、WhatsApp 这些只验格式；都记进联系方式子表、挂在主要联系人身上。连第一行最多 20 个（同联系人表单）。
 * 只填第一行的和原来一样。带项目（建档向导）和只建客户（建档只建客户）两条都走。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "甲", email: "a@x", role: "ADMIN", title: "管理员", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 建档向导, 建档只建客户, type 建档向导输入 } from "@/app/(app)/projects/actions";
import { 验联系人号码 } from "@/lib/enterprise/contact-dedupe";
import { 每人最多号码 } from "@/lib/enterprise/customer-v2";
import { invalidateSettingsCache } from "@/lib/settings";

let 甲: string;
let 乙: string;

type 行 = { kind: string; value: string };
/** 和向导最后一步交的同一个样子：第一行手机号带进联系人电话，多加的几行放 联系人.号码们 */
function 输入(号码们?: 行[], 第一行 = "13900000101"): 建档向导输入 {
  return {
    客户: {
      name: "多号客户", phone: 第一行, 企业号码: { 类型: "手机号", 值: 第一行 }, school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: 甲, channelId: null, referrerCustomerId: null, touchpoint: "公司资源",
    } as 建档向导输入["客户"],
    联系人: { name: "王经理", phone: 第一行, ...(号码们 ? { 号码们 } : {}) },
    项目: { name: "多号项目", amount: 0, currency: "CNY", ownerId: 甲, 业务线: "内贸", channelId: null },
    跟进: { type: "PHONE", content: "电话聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育" },
  } as 建档向导输入;
}
const 手机 = (n: number) => `1390000${String(1000 + n).slice(-4)}`;
const 行数 = async () => ({ customer: await prisma.customer.count(), contact: await prisma.contact.count(), project: await prisma.project.count() });
/** 主要联系人身上的号（kind + value），按 kind、value 排好 */
const 联系人的号 = async (customerId: string) => {
  const c = await prisma.contact.findFirstOrThrow({ where: { customerId, isPrimary: true }, select: { id: true } });
  const 们 = await prisma.contactMethod.findMany({ where: { contactId: c.id }, select: { kind: true, value: true } });
  return 们.map((x) => `${x.kind}:${x.value}`).sort();
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  甲 = (await prisma.user.create({ data: { email: "jia", name: "甲", title: "", role: "ADMIN", password: "x" } })).id;
  乙 = (await prisma.user.create({ data: { email: "yi", name: "乙", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: 甲, bizRole: "director" }, { userId: 乙, bizRole: "sales" }] });
  mocks.user = { ...mocks.user, id: 甲 };
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("建档向导：第一行下面多加的号码", () => {
  it("只填第一行：和原来一样，联系人身上只有这一个号", async () => {
    const r = await 建档向导(输入());
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(await 联系人的号(r.customerId)).toEqual(["phone:13900000101"]);
  });

  it("多行写进主要联系人：手机号、微信各记一行；空行丢掉；和第一行重了的只记一次", async () => {
    const r = await 建档向导(输入([
      { kind: "phone", value: " 139 0000 0102 " },
      { kind: "wechat", value: "wx_buyer01" },
      { kind: "phone", value: "   " },
      { kind: "phone", value: "13900000101" },
    ]));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(await 联系人的号(r.customerId)).toEqual(["phone:13900000101", "phone:13900000102", "wechat:wx_buyer01"]);
    // 客户没有电话（E-260）：客户主表电话空着，第一行的号也在主要联系人上（上面那几行里）
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: r.customerId } })).phone).toBe("");
    // 只有向导建的那一位主要联系人，第一行的号没另建一位；客户本身不挂号
    expect(await prisma.contact.count({ where: { customerId: r.customerId } })).toBe(1);
    expect(await prisma.contactMethod.count({ where: { customerId: r.customerId, contactId: null } })).toBe(0);
  });

  it("同一家「手机 = 微信」（微信同号）不撞自己；别人微信格里有这个号就不建（11-20 跨类型）", async () => {
    const r = await 建档向导(输入([{ kind: "wechat", value: "13900000101" }]));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(await 联系人的号(r.customerId)).toEqual(["phone:13900000101", "wechat:13900000101"]);
    const 前 = await 行数();
    expect(await 建档向导(输入(undefined, "13900000101"))).toMatchObject({ ok: false });
    const 乙客 = await prisma.customer.create({ data: { name: "乙的客户", phone: "", followStatus: "待跟进", decisionStatus: "了解中", salesOwnerId: 乙 } });
    await prisma.contactMethod.create({ data: { customerId: 乙客.id, kind: "wechat", value: "13900000177", numberKey: "13900000177" } });
    expect(await 建档向导(输入(undefined, "13900000177"))).toMatchObject({ ok: false });
    expect(await 行数()).toEqual({ ...前, customer: 前.customer + 1 });
  });

  it("第一行查重照旧生效：撞了同事的客户不建（多加的几行没撞也一样）", async () => {
    await prisma.customer.create({ data: { name: "乙的客户", phone: "13900000101", followStatus: "待跟进", decisionStatus: "了解中", salesOwnerId: 乙 } });
    const 前 = await 行数();
    expect(await 建档向导(输入([{ kind: "phone", value: 手机(2) }]))).toMatchObject({ ok: false });
    expect(await 行数()).toEqual(前);
  });

  it("多加的号撞了同事的客户：同样不建，一行不写", async () => {
    await prisma.customer.create({ data: { name: "乙的客户", phone: "13900000188", followStatus: "待跟进", decisionStatus: "了解中", salesOwnerId: 乙 } });
    const 前 = await 行数();
    expect(await 建档向导(输入([{ kind: "phone", value: "13900000188" }]))).toMatchObject({ ok: false });
    expect(await 行数()).toEqual(前);
  });

  it(`连第一行最多 ${每人最多号码} 个：${每人最多号码 - 1} 行多加的能建，再多一行拒、一行不写`, async () => {
    const 多 = Array.from({ length: 每人最多号码 - 1 }, (_, i) => ({ kind: "phone", value: 手机(10 + i) }));
    const 超 = await 建档向导(输入([...多, { kind: "phone", value: 手机(90) }]));
    expect(超).toMatchObject({ ok: false, error: `一位联系人最多记 ${每人最多号码} 个号码` });
    expect(await 行数()).toEqual({ customer: 0, contact: 0, project: 0 });
    const r = await 建档向导(输入(多));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(await 联系人的号(r.customerId)).toHaveLength(每人最多号码);
  });

  it("类型校验：不是号码类型字典里的拒；号码格式不对的拒；一行不写", async () => {
    expect(await 建档向导(输入([{ kind: "pager", value: "12345678" }]))).toMatchObject({ ok: false, error: expect.stringContaining("号码类型不对") });
    expect(await 建档向导(输入([{ kind: "wechat", value: "wx_ok01" }, { kind: "phone", value: "12345" }]))).toMatchObject({ ok: false, error: expect.stringContaining("12345") });
    expect(await 建档向导(输入([{ kind: "", value: "13900000102" }]))).toMatchObject({ ok: false, error: expect.stringContaining("号码类型不对") });
    expect(await 建档向导(输入([{ kind: "landline", value: "abc" }]))).toMatchObject({ ok: false, error: expect.stringContaining("格式不对") });
    expect(await 行数()).toEqual({ customer: 0, contact: 0, project: 0 });
  });

  it("八种类型都能加（同 AI 新线索卡）；座机、WhatsApp 也全公司查重（11-17）：同事客户有同一个座机不建", async () => {
    const 乙客户 = await prisma.customer.create({ data: { name: "乙的客户", phone: "13900000177", followStatus: "待跟进", decisionStatus: "了解中", salesOwnerId: 乙 } });
    const 撞的 = await prisma.contactMethod.create({ data: { customerId: 乙客户.id, kind: "landline", value: "021-12345678", numberKey: "02112345678", formatStatus: "ok" } });
    const 前 = await 行数();
    expect(await 建档向导(输入([{ kind: "landline", value: "021-12345678" }]))).toMatchObject({ ok: false });
    expect(await 行数()).toEqual(前);
    await prisma.contactMethod.delete({ where: { id: 撞的.id } });
    const r = await 建档向导(输入([{ kind: "landline", value: "021-12345678" }, { kind: "whatsapp", value: "+44 7700 900123" }, { kind: "email", value: "Buyer@Example.com" }]));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const 号 = await 联系人的号(r.customerId);
    expect(号).toHaveLength(4);
    expect(号.filter((x) => x.startsWith("landline:") || x.startsWith("whatsapp:"))).toHaveLength(2);
    expect(号.some((x) => x.startsWith("email:"))).toBe(true);
  });

  it("阿里国际站ID（wangwang）同第一行全公司查重：撞了同事的客户不建", async () => {
    const 乙客户 = await prisma.customer.create({ data: { name: "乙的客户", phone: "13900000166", followStatus: "待跟进", decisionStatus: "了解中", salesOwnerId: 乙 } });
    await prisma.contactMethod.create({ data: { customerId: 乙客户.id, kind: "wangwang", value: "cnbuyer01", numberKey: "cnbuyer01", formatStatus: "ok" } });
    const 前 = await 行数();
    expect(await 建档向导(输入([{ kind: "wangwang", value: "cnbuyer01" }]))).toMatchObject({ ok: false });
    expect(await 行数()).toEqual(前);
  });
});

describe("企业版联系人姓名选填（姓名和联系方式至少一项）", () => {
  it("空名 + 联系人电话能建，存空串；空名 + 只有多加的号码也能建；全空拦", async () => {
    const 基 = 输入();
    const r = await 建档向导({ ...基, 联系人: { ...基.联系人, name: "" } });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect((await prisma.contact.findFirstOrThrow({ where: { customerId: r.customerId } })).name).toBe("");
    await resetDb();
    甲 = (await prisma.user.create({ data: { email: "jia", name: "甲", title: "", role: "ADMIN", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 甲, bizRole: "director" } });
    mocks.user = { ...mocks.user, id: 甲 };
    const 基2 = 输入([{ kind: "wechat", value: "wx_noname01" }]);
    expect(await 建档向导({ ...基2, 联系人: { ...基2.联系人, name: " ", phone: "" } })).toMatchObject({ ok: true });
    const 前 = await 行数();
    const 基3 = 输入(undefined, "13900000109");
    expect(await 建档向导({ ...基3, 联系人: { ...基3.联系人, name: "", phone: "" } })).toMatchObject({ ok: false, error: "联系人姓名和联系方式至少填一项" });
    expect(await 行数()).toEqual(前);
  });
});

describe("只建客户（没开项目）也认多加的号码", () => {
  it("多行写进主要联系人；只填第一行不变", async () => {
    const { 项目: _p, ...只建 } = 输入([{ kind: "wechat", value: "wx_only01" }]);
    void _p;
    // 只建客户：客户业务线必填（M-必填-13），向导交在 企业资料 里
    const r = await 建档只建客户({ ...只建, 客户: { ...只建.客户, 企业资料: { bizLine: "内贸" } } });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(await 联系人的号(r.customerId)).toEqual(["phone:13900000101", "wechat:wx_only01"]);
  });
});

describe("验联系人号码（纯函数）", () => {
  it("联系人那几格照旧按类型验", () => {
    expect(验联系人号码({ phone: "13900000101" }, null)).toMatchObject([{ 类型: "手机号", 值: "13900000101", 格: "联系人电话" }]);
  });
});
