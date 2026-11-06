/**
 * 飞书登录带 next（11-06）：入口存 Cookie、回调取回；成功回那一页，失败把 next 带回登录页；恶意值一律不认。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  已登录: false,
  有凭据: true,
  认人出错: null as Error | null,
  罐: new Map<string, { value: string; maxAge?: number }>(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => mocks.罐.get(k),
    set: (k: string, value: string, o?: { maxAge?: number }) => {
      if (o?.maxAge === 0) mocks.罐.delete(k);
      else mocks.罐.set(k, { value, maxAge: o?.maxAge });
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: async () => (mocks.已登录 ? { id: "u1" } : null),
  createSession: async () => {},
}));
vi.mock("@/lib/enterprise/feishu-login", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/feishu-login")>();
  return {
    ...m,
    飞书登录凭据: async () => (mocks.有凭据 ? { appId: "cli_x", appSecret: "s" } : null),
    换飞书身份: async () => ({ openId: "ou_1", name: "甲", 邮箱们: [] }),
    认飞书用户: async () => {
      if (mocks.认人出错) throw mocks.认人出错;
      return { id: "u1" };
    },
  };
});

import { GET as 入口 } from "../src/app/api/auth/feishu/route";
import { GET as 回调 } from "../src/app/api/auth/feishu/callback/route";
import { 状态Cookie, 去处Cookie } from "../src/app/api/auth/feishu/state";
import { 飞书登录出错 } from "../src/lib/enterprise/feishu-login";

const 请求 = (p: string) => new NextRequest(new URL(p, "http://crm.example.test"));
const 去向 = (r: Response) => r.headers.get("location")!;

beforeEach(() => {
  mocks.已登录 = false;
  mocks.有凭据 = true;
  mocks.认人出错 = null;
  mocks.罐.clear();
});

describe("入口 /api/auth/feishu", () => {
  it("带 next：存 Cookie，跳飞书授权", async () => {
    const r = await 入口(请求("/api/auth/feishu?next=" + encodeURIComponent("/customers/abc")));
    expect(去向(r)).toContain("accounts.feishu.cn");
    expect(mocks.罐.get(去处Cookie)?.value).toBe("/customers/abc");
    expect(mocks.罐.get(状态Cookie)?.value).toBeTruthy();
  });

  it("恶意 next：不存，当没带", async () => {
    for (const 坏 of ["//evil.com", "https://evil.com", "/%2F%2Fevil.com", "/login"]) {
      mocks.罐.clear();
      await 入口(请求("/api/auth/feishu?next=" + encodeURIComponent(坏)));
      expect(mocks.罐.has(去处Cookie), 坏).toBe(false);
    }
  });

  it("没带 next：清掉上一趟留下的", async () => {
    mocks.罐.set(去处Cookie, { value: "/customers/old" });
    await 入口(请求("/api/auth/feishu"));
    expect(mocks.罐.has(去处Cookie)).toBe(false);
  });

  it("已登录：直接去 next；没 next 照旧 /start；恶意的也 /start", async () => {
    mocks.已登录 = true;
    expect(去向(await 入口(请求("/api/auth/feishu?next=" + encodeURIComponent("/customers/abc"))))).toBe("/customers/abc");
    expect(去向(await 入口(请求("/api/auth/feishu")))).toBe("/start");
    expect(去向(await 入口(请求("/api/auth/feishu?next=" + encodeURIComponent("//evil.com"))))).toBe("/start");
  });

  it("没配飞书：回登录页，next 还在", async () => {
    mocks.有凭据 = false;
    expect(去向(await 入口(请求("/api/auth/feishu?next=" + encodeURIComponent("/customers/abc"))))).toBe("/login?reason=feishu-off&next=%2Fcustomers%2Fabc");
  });
});

describe("回调 /api/auth/feishu/callback", () => {
  const 备好 = (去处?: string) => {
    mocks.罐.set(状态Cookie, { value: "st" });
    if (去处) mocks.罐.set(去处Cookie, { value: 去处 });
  };
  const 回 = () => 回调(请求("/api/auth/feishu/callback?state=st&code=c"));

  it("成功：回 next，Cookie 用完即清；没 next 照旧 /start", async () => {
    备好("/customers/abc");
    expect(去向(await 回())).toBe("/customers/abc");
    expect(mocks.罐.has(去处Cookie)).toBe(false);
    备好();
    expect(去向(await 回())).toBe("/start");
  });

  it("Cookie 被改成外站：不认，/start", async () => {
    for (const 坏 of ["//evil.com", "https://evil.com", "/\\evil.com"]) {
      备好(坏);
      expect(去向(await 回()), 坏).toBe("/start");
    }
  });

  it("失败：回登录页带原因和 next（登录页带 reason 不会再自动走，不会来回跳）", async () => {
    备好("/customers/abc");
    mocks.认人出错 = new 飞书登录出错("nomatch");
    expect(去向(await 回())).toBe("/login?reason=feishu-nomatch&next=%2Fcustomers%2Fabc");
  });

  it("state 对不上：回登录页，不发会话", async () => {
    备好("/customers/abc");
    expect(去向(await 回调(请求("/api/auth/feishu/callback?state=错&code=c")))).toBe("/login?reason=feishu-state&next=%2Fcustomers%2Fabc");
  });
});
