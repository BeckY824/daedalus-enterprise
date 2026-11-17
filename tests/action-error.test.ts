/**
 * 服务器动作报错的全局兜底（批次 25C，复盘第 1 类）：
 *   - 浏览器里没人接住的动作报错（unhandledrejection）：认得出的（老版本、断网、超时、服务端出错）换成一句中文，不露英文
 *   - 各处 catch / AI 卡：英文原文不给人看，换成中文；原文进日志（console.error）
 *   - 服务端：instrumentation.ts 的 onRequestError 把动作报错记一行日志（路由、动作编号、digest、原文），不记 cookie
 *   - 错误页：撞上老版本动作说「系统刚更新了」，不是「这一页没能打开」
 * 纯函数（lib/action-error.ts），横幅那一头在 components/UpdateBanner.tsx
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { 认动作错, 给人看的错, 全局兜底话, 动作出错日志行, 网络断了话, 超时话 } from "@/lib/action-error";
import { 刷新再提交话, 出错原话 } from "@/lib/stale-deploy";
import { 决定错误展示 } from "@/lib/error-display";

const 老版本 = () => new UnrecognizedActionError('Server Action "7f00aa" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action');
const 服务端错 = () => Object.assign(new Error("An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance which may provide additional details about the nature of the error."), { digest: "1234567890" });
const 断网 = () => new TypeError("Failed to fetch");

afterEach(() => vi.restoreAllMocks());

describe("认动作错", () => {
  it("老版本、断网（Chrome / Firefox / Safari 三种说法）、超时、服务端出错（带 digest / 生产那句 / 回来的不是动作响应）都认得出", () => {
    expect(认动作错(老版本())).toBe("旧版本");
    expect(认动作错(断网())).toBe("网络");
    expect(认动作错(new TypeError("NetworkError when attempting to fetch resource."))).toBe("网络");
    expect(认动作错(new TypeError("Load failed"))).toBe("网络");
    expect(认动作错(Object.assign(new Error("signal timed out"), { name: "TimeoutError" }))).toBe("超时");
    expect(认动作错(服务端错())).toBe("服务端");
    expect(认动作错(new Error("An unexpected response was received from the server."))).toBe("服务端");
    expect(认动作错(new Error("Connection closed."))).toBe("服务端");
  });

  it("别的不认：人自己取消的、普通报错、跳转信号、空的、字符串", () => {
    expect(认动作错(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBeNull();
    expect(认动作错(new Error("x is not a function"))).toBeNull();
    expect(认动作错(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }))).toBeNull();
    expect(认动作错(null)).toBeNull();
    expect(认动作错("出错了")).toBeNull();
  });
});

describe("给人看的错（catch 里、AI 卡上）", () => {
  it("英文原文不给人看：服务端出错给原来那句、断网 / 超时各一句；原文进日志", () => {
    const 记 = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(给人看的错(服务端错(), "没写进去，可以再点一次")).toBe("没写进去，可以再点一次");
    expect(给人看的错(断网(), "没写进去")).toBe(网络断了话);
    expect(给人看的错(Object.assign(new Error("timeout"), { name: "TimeoutError" }), "没写进去")).toBe(超时话);
    expect(给人看的错(new Error("Cannot read properties of undefined (reading 'id')"), "没写进去")).toBe("没写进去");
    expect(给人看的错("fetch failed", "AI 没答上来")).toBe("AI 没答上来");
    expect(记).toHaveBeenCalledTimes(5);
    expect(String(记.mock.calls.at(-1))).toContain("fetch failed");
  });

  it("自己写的中文照原样给，不进日志；老版本动作说刷新", () => {
    const 记 = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(给人看的错("卡上的渠道对不上启用中的渠道", "没写进去")).toBe("卡上的渠道对不上启用中的渠道");
    expect(给人看的错(new Error("额度用完了"), "没写进去")).toBe("额度用完了");
    expect(记).not.toHaveBeenCalled();
    expect(给人看的错(老版本(), "没写进去")).toBe(刷新再提交话);
  });

  it("中文里夹着英文报错（AI 上游原文）也换掉", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(给人看的错("接口返回 500：Internal Server Error", "AI 没答上来")).toBe("AI 没答上来");
  });

  it("出错原话（45 处 catch 在用）也不再把英文 message 给人看", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(出错原话(服务端错(), "解析失败")).toBe("解析失败");
    expect(出错原话(new Error("额度用完了"), "解析失败")).toBe("额度用完了");
  });
});

describe("全局兜底话（没人接住的动作报错）", () => {
  it("认得出的给一句中文，服务端出错带编号好查日志；认不出的不管（null）", () => {
    expect(全局兜底话(老版本())).toBe(刷新再提交话);
    expect(全局兜底话(断网())).toBe(网络断了话);
    const 话 = 全局兜底话(服务端错())!;
    expect(话).toMatch(/没成功/);
    expect(话).toContain("1234567890");
    expect(话).not.toMatch(/[A-Za-z]{4,}/);
    expect(全局兜底话(new Error("x is not a function"))).toBeNull();
    expect(全局兜底话(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBeNull();
  });

  it("给人看的话都是中文、一句", () => {
    for (const s of [网络断了话, 超时话, 全局兜底话(服务端错())!]) {
      expect(s).toMatch(/[一-龥]/);
      expect(s.length).toBeLessThan(60);
    }
  });
});

describe("服务端日志（instrumentation onRequestError）", () => {
  const 请求 = { path: "/projects/p1", method: "POST", headers: { "next-action": "7f00aa11", cookie: "crm_session=秘密" } };
  it("只记动作：路由、动作编号、digest、原文；不带 cookie", () => {
    const e = Object.assign(new Error("Unique constraint failed on the fields: (`phone`)"), { digest: "998877" });
    const 行 = 动作出错日志行(e, 请求, { routeType: "action", routePath: "/projects/[id]" })!;
    expect(行).toContain("[动作出错]");
    expect(行).toContain("/projects/[id]");
    expect(行).toContain("7f00aa11");
    expect(行).toContain("998877");
    expect(行).toContain("Unique constraint failed");
    expect(行).not.toContain("秘密");
    expect(动作出错日志行(e, 请求, { routeType: "render", routePath: "/projects/[id]" })).toBeNull();
  });

  it("跳转 / 找不到这类控制流不当报错记", () => {
    const e = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/login;307;" });
    expect(动作出错日志行(e, 请求, { routeType: "action", routePath: "/x" })).toBeNull();
  });

  it("instrumentation.ts 导出 onRequestError，动作报错打一行 console.error", async () => {
    const 记 = vi.spyOn(console, "error").mockImplementation(() => {});
    const m = await import("@/instrumentation");
    expect(typeof m.onRequestError).toBe("function");
    await m.onRequestError(new Error("boom"), 请求, { routerKind: "App Router", routePath: "/x", routeType: "action", revalidateReason: undefined });
    expect(String(记.mock.calls[0]?.[0])).toContain("[动作出错]");
  });
});

describe("错误页", () => {
  it("撞上老版本动作：说系统刚更新、请刷新，不是「这一页没能打开」", () => {
    expect(决定错误展示({ message: 'Server Action "7f" was not found on the server.' }, false).类型).toBe("旧版本");
    expect(决定错误展示(老版本(), true).类型).toBe("旧版本");
  });
});
