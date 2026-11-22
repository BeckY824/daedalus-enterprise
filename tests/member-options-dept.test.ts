/**
 * 负责人下拉同名的带部门（lib/utils.ts 的 成员选项带部门，设计语言 L-A 的 L-新6）。
 * 同名不同部门 → 带部门；同名同部门 → 部门后再带登录名；同名但没分部门 → 带登录名；不重名 → 原样只写名字。
 */
import { describe, it, expect } from "vitest";
import { 成员选项带部门 } from "@/lib/utils";

const 叫 = (us: Parameters<typeof 成员选项带部门>[0]) => 成员选项带部门(us).map((o) => [o.value, o.label]);

describe("成员选项带部门", () => {
  it("同名不同部门：各带自己的部门", () => {
    expect(叫([
      { id: "a", name: "甲一", email: "a@x.test", 部门: "华东组" },
      { id: "b", name: "甲一", email: "b@x.test", 部门: "华南组" },
    ])).toEqual([["a", "甲一（华东组）"], ["b", "甲一（华南组）"]]);
  });

  it("同名同部门：部门后再带登录名", () => {
    expect(叫([
      { id: "a", name: "甲一", email: "a@x.test", 部门: "华东组" },
      { id: "b", name: "甲一", email: "b@x.test", 部门: "华东组" },
    ])).toEqual([["a", "甲一（华东组 · a@x.test）"], ["b", "甲一（华东组 · b@x.test）"]]);
  });

  it("同名但没分部门：带登录名", () => {
    expect(叫([
      { id: "a", name: "甲一", email: "a@x.test" },
      { id: "b", name: "甲一", email: "b@x.test", 部门: null },
    ])).toEqual([["a", "甲一（a@x.test）"], ["b", "甲一（b@x.test）"]]);
  });

  it("同名一个有部门一个没有：有部门的只带部门，没部门的带登录名", () => {
    expect(叫([
      { id: "a", name: "甲一", email: "a@x.test", 部门: "华东组" },
      { id: "b", name: "甲一", email: "b@x.test" },
    ])).toEqual([["a", "甲一（华东组）"], ["b", "甲一（b@x.test）"]]);
  });

  it("不重名：原样只写名字（有部门也不带），顺序不变", () => {
    expect(叫([
      { id: "a", name: "甲一", email: "a@x.test", 部门: "华东组" },
      { id: "c", name: "乙二", email: "c@x.test" },
    ])).toEqual([["a", "甲一"], ["c", "乙二"]]);
  });
});
