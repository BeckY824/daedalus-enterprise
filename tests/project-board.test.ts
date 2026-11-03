/**
 * 项目看板分列（lib/project/board.ts）：五列都摆、列头数和按币种分开的合计、列里最近改过的排前。
 * 总控 10-23 定：金额不换汇，各币种各算各的。
 */
import { describe, it, expect } from "vitest";
import { 看板分列, type 项目行 } from "@/lib/project/board";
import { 字典of } from "@/lib/project/stage-dict";

let n = 0;
function 行(补: Partial<项目行>): 项目行 {
  n += 1;
  return {
    id: `p${n}`, name: `项目${n}`, customerId: "c", customerName: "客户", ownerId: "u", ownerName: "甲",
    phase: "线索", node: "潜客培育", result: null, exceptionReason: null, exceptionCategory: null, pooled: false, amount: 0, currency: "CNY", updatedAt: "2026-10-23T00:00:00.000Z",
    ...补,
  };
}

describe("看板分列", () => {
  it("没项目也摆五列，列头 0、合计空", () => {
    expect(看板分列([]).map((c) => [c.列, c.数, c.合计])).toEqual([
      ["线索", 0, []], ["商机", 0, []], ["订单", 0, []], ["成功交付", 0, []], ["没成", 0, []],
    ]);
  });

  it("异常留在所在阶段那列；流失、丢单进没成；合计按币种分开不换汇", () => {
    const 列 = 看板分列([
      行({ phase: "订单", node: "安装实施", amount: 100, currency: "CNY" }),
      行({ phase: "订单", node: "安装实施", result: "异常状态", exceptionReason: "停电", amount: 50, currency: "USD" }),
      行({ phase: "订单", node: "合同签订", amount: 30, currency: "CNY" }),
      行({ phase: "线索", node: "线索验证", result: "线索流失" }),
      行({ phase: "商机", node: "共识方案", result: "丢单", amount: 9 }),
      行({ phase: "订单", node: "尾款结算", result: "成功交付", amount: 7, currency: "EUR" }),
    ]);
    const 看 = Object.fromEntries(列.map((c) => [c.列, { 数: c.数, 合计: c.合计 }]));
    expect(看.订单).toEqual({ 数: 3, 合计: [{ 币种: "CNY", 合计: 130 }, { 币种: "USD", 合计: 50 }] });
    expect(看.没成).toEqual({ 数: 2, 合计: [{ 币种: "CNY", 合计: 9 }] });
    expect(看.成功交付).toEqual({ 数: 1, 合计: [{ 币种: "EUR", 合计: 7 }] });
    expect(看.线索.数).toBe(0);
  });

  it("列里最近改过的排前", () => {
    const [线索] = 看板分列([
      行({ name: "旧", updatedAt: "2026-10-20T00:00:00.000Z" }),
      行({ name: "新", updatedAt: "2026-10-22T00:00:00.000Z" }),
      行({ name: "中", updatedAt: "2026-10-21T00:00:00.000Z" }),
    ]);
    expect(线索.行.map((r) => r.name)).toEqual(["新", "中", "旧"]);
  });
});

describe("看板 0 个项目的列照常摆（11-01 用户定，原来企业版空列默认藏起）", () => {
  it("只有两列有项目：五列都在、顺序不变，空列数 0、没有卡片", () => {
    const 列 = 看板分列([行({ phase: "商机", node: "共识方案" }), 行({ phase: "订单", node: "尾款结算", result: "成功交付" })]);
    expect(列.map((c) => c.列)).toEqual(["线索", "商机", "订单", "成功交付", "没成"]);
    expect(列.map((c) => c.数)).toEqual([0, 1, 0, 1, 0]);
    for (const c of 列) expect(c.行).toHaveLength(c.数);
  });
});

describe("看板分列（企业版：按进程分列，11-03 客户反馈 6）", () => {
  const 企 = 字典of(true);

  it("三个阶段 14 个进程一个一列，后面交付结清、线索流失、商机丢单；异常状态不单列", () => {
    const 列 = 看板分列([], 企);
    expect(列.map((c) => c.名)).toEqual([
      "潜客培育", "线索验证", "线索推进",
      "痛点挖掘", "方案敲定", "成交推进", "合同审批", "签订合同", "首款到账",
      "生产备货", "物流运输", "安装实施", "交付验收", "尾款结算",
      "交付结清", "线索流失", "商机丢单",
    ]);
    expect(列.find((c) => c.名 === "方案敲定")).toMatchObject({ 色: "商机", 阶段: "商机", 空态: "还没有在方案敲定的项目" });
    expect(列.find((c) => c.名 === "商机丢单")).toMatchObject({ 列: "丢单", 色: "没成", 空态: "还没有商机丢单的项目" });
    expect(列.find((c) => c.名 === "交付结清")?.色).toBe("成功交付");
  });

  it("项目按进程落列；异常留在所在进程；有结局进出口列；认不出的进程落本阶段第一列", () => {
    const 列 = 看板分列([
      行({ phase: "商机", node: "方案敲定", amount: 10 }),
      行({ phase: "订单", node: "安装实施", result: "异常状态" }),
      行({ phase: "商机", node: "成交推进", result: "丢单", amount: 9 }),
      行({ phase: "线索", node: "线索验证", result: "线索流失" }),
      行({ phase: "订单", node: "尾款结算", result: "交付结清", amount: 7 }),
      行({ phase: "商机", node: "某个旧进程" }),
    ], 企);
    const 数 = Object.fromEntries(列.map((c) => [c.名, c.数]));
    expect(数).toMatchObject({ 方案敲定: 1, 安装实施: 1, 商机丢单: 1, 线索流失: 1, 交付结清: 1, 痛点挖掘: 1, 成交推进: 0, 线索验证: 0, 尾款结算: 0 });
    expect(列.reduce((n, c) => n + c.数, 0)).toBe(6);
  });

  it("后台改了出口叫法，列头跟着改", () => {
    const 列 = 看板分列([], 字典of(true, { 商机: [null, "输单"] }));
    expect(列.slice(-3).map((c) => c.名)).toEqual(["交付结清", "线索流失", "输单"]);
  });

  it("阶段筛到商机：只摆商机的 6 个进程和商机丢单", () => {
    const 列 = 看板分列([行({ phase: "商机", node: "痛点挖掘" }), 行({ phase: "线索", node: "潜客培育" })], 企, "商机");
    expect(列.map((c) => c.名)).toEqual(["痛点挖掘", "方案敲定", "成交推进", "合同审批", "签订合同", "首款到账", "商机丢单"]);
    expect(列.reduce((n, c) => n + c.数, 0)).toBe(1);
  });
});
