/**
 * 外贸订单的规则（2026-10-03 外贸第 3a 块）：当前节点 = 第一个没完成也不是不适用的；红黄绿灰；进度不算不适用；钱；默认订单号；按条款给单据。
 * 节点 / 单据 / 定金尾款的写入口 2026-10-28 随订单节点开关一起删了，那几段用例跟着删；订单只从签约生成（lib/order-contract.ts）
 */
import { describe, it, expect } from "vitest";
import { 当前节点, 节点灯, 进度, 超期数, 订单的钱, 默认订单号, 默认单据, 团队订单前缀 } from "@/lib/order";

const 天 = (n: number, 从 = new Date(2026, 9, 10, 12)) => new Date(从.getTime() + n * 86400000).toISOString();
const 今天 = new Date(2026, 9, 10, 12);

describe("规则", () => {
  it("当前节点：第一个没完成、也不是不适用的；全走完是 null", () => {
    const n = (idx: number, status: string) => ({ idx, status });
    expect(当前节点([n(2, "未开始"), n(1, "已完成")])?.idx).toBe(2);
    expect(当前节点([n(1, "不适用"), n(2, "卡住"), n(3, "未开始")])?.idx).toBe(2);
    expect(当前节点([n(1, "已完成"), n(2, "不适用")])).toBeNull();
  });

  it("颜色：完成绿、不适用灰、卡住红、过了截止日红、3 天内黄、截止日当天黄不红", () => {
    expect(节点灯({ status: "已完成", dueAt: 天(-5) }, 今天)).toBe("绿");
    expect(节点灯({ status: "不适用", dueAt: 天(-5) }, 今天)).toBe("灰");
    expect(节点灯({ status: "卡住", dueAt: null }, 今天)).toBe("红");
    expect(节点灯({ status: "进行中", dueAt: 天(-1) }, 今天)).toBe("红");
    expect(节点灯({ status: "未开始", dueAt: 天(0) }, 今天)).toBe("黄");
    expect(节点灯({ status: "未开始", dueAt: 天(3) }, 今天)).toBe("黄");
    expect(节点灯({ status: "未开始", dueAt: 天(4) }, 今天)).toBe("无");
    expect(节点灯({ status: "未开始", dueAt: null }, 今天)).toBe("无");
    expect(超期数([{ status: "卡住", dueAt: null }, { status: "进行中", dueAt: 天(-2) }, { status: "已完成", dueAt: 天(-2) }], 今天)).toBe(2);
  });

  it("进度不算不适用的；钱：尾款应收 = 金额 - 定金应收，未收不小于 0", () => {
    expect(进度([{ status: "已完成" }, { status: "不适用" }, { status: "未开始" }])).toBe(50);
    expect(进度([{ status: "不适用" }])).toBe(100);
    expect(订单的钱({ amount: 10000, depositDue: 3000, depositPaid: 3000, balancePaid: 2000 })).toEqual({ 尾款应收: 7000, 未收: 5000 });
    expect(订单的钱({ amount: 100, depositDue: 30, depositPaid: 80, balancePaid: 80 }).未收).toBe(0);
  });

  it("团队模式下订单号带下单人名字的第一个字：几台电脑各编各的不撞号", () => {
    expect(团队订单前缀("甲")).toBe("甲-");
    expect(团队订单前缀("  Alice")).toBe("A-");
    expect(团队订单前缀("")).toBe("");
    expect(默认订单号(["甲-20261010-1"], 今天, "甲-")).toBe("甲-20261010-2");
  });

  it("默认订单号按日期编号，同一天往后排；单据按贸易条款", () => {
    expect(默认订单号([], 今天)).toBe("20261010-1");
    expect(默认订单号(["20261010-1", "20261010-2"], 今天)).toBe("20261010-3");
    expect(默认单据("EXW")).not.toContain("订舱单 S/O");
    expect(默认单据("EXW")).not.toContain("提单 B/L");
    expect(默认单据("CIF")).toContain("保险单");
    expect(默认单据("FOB")).not.toContain("保险单");
    expect(默认单据(null)).toEqual(默认单据("FOB"));
  });
});
