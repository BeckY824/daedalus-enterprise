/**
 * ⌘K 那几处的小算法（lib/cmdk.ts，11-03 C1-2 / C10-2）：
 * 名单搜索框回车进第一位、名单里没有去全量搜；跳转单搜不到时说「没找到『xxx』」，太长截断。
 */
import { describe, it, expect } from "vitest";
import { 没找到说法, 名单回车去处 } from "@/lib/cmdk";

describe("名单搜索框回车（C1-2）", () => {
  const 显示的 = [{ id: "c-2" }, { id: "c-1" }];
  it("搜了字、名单上有：进排在最上面那位", () => {
    expect(名单回车去处("张三", 显示的, 2, "/customers")).toBe("/customers/c-2");
    expect(名单回车去处(" 改造 ", [{ id: "p-9" }], 1, "/projects")).toBe("/projects/p-9");
  });
  it("名单里一位都没有：去全量表格里按这个词搜（词去掉首尾空白再编码）", () => {
    expect(名单回车去处(" 销售甲&乙 ", [], 0, "/customers")).toBe(`/customers?keyword=${encodeURIComponent("销售甲&乙")}`);
  });
  it("只是页签筛掉了、或者没打字：不动", () => {
    expect(名单回车去处("张三", [], 3, "/customers")).toBeNull();
    expect(名单回车去处("  ", 显示的, 2, "/customers")).toBeNull();
  });
});

describe("跳转单搜不到（C10-2）", () => {
  it("短的原样放进书名号，空白收成一个", () => {
    expect(没找到说法("  张三   公司 ")).toBe("没找到『张三 公司』");
  });
  it("太长的截到 20 个字加省略号，表情不劈开", () => {
    const 长 = "很长的客户名".repeat(10);
    expect(没找到说法(长)).toBe(`没找到『${长.slice(0, 20)}…』`);
    expect(没找到说法("😀".repeat(25))).toBe(`没找到『${"😀".repeat(20)}…』`);
    expect(没找到说法("一".repeat(20))).toBe(`没找到『${"一".repeat(20)}』`);
  });
});
