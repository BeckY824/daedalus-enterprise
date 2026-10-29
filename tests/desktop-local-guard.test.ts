/**
 * 桌面端本地服务的两道门（lib/desktop/local-guard.ts，2026-10-04，D-1）。
 * 原来本地 /login 对谁都 307 到 /api/desktop/session?t=<令牌>：同机别的系统账户、DNS 重绑定过来的网页都能拿到会话。
 * 企业版删掉了那条自动登录路由（2026-10-29），两道门本身还给 api/desktop/ready 用，这里只钉判断。
 */
import { describe, it, expect } from "vitest";
import { 是本机地址, 来自壳 } from "@/lib/desktop/local-guard";

describe("是本机地址", () => {
  it("127.0.0.1 / localhost / [::1]（带不带端口）都认", () => {
    for (const h of ["127.0.0.1", "127.0.0.1:3410", "localhost:51234", "[::1]", "[::1]:8080"]) expect(是本机地址(h), h).toBe(true);
  });
  it("重绑定过来的域名、局域网地址、空的一律不认", () => {
    for (const h of ["attacker.example.com", "attacker.example.com:3410", "127.0.0.1.attacker.com", "192.168.1.5:3410", "", null, undefined, "[::2]:80"]) {
      expect(是本机地址(h as string), String(h)).toBe(false);
    }
  });
});

describe("来自壳", () => {
  it("令牌对得上才算；空的、长度不同、内容不同都不算", () => {
    expect(来自壳("abc123", "abc123")).toBe(true);
    expect(来自壳("", "abc123")).toBe(false);
    expect(来自壳(null, "abc123")).toBe(false);
    expect(来自壳("abc12", "abc123")).toBe(false);
    expect(来自壳("abc124", "abc123")).toBe(false);
    expect(来自壳("abc123", undefined)).toBe(false);
  });
});

