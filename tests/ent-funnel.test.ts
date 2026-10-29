/**
 * 复盘页的全周期漏斗（定稿 #15、待 4：线索 → 商机 → 订单 → 交付；老板看全员，业务员看自己）。
 *
 *   口径：同一批项目往下数——线索 = 全部，商机 = 走到商机或订单，订单 = 走到订单，交付 = 结局成功交付
 *   转化率 = 本段 / 上一段；第一段、上一段是 0 的没有转化率
 *   现在 = 看得到的全部项目；一段 = 这一段新建的项目
 *   可见范围不另写：查库那层按人限定，老板看全员、业务员只看自己的
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 项目漏斗of, 转化率字 } from "../src/app/(app)/overview/funnel";
import { 项目现在, 项目一段 } from "../src/app/(app)/overview/project-stats";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";

const 行 = (phase: string, result: string | null = null) => ({ phase, result });
const 数们 = (g: { count: number }[]) => g.map((x) => x.count);

describe("漏斗口径（纯函数）", () => {
  it("同一批项目往下数：丢单留在商机、线索流失留在线索、异常留在订单，各自照样算走到了那一段", () => {
    const g = 项目漏斗of([
      行("线索"),
      行("线索", "线索流失"),
      行("商机"),
      行("商机", "丢单"),
      行("订单"),
      行("订单", "异常状态"),
      行("订单", "成功交付"),
      行("订单", "成功交付"),
    ]);
    expect(g.map((x) => x.段)).toEqual(["线索", "商机", "订单", "交付"]);
    expect(数们(g)).toEqual([8, 6, 4, 2]);
    expect(g.map((x) => x.转化率)).toEqual([null, 6 / 8, 4 / 6, 2 / 4]);
  });

  it("没有项目：四段全 0，没有转化率；上一段是 0 的那段也没有", () => {
    expect(项目漏斗of([])).toEqual([
      { 段: "线索", count: 0, 转化率: null },
      { 段: "商机", count: 0, 转化率: null },
      { 段: "订单", count: 0, 转化率: null },
      { 段: "交付", count: 0, 转化率: null },
    ]);
    const g = 项目漏斗of([行("线索"), 行("线索")]);
    expect(数们(g)).toEqual([2, 0, 0, 0]);
    expect(g.map((x) => x.转化率)).toEqual([null, 0, null, null]);
  });

  it("转化率写成人话", () => {
    expect(转化率字(null)).toBe("—");
    expect(转化率字(0)).toBe("0%");
    expect(转化率字(0.004)).toBe("<1%");
    expect(转化率字(2 / 3)).toBe("67%");
    expect(转化率字(1)).toBe("100%");
  });
});

describe("可见范围：老板看全员，业务员看自己（企业版 + 项目模式 + 按组织看客户）", () => {
  let 老板: { id: string }, 乙: { id: string }, 丙: { id: string };
  async function 建(ownerId: string, customerId: string, phase: string, result?: string, createdAt?: Date) {
    return prisma.project.create({ data: { name: `p-${phase}-${result ?? ""}`, customerId, ownerId, creatorId: ownerId, phase, node: phase === "线索" ? "潜客培育" : phase === "商机" ? "明确需求" : "生产备货", result, createdAt } });
  }

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    忘掉企业版范围();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    老板 = await prisma.user.create({ data: { email: "boss@t", password: "x", name: "老板", role: "ADMIN" } });
    乙 = await prisma.user.create({ data: { email: "yi@t", password: "x", name: "乙", role: "SALES" } });
    丙 = await prisma.user.create({ data: { email: "bing@t", password: "x", name: "丙", role: "SALES" } });
    await prisma.entMember.createMany({ data: [{ userId: 乙.id }, { userId: 丙.id }] });
    await setSetting("business", { projectMode: true });
    await setSetting(规则.按组织看客户.key, true);
    invalidateSettingsCache();
    忘掉企业版范围();
    // 各挂各的客户：同一个客户底下的项目，业务员看得到客户就看得到项目，测不出按人
    const 乙客户 = (await prisma.customer.create({ data: { name: "客户一", phone: "13800000011", salesOwnerId: 乙.id } })).id;
    const 丙客户 = (await prisma.customer.create({ data: { name: "客户二", phone: "13800000012", salesOwnerId: 丙.id } })).id;
    // 乙：线索 1、商机 1、订单 1（成功交付）；丙：线索 1、订单 1
    await 建(乙.id, 乙客户, "线索");
    await 建(乙.id, 乙客户, "商机");
    await 建(乙.id, 乙客户, "订单", "成功交付");
    await 建(丙.id, 丙客户, "线索");
    await 建(丙.id, 丙客户, "订单");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    忘掉企业版范围();
  });
  afterAll(async () => void (await prisma.$disconnect()));

  it("现在：老板数全员 5 条，乙只数自己的 3 条，丙只数自己的 2 条", async () => {
    expect(数们((await 以谁的身份(老板.id, () => 项目现在("CNY"))).漏斗)).toEqual([5, 3, 2, 1]);
    expect(数们((await 以谁的身份(乙.id, () => 项目现在("CNY"))).漏斗)).toEqual([3, 2, 1, 1]);
    expect(数们((await 以谁的身份(丙.id, () => 项目现在("CNY"))).漏斗)).toEqual([2, 1, 1, 0]);
  });

  it("一段：只数这一段新建的；同一套范围", async () => {
    const 月初 = new Date();
    月初.setDate(1);
    月初.setHours(0, 0, 0, 0);
    // 截止留 1 秒：库里记的建立时间和这里的「现在」毫秒上偶尔对不齐，最后建的那条会被挤出段外（负载下时有时无）
    const 现在 = new Date(Date.now() + 1000);
    // 段外建一条老板名下的：一段的漏斗不算它，现在的漏斗算
    const 老客户 = (await prisma.customer.create({ data: { name: "客户三", phone: "13800000013", salesOwnerId: 老板.id } })).id;
    await 建(老板.id, 老客户, "商机", undefined, new Date(月初.getTime() - 86400000));
    expect(数们((await 以谁的身份(老板.id, () => 项目一段(月初, 现在, "day", "CNY"))).漏斗)).toEqual([5, 3, 2, 1]);
    expect(数们((await 以谁的身份(老板.id, () => 项目现在("CNY"))).漏斗)).toEqual([6, 4, 2, 1]);
    expect(数们((await 以谁的身份(乙.id, () => 项目一段(月初, 现在, "day", "CNY"))).漏斗)).toEqual([3, 2, 1, 1]);
  });
});
