/** 客户详情刚加的联系人排最前（lib/fresh-first.ts，11-03 C1-8） */
import { describe, it, expect } from "vitest";
import { 刚加的排前 } from "@/lib/fresh-first";

const 们 = [{ id: "关键" }, { id: "早" }, { id: "新" }, { id: "晚" }];

describe("刚加的排前", () => {
  it("刚加的挪到最前，其余顺序不变，不改原数组", () => {
    expect(刚加的排前(们, "新").map((x) => x.id)).toEqual(["新", "关键", "早", "晚"]);
    expect(们.map((x) => x.id)).toEqual(["关键", "早", "新", "晚"]);
  });
  it("没有刚加的、还没刷新回来、本来就在最前：原样", () => {
    expect(刚加的排前(们, null)).toBe(们);
    expect(刚加的排前(们, "不在")).toBe(们);
    expect(刚加的排前(们, "关键")).toBe(们);
  });
});
