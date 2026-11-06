/**
 * 登录后回哪（?next=）的校验（11-06，lib/safe-next.ts）：这个值来自 URL、会写进 Location 头，
 * 钉的是每种开放跳转的绕法都挡住，正常的站内路径带查询串原样回去。
 */
import { describe, it, expect } from "vitest";
import { 站内路径, 飞书登录地址 } from "../src/lib/safe-next";

describe("站内路径()", () => {
  it("正常路径带查询和锚点原样回去", () => {
    for (const p of ["/customers/abc", "/customers", "/customers?view=me&page=2", "/projects/1#notes", "/x?u=%2F%2Fevil.com"]) {
      expect(站内路径(p), p).toBe(p);
    }
  });

  it("中文路径规整成编码后的（能放进 Location 头）", () => {
    expect(站内路径("/overview?view=本年")).toBe("/overview?view=%E6%9C%AC%E5%B9%B4");
  });

  it("开放跳转的绕法一律不收", () => {
    for (const p of [
      "//evil.com", "///evil.com", "/\\evil.com", "\\\\evil.com", "https://evil.com", "http:evil.com", "javascript:alert(1)", "evil.com",
      "/%2F/evil.com", "/%2f%2fevil.com", "/%5Cevil.com", "/%252F%252Fevil.com", "/%25252F%25252Fevil.com",
      "/\t/evil.com", "/\n/evil.com", "/%09/evil.com", "/%0a/evil.com",
      "/..//evil.com", "/%2e%2e//evil.com", "/a/..//evil.com",
      "/%E0%A4%A",
    ]) {
      expect(站内路径(p), JSON.stringify(p)).toBeNull();
    }
  });

  it("多层编码超过上限直接不收", () => {
    let s = "/a%2Fb";
    for (let i = 0; i < 5; i++) s = s.replace(/%/g, "%25");
    expect(站内路径(s)).toBeNull();
  });

  it("回到登录页、接口、静态资源没有意义，当没有", () => {
    for (const p of ["/login", "/login?next=/x", "/signup", "/forgot", "/api/x", "/_next/static/a.js", "/%6Cogin", "/x/../login", "/%61pi/x"]) {
      expect(站内路径(p), p).toBeNull();
    }
    for (const p of ["/logins", "/apis/x"]) expect(站内路径(p), p).toBe(p);
  });

  it("不是字符串、空串、太长都当没有", () => {
    for (const v of [undefined, null, "", 1, ["/customers"], `/${"a".repeat(1024)}`]) expect(站内路径(v)).toBeNull();
  });
});

describe("飞书登录地址()", () => {
  it("有去处带上编码后的 next，没有就是光入口", () => {
    expect(飞书登录地址()).toBe("/api/auth/feishu");
    expect(飞书登录地址(null)).toBe("/api/auth/feishu");
    expect(飞书登录地址("/customers/a?x=1")).toBe("/api/auth/feishu?next=%2Fcustomers%2Fa%3Fx%3D1");
  });
});
