/**
 * 录音实测页 /mic-test.html（11-21，录音点评 PR1）：public 下的静态页，但要登录才能开。
 * 钉住：proxy 的 matcher 放它进来、它不在公开名单里，没登录跳登录页（登录后回到这页）；登录了照常放行。
 * 页面本身只读：不存任何东西，只调本站两个小接口（飞书鉴权签名、上传回显）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "../src/proxy";
import { nextConfig } from "../next.config";

const 页 = "/mic-test.html";

describe("录音实测页要登录", () => {
  it("proxy 的 matcher 命中这一页（.html 不在排除名单）", () => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig, url: 页 })).toBe(true);
  });

  it("没登录：跳 /login，带 next=/mic-test.html", async () => {
    const res = await proxy(new NextRequest(`http://crm.example.test${页}`));
    expect([307, 308]).toContain(res.status);
    const 去 = new URL(res.headers.get("location")!);
    expect(去.pathname).toBe("/login");
    expect(去.searchParams.get("next")).toBe(页);
  });

  it("会话票是假的也跳登录", async () => {
    const res = await proxy(new NextRequest(`http://crm.example.test${页}`, { headers: { cookie: "crm_session=not-a-jwt" } }));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("登录了：放行（不跳转）", async () => {
    // 测试环境没设 AUTH_SECRET 时 proxy 用开发默认值（src/proxy.ts readSecret）
    const 密 = new TextEncoder().encode(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32 ? process.env.AUTH_SECRET : "dev-only-secret-change-me-in-production");
    const 票 = await new SignJWT({ sub: "u1", ims: Date.now() }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(密);
    const res = await proxy(new NextRequest(`http://crm.example.test${页}`, { headers: { cookie: `crm_session=${票}` } }));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("录音实测页只读", () => {
  const html = readFileSync("public/mic-test.html", "utf8");

  it("不存东西：没有浏览器存储；请求只打本站两个小接口（签名、回显）", () => {
    for (const 词 of ["localStorage", "sessionStorage", "indexedDB", "document.cookie", "XMLHttpRequest", "sendBeacon", "<form"]) {
      expect(html, 词).not.toContain(词);
    }
    expect(html).toContain('var 签名接口 = "/api/feishu/jsapi-sign"');
    expect(html).toContain('var 回显接口 = "/api/mic-test/echo"');
    // fetch 只有两处：签名、回显；飞书 uploadFile 也只传回显
    const 调用 = [...html.matchAll(/fetch\(([^,]+),/g)].map((m) => m[1].trim());
    expect(调用.sort()).toEqual(["回显接口", "签名接口 + \"?url=\" + encodeURIComponent(location.href.split(\"#\")[0])"].sort());
    expect(html).toMatch(/uploadFile\(\{ url: location\.origin \+ 回显接口/);
  });

  it("八块 + 结果摘要（T1–T8）都在", () => {
    for (const id of ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "pttWeb", "pttFs", "fsOpen", "sum"]) expect(html).toContain(`id="${id}"`);
    for (const 格式 of ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm;codecs=opus"]) expect(html).toContain(`"${格式}"`);
    for (const t of ["T1", "T2", "T3", "T4", "T5", "T6a", "T6b", "T6c", "T6d", "T6e", "T7", "T8"]) expect(html).toMatch(new RegExp(`\\b${t}: "`));
    for (const 接口 of ["getRecorderManager", "onFrameRecorded", "readFile", "uploadFile", "scope.record", "external: true"]) expect(html).toContain(接口);
  });

  it("飞书 SDK 只从飞书的 CDN 引、https", () => {
    const 外链 = [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
    expect(外链.length).toBeGreaterThan(0);
    for (const u of 外链) expect(u, u).toMatch(/^https:\/\/lf-scm-cn\.feishucdn\.com\/lark\/op\/h5-js-sdk-[\d.]+\.js$/);
  });

  it("页面响应头里话筒只放本站", async () => {
    const 规则 = await nextConfig.headers!();
    const 全站 = 规则.find((r) => r.source === "/:path*")!;
    expect(全站.headers.find((h) => h.key === "Permissions-Policy")?.value).toContain("microphone=(self)");
  });
});
