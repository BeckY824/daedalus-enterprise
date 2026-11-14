import { describe, it, expect } from "vitest";
import http from "node:http";
import dc from "node:diagnostics_channel";
import { 该跳过, 请求种类, 读路由表, 纯路径, 路由模式, 阈值, 盯一个请求, 日志前缀, 用户头 } from "@/lib/request-log";

/** routes-manifest.json 的形状（只留用到的字段） */
const 表 = 读路由表({
  staticRoutes: [{ page: "/customers", regex: "^/customers(?:/)?$" }, { page: "/customers/recent", regex: "^/customers/recent(?:/)?$" }, { page: "/", regex: "^/(?:/)?$" }],
  dynamicRoutes: [
    { page: "/customers/[id]", regex: "^/customers/([^/]+?)(?:/)?$" },
    { page: "/projects/[id]", regex: "^/projects/([^/]+?)(?:/)?$" },
  ],
});

describe("慢请求日志：归一和分类", () => {
  it("路由模式不带 id、不带查询串；对不上的不露路径", () => {
    expect(路由模式(纯路径("/customers/cmabc123xyz?do=followup"), 表)).toBe("/customers/[id]");
    expect(路由模式(纯路径("/customers?keyword=%E5%BC%A0%E4%B8%89&page=3"), 表)).toBe("/customers");
    expect(路由模式(纯路径("/customers/recent"), 表)).toBe("/customers/recent");
    expect(路由模式(纯路径("/projects/p1/"), 表)).toBe("/projects/[id]");
    expect(路由模式(纯路径("/no/such/13800138000"), 表)).toBe("(unmatched)");
    expect(路由模式(纯路径("/"), 表)).toBe("/");
  });

  it("没有路由表时粗归一：像 id 的段换掉", () => {
    expect(路由模式("/customers/cm9x8y7z6w5v4u3t2s1r0q", null)).toBe("/customers/[x]");
    expect(路由模式("/follow-ups/plans", null)).toBe("/follow-ups/plans");
  });

  it("去掉 Next 的 .rsc / .segments 后缀", () => {
    expect(纯路径("/customers/abc.rsc?_rsc=1")).toBe("/customers/abc");
    expect(纯路径("/customers/abc.segments/_tree.segment.rsc")).toBe("/customers/abc");
  });

  it("静态资源、接口、Next 文件不记", () => {
    for (const p of ["/_next/static/chunks/a.js", "/api/attachments/1", "/api", "/favicon.ico", "/ocr/v1/x", "/geo/world.json", "/icon.svg"]) expect(该跳过(p)).toBe(true);
    for (const p of ["/customers", "/customers/abc", "/"]) expect(该跳过(p)).toBe(false);
  });

  it("种类：action 头 > rsc 头 > HTML", () => {
    expect(请求种类({ "next-action": "abc", rsc: "1" })).toBe("ACTION");
    expect(请求种类({ rsc: "1" })).toBe("RSC");
    expect(请求种类({})).toBe("HTML");
  });

  it("阈值默认 200，0 全记，乱写回默认", () => {
    expect(阈值({})).toBe(200);
    expect(阈值({ CRM_REQ_LOG_MS: "0" })).toBe(0);
    expect(阈值({ CRM_REQ_LOG_MS: "abc" })).toBe(200);
  });
});

/** 起一个真 http.Server，订 diagnostics_channel，和 instrumentation 里一样 */
async function 跑(处理: http.RequestListener, 请求们: { path: string; headers?: Record<string, string> }[], 门槛 = 0) {
  const 行们: string[] = [];
  const 订 = (msg: unknown) => 盯一个请求(msg as Parameters<typeof 盯一个请求>[0], 表, 门槛, (l) => 行们.push(l));
  dc.subscribe("http.server.request.start", 订);
  const s = http.createServer(处理);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as { port: number }).port;
  const agent = new http.Agent({ keepAlive: true });
  try {
    for (const q of 请求们) {
      await new Promise<void>((r, j) => {
        const req = http.get({ host: "127.0.0.1", port, path: q.path, headers: q.headers, agent }, (res) => {
          res.resume();
          res.on("end", () => r());
        });
        req.on("error", j);
      });
    }
    // close 事件在响应写完后的下一拍
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    agent.destroy();
    await new Promise((r) => s.close(r));
    dc.unsubscribe("http.server.request.start", 订);
  }
  return 行们.map((l) => {
    expect(l.startsWith(日志前缀 + " ")).toBe(true);
    return JSON.parse(l.slice(日志前缀.length + 1));
  });
}

describe("慢请求日志：真 http.Server 上记一行", () => {
  it("记路由模式、种类、状态、字节、用户 id；不记查询串和搜索词", async () => {
    const 行 = await 跑(
      (_q, r) => r.end("x".repeat(3000)),
      [
        { path: "/customers?keyword=%E6%90%9C%E7%B4%A2%E8%AF%8D", headers: { [用户头]: "u1" } },
        { path: "/customers/c123?_rsc=abc", headers: { rsc: "1", "next-router-prefetch": "1", [用户头]: "u2" } },
        { path: "/_next/static/a.js" },
      ],
    );
    expect(行).toHaveLength(2);
    expect(行[0]).toMatchObject({ route: "/customers", kind: "HTML", status: 200, uid: "u1" });
    expect(行[0].pf).toBeUndefined();
    // keep-alive 同一条连接：第二个请求的字节按差算，不把第一个的算进来
    expect(行[0].bytes).toBeGreaterThan(3000);
    expect(行[1].bytes).toBeGreaterThan(3000);
    expect(行[1].bytes).toBeLessThan(6000);
    expect(行[1]).toMatchObject({ route: "/customers/[id]", kind: "RSC", pf: 1, uid: "u2" });
    expect(typeof 行[0].ms).toBe("number");
    expect(new Date(行[0].t).getTime()).not.toBeNaN();
    const 全文 = JSON.stringify(行);
    expect(全文).not.toContain("keyword");
    expect(全文).not.toContain("c123");
  });

  it("没到阈值的不记；3xx 不带用户 id", async () => {
    const 快 = await 跑((_q, r) => r.end("ok"), [{ path: "/customers" }], 10_000);
    expect(快).toEqual([]);
    const 跳 = await 跑((_q, r) => {
      r.statusCode = 307;
      r.setHeader("location", "/login");
      r.end();
    }, [{ path: "/customers", headers: { [用户头]: "forged" } }]);
    expect(跳[0].status).toBe(307);
    expect(跳[0].uid).toBeUndefined();
  });
});
