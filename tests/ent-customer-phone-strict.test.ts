/**
 * 企业版客户电话严格规矩 + 客户本身号码几行 + 号码查重统一（11-17 号码审计，员工反馈四个症状）：
 *   症状 1：电话格贴了微信号「sqin17548955941」存成了 17548955941 —— 现在整格拒、提示去选微信类型，库不变
 *   症状 2：6 位乱数（748392）也收 —— 现在拒
 *   症状 3：带字母的串一直摆到刷新、再改就没了 —— 服务端回 值（最后存下的样子），没动就回库里现值
 *   症状 4：电话清不掉 —— 还有别的对的联系方式就放；一个都不剩才拦（M-必填-01）；号码几行里有手机的升成电话
 *   子表同步：电话换了 / 清了，子表里客户本身那行跟着换（带归属地）
 *   客户号码几行（saveCustomerNumbers）：加、改、删；只验新加 / 改过的行；全公司查重；删光了拦
 *   查重跨入口：客户电话 ↔ 联系人号码 ↔ 客户号码几行 ↔ 座机 / WhatsApp（同一个号键空间）
 *   联系人卡只验新加 / 改过的行：导入进来的老号验不过，不挡改别的
 * 号码、名字全是编造的
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "tester-id", name: "测试员", email: "t", role: "SALES", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { saveCustomer, patchCustomer, saveCustomerNumbers } from "@/app/(app)/customers/actions";
import { saveContact } from "@/app/(app)/customers/[id]/actions";
import { 一行号全公司查, 全公司查号 } from "@/lib/enterprise/contact-dedupe";
import { 清空电话拦话, 删光号码拦话 } from "@/lib/enterprise/customer-phone-db";
import { 像微信号提示 } from "@/lib/enterprise/contact-format";

let 别人: string;
let 序 = 0;
const 当 = (id: string, name: string) => { mocks.user = { ...mocks.user, id, name }; 忘掉企业版范围(); };

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  当("tester-id", "测试员");
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "SALES", password: "x" } });
  别人 = (await prisma.user.create({ data: { email: "o@t", name: "别人", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: "tester-id", bizRole: "sales" }, { userId: 别人, bizRole: "sales" }] });
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(() => prisma.$disconnect());

async function 新建(phone: string | null, 名?: string) {
  const r = await saveCustomer({
    name: 名 ?? `测试客户${++序}`, phone, school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
    salesOwnerId: "tester-id", channelId: null, referrerCustomerId: null,
    企业资料: { bizLine: "内贸" },
  } as Parameters<typeof saveCustomer>[0]);
  if (!r.ok) throw new Error(r.error);
  /*
    E-260 起新建不写客户电话、号记在主要联系人上。这份测的客户电话格（patchCustomer phone）、客户本身号码几行（saveCustomerNumbers）
    还在，阶段 2 删入口时这份一起改：这里把刚建的还原成老数据的样子（客户主表有电话、子表那行挂在客户本身上、没有联系人）
  */
  const 主联 = await prisma.contact.findFirst({ where: { customerId: r.id }, select: { id: true, phone: true } });
  if (主联) {
    await prisma.contactMethod.updateMany({ where: { contactId: 主联.id }, data: { contactId: null } });
    await prisma.contactCustomer.deleteMany({ where: { contactId: 主联.id } });
    await prisma.contact.delete({ where: { id: 主联.id } });
    await prisma.customer.update({ where: { id: r.id }, data: { phone: 主联.phone ?? "" } });
  }
  return r.id;
}
const 读 = (id: string) => prisma.customer.findUniqueOrThrow({ where: { id } });
const 客户行 = (id: string) => prisma.contactMethod.findMany({ where: { customerId: id, contactId: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, value: true, numberKey: true, region: true } });
async function 加联系人(customerId: string, 号码们: { kind: string; value: string }[], name = `联系人${++序}`) {
  const r = await saveContact({ customerId, name, isPrimary: false, 企业: { 号码们 } });
  return r;
}

describe("症状 1、2：电话格只收手机号，带字母整格拒、不截数字", () => {
  it("就地改贴微信号：拒，提示去选微信类型，库不变", async () => {
    const id = await 新建("13900001101");
    for (const v of ["sqin17548955941", "wxid_abc17548955941", "Abc_123456"]) {
      const r = await patchCustomer(id, "phone", v);
      expect(r).toEqual({ ok: false, error: 像微信号提示 });
    }
    expect((await 读(id)).phone).toBe("13900001101");
  });

  it("就地改 6 位乱数、座机、科学计数法：拒", async () => {
    const id = await 新建("13900001102");
    expect(await patchCustomer(id, "phone", "748392")).toMatchObject({ ok: false });
    expect(await patchCustomer(id, "phone", "123456")).toMatchObject({ ok: false });
    expect(await patchCustomer(id, "phone", "010-12345678")).toMatchObject({ ok: false, error: expect.stringContaining("像座机") });
    expect(await patchCustomer(id, "phone", "8.61391E+12")).toMatchObject({ ok: false, error: expect.stringContaining("科学计数法") });
    expect((await 读(id)).phone).toBe("13900001102");
  });

  it("完整表单新建贴微信号拒、+86 写法规整成 11 位；编辑不认交来的电话（E-260），库不变", async () => {
    await expect(新建("sqin17548955941")).rejects.toThrow(像微信号提示);
    await expect(新建("748392")).rejects.toThrow();
    const id = await 新建("+86 139 0000 1103");
    expect((await 读(id)).phone).toBe("13900001103");
    const c = await 读(id);
    const r = await saveCustomer({
      id, updatedAt: c.updatedAt.toISOString(), name: c.name, phone: "sqin17548955941", school: null, grade: null, major: null,
      followStatus: c.followStatus, decisionStatus: c.decisionStatus, expectedSignAt: null, remark: null,
      salesOwnerId: "tester-id", channelId: null, referrerCustomerId: null,
    } as Parameters<typeof saveCustomer>[0]);
    expect(r).toMatchObject({ ok: true });
    expect((await 读(id)).phone).toBe("13900001103");
  });

  it("国外号 00 / + 两种写法存成同一个", async () => {
    const id = await 新建("13900001104");
    expect(await patchCustomer(id, "phone", "0044 20 7946 0958")).toMatchObject({ ok: true, 值: "+442079460958" });
    expect((await 读(id)).phone).toBe("+442079460958");
  });
});

describe("症状 3：回服务端最后存下的样子", () => {
  it("规整过的、没动的都回 值", async () => {
    const id = await 新建("13900001201");
    expect(await patchCustomer(id, "phone", "+86 139-0000-1202")).toMatchObject({ ok: true, 值: "13900001202" });
    // 规整后和库里一样：不写，回库里现值
    expect(await patchCustomer(id, "phone", "+86 13900001202")).toEqual({ ok: true, 值: "13900001202" });
    expect(await patchCustomer(id, "phone", "13900001202")).toEqual({ ok: true, 值: "13900001202" });
    expect(await patchCustomer(id, "addrDetail", "  某路 1 号 ")).toMatchObject({ ok: true, 值: "某路 1 号" });
  });
});

describe("症状 4：清空电话", () => {
  it("一个联系方式都不剩：拦", async () => {
    const id = await 新建("13900001301");
    expect(await patchCustomer(id, "phone", "")).toEqual({ ok: false, error: 清空电话拦话 });
    expect((await 读(id)).phone).toBe("13900001301");
  });

  it("联系人有对的号：放；子表里电话那行跟着删", async () => {
    const id = await 新建("13900001302");
    expect((await 客户行(id)).map((r) => r.value)).toEqual(["13900001302"]);
    expect((await 加联系人(id, [{ kind: "wechat", value: "contact_wx_1302" }])).ok).toBe(true);
    expect(await patchCustomer(id, "phone", "")).toMatchObject({ ok: true, 值: "" });
    expect((await 读(id)).phone).toBe("");
    expect(await 客户行(id)).toEqual([]);
  });

  it("联系人的号是占位号 / 格式不对：不算，照拦", async () => {
    const id = await 新建("13900001303");
    const 人 = await prisma.contact.create({ data: { customerId: id, name: "老联系人", phone: "12345" } });
    await prisma.contactMethod.create({ data: { customerId: id, contactId: 人.id, kind: "phone", value: "12345", numberKey: "12345" } });
    expect(await patchCustomer(id, "phone", "")).toEqual({ ok: false, error: 清空电话拦话 });
  });

  it("号码几行里还有手机：升成电话（电话 = 第一个手机）", async () => {
    const id = await 新建("13900001304");
    expect(await saveCustomerNumbers(id, [{ kind: "phone", value: "13900001305" }, { kind: "landline", value: "010-66001304" }])).toEqual({ ok: true });
    expect(await patchCustomer(id, "phone", "")).toMatchObject({ ok: true, 值: "13900001305" });
    expect((await 读(id)).phone).toBe("13900001305");
    expect((await 客户行(id)).map((r) => r.value).sort()).toEqual(["010-66001304", "13900001305"]);
  });

  it("完整表单交空电话：不认（E-260 编辑不写客户电话），库不变", async () => {
    const id = await 新建("13900001306");
    const 存 = async () => {
      const c = await 读(id);
      return saveCustomer({
        id, updatedAt: c.updatedAt.toISOString(), name: c.name, phone: "", school: null, grade: null, major: null,
        followStatus: c.followStatus, decisionStatus: c.decisionStatus, expectedSignAt: null, remark: null,
        salesOwnerId: "tester-id", channelId: null, referrerCustomerId: null,
      } as Parameters<typeof saveCustomer>[0]);
    };
    expect(await 存()).toMatchObject({ ok: true });
    expect((await 读(id)).phone).toBe("13900001306");
    expect((await 客户行(id)).map((r) => r.value)).toEqual(["13900001306"]);
  });
});

describe("子表同步：电话换了，客户本身那行跟着换（带归属地）", () => {
  it("就地改", async () => {
    const id = await 新建("13900001401");
    expect(await patchCustomer(id, "phone", "13900001402")).toMatchObject({ ok: true });
    const 行 = await 客户行(id);
    expect(行.map((r) => [r.kind, r.value, r.numberKey])).toEqual([["phone", "13900001402", "13900001402"]]);
  });
  it("联系人挂着的同号行不动", async () => {
    const id = await 新建("13900001403");
    const 人 = await prisma.contact.create({ data: { customerId: id, name: "同号联系人", phone: "13900001403" } });
    await prisma.contactMethod.create({ data: { customerId: id, contactId: 人.id, kind: "phone", value: "13900001403", numberKey: "13900001403" } });
    expect(await patchCustomer(id, "phone", "13900001404")).toMatchObject({ ok: true });
    expect(await prisma.contactMethod.count({ where: { contactId: 人.id, numberKey: "13900001403" } })).toBe(1);
  });
});

describe("客户号码几行（saveCustomerNumbers）", () => {
  it("加、改、删；电话那行不在几行里", async () => {
    const id = await 新建("13900001501");
    expect(await saveCustomerNumbers(id, [{ kind: "landline", value: "010-66001501" }, { kind: "whatsapp", value: "+44 20 7946 1501" }])).toEqual({ ok: true });
    let 行 = await 客户行(id);
    expect(行.map((r) => r.kind)).toEqual(["phone", "landline", "whatsapp"]);
    expect(行.find((r) => r.kind === "whatsapp")?.numberKey).toBe("442079461501");
    expect(await saveCustomerNumbers(id, [{ kind: "landline", value: "010-66001502" }])).toEqual({ ok: true });
    行 = await 客户行(id);
    expect(行.map((r) => r.value)).toEqual(["13900001501", "010-66001502"]);
    expect((await 读(id)).phone).toBe("13900001501");
  });

  it("新号格式不对拒；导入进来的老号一字没动不验", async () => {
    const id = await 新建("13900001502");
    await prisma.contactMethod.create({ data: { customerId: id, contactId: null, kind: "wechat", value: "老 微信", numberKey: "老微信" } });
    expect(await saveCustomerNumbers(id, [{ kind: "wechat", value: "老 微信" }, { kind: "phone", value: "sqin17548955941" }])).toMatchObject({ ok: false, error: expect.stringContaining("像微信号") });
    expect(await saveCustomerNumbers(id, [{ kind: "wechat", value: "老 微信" }, { kind: "email", value: "a@b.photography" }])).toEqual({ ok: true });
    expect((await 客户行(id)).map((r) => r.value)).toEqual(["13900001502", "老 微信", "a@b.photography"]);
  });

  it("电话空着：第一个手机升成电话", async () => {
    const id = await 新建("13900001503");
    await saveCustomerNumbers(id, [{ kind: "email", value: "x1503@example.com" }]);
    await patchCustomer(id, "phone", "");
    expect((await 读(id)).phone).toBe("");
    expect(await saveCustomerNumbers(id, [{ kind: "email", value: "x1503@example.com" }, { kind: "phone", value: "13900001504" }])).toMatchObject({ ok: true, 电话: "13900001504" });
    expect((await 读(id)).phone).toBe("13900001504");
  });

  it("删光了、电话也空、联系人也没号：拦", async () => {
    const id = await 新建("13900001505");
    await saveCustomerNumbers(id, [{ kind: "email", value: "x1505@example.com" }]);
    await patchCustomer(id, "phone", "");
    expect(await saveCustomerNumbers(id, [])).toEqual({ ok: false, error: 删光号码拦话 });
  });

  it("新号撞了别的客户（含座机 / WhatsApp 和手机同号）：拒", async () => {
    await 新建("13900001506");
    const id = await 新建("13900001507");
    const r = await saveCustomerNumbers(id, [{ kind: "whatsapp", value: "+86 139 0000 1506" }]);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("已有") });
    expect((await 客户行(id)).map((x) => x.kind)).toEqual(["phone"]);
  });

  it("不是负责人改不了", async () => {
    const id = await 新建("13900001508");
    当(别人, "别人");
    expect(await saveCustomerNumbers(id, [{ kind: "landline", value: "010-66001508" }])).toMatchObject({ ok: false });
  });
});

describe("查重跨入口", () => {
  it("客户电话撞别人联系人的号：拦；撞自己联系人的号：放", async () => {
    const 甲 = await 新建("13900001601");
    expect((await 加联系人(甲, [{ kind: "phone", value: "13900001602" }])).ok).toBe(true);
    const 乙 = await 新建("13900001603");
    expect(await patchCustomer(乙, "phone", "13900001602")).toMatchObject({ ok: false, error: expect.stringContaining("13900001602") });
    expect((await 加联系人(乙, [{ kind: "phone", value: "13900001604" }])).ok).toBe(true);
    expect(await patchCustomer(乙, "phone", "13900001604")).toMatchObject({ ok: true });
  });

  it("客户电话撞别人客户号码几行里的 WhatsApp（+86 写法）：拦", async () => {
    const 甲 = await 新建("13900001605");
    expect(await saveCustomerNumbers(甲, [{ kind: "whatsapp", value: "+86 139 0000 1606" }])).toEqual({ ok: true });
    const 乙 = await 新建("13900001607");
    expect(await patchCustomer(乙, "phone", "13900001606")).toMatchObject({ ok: false });
  });

  it("联系人卡：撞别的客户本身的电话 / 号码几行，说客户本身；自己这位客户的号不算", async () => {
    const 甲 = await 新建("13900001608");
    expect(await saveCustomerNumbers(甲, [{ kind: "landline", value: "010-66001608" }])).toEqual({ ok: true });
    const 乙 = await 新建("13900001609");
    const r1 = await 加联系人(乙, [{ kind: "phone", value: "13900001608" }]);
    expect(r1).toMatchObject({ ok: false });
    expect((r1 as { 撞了?: { 客户本身?: boolean; customerId: string | null }[] }).撞了?.[0]).toMatchObject({ 客户本身: true, customerId: 甲 });
    expect((r1 as { error: string }).error).toContain("本身");
    const r2 = await 加联系人(乙, [{ kind: "landline", value: "+86 10 6600 1608" }]);
    expect(r2).toMatchObject({ ok: false });
    // 自己这位客户的电话：同一家的人用公司的号，不算撞
    expect((await 加联系人(乙, [{ kind: "phone", value: "13900001609" }])).ok).toBe(true);
  });

  it("老口径存的 WhatsApp 键（带 86）也撞得上", async () => {
    const 甲 = await 新建("13900001610");
    await prisma.contactMethod.create({ data: { customerId: 甲, contactId: null, kind: "whatsapp", value: "+8613900001611", numberKey: "8613900001611" } });
    expect(await 全公司查号(prisma, "手机号", "13900001611", "13900001611")).toEqual([甲]);
    expect(await 一行号全公司查(prisma, { kind: "landline", value: "13900001611", numberKey: "13900001611" })).toEqual([甲]);
  });

  it("建档向导别的类型的号（传真、Telegram）同类同键全公司查", async () => {
    const 甲 = await 新建("13900001612");
    await prisma.contactMethod.create({ data: { customerId: 甲, contactId: null, kind: "fax", value: "010-66001612", numberKey: "01066001612" } });
    expect(await 一行号全公司查(prisma, { kind: "fax", value: "010 6600 1612", numberKey: "01066001612" })).toEqual([甲]);
    expect(await 一行号全公司查(prisma, { kind: "fax", value: "010 6600 1612", numberKey: "01066001612" }, 甲)).toEqual([]);
  });
});

describe("联系人卡只验新加 / 改过的行", () => {
  it("导入进来的老号（格式不对）一字没动：改职位照存；改了那一行才验", async () => {
    const id = await 新建("13900001701");
    const 人 = await prisma.contact.create({ data: { customerId: id, name: "导入联系人", phone: "748392" } });
    await prisma.contactMethod.create({ data: { customerId: id, contactId: 人.id, kind: "phone", value: "748392", numberKey: "748392" } });
    const c = await prisma.contact.findUniqueOrThrow({ where: { id: 人.id } });
    const 存 = (号码们: { kind: string; value: string }[]) => saveContact({ id: 人.id, customerId: id, name: "导入联系人", position: "采购", isPrimary: false, 版本: c.updatedAt.toISOString(), 企业: { 号码们 } });
    expect(await 存([{ kind: "phone", value: "748392" }])).toMatchObject({ ok: true });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: 人.id } })).position).toBe("采购");
    const c2 = await prisma.contact.findUniqueOrThrow({ where: { id: 人.id } });
    const r = await saveContact({ id: 人.id, customerId: id, name: "导入联系人", isPrimary: false, 版本: c2.updatedAt.toISOString(), 企业: { 号码们: [{ kind: "phone", value: "748393" }] } });
    expect(r).toMatchObject({ ok: false });
  });
});
