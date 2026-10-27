/**
 * 同名成员带邮箱（lib/utils.ts 的 同名带邮箱 / 成员选项）。
 * 2026-10-27：持有上限、组织架构里两个同名成员只显示名字，分不出是谁。纯显示，不看企业版开关。
 */
import { describe, it, expect } from "vitest";
import { 同名带邮箱, 成员选项 } from "@/lib/utils";

const 名单 = [
  { id: "a", name: "王芳", email: "wf1@x.test" },
  { id: "b", name: "王芳", email: "wf2@x.test" },
  { id: "c", name: "李强", email: "lq@x.test" },
];

describe("同名带邮箱", () => {
  it("同名的带邮箱，不同名的只有名字", () => {
    const 叫 = 同名带邮箱(名单);
    expect(叫.get("a")).toBe("王芳（wf1@x.test）");
    expect(叫.get("b")).toBe("王芳（wf2@x.test）");
    expect(叫.get("c")).toBe("李强");
  });

  it("只在传进来的这批人里算同名：另一个王芳不在名单里就不带", () => {
    expect(同名带邮箱(名单.slice(1)).get("b")).toBe("王芳");
  });

  it("成员选项跟着用同一份显示名", () => {
    expect(成员选项(名单).map((o) => o.label)).toEqual(["王芳（wf1@x.test）", "王芳（wf2@x.test）", "李强"]);
  });
});
