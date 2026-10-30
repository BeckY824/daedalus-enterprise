/**
 * 企业版项目的成交需求 / 合同金额 / 定金金额（迁移 097，10-30）。
 * 客户原话：项目加三格，金额前面带币种下拉（同「号码类型 + 号码」），原表三列照原样导入。
 *
 * 钉的是：
 *   - 认币种：代码大小写都认，中文名（美元 / 人民币 / 港币……）和常见别称（美金、RMB、元）认成代码，认不出 = null
 *   - 项目成交钱改成：没传 = 原样；金额空 = 清掉、币种跟着清；有数没币种落人民币；坏币种、负数、超长成交需求报错
 *   - 改项目（真库）：五格存得进读得出、再交一遍不算变；不是企业版传了也不动；和 amount 互不影响
 *   - 字段权限：五格都挂在「金额」那一行（不另开开关），金额只能看时改不了
 *   - 导入：「意向产品」→ 成交需求，「合同金额」→ 合同金额（没币种列落人民币），「定金金额」+「定金币种」中文币种名认成代码；
 *     认不出的金额 / 币种原样进备注；再导一遍原表改了就照改；开关关（不是项目模式）照旧建商机、这几格进备注
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ 开: true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.开 }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 认币种 } from "@/lib/currency";
import { 项目成交钱改成, 成交需求上限, type 项目成交钱 } from "@/lib/project/profile-rules";
import { 改项目 } from "@/lib/project/db";
import { 项目列字段, 字段权限key } from "@/lib/enterprise/field-perm";
import { 规则 } from "@/lib/enterprise/rules";
import { 规则猜列 } from "@/lib/enterprise-import/mapping";
import { 试跑 } from "@/lib/enterprise-import/report";
import { 写一批 } from "@/lib/enterprise-import/apply";
import type { 读出的表 } from "@/lib/enterprise-import/excel";
import type { 实体 } from "@/lib/enterprise-import/types";

const 空钱: 项目成交钱 = { dealDemand: null, contractAmount: null, contractCurrency: null, depositAmount: null, depositCurrency: null };

describe("认币种", () => {
  it("代码大小写、前后空格都认", () => {
    expect(认币种("USD")).toBe("USD");
    expect(认币种(" usd ")).toBe("USD");
    expect(认币种("cny")).toBe("CNY");
  });

  it("中文名和常见别称认成代码", () => {
    expect(认币种("美元")).toBe("USD");
    expect(认币种("人民币")).toBe("CNY");
    expect(认币种("港币")).toBe("HKD");
    expect(认币种("欧元")).toBe("EUR");
    expect(认币种("美金")).toBe("USD");
    expect(认币种("RMB")).toBe("CNY");
    expect(认币种("rmb")).toBe("CNY");
    expect(认币种("元")).toBe("CNY");
    expect(认币种("阿联酋迪拉姆")).toBe("AED");
  });

  it("认不出、空、不是字符串 = null", () => {
    expect(认币种("金币")).toBeNull();
    expect(认币种("XYZ")).toBeNull();
    expect(认币种("")).toBeNull();
    expect(认币种("  ")).toBeNull();
    expect(认币种(null)).toBeNull();
    expect(认币种(100)).toBeNull();
  });
});

describe("项目成交钱改成", () => {
  const 原: 项目成交钱 = { dealDemand: "样机 2 台", contractAmount: 1000, contractCurrency: "USD", depositAmount: 300, depositCurrency: "USD" };

  it("没传 = 原样", () => {
    expect(项目成交钱改成({}, 原)).toEqual({ ok: true, 值: 原 });
  });

  it("有数没币种落人民币；金额空 = 清掉，币种跟着清", () => {
    expect(项目成交钱改成({ contractAmount: 5000, depositAmount: "1,000" }, 空钱)).toEqual({
      ok: true,
      值: { ...空钱, contractAmount: 5000, contractCurrency: "CNY", depositAmount: 1000, depositCurrency: "CNY" },
    });
    expect(项目成交钱改成({ contractAmount: null, depositAmount: "" }, 原)).toEqual({ ok: true, 值: { ...空钱, dealDemand: "样机 2 台" } });
    // 金额空着只给币种：不存币种
    expect(项目成交钱改成({ contractCurrency: "EUR" }, 空钱)).toEqual({ ok: true, 值: 空钱 });
  });

  it("换币种；币种传空 = 不动", () => {
    expect(项目成交钱改成({ contractCurrency: "EUR", depositCurrency: "" }, 原)).toMatchObject({ ok: true, 值: { contractCurrency: "EUR", depositCurrency: "USD" } });
  });

  it("成交需求去首尾空白，空 = 清掉", () => {
    expect(项目成交钱改成({ dealDemand: "  三台设备 \n" }, 空钱)).toMatchObject({ ok: true, 值: { dealDemand: "三台设备" } });
    expect(项目成交钱改成({ dealDemand: "   " }, 原)).toMatchObject({ ok: true, 值: { dealDemand: null } });
    expect(项目成交钱改成({ dealDemand: null }, 原)).toMatchObject({ ok: true, 值: { dealDemand: null } });
  });

  it("坏值报错：负数、认不出的数、认不出的币种、超长成交需求、成交需求不是文字", () => {
    expect(项目成交钱改成({ contractAmount: -1 }, 空钱)).toMatchObject({ ok: false, error: expect.stringContaining("合同金额") });
    expect(项目成交钱改成({ depositAmount: "一千" }, 空钱)).toMatchObject({ ok: false, error: expect.stringContaining("定金金额") });
    expect(项目成交钱改成({ contractAmount: 1, contractCurrency: "美元" }, 空钱)).toMatchObject({ ok: false, error: expect.stringContaining("币种") });
    expect(项目成交钱改成({ dealDemand: "长".repeat(成交需求上限 + 1) }, 空钱)).toMatchObject({ ok: false, error: expect.stringContaining("成交需求") });
    expect(项目成交钱改成({ dealDemand: 3 }, 空钱)).toMatchObject({ ok: false, error: expect.stringContaining("成交需求") });
  });
});

describe("字段权限表", () => {
  it("五格都挂在「金额」那一行（不另开开关）", () => {
    for (const k of ["dealDemand", "contractAmount", "contractCurrency", "depositAmount", "depositCurrency"]) expect(项目列字段[k]).toBe("商机金额");
  });
});

describe("改项目：成交需求 / 合同金额 / 定金金额（真库）", () => {
  let 乙: { id: string; role: string };
  let 项目id: string;
  const 读 = () =>
    prisma.project.findUniqueOrThrow({
      where: { id: 项目id },
      select: { amount: true, dealDemand: true, contractAmount: true, contractCurrency: true, depositAmount: true, depositCurrency: true },
    });
  const 基 = { name: "QA-成交钱项目", amount: 0 };

  beforeEach(async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await resetDb();
    invalidateSettingsCache();
    乙 = { id: (await prisma.user.create({ data: { email: "p097-yi", name: "p097-yi", title: "", role: "SALES", password: "x" } })).id, role: "SALES" };
    const 客户 = await prisma.customer.create({ data: { name: "QA-成交钱客户", phone: "13800001097", salesOwnerId: 乙.id } });
    项目id = (await prisma.project.create({ data: { name: 基.name, customerId: 客户.id, ownerId: 乙.id, creatorId: 乙.id } })).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("存得进读得出；再交一遍一样的不算变；和 amount 互不影响", async () => {
    const 交 = { ...基, dealDemand: " 样机 2 台 ", contractAmount: 12000, contractCurrency: "USD", depositAmount: 3000, depositCurrency: "USD" };
    const r = await 改项目(乙, 项目id, 交);
    expect(r).toMatchObject({ ok: true });
    expect(new Set(r.ok ? r.变了 : [])).toEqual(new Set(["dealDemand", "contractAmount", "contractCurrency", "depositAmount", "depositCurrency"]));
    expect(await 读()).toEqual({ amount: 0, dealDemand: "样机 2 台", contractAmount: 12000, contractCurrency: "USD", depositAmount: 3000, depositCurrency: "USD" });
    expect(await 改项目(乙, 项目id, { ...交, dealDemand: "样机 2 台" })).toEqual({ ok: true, 变了: [] });
    // 只改金额：成交钱那几格不动；不传这几格（老的入口）= 不动
    expect(await 改项目(乙, 项目id, { ...基, amount: 500 })).toMatchObject({ ok: true, 变了: ["amount"] });
    expect(await 读()).toMatchObject({ amount: 500, contractAmount: 12000, depositCurrency: "USD" });
  });

  it("清掉合同金额，币种跟着清；坏值拦下库里不动", async () => {
    await 改项目(乙, 项目id, { ...基, contractAmount: 100, depositAmount: 50, depositCurrency: "EUR" });
    expect(await 读()).toMatchObject({ contractAmount: 100, contractCurrency: "CNY", depositAmount: 50, depositCurrency: "EUR" });
    expect(await 改项目(乙, 项目id, { ...基, contractAmount: null })).toMatchObject({ ok: true });
    expect(await 读()).toMatchObject({ contractAmount: null, contractCurrency: null, depositAmount: 50 });
    expect(await 改项目(乙, 项目id, { ...基, depositAmount: -5 })).toMatchObject({ ok: false });
    expect(await 改项目(乙, 项目id, { ...基, depositCurrency: "ABC" })).toMatchObject({ ok: false });
    expect(await 读()).toMatchObject({ depositAmount: 50, depositCurrency: "EUR" });
  });

  it("金额只能看：这几格都改不了，只改名字照存", async () => {
    await prisma.entMember.create({ data: { userId: 乙.id, bizRole: "sales" } });
    await setSetting(规则.字段权限.key, true);
    await setSetting(字段权限key, { 商机金额: { sales: "看" } });
    expect(await 改项目(乙, 项目id, { ...基, contractAmount: 100 })).toMatchObject({ ok: false, error: expect.stringContaining("金额") });
    expect(await 改项目(乙, 项目id, { ...基, dealDemand: "新需求" })).toMatchObject({ ok: false, error: expect.stringContaining("金额") });
    expect(await 改项目(乙, 项目id, { ...基, name: "QA-改名" })).toMatchObject({ ok: true });
    expect(await 读()).toMatchObject({ dealDemand: null, contractAmount: null });
  });

  it("不是企业版：传了也不动", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 改项目(乙, 项目id, { ...基, dealDemand: "x", contractAmount: 1, depositAmount: 2 })).toEqual({ ok: true, 变了: [] });
    expect(await 读()).toEqual({ amount: 0, ...空钱 });
  });
});

describe("导入：原表三列", () => {
  it("规则猜列：意向产品 / 合同金额 / 定金金额 / 定金币种落到新格，「金额」照旧是 amount", () => {
    expect(规则猜列("opportunity", ["商机名称", "金额", "意向产品", "合同金额", "定金金额", "定金币种", "合同币种"])).toMatchObject({
      商机名称: "name",
      金额: "amount",
      意向产品: "dealDemand",
      合同金额: "contractAmount",
      定金金额: "depositAmount",
      定金币种: "depositCurrency",
      合同币种: "contractCurrency",
    });
  });

  function 表(名: string, 实体: 实体, 表头: string[], 行: string[][]): 读出的表 {
    return { 名, 实体, 表头, 行, 行号: 行.map((_, i) => i + 2), 提醒: [] };
  }
  const 客户表 = () => 表("客户.xlsx", "customer", ["记录ID", "客户名称", "手机号码", "客户负责人"], [["C1", "QA-导入客户", "13800000097", "张伟"]]);
  const 商机表 = (行: string[][]) => 表("商机.xlsx", "opportunity", ["商机ID", "客户ID", "商机名称", "商机阶段", "商机金额", "意向产品", "合同金额", "定金金额", "定金币种"], 行);
  const 我 = { id: "tester-id", name: "测试员" };
  async function 导(表们: 读出的表[]) {
    const { 批次Id, 报告 } = await 试跑({ 来源: "excel", 用户Id: 我.id, 表: 表们, 建议器: null });
    const r = await 写一批(批次Id, 我);
    expect(r.完了).toBe(true);
    return { 批次Id, 报告 };
  }
  const 项目 = (name: string) => prisma.project.findFirstOrThrow({ where: { name } });

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    mocks.开 = true;
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await prisma.user.create({ data: { id: 我.id, email: "t@x", name: 我.name, title: "管理员", role: "ADMIN", password: "x" } });
    await prisma.user.create({ data: { email: "zw@x", name: "张伟", title: "销售", role: "SALES", password: "x" } });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("项目模式：三列落项目；合同金额落人民币，定金币种中文名认成代码；空格子不写；认不出的进备注", async () => {
    const { 报告 } = await 导([
      客户表(),
      商机表([
        ["O1", "C1", "QA-设备单", "解决方案", "12万", "激光切割机 2 台", "100000", "3万", "美元"],
        ["O2", "C1", "QA-空着的", "解决方案", "", "", "", "", ""],
        ["O3", "C1", "QA-带符号", "解决方案", "", "配件", "$5,000", "500", "金币"],
        ["O4", "C1", "QA-写错的", "解决方案", "", "", "很多", "", "港币"],
      ]),
    ]);
    const 一 = await 项目("QA-设备单");
    expect([一.amount, 一.dealDemand, 一.contractAmount, 一.contractCurrency, 一.depositAmount, 一.depositCurrency]).toEqual([120000, "激光切割机 2 台", 100000, "CNY", 30000, "USD"]);
    expect(一.remark ?? "").not.toContain("意向产品");

    const 空 = await 项目("QA-空着的");
    expect([空.dealDemand, 空.contractAmount, 空.contractCurrency, 空.depositAmount, 空.depositCurrency]).toEqual([null, null, null, null, null]);

    // 金额前的 $ 认成美元；币种列认不出 → 按人民币写、原样进备注、提醒一笔
    const 符 = await 项目("QA-带符号");
    expect([符.contractAmount, 符.contractCurrency, 符.depositAmount, 符.depositCurrency]).toEqual([5000, "USD", 500, "CNY"]);
    expect(符.remark).toContain("定金币种：金币");
    expect(报告.问题).toContainEqual(expect.objectContaining({ 外部ID: "O3", 类别: "格式不对", 说明: expect.stringContaining("金币") }));

    // 合同金额认不出：不写、进备注；只有币种没有金额：币种进备注
    const 错 = await 项目("QA-写错的");
    expect([错.contractAmount, 错.contractCurrency, 错.depositAmount, 错.depositCurrency]).toEqual([null, null, null, null]);
    expect(错.remark).toContain("合同金额：很多");
    expect(错.remark).toContain("定金币种：港币");
    expect(报告.问题).toContainEqual(expect.objectContaining({ 外部ID: "O4", 类别: "格式不对", 说明: expect.stringContaining("很多") }));
  });

  it("再导一遍：原表改了照改；原表这次空着的不清（只补）", async () => {
    await 导([客户表(), 商机表([["O1", "C1", "QA-设备单", "解决方案", "", "激光切割机 2 台", "100000", "3万", "美元"]])]);
    await 导([客户表(), 商机表([["O1", "C1", "QA-设备单", "解决方案", "", "激光切割机 3 台", "", "4万", "欧元"]])]);
    const p = await 项目("QA-设备单");
    expect([p.dealDemand, p.contractAmount, p.contractCurrency, p.depositAmount, p.depositCurrency]).toEqual(["激光切割机 3 台", 100000, "CNY", 40000, "EUR"]);
  });

  it("开关关：照旧建商机，这几格原样进商机备注", async () => {
    mocks.开 = false;
    await 导([客户表(), 商机表([["O1", "C1", "QA-设备单", "需求确认", "12万", "激光切割机 2 台", "100000", "3万", "美元"]])]);
    expect(await prisma.project.count()).toBe(0);
    const o = await prisma.opportunity.findFirstOrThrow({ where: { name: "QA-设备单" } });
    expect(o.amount).toBe(120000);
    for (const 段 of ["成交需求：激光切割机 2 台", "合同金额：100000", "定金金额：3万", "定金币种：美元"]) expect(o.remark).toContain(段);
  });
});
