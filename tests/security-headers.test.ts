/**
 * 上线前审查（2026-09-15）发现托管版一条安全头都没有，还带着 x-powered-by。
 * 官网那边 nginx 加了，app 这边漏了。钉在这里，免得哪次重写 next.config 时又掉。
 */
import { describe, it, expect } from "vitest";
import nextConfig from "../next.config";

describe("安全响应头", () => {
  it("全路径都带，且不报框架名", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const 规则 = await nextConfig.headers!();
    const 全站 = 规则.find((r) => r.source === "/:path*");
    expect(全站, "要有一条覆盖所有路径的规则").toBeDefined();
    const 键 = Object.fromEntries(全站!.headers.map((h) => [h.key, h.value]));
    expect(键["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(键["X-Content-Type-Options"]).toBe("nosniff");
    expect(键["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(键["Strict-Transport-Security"]).toMatch(/^max-age=\d+$/);
    expect(键["Strict-Transport-Security"], "preload 撤不回来，不要加").not.toContain("preload");
    expect(键["Permissions-Policy"], "其余页面相机、话筒、定位都关着").toBe("camera=(), microphone=(), geolocation=()");
  });

  /**
   * Next 的规则按顺序叠，同名头后面的覆盖前面的，所以这里按 Next 的路径匹配把每条规则过一遍。
   * 手机上拍名片走 <input capture>（dashboard/CardScanKey.tsx），是系统相机，不靠这个头放开。
   */
  it("所有路径相机、话筒、定位都关着", async () => {
    const { getPathMatch } = await import("next/dist/shared/lib/router/utils/path-match");
    const 规则 = await nextConfig.headers!();
    const 头 = (路径: string) => {
      let 值: string | undefined;
      for (const r of 规则) {
        if (!getPathMatch(r.source, { strict: true, removeUnnamedParams: true })(路径)) continue;
        for (const h of r.headers) if (h.key.toLowerCase() === "permissions-policy") 值 = h.value;
      }
      return 值;
    };
    for (const p of ["/login", "/dashboard", "/customers", "/api/mobile/scan", "/m", "/ocr/v1/paddle.js"]) {
      expect(头(p), p).toBe("camera=(), microphone=(), geolocation=()");
    }
  });
});

/** 商机列表和商机管道、订单、供应商 10-28 删了（企业版只用项目）：老链接转去项目，不落 404 */
describe("旧商机地址", () => {
  it("/opportunities、/orders、/suppliers 和它们下面的地址都转到 /projects，且不是永久转", async () => {
    // 订单、供应商两页 10-28 删了、表 10-29 也删了（迁移 066），老书签同样转项目
    const 规则 = await nextConfig.redirects!();
    for (const source of ["/opportunities", "/opportunities/:path*", "/orders", "/orders/:path*", "/suppliers", "/suppliers/:path*"]) {
      expect(规则.find((r) => r.source === source), source).toMatchObject({ destination: "/projects", permanent: false });
    }
  });
});
