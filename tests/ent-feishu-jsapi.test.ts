/**
 * 飞书网页 JSAPI 鉴权签名接口 /api/feishu/jsapi-sign（11-21，录音点评 PR1，实测页和 PR3 飞书原生录音用）。
 * 钉住：未登录 401 且一次飞书请求都不发；没配 ENT_PUBLIC_URL 一个都不签（400「未配置站点地址」，不看 Host）；
 * 只签和 ENT_PUBLIC_URL 同源的 /mic-test.html；
 * 签名按飞书的拼法算（固定样例）；票不出服务端、每进程缓存到快过期；没凭据回「未配置」。
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const 罐 = vi.hoisted(() => ({
  用户: null as null | { id: string },
  凭据: { appId: "cli_test", appSecret: "s-test", 基址: "https://open.feishu.test" } as null | { appId: string; appSecret: string; 基址: string },
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => 罐.用户) }));
vi.mock("@/lib/enterprise/feishu-push", () => ({
  推送凭据: vi.fn(async () => 罐.凭据),
  飞书租户令牌: vi.fn(async () => "t-token"),
}));

import { GET } from "../src/app/api/feishu/jsapi-sign/route";
import { 可签地址, 站点源, 算签名, 清JSAPI票 } from "@/lib/enterprise/feishu-jsapi";

const 页 = "https://crm.example.test/mic-test.html?x=1";
const 请求 = (url: string | null, host = "crm.example.test") =>
  new NextRequest(`https://${host}/api/feishu/jsapi-sign${url == null ? "" : `?url=${encodeURIComponent(url)}`}`, { headers: { host } });
const 票回 = (ticket: string, expire_in = 7200) => new Response(JSON.stringify({ code: 0, msg: "ok", data: { ticket, expire_in } }), { status: 200 });

let 飞书请求: ReturnType<typeof vi.fn>;
beforeEach(() => {
  清JSAPI票();
  罐.用户 = null;
  罐.凭据 = { appId: "cli_test", appSecret: "s-test", 基址: "https://open.feishu.test" };
  飞书请求 = vi.fn(async () => 票回("TICKET-1"));
  vi.stubGlobal("fetch", 飞书请求);
  vi.stubEnv("ENT_PUBLIC_URL", "https://crm.example.test");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("签名接口", () => {
  it("未登录：401，不去飞书拿票", async () => {
    const res = await GET(请求(页));
    expect(res.status).toBe(401);
    expect(飞书请求).not.toHaveBeenCalled();
  });

  it("登录后：返回 appId / timestamp / nonceStr / signature 四项，签名按飞书拼法算，不带票", async () => {
    罐.用户 = { id: "u1" };
    const res = await GET(请求(`${页}#锚点`));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Object.keys(j).sort()).toEqual(["appId", "nonceStr", "signature", "timestamp"]);
    expect(j.appId).toBe("cli_test");
    expect(JSON.stringify(j)).not.toContain("TICKET-1");
    const 期望 = createHash("sha1").update(`jsapi_ticket=TICKET-1&noncestr=${j.nonceStr}&timestamp=${j.timestamp}&url=${页}`).digest("hex");
    expect(j.signature).toBe(期望);
    expect(res.headers.get("cache-control")).toBe("no-store");
    // 拿票：POST /open-apis/jssdk/ticket/get，Bearer 租户令牌（飞书官方示例 lark-samples/web_app_with_jssdk 同样）
    const [地址, 参数] = 飞书请求.mock.calls[0] as [string, RequestInit];
    expect(地址).toBe("https://open.feishu.test/open-apis/jssdk/ticket/get");
    expect(参数.method).toBe("POST");
    expect((参数.headers as Record<string, string>).Authorization).toBe("Bearer t-token");
  });

  it("没配飞书凭据：503「未配置」，不去飞书", async () => {
    罐.用户 = { id: "u1" };
    罐.凭据 = null;
    const res = await GET(请求(页));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("未配置");
    expect(飞书请求).not.toHaveBeenCalled();
  });

  it("没配 ENT_PUBLIC_URL：400「未配置站点地址」，Host / X-Forwarded-Host 对上了也不签，不去飞书", async () => {
    罐.用户 = { id: "u1" };
    for (const 值 of ["", "   ", "不是地址", "ftp://crm.example.test"]) {
      vi.stubEnv("ENT_PUBLIC_URL", 值);
      const 伪 = new NextRequest(`https://crm.example.test/api/feishu/jsapi-sign?url=${encodeURIComponent(页)}`, {
        headers: { host: "crm.example.test", "x-forwarded-host": "crm.example.test" },
      });
      const res = await GET(伪);
      expect(res.status, 值).toBe(400);
      expect((await res.json()).error).toContain("未配置站点地址");
    }
    vi.stubEnv("ENT_PUBLIC_URL", undefined);
    expect((await GET(请求(页))).status).toBe(400);
    expect(飞书请求).not.toHaveBeenCalled();
  });

  it("别的页面、别的主机不签：400；以 ENT_PUBLIC_URL 为准，请求的 Host 不算", async () => {
    罐.用户 = { id: "u1" };
    expect((await GET(请求("https://crm.example.test/dashboard"))).status).toBe(400);
    expect((await GET(请求("https://evil.example/mic-test.html"))).status).toBe(400);
    // 伪造 Host 成 evil.example 也不行
    expect((await GET(请求("https://evil.example/mic-test.html", "evil.example"))).status).toBe(400);
    expect((await GET(请求(null))).status).toBe(400);
    vi.stubEnv("ENT_PUBLIC_URL", "https://119.0.0.1");
    // 请求主机对上了也不行：以 ENT_PUBLIC_URL 为准
    expect((await GET(请求(页))).status).toBe(400);
    expect((await GET(请求("http://119.0.0.1/mic-test.html"))).status).toBe(400);
    expect(飞书请求).not.toHaveBeenCalled();
    expect((await GET(请求("https://119.0.0.1/mic-test.html"))).status).toBe(200);
  });

  it("票每进程缓存，快过期（提前 5 分钟）就换新", async () => {
    罐.用户 = { id: "u1" };
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
    await GET(请求(页));
    await GET(请求(页));
    expect(飞书请求).toHaveBeenCalledTimes(1);
    // 7200 秒的票，6900 秒后还在用
    vi.setSystemTime(new Date(Date.parse("2026-11-21T12:00:00Z") + 6800 * 1000));
    await GET(请求(页));
    expect(飞书请求).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date(Date.parse("2026-11-21T12:00:00Z") + 6901 * 1000));
    飞书请求.mockResolvedValueOnce(票回("TICKET-2"));
    const j = await (await GET(请求(页))).json();
    expect(飞书请求).toHaveBeenCalledTimes(2);
    expect(j.signature).toBe(createHash("sha1").update(`jsapi_ticket=TICKET-2&noncestr=${j.nonceStr}&timestamp=${j.timestamp}&url=${页}`).digest("hex"));
  });

  it("飞书拿票失败：502，消息里只有状态和 code，不带凭据", async () => {
    罐.用户 = { id: "u1" };
    飞书请求.mockResolvedValueOnce(new Response(JSON.stringify({ code: 99991400, msg: "bad" }), { status: 200 }));
    const res = await GET(请求(页));
    expect(res.status).toBe(502);
    const j = await res.json();
    expect(j.error).toContain("99991400");
    expect(j.error).not.toContain("s-test");
  });
});

describe("可签地址 / 算签名", () => {
  it("只认 http(s)、和本站源同源、/mic-test.html；去掉 # 以后", () => {
    const 本站 = 站点源("https://a.test/");
    expect(本站).toBe("https://a.test");
    expect(可签地址("https://a.test/mic-test.html#x", 本站)).toBe("https://a.test/mic-test.html");
    expect(可签地址("https://A.test/mic-test.html", 本站)).toBe("https://A.test/mic-test.html");
    expect(可签地址("https://b.test/mic-test.html", 本站)).toBeNull();
    expect(可签地址("http://a.test/mic-test.html", 本站)).toBeNull();
    expect(可签地址("javascript:alert(1)//mic-test.html", 本站)).toBeNull();
    expect(可签地址("https://u:p@a.test/mic-test.html", 本站)).toBeNull();
    expect(可签地址("https://a.test/mic-test.html/../login", 本站)).toBeNull();
    expect(可签地址("https://a.test:8443/mic-test.html", 本站)).toBeNull();
    expect(可签地址("https://a.test:8443/mic-test.html", 站点源("https://a.test:8443"))).toBe("https://a.test:8443/mic-test.html");
  });

  it("没有本站源（ENT_PUBLIC_URL 没配 / 配错）一律不签", () => {
    for (const 值 of [undefined, null, "", "  ", "a.test", "ftp://a.test", "javascript:alert(1)"]) expect(站点源(值), String(值)).toBeNull();
    expect(可签地址("https://a.test/mic-test.html", null)).toBeNull();
  });

  it("固定样例：sha1(jsapi_ticket=&noncestr=&timestamp=&url=) 十六进制", () => {
    expect(算签名("T-fixed", "abc123", 1700000000000, "https://crm.example.test/mic-test.html?x=1")).toBe("3bcf1b8aeacc800921a2d4068243ff7dddf00b36");
  });
});
