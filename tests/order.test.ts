/**
 * 外贸订单的规则（2026-10-03 外贸第 3a 块）：默认订单号；按条款给单据。
 * 当前节点、红黄绿灰、进度、钱那几个算法只给订单页用，2026-10-28 随订单页一起删了。
 * 节点 / 单据 / 定金尾款的写入口 2026-10-28 随订单节点开关一起删了，那几段用例跟着删；订单只从签约生成（lib/order-contract.ts）
 */
import { describe, it, expect } from "vitest";
import { 默认订单号, 默认单据, 团队订单前缀 } from "@/lib/order";

const 今天 = new Date(2026, 9, 10, 12);

describe("规则", () => {
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
