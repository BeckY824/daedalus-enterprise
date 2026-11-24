/**
 * 企业版联系人姓名选填（11-17 员工反馈「联系人姓名不一定知道」）：姓名和联系方式至少一项，空名存空串、显示「—」。
 *   saveContact：空名 + 有号码能新建、能编辑（补第二个号）；全空拦；非企业版照旧必填
 *   未归属联系人、只负责项目的人加联系人：同一个判法（联系人姓名问题）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" }),
}));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { saveCustomer } from "@/app/(app)/customers/actions";
import { saveContact } from "@/app/(app)/customers/[id]/actions";
import { 联系人姓名问题, 姓名号码至少一项 } from "@/lib/enterprise/customer-v2";

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "ADMIN", password: "x" } });
  await prisma.entMember.create({ data: { userId: "tester-id", bizRole: "sales" } });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

async function 建客户() {
  const r = await saveCustomer({
    name: "测试客户", phone: "13800001001", school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
    salesOwnerId: "tester-id", channelId: null, referrerCustomerId: null, 企业资料: { bizLine: "内贸" },
  } as Parameters<typeof saveCustomer>[0]);
  if (!r.ok) throw new Error(r.error);
  return r.id;
}

describe("联系人姓名问题", () => {
  it("企业版：姓名或任一号码填了就行；全空（只有空白）拦；非企业版照旧必填", () => {
    expect(联系人姓名问题(true, "周经理", [])).toBeNull();
    expect(联系人姓名问题(true, "  ", ["wx_test01"])).toBeNull();
    expect(联系人姓名问题(true, undefined, [null, " ", undefined])).toBe(姓名号码至少一项);
    expect(联系人姓名问题(false, "", ["13800001002"])).toBe("请填写联系人姓名");
  });
});

describe("saveContact", () => {
  it("空名 + 有号码能新建；编辑时补第二个号（姓名还空着）也能存；姓名存空串", async () => {
    const customerId = await 建客户();
    const r = await saveContact({ customerId, name: "", isPrimary: false, 企业: { 号码们: [{ kind: "landline", value: "021-5555 0201" }] } });
    expect(r).toMatchObject({ ok: true });
    const id = (r as { id: string }).id;
    const c = await prisma.contact.findUniqueOrThrow({ where: { id } });
    expect(c.name).toBe("");
    const 改 = await saveContact({ id, customerId, name: "", isPrimary: false, 企业: { 号码们: [{ kind: "landline", value: "021-5555 0201" }, { kind: "wechat", value: "wx_test02" }] } });
    expect(改).toMatchObject({ ok: true });
    expect((await prisma.contactMethod.findMany({ where: { contactId: id }, orderBy: { kind: "asc" } })).map((m) => m.kind)).toEqual(["landline", "wechat"]);
    expect((await prisma.contact.findUniqueOrThrow({ where: { id } })).wechat).toBe("wx_test02");
  });

  it("姓名、号码全空：拦，不建", async () => {
    const customerId = await 建客户();
    // 新建客户顺带建了带号的主要联系人（E-260）：这次一位都不多
    const 前 = await prisma.contact.count();
    expect(await saveContact({ customerId, name: " ", isPrimary: false, 企业: { 号码们: [] } })).toEqual({ ok: false, error: 姓名号码至少一项 });
    expect(await prisma.contact.count()).toBe(前);
    expect(await prisma.contact.count({ where: { customerId, isPrimary: false } })).toBe(0);
  });

  it("非企业版：姓名照旧必填", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await saveContact({ customerId: "x", name: "", isPrimary: false, phone: "13800001003" })).toEqual({ ok: false, error: "请填写联系人姓名" });
  });
});
