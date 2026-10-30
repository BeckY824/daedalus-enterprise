/**
 * 企业版用飞书身份登录 + 保持登录（2026-10-30）。
 * 认人：先按记下的 open_id，没记过按姓名认在用的号且只认一个；重名、没对上、已绑别人、停用都不放行。
 * 保持登录：会话 30 天，签发够一天的票在打开页面时顺延，ims 不变；没有 ims 的老票不顺延。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT, decodeJwt } from "jose";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 认飞书用户, 换飞书身份, 飞书登录凭据, 飞书授权地址, 对外地址, 飞书登录出错 } from "../src/lib/enterprise/feishu-login";
import { proxy } from "../src/proxy";

afterAll(() => prisma.$disconnect());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const 建号 = (name: string, extra: { active?: boolean; feishuOpenId?: string } = {}) =>
  prisma.user.create({ data: { email: `${name}-${Math.random().toString(36).slice(2, 8)}@x.test`, name, title: "销售", role: "SALES", password: "x", ...extra } });

async function 原因(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof 飞书登录出错) return e.原因;
    throw e;
  }
  return "通过";
}

describe("认飞书用户", () => {
  beforeEach(() => resetDb());

  it("第一次按姓名认上并绑定，之后按 open_id 认（改了名也认得）", async () => {
    const 张三 = await 建号("张三");
    expect(await 认飞书用户({ openId: "ou_1", name: "张三" })).toEqual({ id: 张三.id, name: "张三" });
    expect((await prisma.user.findUnique({ where: { id: 张三.id } }))?.feishuOpenId).toBe("ou_1");
    expect(await prisma.auditLog.count({ where: { entityId: 张三.id } })).toBe(1);
    expect((await 认飞书用户({ openId: "ou_1", name: "张三（销售部）" })).id).toBe(张三.id);
  });

  it("没有同名的号：nomatch；姓名为空：nomatch", async () => {
    await 建号("张三");
    expect(await 原因(认飞书用户({ openId: "ou_1", name: "李四" }))).toBe("nomatch");
    expect(await 原因(认飞书用户({ openId: "ou_1", name: "" }))).toBe("nomatch");
  });

  it("两个在用的同名号：dup，谁也不绑", async () => {
    await 建号("张三");
    await 建号("张三");
    expect(await 原因(认飞书用户({ openId: "ou_1", name: "张三" }))).toBe("dup");
    expect(await prisma.user.count({ where: { feishuOpenId: { not: null } } })).toBe(0);
  });

  it("同名号已绑了别的飞书身份：taken", async () => {
    await 建号("张三", { feishuOpenId: "ou_old" });
    expect(await 原因(认飞书用户({ openId: "ou_new", name: "张三" }))).toBe("taken");
  });

  it("停用：绑过的停用了、同名的只有停用的，都是 inactive", async () => {
    await 建号("张三", { active: false, feishuOpenId: "ou_1" });
    expect(await 原因(认飞书用户({ openId: "ou_1", name: "张三" }))).toBe("inactive");
    await 建号("李四", { active: false });
    expect(await 原因(认飞书用户({ openId: "ou_2", name: "李四" }))).toBe("inactive");
  });

  it("同名里一个停用一个在用：认在用的那个", async () => {
    await 建号("张三", { active: false });
    const 在用 = await 建号("张三");
    expect((await 认飞书用户({ openId: "ou_1", name: "张三" })).id).toBe(在用.id);
  });
});

describe("换飞书身份", () => {
  const 凭据 = { appId: "cli_test", appSecret: "s" };
  const 回 = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("换 token、读用户信息，拿到 open_id 和姓名", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(回({ code: 0, access_token: "u-token" })).mockResolvedValueOnce(回({ code: 0, data: { open_id: "ou_1", name: " 张三 " } }));
    vi.stubGlobal("fetch", fetch);
    expect(await 换飞书身份("c", "http://h/api/auth/feishu/callback", 凭据)).toEqual({ openId: "ou_1", name: "张三" });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ grant_type: "authorization_code", client_id: "cli_test", code: "c", redirect_uri: "http://h/api/auth/feishu/callback" });
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer u-token");
  });

  it("飞书回错、断网、没有 open_id：一律 exchange", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(回({ code: 20003, msg: "bad code" })));
    expect(await 原因(换飞书身份("c", "r", 凭据))).toBe("exchange");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(await 原因(换飞书身份("c", "r", 凭据))).toBe("exchange");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(回({ code: 0, access_token: "t" })).mockResolvedValueOnce(回({ code: 0, data: {} })));
    expect(await 原因(换飞书身份("c", "r", 凭据))).toBe("exchange");
  });
});

describe("凭据与地址", () => {
  beforeEach(() => resetDb());

  it("不是企业版：不给用飞书登录", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    vi.stubEnv("ENT_FEISHU_APP_ID", "cli_x");
    vi.stubEnv("ENT_FEISHU_APP_SECRET", "s");
    expect(await 飞书登录凭据()).toBeNull();
  });

  it("企业版：没存连接配置就看环境变量，缺一个就不给", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    vi.stubEnv("ENT_FEISHU_APP_ID", " cli_x ");
    vi.stubEnv("ENT_FEISHU_APP_SECRET", "s");
    expect(await 飞书登录凭据()).toEqual({ appId: "cli_x", appSecret: "s" });
    vi.stubEnv("ENT_FEISHU_APP_SECRET", "");
    expect(await 飞书登录凭据()).toBeNull();
  });

  it("回调地址：ENT_PUBLIC_URL 优先，其次 nginx 转过来的头", () => {
    vi.stubEnv("ENT_PUBLIC_URL", "");
    expect(对外地址(new Headers({ host: "127.0.0.1:3000", "x-forwarded-proto": "http", "x-forwarded-host": "47.0.0.1" }))).toBe("http://47.0.0.1");
    expect(对外地址(new Headers({ host: "crm.example.test" }))).toBe("http://crm.example.test");
    vi.stubEnv("ENT_PUBLIC_URL", "https://crm.example.test/");
    expect(对外地址(new Headers({ host: "127.0.0.1:3000" }))).toBe("https://crm.example.test");
    const u = new URL(飞书授权地址("cli_x", "https://crm.example.test/api/auth/feishu/callback", "st"));
    expect(u.origin + u.pathname).toBe("https://accounts.feishu.cn/open-apis/authen/v1/authorize");
    expect(u.searchParams.get("redirect_uri")).toBe("https://crm.example.test/api/auth/feishu/callback");
    expect(u.searchParams.get("state")).toBe("st");
  });
});

describe("保持登录：proxy 顺延会话", () => {
  const 密钥 = new TextEncoder().encode("dev-only-secret-change-me-in-production");
  const 签 = (payload: Record<string, unknown>, 签发于秒: number) =>
    new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt(签发于秒).setExpirationTime(签发于秒 + 30 * 86400).sign(密钥);
  const 打开 = (token: string) => {
    const r = new NextRequest(new URL("/dashboard", "http://crm.example.test"));
    r.cookies.set("crm_session", token);
    return proxy(r);
  };
  const 现在秒 = () => Math.floor(Date.now() / 1000);

  it("签发够一天：换新票，30 天，sub / ims 不变", async () => {
    const ims = Date.now() - 2 * 86400_000;
    const res = await 打开(await 签({ sub: "u1", ims }, 现在秒() - 2 * 86400));
    const c = res.cookies.get("crm_session");
    expect(c?.maxAge).toBe(30 * 86400);
    const p = decodeJwt(c!.value);
    expect(p.sub).toBe("u1");
    expect(p.ims).toBe(ims);
    expect(p.iat).toBeGreaterThanOrEqual(现在秒() - 5);
    expect(p.exp! - p.iat!).toBe(30 * 86400);
  });

  it("刚签的票不换；没有 ims 的老票不顺延", async () => {
    expect((await 打开(await 签({ sub: "u1", ims: Date.now() }, 现在秒()))).cookies.get("crm_session")).toBeUndefined();
    expect((await 打开(await 签({ sub: "u1" }, 现在秒() - 2 * 86400))).cookies.get("crm_session")).toBeUndefined();
  });
});
