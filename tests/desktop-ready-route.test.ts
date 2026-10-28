/**
 * 就绪路由（src/app/api/desktop/ready）：只在桌面本机模式开，不把自动登录令牌带出去。
 * 壳那一半（desktop/local-server.js 分端口、认身份、起停子进程）在桌面端仓库里钉；企业库不带壳。
 */
import { afterEach, expect, it, vi } from "vitest";
import crypto from "node:crypto";

afterEach(() => { vi.unstubAllEnvs(); });

it("就绪路由仅在桌面本机开启，不暴露自动登录令牌", async () => {
  const { GET } = await import("@/app/api/desktop/ready/route");
  const req = new Request("http://127.0.0.1:1234/api/desktop/ready");
  vi.stubEnv("DESKTOP_LOCAL", ""); vi.stubEnv("DESKTOP_TOKEN", "qa-token"); expect((await GET(req)).status).toBe(404);
  vi.stubEnv("DESKTOP_LOCAL", "1"); expect((await GET(new Request("http://evil.example/api/desktop/ready"))).status).toBe(404);
  const response = await GET(req); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toEqual({ instance: crypto.createHash("sha256").update("qa-token").digest("hex") });
});
