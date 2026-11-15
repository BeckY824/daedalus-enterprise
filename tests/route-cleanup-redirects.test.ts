/**
 * 清理没用到的页面（11-15 用户：「有些没用到的页面都可以清除」，清理清单逐块确认过）。
 *
 * 删掉的每一条地址：页面文件和它的 @pane 空槽都没了，老链接（书签、通知、AI 回答里存着的）
 * 跳到合适的新页，不落 404；代码里也不再有指过去的链接。
 *   /start               → /dashboard（原来就只是转去首页的跳板）
 *   /customers/recent    → /customers（桌面端左栏「客户」的跳板，企业版网页走不到）
 *   /follow-ups/watchlist→ /dashboard（盯盘就在首页；AI 的 get_watchlist 不再给这个链接）
 *   /reports             → /overview?view=本年（proxy 里那条，页面兜底删了）
 *   /opportunities 等    → /projects（页面 10-28 就删了，跳转留着）
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import nextConfig from "../next.config";
import { proxy } from "../src/proxy";

const 根 = path.resolve(__dirname, "..");
const APP = path.join(根, "src/app/(app)");

describe("删掉的地址：老链接跳到新页", () => {
  it("next.config：/start、/customers/recent、/follow-ups/watchlist 各转到新页，不是永久转", async () => {
    const 规则 = await nextConfig.redirects!();
    for (const [source, destination] of [
      ["/start", "/dashboard"],
      ["/customers/recent", "/customers"],
      ["/follow-ups/watchlist", "/dashboard"],
      ["/opportunities", "/projects"],
      ["/opportunities/:path*", "/projects"],
    ]) {
      expect(规则.find((r) => r.source === source), source).toMatchObject({ destination, permanent: false });
    }
  });

  it("proxy：已登录打开 /reports 转到数据页「本年」", async () => {
    const 秒 = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ sub: "u1", ims: Date.now() })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt(秒)
      .setExpirationTime(秒 + 30 * 86400)
      .sign(new TextEncoder().encode("dev-only-secret-change-me-in-production"));
    const r = new NextRequest(new URL("/reports", "http://crm.example.test"));
    r.cookies.set("crm_session", token);
    const res = await proxy(r);
    expect(res.status).toBe(307);
    const u = new URL(res.headers.get("location")!);
    expect(u.pathname).toBe("/overview");
    expect(u.searchParams.get("view")).toBe("本年");
  });

  it("页面和 @pane 空槽都删了（start 在 (app) 外面，没有空槽）", () => {
    for (const p of [
      "src/app/start/page.tsx",
      "src/app/(app)/reports/page.tsx",
      "src/app/(app)/@pane/reports/page.tsx",
      "src/app/(app)/customers/recent/page.tsx",
      "src/app/(app)/@pane/customers/recent/page.tsx",
      "src/app/(app)/follow-ups/watchlist/page.tsx",
      "src/app/(app)/@pane/follow-ups/watchlist/page.tsx",
    ]) expect(fs.existsSync(path.join(根, p)), p).toBe(false);
    // 商机目录只剩 server action（客户页还在用 setOppStatus），不许再长出页面
    expect(fs.existsSync(path.join(APP, "opportunities/page.tsx"))).toBe(false);
  });

  it("src 里没有链接再指向删掉的地址（通知、AI 工具、revalidatePath、左栏）", () => {
    const 坏 = [
      /["'`]\/start["'`?]/,
      /["'`]\/reports["'`?]/,
      /\/customers\/recent/,
      /\/follow-ups\/watchlist/,
      /["'`]\/opportunities/,
    ];
    const 命中: string[] = [];
    (function 走(dir: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "generated") 走(p);
        } else if (/\.(tsx?|js)$/.test(e.name)) {
          fs.readFileSync(p, "utf8").split("\n").forEach((行, i) => {
            // proxy.ts 里 /reports 那条就是老书签的跳转本身
            if (p.endsWith(path.join("src", "proxy.ts")) && 行.includes('pathname === "/reports"')) return;
            if (坏.some((re) => re.test(行))) 命中.push(`${path.relative(根, p)}:${i + 1}`);
          });
        }
      }
    })(path.join(根, "src"));
    expect(命中).toEqual([]);
  });
});
