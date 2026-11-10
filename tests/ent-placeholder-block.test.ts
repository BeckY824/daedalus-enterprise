/**
 * 禁填占位号（P-全局-06）：新建、编辑客户和联系人（含 AI 建档、线索录入）时，电话 / WhatsApp / 座机填占位假号
 * （全同数字、一串 0、顺序数字）就拦下、提示填真实号码。
 *   - 共用的几道关：查电话（客户表单、saveCustomer、线索）、验号码 手机号（建档向导、AI 建档、线索、号码子表手机）、
 *     验一行号码 座机 / WhatsApp（联系人号码几行）、联系人电话（saveContact）
 *   - 老数据原样没动的不拦（改备注不因为库里本来是占位号就存不了）；放回公海前的查联系方式不在这条里，照旧放过
 * 名字、号码全是编造的
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" }),
}));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 查电话 } from "@/lib/phone";
import { 验号码 } from "@/lib/enterprise/contact-format";
import { 验一行号码 } from "@/lib/enterprise/customer-v2";
import { saveCustomer } from "@/app/(app)/customers/actions";
import { saveContact } from "@/app/(app)/customers/[id]/actions";

describe("纯函数的几道关", () => {
  it("查电话：占位号拦下、提示填真实号码；真号照过；放过占位的（老数据检查）不拦", () => {
    for (const v of ["11111111111", "00000000", "12345", "13800000000"]) {
      const r = 查电话(v, { 必填: false });
      expect(r.ok, v).toBe(false);
      if (!r.ok) expect(r.error).toContain("真实号码");
    }
    expect(查电话("13900000001", { 必填: true })).toEqual({ ok: true, phone: "13900000001" });
    expect(查电话("11111111111", { 必填: true, 放过占位: true }).ok).toBe(true);
  });

  it("验号码 手机号（建档向导、AI 建档、线索录入）：占位号格式错误、提示填真实号码", () => {
    for (const v of ["11111111111", "+86 13900000000", "+12345678"]) {
      const r = 验号码("手机号", v);
      expect(r.ok, v).toBe(false);
      if (!r.ok) expect(r.提示).toContain("真实号码");
    }
    expect(验号码("手机号", "13900000001").ok).toBe(true);
    expect(验号码("手机号", "11111111111", { 放过占位: true }).ok).toBe(true);
  });

  it("验一行号码：座机、WhatsApp、手机那几行填占位号拦下", () => {
    expect(验一行号码({ 名: "座机", kind: "landline" }, "0000000")).toMatchObject({ ok: false });
    expect(验一行号码({ 名: "WhatsApp", kind: "whatsapp" }, "+86 111 1111 1111")).toMatchObject({ ok: false });
    expect(验一行号码({ 名: "手机", kind: "phone", 验: "手机号" }, "12345678901")).toMatchObject({ ok: false });
    const r = 验一行号码({ 名: "座机", kind: "landline" }, "00000000");
    if (!r.ok) expect(r.error).toContain("真实号码");
    expect(验一行号码({ 名: "座机", kind: "landline" }, "021-5555-0101").ok).toBe(true);
    expect(验一行号码({ 名: "座机", kind: "landline" }, "0000000", { 放过占位: true }).ok).toBe(true);
  });
});

describe("保存客户、联系人（企业版）", () => {
  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "ADMIN", password: "x" } });
    await prisma.entMember.create({ data: { userId: "tester-id", bizRole: "sales" } });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => prisma.$disconnect());

  const 存客户 = (改: Record<string, unknown>) =>
    saveCustomer({
      name: "示例客户", phone: "13900000901", school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: "tester-id", channelId: null, referrerCustomerId: null,
      ...改,
    } as Parameters<typeof saveCustomer>[0]);

  it("新建客户电话填占位号：拦下、不建", async () => {
    const r = await 存客户({ phone: "11111111111" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("真实号码");
    expect(await prisma.customer.count()).toBe(0);
  });

  it("编辑：库里本来就是占位号、这次没动电话的照存；改成占位号的拦下", async () => {
    const c = await prisma.customer.create({ data: { name: "示例老客户", phone: "00000000", salesOwnerId: "tester-id", followStatus: "待跟进" } });
    const 改备注 = await 存客户({ id: c.id, name: "示例老客户", phone: "00000000", remark: "改了备注", updatedAt: c.updatedAt.toISOString() });
    expect(改备注.ok).toBe(true);
    const c2 = await prisma.customer.create({ data: { name: "示例客户二", phone: "13900000902", salesOwnerId: "tester-id", followStatus: "待跟进" } });
    const 改号 = await 存客户({ id: c2.id, name: "示例客户二", phone: "12345", updatedAt: c2.updatedAt.toISOString() });
    expect(改号.ok).toBe(false);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c2.id } })).phone).toBe("13900000902");
  });

  it("联系人：电话、座机、WhatsApp 填占位号拦下；没动的老号照存", async () => {
    const c = await prisma.customer.create({ data: { name: "示例客户三", phone: "13900000903", salesOwnerId: "tester-id", followStatus: "待跟进" } });
    const 电话 = await saveContact({ customerId: c.id, name: "示例联系人", isPrimary: false, phone: "11111111111" });
    expect(电话.ok).toBe(false);
    if (!电话.ok) expect(电话.error).toContain("真实号码");
    const 座机 = await saveContact({ customerId: c.id, name: "示例联系人", isPrimary: false, 企业: { 号码们: [{ kind: "landline", value: "00000000" }] } });
    expect(座机.ok).toBe(false);
    const 瓦 = await saveContact({ customerId: c.id, name: "示例联系人", isPrimary: false, 企业: { 号码们: [{ kind: "whatsapp", value: "+86 13800000000" }] } });
    expect(瓦.ok).toBe(false);
    expect(await prisma.contact.count()).toBe(0);

    const 老 = await prisma.contact.create({ data: { customerId: c.id, name: "示例老联系人", phone: "00000000" } });
    const 改 = await saveContact({ id: 老.id, customerId: c.id, name: "示例老联系人", isPrimary: false, phone: "00000000", remark: "改了备注", 版本: 老.updatedAt.toISOString() });
    expect(改.ok).toBe(true);
  });
});
