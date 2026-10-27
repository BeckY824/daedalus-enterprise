/**
 * 设置 → 团队成员「项目数」列（10-27 用户「改成项目数」，lib/project/member-count.ts）：
 *   按线索 / 商机 / 订单分开说，缺的阶段记 0，一个都没有就是 0；三阶段以外的键不算
 */
import { describe, it, expect } from "vitest";
import { 按阶段说 } from "@/lib/project/member-count";

describe("成员页项目数", () => {
  it("按三阶段说、缺的记 0；一个都没有 = 0", () => {
    expect(按阶段说({ 线索: 3, 订单: 1 })).toBe("线索 3 · 商机 0 · 订单 1");
    expect(按阶段说({})).toBe(0);
    expect(按阶段说({ 别的: 5 })).toBe(0);
  });
});
