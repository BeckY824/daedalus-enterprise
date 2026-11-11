/**
 * 企业版客户「渠道触点」（P-渠道-08）+ 介绍人客户（P-渠道-09）：
 *   - 触点单选：公司资源 / 客户介绍；这两类客户主渠道留空，由触点承载；主渠道和触点至少填一个
 *   - 触点 = 客户介绍时挂介绍人客户（referrerCustomerId）：主渠道照样留空，不从介绍人那边继承渠道
 *   - 认不出的触点拦下；编辑原来有渠道或触点的，清成两样都空拦下；改备注不清介绍人
 *   - 节点必填「来源」放宽为「来源或触点」（M-必填-01）
 *   - 没开企业版：触点不看、不写
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
import { 认渠道触点, 渠道触点们 } from "@/lib/enterprise/touchpoint";
import { 还差, type 必填数据 } from "@/lib/project/required";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { saveCustomer } from "@/app/(app)/customers/actions";

describe("认渠道触点", () => {
  it("只认两个取值；空 = 没填；别的认不出", () => {
    expect(渠道触点们).toEqual(["公司资源", "客户介绍"]);
    expect(认渠道触点(" 客户介绍 ")).toBe("客户介绍");
    expect(认渠道触点("公司资源")).toBe("公司资源");
    expect(认渠道触点("")).toBeNull();
    expect(认渠道触点(null)).toBeNull();
    expect(认渠道触点("朋友介绍")).toBeUndefined();
  });
});

describe("节点必填「来源」= 来源或触点（M-必填-01 放宽）", () => {
  const 规则 = { ...默认组织规则, 节点推进: { 开: true, 必填: { 潜客培育: ["来源"] } } };
  const 数据 = (客户: 必填数据["客户"]): 必填数据 => ({
    项目: { node: "潜客培育", contactId: null, nextStepAt: null, expectedDealAt: null, amount: 0, remark: null, acceptancePassed: false },
    客户, 联系人们: [], 沟通节点们: [],
  });
  it("来源、触点都空才差；只有触点也算齐", () => {
    expect(还差(规则, 数据({ phone: null, extra: null }))).toEqual(["来源"]);
    expect(还差(规则, 数据({ phone: null, extra: null, touchpoint: "客户介绍" }))).toEqual([]);
    expect(还差(规则, 数据({ phone: null, extra: { source: "展会" } }))).toEqual([]);
    expect(还差(规则, 数据({ phone: null, extra: null, touchpoint: "无" }))).toEqual(["来源"]);
  });
});

describe("保存客户（企业版）", () => {
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
      name: "示例客户", phone: null, school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: "tester-id", channelId: null, referrerCustomerId: null,
      ...改,
      // 客户业务线必填（M-必填-13）：没另给按内贸
      企业资料: { bizLine: "内贸", ...((改.企业资料 as object | undefined) ?? {}) },
    } as unknown as Parameters<typeof saveCustomer>[0]);

  const 建介绍人 = async () => {
    const 渠道 = await prisma.channel.create({ data: { name: "示例渠道", active: true, channelOwnerId: "tester-id" } });
    return prisma.customer.create({ data: { name: "示例介绍人", phone: "13900001101", salesOwnerId: "tester-id", followStatus: "待跟进", channelId: 渠道.id } });
  };

  it("触点 = 客户介绍 + 介绍人：建好、主渠道留空（不继承介绍人的渠道）、介绍人挂上", async () => {
    const 介绍人 = await 建介绍人();
    const r = await 存客户({ phone: "13900001102", touchpoint: "客户介绍", referrerCustomerId: 介绍人.id });
    expect(r.ok).toBe(true);
    const c = await prisma.customer.findFirstOrThrow({ where: { phone: "13900001102" } });
    expect(c).toMatchObject({ touchpoint: "客户介绍", channelId: null, referrerCustomerId: 介绍人.id });
  });

  it("触点 = 公司资源、没渠道：建好", async () => {
    const r = await 存客户({ phone: "13900001103", touchpoint: "公司资源" });
    expect(r.ok).toBe(true);
    expect((await prisma.customer.findFirstOrThrow({ where: { phone: "13900001103" } })).touchpoint).toBe("公司资源");
  });

  it("认不出的触点拦下、不建", async () => {
    const r = await 存客户({ phone: "13900001104", touchpoint: "朋友介绍" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("渠道触点");
    expect(await prisma.customer.count()).toBe(0);
  });

  it("编辑：改备注不清介绍人、不动触点；原来只有触点的清成两样都空拦下", async () => {
    const 介绍人 = await 建介绍人();
    const c = await prisma.customer.create({ data: { name: "示例客户二", phone: "13900001105", salesOwnerId: "tester-id", followStatus: "待跟进", touchpoint: "客户介绍", referrerCustomerId: 介绍人.id } });
    const 改备注 = await 存客户({ id: c.id, name: "示例客户二", phone: "13900001105", remark: "改了备注", touchpoint: "客户介绍", referrerCustomerId: 介绍人.id, updatedAt: c.updatedAt.toISOString() });
    expect(改备注.ok).toBe(true);
    const 后 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(后).toMatchObject({ remark: "改了备注", touchpoint: "客户介绍", referrerCustomerId: 介绍人.id, channelId: null });

    const 清空 = await 存客户({ id: c.id, name: "示例客户二", phone: "13900001105", touchpoint: null, referrerCustomerId: null, updatedAt: 后.updatedAt.toISOString() });
    expect(清空.ok).toBe(false);
    if (!清空.ok) expect(清空.error).toContain("渠道触点");
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).touchpoint).toBe("客户介绍");
  });

  it("编辑：不交触点（undefined）= 不碰", async () => {
    const c = await prisma.customer.create({ data: { name: "示例客户三", phone: "13900001106", salesOwnerId: "tester-id", followStatus: "待跟进", touchpoint: "公司资源" } });
    const r = await 存客户({ id: c.id, name: "示例客户三", phone: "13900001106", remark: "x", updatedAt: c.updatedAt.toISOString() });
    expect(r.ok).toBe(true);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).touchpoint).toBe("公司资源");
  });

  it("触点也是来源（P-删-03）：空的补一次可以；有值的换别的、清空、改挂主渠道都拦", async () => {
    const c = await prisma.customer.create({ data: { name: "示例客户四", phone: "13900001108", salesOwnerId: "tester-id", followStatus: "待跟进" } });
    const 补 = await 存客户({ id: c.id, name: "示例客户四", phone: "13900001108", touchpoint: "公司资源", updatedAt: c.updatedAt.toISOString() });
    expect(补.ok).toBe(true);
    const 锁 = "客户来源（渠道触点）记的是第一次的来源，建好之后不能改";
    const 渠道 = await prisma.channel.create({ data: { name: "示例渠道二", active: true, channelOwnerId: "tester-id" } });
    for (const 改 of [{ touchpoint: "客户介绍" }, { touchpoint: null }, { touchpoint: null, channelId: 渠道.id }]) {
      const 前 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
      const r = await 存客户({ id: c.id, name: "示例客户四", phone: "13900001108", updatedAt: 前.updatedAt.toISOString(), ...改 });
      expect(r).toMatchObject({ ok: false, error: 锁 });
    }
    const 后 = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(后).toMatchObject({ touchpoint: "公司资源", channelId: null });
    // 照原样交回来（表单整表保存）= 没改，放行
    const 原样 = await 存客户({ id: c.id, name: "示例客户四", phone: "13900001108", touchpoint: "公司资源", remark: "改备注", updatedAt: 后.updatedAt.toISOString() });
    expect(原样.ok).toBe(true);
  });

  it("没开企业版：触点不看、不写", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const r = await 存客户({ phone: "13900001107", touchpoint: "朋友介绍" });
    expect(r.ok).toBe(true);
    expect((await prisma.customer.findFirstOrThrow({ where: { phone: "13900001107" } })).touchpoint).toBeNull();
  });
});
