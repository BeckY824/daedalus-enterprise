/**
 * proxy 命中的请求，Next 先把请求体缓冲一份、默认最多 10MB，超出部分静默截断（node_modules/next/dist/server/body-streams.js）。
 * 切换视图那批把 /api 也放进了 matcher：附件 20MB、企业导入 200MB 的上传在 10MB 以上就坏了（显示成功、存下来是半截）。
 * 钉住：/api 只在带切换视图票时才进 proxy；上限不调大、等于 Next 默认；带了失效旧票、体又超上限的写在 proxy 里直接拒并删票。
 * 视图期间 /api 写一律被拒的那几条在 tests/ent-view-as-scan.test.ts（proxy 那一道）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { config, proxy } from "../src/proxy";
import nextConfig from "../next.config";
import { proxy缓冲上限, 视图票名 } from "@/lib/enterprise/view-as-gate";
import { 视图票 } from "@/lib/enterprise/view-as";
import { 附件上限字节 } from "@/lib/attachment-rules";

afterEach(() => vi.unstubAllEnvs());

type 条目 = string | { source: string; has?: { type: string; key: string }[] };
const 条目们 = config.matcher as readonly 条目[];

describe("proxy matcher 与请求体缓冲", () => {
  it("页面那条排除 /api；/api 那条只在带切换视图票（cookie 名 = 代码常量）时命中", () => {
    const 页面 = 条目们.filter((x): x is string => typeof x === "string");
    expect(页面).toHaveLength(1);
    expect(页面[0].startsWith("/((?!api|")).toBe(true);
    const api = 条目们.filter((x) => typeof x === "object" && x.source.startsWith("/api"));
    expect(api).toEqual([{ source: "/api/:path*", has: [{ type: "cookie", key: 视图票名 }] }]);
    // 两处常量是同一个名字（view-as.ts 签票 / view-as-gate.ts 认票）
    expect(视图票名).toBe(视图票);
  });

  it("缓冲上限不调大：next.config 不配 proxyClientMaxBodySize，等于 Next 默认 10MB；各上传接口的上限都比它大，所以平时的 /api 不能经 proxy", async () => {
    expect((nextConfig.experimental as Record<string, unknown> | undefined)?.proxyClientMaxBodySize).toBeUndefined();
    const { defaultConfig } = await import("next/dist/server/config-shared");
    expect(defaultConfig.experimental?.proxyClientMaxBodySize).toBe(proxy缓冲上限);
    expect(附件上限字节).toBeGreaterThan(proxy缓冲上限);
    // 企业导入一次上限（src/app/api/enterprise-import/upload/route.ts 一次上限字节）
    const 导入 = (await import("node:fs")).readFileSync("src/app/api/enterprise-import/upload/route.ts", "utf8").match(/const 一次上限字节 = (\d+) \* 1024 \* 1024/);
    expect(Number(导入?.[1]) * 1024 * 1024).toBeGreaterThan(proxy缓冲上限);
  });

  it("带着失效旧票（开关关着）进来、写请求体超上限：413 并删票，不把截断的体放进路由；没超照常放行；GET 不管", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    vi.stubEnv("CRM_ENT_VIEW_AS", "0");
    const 请求 = (method: string, 长: number | null) => new NextRequest("http://crm.example.test/api/attachments", {
      method,
      headers: { cookie: `${视图票名}=stale-ticket; crm_session=x`, ...(长 == null ? {} : { "content-length": String(长) }) },
    });
    const 大 = await proxy(请求("POST", 15 * 1024 * 1024));
    expect(大.status).toBe(413);
    expect(大.headers.get("set-cookie") ?? "").toMatch(new RegExp(`${视图票名}=;`));
    const 小 = await proxy(请求("POST", 1024));
    expect(小.headers.get("x-middleware-next")).toBe("1");
    const 读 = await proxy(请求("GET", null));
    expect(读.headers.get("x-middleware-next")).toBe("1");
  });
});
