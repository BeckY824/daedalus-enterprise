/**
 * 企业版网页里不留我们云端 / 桌面端的页面（2026-10-24）：注册、条款、隐私、手机伴侣、反馈都跳走；
 * 开关关着时（桌面端、团队版、云端、开源自部署）这几页照旧。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { 企业版跳转 } from "../src/lib/enterprise/web-paths";
import { proxy } from "../src/proxy";

afterEach(() => vi.unstubAllEnvs());

describe("企业版跳转()", () => {
  it("注册、条款、隐私回登录页", () => {
    for (const p of ["/signup", "/terms", "/privacy"]) expect(企业版跳转(p), p).toBe("/login");
  });

  it("手机伴侣、反馈回首页", () => {
    for (const p of ["/m", "/m/", "/m/sw.js", "/feedback"]) expect(企业版跳转(p), p).toBe("/dashboard");
  });

  it("别的页不动，长得像的也不误伤", () => {
    for (const p of ["/login", "/forgot", "/dashboard", "/customers", "/settings", "/me", "/members", "/mobile", "/feedbacks", "/signup-x", "/admin"]) {
      expect(企业版跳转(p), p).toBeNull();
    }
  });
});

const 请求 = (p: string) => new NextRequest(new URL(p, "http://crm.example.test"));

describe("proxy", () => {
  it("企业版：没登录打开注册 / 条款跳登录，手机页跳首页（再由下一趟送去登录）", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    for (const [p, 去] of [["/signup", "/login"], ["/terms", "/login"], ["/privacy", "/login"], ["/m", "/dashboard"], ["/feedback", "/dashboard"]] as const) {
      const r = await proxy(请求(p + "?from=x"));
      expect(r.status, p).toBe(307);
      expect(new URL(r.headers.get("location")!).pathname, p).toBe(去);
      expect(new URL(r.headers.get("location")!).search, p).toBe("");
    }
  });

  it("开关关着：条款、隐私、手机页没登录也照常打开", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    for (const p of ["/signup", "/terms", "/privacy", "/m"]) {
      const r = await proxy(请求(p));
      expect(r.headers.get("location"), p).toBeNull();
    }
  });
});

describe("没登录打开某一页：登录后回来（11-06）", () => {
  const 去向 = async (p: string) => {
    const r = await proxy(请求回来(p));
    return new URL(r.headers.get("location")!);
  };
  const 请求回来 = (p: string) => new NextRequest(new URL(p, "http://crm.example.test"));

  it("客户详情：弹去登录页，带上 next", async () => {
    const u = await 去向("/customers/abc");
    expect(u.pathname).toBe("/login");
    expect(u.searchParams.get("next")).toBe("/customers/abc");
  });

  it("带查询串的页面：查询串跟着 next 走，登录页自己不带", async () => {
    const u = await 去向("/customers?view=mine&q=%E5%BC%A0");
    expect(u.pathname).toBe("/login");
    expect([...u.searchParams.keys()]).toEqual(["next"]);
    expect(u.searchParams.get("next")).toBe("/customers?view=mine&q=%E5%BC%A0");
  });

  it("_rsc 不记", async () => {
    expect((await 去向("/customers/abc?_rsc=xyz")).searchParams.get("next")).toBe("/customers/abc");
  });

  it("首页类不记：/、/start、/dashboard", async () => {
    for (const p of ["/", "/start", "/dashboard"]) expect((await 去向(p)).search, p).toBe("");
  });

  it("//evil.com 这种路径：不记 next", async () => {
    const r = await proxy(new NextRequest("http://crm.example.test/%2F%2Fevil.com"));
    const u = new URL(r.headers.get("location")!);
    expect(u.pathname).toBe("/login");
    expect(u.searchParams.get("next")).toBeNull();
  });

  it("POST 不记", async () => {
    const r = await proxy(new NextRequest("http://crm.example.test/customers/abc", { method: "POST" }));
    expect(new URL(r.headers.get("location")!).searchParams.get("next")).toBeNull();
  });
});

describe("已登录打开带 next 的登录页", () => {
  const 已登录 = async (p: string) => {
    const 秒 = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ sub: "u1", ims: Date.now() })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(秒)
      .setExpirationTime(秒 + 30 * 86400)
      .sign(new TextEncoder().encode("dev-only-secret-change-me-in-production"));
    const r = new NextRequest(new URL(p, "http://crm.example.test"));
    r.cookies.set("crm_session", token);
    return new URL((await proxy(r)).headers.get("location")!);
  };

  it("next 合法：直接去那一页，查询串保留", async () => {
    const u = await 已登录("/login?next=" + encodeURIComponent("/customers/abc?tab=x"));
    expect(`${u.pathname}${u.search}`).toBe("/customers/abc?tab=x");
    expect(u.host).toBe("crm.example.test");
  });

  it("恶意 next：回首页，next 不留，也不出站", async () => {
    for (const 坏 of ["//evil.com", "https://evil.com", "/\\evil.com", "/%2F%2Fevil.com", "/login"]) {
      const u = await 已登录("/login?next=" + encodeURIComponent(坏));
      expect(`${u.host}${u.pathname}${u.search}`, 坏).toBe("crm.example.test/dashboard");
    }
  });

  it("不带 next：照旧回首页", async () => {
    expect((await 已登录("/login")).pathname).toBe("/dashboard");
  });
});
