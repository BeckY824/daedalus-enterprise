/**
 * 企业版客户电话严格规矩 + 号码查重统一（11-17 号码审计，员工反馈四个症状），E-260（11-24）起按「客户没有电话」改：
 *   新建交来的号照旧严格验（症状 1、2：贴微信号整格拒、6 位乱数拒、+86 规整成 11 位），建好记在主要联系人上、客户电话存空串
 *   客户电话格就地改（patchCustomer phone）企业版一律拦；完整表单编辑不认交来的电话
 *   客户本身号码几行（saveCustomerNumbers）删了；清空电话、升电话、电话子表同步那几条路跟着删
 *   查重跨入口：联系人号码 ↔ 新建交来的号 ↔ 子表里的老行 ↔ 座机 / WhatsApp（同一个号键空间）；客户电话格不再比（数据脚本已挪到主联系人）
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
import { saveCustomer, patchCustomer } from "@/app/(app)/customers/actions";
import { saveContact } from "@/app/(app)/customers/[id]/actions";
import { 一行号全公司查, 全公司查号 } from "@/lib/enterprise/contact-dedupe";
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
  return r.id;
}
const 读 = (id: string) => prisma.customer.findUniqueOrThrow({ where: { id } });
/** 主要联系人的电话格（E-260：新建交来的号记在他身上） */
const 主联系人电话 = async (id: string) => (await prisma.contact.findFirst({ where: { customerId: id, isPrimary: true }, select: { phone: true } }))?.phone ?? null;
async function 加联系人(customerId: string, 号码们: { kind: string; value: string }[], name = `联系人${++序}`) {
  const r = await saveContact({ customerId, name, isPrimary: false, 企业: { 号码们 } });
  return r;
}

describe("症状 1、2：新建交来的号只收手机号，带字母整格拒、不截数字；记在主要联系人上", () => {
  it("新建贴微信号、6 位乱数：拒；+86 写法规整成 11 位，记在主要联系人上，客户电话存空串", async () => {
    await expect(新建("sqin17548955941")).rejects.toThrow(像微信号提示);
    await expect(新建("748392")).rejects.toThrow();
    const id = await 新建("+86 139 0000 1103");
    expect((await 读(id)).phone).toBe("");
    expect(await 主联系人电话(id)).toBe("13900001103");
  });

  it("完整表单编辑不认交来的电话（E-260），库不变", async () => {
    const id = await 新建("13900001104");
    const c = await 读(id);
    for (const phone of ["sqin17548955941", "13900001105", ""]) {
      const r = await saveCustomer({
        id, updatedAt: (await 读(id)).updatedAt.toISOString(), name: c.name, phone, school: null, grade: null, major: null,
        followStatus: c.followStatus, decisionStatus: c.decisionStatus, expectedSignAt: null, remark: null,
        salesOwnerId: "tester-id", channelId: null, referrerCustomerId: null,
      } as Parameters<typeof saveCustomer>[0]);
      expect(r).toMatchObject({ ok: true });
    }
    expect((await 读(id)).phone).toBe("");
    expect(await 主联系人电话(id)).toBe("13900001104");
  });
});

describe("客户电话格就地改：企业版一律拦（E-260 客户没有电话）", () => {
  it("改号、清空都拦，库不变；别的格照旧回 值", async () => {
    const id = await 新建("13900001201");
    await prisma.customer.update({ where: { id }, data: { phone: "13900001299" } });
    for (const v of ["13900001202", "", "sqin17548955941"]) {
      expect(await patchCustomer(id, "phone", v)).toMatchObject({ ok: false, error: expect.stringContaining("号码请记在联系人上") });
    }
    expect((await 读(id)).phone).toBe("13900001299");
    expect(await patchCustomer(id, "addrDetail", "  某路 1 号 ")).toMatchObject({ ok: true, 值: "某路 1 号" });
  });
});

describe("查重跨入口", () => {
  it("新建交来的号撞别人联系人的号：拦", async () => {
    const 甲 = await 新建("13900001601");
    expect((await 加联系人(甲, [{ kind: "phone", value: "13900001602" }])).ok).toBe(true);
    // 同一位负责人撞了自己的：走同号协同，照样不新建（撞同事的说负责人，见 ent-contact-dedupe）
    await expect(新建("13900001602")).rejects.toThrow();
    // 撞主要联系人身上的号（新建时记过去的）也拦
    await expect(新建("+86 139 0000 1601")).rejects.toThrow();
    expect(await prisma.customer.count()).toBe(1);
  });

  it("联系人卡撞别家联系人的号（含座机 / WhatsApp 和手机同号）：拦", async () => {
    await 新建("13900001603");
    const 乙 = await 新建("13900001604");
    const r1 = await 加联系人(乙, [{ kind: "whatsapp", value: "+86 139 0000 1603" }]);
    expect(r1).toMatchObject({ ok: false });
    expect((r1 as { error: string }).error).toContain("已经记在");
  });

  it("客户电话格不再比（X-159 豁免随之没了）：老数据电话格里的号，别家联系人照样能用", async () => {
    const 甲 = await 新建("13900001605");
    await prisma.customer.update({ where: { id: 甲 }, data: { phone: "13900001606" } });
    const 乙 = await 新建("13900001607");
    expect((await 加联系人(乙, [{ kind: "phone", value: "13900001606" }])).ok).toBe(true);
    expect(await 全公司查号(prisma, "手机号", "13900001606", "13900001606")).toEqual([乙]);
  });

  it("子表里还挂在客户本身上的老行（数据脚本挪之前）照样撞得上，说客户本身；老口径带 86 的键也认", async () => {
    const 甲 = await 新建("13900001608");
    await prisma.contactMethod.create({ data: { customerId: 甲, contactId: null, kind: "whatsapp", value: "+8613900001611", numberKey: "8613900001611" } });
    expect(await 全公司查号(prisma, "手机号", "13900001611", "13900001611")).toEqual([甲]);
    expect(await 一行号全公司查(prisma, { kind: "landline", value: "13900001611", numberKey: "13900001611" })).toEqual([甲]);
    const 乙 = await 新建("13900001609");
    const r = await 加联系人(乙, [{ kind: "phone", value: "13900001611" }]);
    expect(r).toMatchObject({ ok: false });
    expect((r as { 撞了?: { 客户本身?: boolean; customerId: string | null }[] }).撞了?.[0]).toMatchObject({ 客户本身: true, customerId: 甲 });
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
