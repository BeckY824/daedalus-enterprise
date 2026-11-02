/**
 * 上线前全面测试 · 字段存 / 清 / 长文本 / 特殊字符 / 日期往返（11-02），按 c1 开关组合（按组织看客户、线索分配、市场复核、不设配额全开）：
 *   项目（改项目，负责人 = 销售甲，业务角色 sales）：
 *     - 名称、备注、痛点标注、需求描述、详细地址：emoji、引号、<script>、反斜杠、换行原样存原样读
 *     - 清空：备注、痛点标注、需求描述、预计成交日、合同金额、级别交空 = 库里 null
 *     - 上限：名称 60 / 备注 500 / 痛点标注 2000 / 需求描述 500 / 详细地址 100，正好收、多一个字拒、库里不动
 *     - 预计成交日：交 2026-12-31 → 库里是北京 0 点（UTC 前一天 16:00），页面格式化回 2026-12-31；同一天再交不算变；2026-02-30 拒；跨年
 *   客户（saveCustomer 整表 / patchCustomer 单格）：
 *     - 名称、备注、学校格：特殊字符原样往返
 *     - 清空：备注、简称、预计签约日（两列都清）
 *     - 预计签约日：交 2026-12-31 → on = 2026-12-31、at = 北京 0 点；2026-13-01 拒
 *     - 简称：中间空白并成一个，20 字收、21 字拒；详细地址 100 收、101 拒
 *     - 待定（钉现状）：客户名称、备注没有长度上限（项目名称 60、备注 500）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" }),
}));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 改项目 } from "@/lib/project/db";
import { saveCustomer, patchCustomer } from "@/app/(app)/customers/actions";
import { 规则 } from "@/lib/enterprise/rules";
import { 不设配额key } from "@/lib/enterprise/lead-assign";
import { dayjs } from "@/lib/utils";

const 怪字 = `销售甲's "单" <script>alert(1)</script> \\路径\\ 😀👍🏻 \n第二行\t制表 & ; -- '`;
const 怪字一行 = `销售甲's "单" <script>alert(1)</script> \\路径\\ 😀 & ; --`;

async function c1开关() {
  for (const k of [规则.按组织看客户.key, 规则.线索分配.key, 规则.市场复核.key]) await setSetting(k, true);
  await setSetting(不设配额key, true);
}

describe("项目字段：改项目真库", () => {
  let 甲: { id: string; role: string };
  let 项目id: string;
  const 基 = { name: "项目甲", amount: 0 };
  const 读 = () => prisma.project.findUniqueOrThrow({ where: { id: 项目id } });

  beforeEach(async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await resetDb();
    invalidateSettingsCache();
    await c1开关();
    甲 = { id: (await prisma.user.create({ data: { email: "xs-jia", name: "销售甲", title: "", role: "SALES", password: "x" } })).id, role: "SALES" };
    await prisma.entMember.create({ data: { userId: 甲.id, bizRole: "sales" } });
    const 客户id = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800002201", salesOwnerId: 甲.id } })).id;
    项目id = (await prisma.project.create({ data: { name: 基.name, customerId: 客户id, ownerId: 甲.id, creatorId: 甲.id } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("特殊字符原样往返：名称（单行）、备注、痛点标注、需求描述、详细地址", async () => {
    const r = await 改项目(甲, 项目id, { ...基, name: 怪字一行, remark: 怪字, painPoints: 怪字, dealDemand: 怪字, location: 怪字一行 });
    expect(r).toMatchObject({ ok: true });
    const p = await 读();
    expect(p.name).toBe(怪字一行.trim());
    expect(p.remark).toBe(怪字.trim());
    expect(p.painPoints).toBe(怪字.trim());
    expect(p.dealDemand).toBe(怪字.trim());
    expect(p.location).toBe(怪字一行.trim());
    // 再交一遍一样的：不算变
    expect(await 改项目(甲, 项目id, { ...基, name: 怪字一行, remark: 怪字, painPoints: 怪字, dealDemand: 怪字, location: 怪字一行 })).toEqual({ ok: true, 变了: [] });
  });

  it("首尾空白去掉、中间换行留着", async () => {
    await 改项目(甲, 项目id, { ...基, remark: "  第一行\n\n第二行  ", painPoints: "\n一\n二\n" });
    const p = await 读();
    expect(p.remark).toBe("第一行\n\n第二行");
    expect(p.painPoints).toBe("一\n二");
  });

  it("清空：备注、痛点标注、需求描述、预计成交日、合同金额、级别交空 = 库里 null", async () => {
    await 改项目(甲, 项目id, { ...基, remark: "有", painPoints: "有", dealDemand: "有", expectedDealAt: "2026-12-01", contractAmount: 100 as never, level: "A" });
    let p = await 读();
    expect([p.remark, p.painPoints, p.dealDemand, p.contractAmount, p.level]).toEqual(["有", "有", "有", 100, "A"]);
    expect(p.expectedDealAt).not.toBeNull();
    const r = await 改项目(甲, 项目id, { ...基, remark: "", painPoints: "", dealDemand: "", expectedDealAt: "", contractAmount: "" as never, level: "" });
    expect(r).toMatchObject({ ok: true });
    p = await 读();
    expect([p.remark, p.painPoints, p.dealDemand, p.contractAmount, p.contractCurrency, p.level, p.expectedDealAt]).toEqual([null, null, null, null, null, null, null]);
  });

  it("只有空白的也算清空；名称只有空白拒", async () => {
    await 改项目(甲, 项目id, { ...基, remark: "有", painPoints: "有" });
    expect(await 改项目(甲, 项目id, { ...基, remark: " \n\t ", painPoints: "　" })).toMatchObject({ ok: true });
    const p = await 读();
    expect([p.remark, p.painPoints]).toEqual([null, null]);
    expect(await 改项目(甲, 项目id, { ...基, name: "   " })).toMatchObject({ ok: false, error: "请填写项目名称" });
    expect((await 读()).name).toBe(基.name);
  });

  const 上限们: [string, string, number][] = [
    ["name", "名称", 60],
    ["remark", "备注", 500],
    ["painPoints", "痛点标注", 2000],
    ["dealDemand", "需求描述", 500],
    ["location", "详细地址", 100],
  ];
  for (const [键, 名, 上限] of 上限们) {
    it(`上限：${名} ${上限} 字收、${上限 + 1} 字拒、库里不动`, async () => {
      const 正好 = "字".repeat(上限);
      expect(await 改项目(甲, 项目id, { ...基, [键]: 正好 })).toMatchObject({ ok: true });
      expect((await 读())[键 as "name"]).toBe(正好);
      const 多 = await 改项目(甲, 项目id, { ...基, [键]: "多".repeat(上限 + 1) });
      expect(多).toMatchObject({ ok: false });
      expect((await 读())[键 as "name"]).toBe(正好);
    });
  }

  it("emoji 计数（钉现状，见报告待定）：名称按 UTF-16 数（30 个 😀 = 60 收、31 个拒），需求描述按字数（500 个 😀 收）", async () => {
    expect(await 改项目(甲, 项目id, { ...基, name: "😀".repeat(30) })).toMatchObject({ ok: true });
    expect(await 改项目(甲, 项目id, { ...基, name: "😀".repeat(31) })).toMatchObject({ ok: false });
    expect(await 改项目(甲, 项目id, { ...基, dealDemand: "😀".repeat(500) })).toMatchObject({ ok: true });
    expect(await 改项目(甲, 项目id, { ...基, dealDemand: "😀".repeat(501) })).toMatchObject({ ok: false });
  });

  it("预计成交日：2026-12-31 → 库里北京 0 点（UTC 12-30 16:00），页面格式化回 2026-12-31；同一天再交不算变", async () => {
    expect(await 改项目(甲, 项目id, { ...基, expectedDealAt: "2026-12-31" })).toMatchObject({ ok: true, 变了: ["expectedDealAt"] });
    const p = await 读();
    expect(p.expectedDealAt?.toISOString()).toBe("2026-12-30T16:00:00.000Z");
    expect(dayjs(p.expectedDealAt).format("YYYY-MM-DD")).toBe("2026-12-31");
    expect(await 改项目(甲, 项目id, { ...基, expectedDealAt: "2026-12-31" })).toEqual({ ok: true, 变了: [] });
    // 页面回填用的格式化值原样再交：也不算变
    expect(await 改项目(甲, 项目id, { ...基, expectedDealAt: dayjs(p.expectedDealAt).format("YYYY-MM-DD") })).toEqual({ ok: true, 变了: [] });
  });

  it("预计成交日：跨年 2027-01-01、闰年 2028-02-29 往返；不存在的日子和乱写的拒、库里不动", async () => {
    await 改项目(甲, 项目id, { ...基, expectedDealAt: "2027-01-01" });
    expect(dayjs((await 读()).expectedDealAt).format("YYYY-MM-DD")).toBe("2027-01-01");
    expect((await 读()).expectedDealAt?.toISOString()).toBe("2026-12-31T16:00:00.000Z");
    await 改项目(甲, 项目id, { ...基, expectedDealAt: "2028-02-29" });
    expect(dayjs((await 读()).expectedDealAt).format("YYYY-MM-DD")).toBe("2028-02-29");
    for (const 坏 of ["2026-02-30", "2027-02-29", "2026-13-01", "明天", "2026/12/31"]) {
      expect(await 改项目(甲, 项目id, { ...基, expectedDealAt: 坏 })).toMatchObject({ ok: false, error: expect.stringContaining("预计成交日期") });
    }
    expect(dayjs((await 读()).expectedDealAt).format("YYYY-MM-DD")).toBe("2028-02-29");
  });

  it("级别只收 S/A/B/C（小写认、D 拒）；合同金额负数拒", async () => {
    expect(await 改项目(甲, 项目id, { ...基, level: "s" })).toMatchObject({ ok: true });
    expect((await 读()).level).toBe("S");
    expect(await 改项目(甲, 项目id, { ...基, level: "D" })).toMatchObject({ ok: false });
    expect(await 改项目(甲, 项目id, { ...基, contractAmount: -1 as never })).toMatchObject({ ok: false });
    expect((await 读()).level).toBe("S");
  });
});

describe("客户字段：saveCustomer / patchCustomer 真库", () => {
  let 销售甲: string;
  let 序 = 0;

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await c1开关();
    await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "ADMIN", password: "x" } });
    销售甲 = (await prisma.user.create({ data: { email: "s@t", name: "销售甲", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 销售甲, bizRole: "sales" } });
    await prisma.entMember.create({ data: { userId: "tester-id", bizRole: "director" } });
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => prisma.$disconnect());

  const 新建 = (改: Record<string, unknown> = {}) =>
    saveCustomer({
      name: `客户${++序}`, phone: `1390000${String(2000 + 序).slice(-4)}`, school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: 销售甲, channelId: null, referrerCustomerId: null,
      ...改,
    } as Parameters<typeof saveCustomer>[0]);
  async function 新建id(改: Record<string, unknown> = {}) {
    const r = await 新建(改);
    if (!r.ok) throw new Error(r.error);
    return (await prisma.customer.findFirstOrThrow({ orderBy: { createdAt: "desc" }, select: { id: true } })).id;
  }
  async function 整表保存(id: string, 改: Record<string, unknown>) {
    const c = await prisma.customer.findUniqueOrThrow({ where: { id } });
    const 值 = {
      name: c.name, phone: c.phone, school: c.school, grade: c.grade, major: c.major,
      followStatus: c.followStatus, decisionStatus: c.decisionStatus, expectedSignAt: c.expectedSignAt,
      remark: c.remark, salesOwnerId: c.salesOwnerId, channelId: c.channelId, referrerCustomerId: c.referrerCustomerId,
      channelOwnerId: c.channelOwnerId, custStatus: c.custStatus,
    };
    return saveCustomer({ id, updatedAt: c.updatedAt.toISOString(), base: 值, ...值, ...改 } as Parameters<typeof saveCustomer>[0]);
  }
  const 读 = (id: string) => prisma.customer.findUniqueOrThrow({ where: { id } });

  it("新建：名称（单行）、备注特殊字符原样存原样读", async () => {
    const id = await 新建id({ name: 怪字一行, remark: 怪字 });
    const c = await 读(id);
    expect(c.name).toBe(怪字一行.trim());
    expect(c.remark).toBe(怪字.trim());
  });

  it("整表保存改备注 / 名称：特殊字符往返；再改回一样的不报错", async () => {
    const id = await 新建id();
    expect(await 整表保存(id, { remark: 怪字, name: `${怪字一行}二` })).toMatchObject({ ok: true });
    let c = await 读(id);
    expect(c.remark).toBe(怪字.trim());
    expect(c.name).toBe(`${怪字一行}二`.trim());
    expect(await 整表保存(id, {})).toMatchObject({ ok: true });
    c = await 读(id);
    expect(c.remark).toBe(怪字.trim());
  });

  it("单格改：备注、学校格特殊字符往返；交空 = null", async () => {
    const id = await 新建id();
    expect(await patchCustomer(id, "remark", 怪字)).toMatchObject({ ok: true });
    expect(await patchCustomer(id, "school", 怪字一行)).toMatchObject({ ok: true });
    let c = await 读(id);
    expect(c.remark).toBe(怪字.trim());
    expect(c.school).toBe(怪字一行.trim());
    expect(await patchCustomer(id, "remark", "")).toMatchObject({ ok: true });
    expect(await patchCustomer(id, "school", "   ")).toMatchObject({ ok: true });
    c = await 读(id);
    expect([c.remark, c.school]).toEqual([null, null]);
  });

  it("预计签约日：2026-12-31 → on = 2026-12-31、at = 北京 0 点，页面格式化回同一天；交空两列都清", async () => {
    const id = await 新建id();
    expect(await patchCustomer(id, "expectedSignAt", "2026-12-31")).toMatchObject({ ok: true });
    let c = await 读(id);
    expect(c.expectedSignOn).toBe("2026-12-31");
    expect(c.expectedSignAt?.toISOString()).toBe("2026-12-30T16:00:00.000Z");
    expect(dayjs(c.expectedSignAt).format("YYYY-MM-DD")).toBe("2026-12-31");
    expect(await patchCustomer(id, "expectedSignAt", "")).toMatchObject({ ok: true });
    c = await 读(id);
    expect([c.expectedSignAt, c.expectedSignOn]).toEqual([null, null]);
  });

  it("预计签约日：整表保存交字符串也一样；跨年 2027-01-01；不存在的日子拒、库里不动", async () => {
    const id = await 新建id({ expectedSignAt: "2027-01-01" });
    let c = await 读(id);
    expect(c.expectedSignOn).toBe("2027-01-01");
    expect(c.expectedSignAt?.toISOString()).toBe("2026-12-31T16:00:00.000Z");
    for (const 坏 of ["2026-13-01", "2026-02-30", "下周"]) {
      expect(await patchCustomer(id, "expectedSignAt", 坏)).toMatchObject({ ok: false });
    }
    c = await 读(id);
    expect(c.expectedSignOn).toBe("2027-01-01");
    // 整表保存把库里的 Date 原样交回：on 留着、不漂
    expect(await 整表保存(id, { remark: "改个备注" })).toMatchObject({ ok: true });
    c = await 读(id);
    expect(c.expectedSignOn).toBe("2027-01-01");
    expect(c.expectedSignAt?.toISOString()).toBe("2026-12-31T16:00:00.000Z");
  });

  it("简称：首尾去空白、中间空白并一个；20 字收、21 字拒；交空清掉（整表和单格一样）", async () => {
    const id = await 新建id();
    expect(await 整表保存(id, { 企业资料: { shortName: "  甲  \n 公司 " } })).toMatchObject({ ok: true });
    expect((await 读(id)).shortName).toBe("甲 公司");
    expect(await 整表保存(id, { 企业资料: { shortName: "简".repeat(20) } })).toMatchObject({ ok: true });
    expect(await 整表保存(id, { 企业资料: { shortName: "简".repeat(21) } })).toMatchObject({ ok: false, error: expect.stringContaining("简称") });
    expect((await 读(id)).shortName).toBe("简".repeat(20));
    expect(await patchCustomer(id, "shortName", "简".repeat(21))).toMatchObject({ ok: false });
    expect(await patchCustomer(id, "shortName", `<b>"甲"</b>`)).toMatchObject({ ok: true });
    expect((await 读(id)).shortName).toBe(`<b>"甲"</b>`);
    expect(await patchCustomer(id, "shortName", "")).toMatchObject({ ok: true });
    expect((await 读(id)).shortName).toBeNull();
  });

  it("详细地址：特殊字符（单行）往返、100 字收、101 字拒、交空清掉", async () => {
    const id = await 新建id();
    expect(await 整表保存(id, { 企业资料: { addrDetail: 怪字一行 } })).toMatchObject({ ok: true });
    expect((await 读(id)).addrDetail).toBe(怪字一行.trim());
    expect(await 整表保存(id, { 企业资料: { addrDetail: "址".repeat(100) } })).toMatchObject({ ok: true });
    expect(await 整表保存(id, { 企业资料: { addrDetail: "址".repeat(101) } })).toMatchObject({ ok: false });
    expect((await 读(id)).addrDetail).toBe("址".repeat(100));
    expect(await 整表保存(id, { 企业资料: { addrDetail: "" } })).toMatchObject({ ok: true });
    expect((await 读(id)).addrDetail).toBeNull();
  });

  it("地址四格：国内存四格、国外只留国家 + 城市、全空清掉", async () => {
    const id = await 新建id();
    expect(await 整表保存(id, { 企业资料: { addrCountry: "中国", addrProvince: "广东省", addrCity: "深圳市", addrDistrict: "南山区" } })).toMatchObject({ ok: true });
    let c = await 读(id);
    expect([c.addrCountry, c.addrProvince, c.addrCity, c.addrDistrict]).toEqual(["中国", "广东省", "深圳市", "南山区"]);
    expect(await 整表保存(id, { 企业资料: { addrCountry: "美国", addrProvince: "加州", addrCity: "洛杉矶", addrDistrict: "某区" } })).toMatchObject({ ok: true });
    c = await 读(id);
    expect([c.addrCountry, c.addrProvince, c.addrCity, c.addrDistrict]).toEqual(["美国", null, "洛杉矶", null]);
    expect(await 整表保存(id, { 企业资料: { addrCountry: "", addrProvince: "", addrCity: "", addrDistrict: "" } })).toMatchObject({ ok: true });
    c = await 读(id);
    expect([c.addrCountry, c.addrProvince, c.addrCity, c.addrDistrict]).toEqual([null, null, null, null]);
  });

  it("待定（钉现状）：客户名称、备注没有长度上限——5000 字备注、300 字名称都收（项目名称 60、备注 500）", async () => {
    const id = await 新建id({ name: "名".repeat(300), remark: "备".repeat(5000) });
    const c = await 读(id);
    expect(c.name.length).toBe(300);
    expect(c.remark?.length).toBe(5000);
    expect(await patchCustomer(id, "remark", "备".repeat(20000))).toMatchObject({ ok: true });
    expect((await 读(id)).remark?.length).toBe(20000);
  });

  it("名称只有空白 / 零宽字符拒", async () => {
    expect(await 新建({ name: "   " })).toMatchObject({ ok: false });
    expect(await 新建({ name: "​​" })).toMatchObject({ ok: false });
  });
});
