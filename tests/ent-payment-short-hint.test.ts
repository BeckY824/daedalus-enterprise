import { describe, it, expect } from "vitest";
import { 还应收, 回款少于应收 } from "@/lib/project/payment-hint";

describe("录回款少于应收提示（A5-4）", () => {
  it("应收 = 合同金额减同币种已回；没合同金额 / 已收齐不提示", () => {
    expect(还应收({ 数: 10000, 币: "CNY" }, [{ amount: 3000, currency: "CNY" }, { amount: 500, currency: "USD" }])).toEqual({ 数: 7000, 币: "CNY" });
    expect(还应收({ 数: null, 币: "CNY" }, [])).toBeNull();
    expect(还应收(null, [])).toBeNull();
    expect(还应收({ 数: 0, 币: "CNY" }, [])).toBeNull();
    expect(还应收({ 数: 1000, 币: "CNY" }, [{ amount: 1000, currency: "CNY" }])).toBeNull();
    expect(还应收({ 数: 1000, 币: "CNY" }, [{ amount: 1200, currency: "CNY" }])).toBeNull();
    expect(还应收({ 数: 0.3, 币: "CNY" }, [{ amount: 0.1, currency: "CNY" }])).toEqual({ 数: 0.2, 币: "CNY" });
  });

  it("本笔少于应收给一句「回款少于应收 ¥N」，等于或多于、币种不同、没填都不提示", () => {
    const 应收 = { 数: 7000, 币: "CNY" };
    expect(回款少于应收(2000, "CNY", 应收)).toBe("回款少于应收 ¥ 7,000");
    expect(回款少于应收(7000, "CNY", 应收)).toBeNull();
    expect(回款少于应收(8000, "CNY", 应收)).toBeNull();
    expect(回款少于应收(2000, "USD", 应收)).toBeNull();
    expect(回款少于应收(null, "CNY", 应收)).toBeNull();
    expect(回款少于应收(2000, "CNY", null)).toBeNull();
    expect(回款少于应收(100, "USD", { 数: 500, 币: "USD" })).toBe("回款少于应收 US$ 500");
  });
});
