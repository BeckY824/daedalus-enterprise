import { describe, it, expect } from "vitest";
import http from "node:http";
import dc from "node:diagnostics_channel";
import { 该跳过, 请求种类, 读路由表, 纯路径, 路由模式, 阈值, 盯一个请求, 日志前缀, 用户头, 开请求日志 } from "@/lib/request-log";

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

/** 模拟 proxy.ts：验过票（这里用测试头 x-test-sub 代替）才把用户 id 写进 req.headers，同 Next resolve-routes 改的那个对象 */
const 像proxy = (q: http.IncomingMessage) => {
  const sub = q.headers["x-test-sub"];
  if (typeof sub === "string") q.headers[用户头] = sub;
};

describe("慢请求日志：真 http.Server 上记一行", () => {
  it("记路由模式、种类、状态、字节、用户 id；不记查询串和搜索词", async () => {
    const 行 = await 跑(
      (q, r) => {
        像proxy(q);
        r.end("x".repeat(3000));
      },
      [
        { path: "/customers?keyword=%E6%90%9C%E7%B4%A2%E8%AF%8D", headers: { "x-test-sub": "u1" } },
        { path: "/customers/c123?_rsc=abc", headers: { rsc: "1", "next-router-prefetch": "1", "x-test-sub": "u2" } },
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

  it("客户端自带的用户头不认：没经过 proxy 的 200 / 404、proxy 当场跳转的 307 都不带 uid", async () => {
    const 伪 = { [用户头]: "forged" };
    const 行 = await 跑(
      (q, r) => {
        // 不调 像proxy：matcher 外的路径（/apix、/api-docs）、proxy 抛错、proxy 自己回的跳转都是这样
        expect(q.headers[用户头]).toBeUndefined();
        if (q.url === "/apix") r.statusCode = 404;
        if (q.url === "/customers") {
          r.statusCode = 307;
          r.setHeader("location", "/login");
        }
        r.end("x");
      },
      [
        { path: "/apix", headers: 伪 },
        { path: "/api-docs", headers: 伪 },
        { path: "/customers", headers: 伪 },
      ],
    );
    expect(行.map((x) => x.status)).toEqual([404, 200, 307]);
    for (const x of 行) expect(x.uid).toBeUndefined();
    expect(JSON.stringify(行)).not.toContain("forged");
  });

  it("页面自己 redirect()（经过了 proxy）的 3xx 照记 uid", async () => {
    const 行 = await 跑((q, r) => {
      像proxy(q);
      r.statusCode = 307;
      r.setHeader("location", "/dashboard");
      r.end();
    }, [{ path: "/customers", headers: { "x-test-sub": "u3", [用户头]: "forged" } }]);
    expect(行[0]).toMatchObject({ status: 307, uid: "u3" });
  });

  it("没到阈值的不记", async () => {
    expect(await 跑((_q, r) => r.end("ok"), [{ path: "/customers" }], 10_000)).toEqual([]);
  });

  it("写日志出错不抛到 close 外面（那会是进程级未捕获异常）", async () => {
    const 行们: string[] = [];
    const 订 = (msg: unknown) =>
      盯一个请求(msg as Parameters<typeof 盯一个请求>[0], 表, 0, () => {
        行们.push("x");
        throw new Error("写坏了");
      });
    const 未捕获: unknown[] = [];
    const 接 = (e: unknown) => 未捕获.push(e);
    process.on("uncaughtException", 接);
    dc.subscribe("http.server.request.start", 订);
    const s = http.createServer((_q, r) => r.end("ok"));
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (s.address() as { port: number }).port;
      await fetch(`http://127.0.0.1:${port}/customers`).then((r) => r.text());
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      dc.unsubscribe("http.server.request.start", 订);
      process.off("uncaughtException", 接);
      await new Promise((r) => s.close(r));
    }
    expect(行们).toEqual(["x"]);
    expect(未捕获).toEqual([]);
  });

  it("客户端中途断开：abort=1", async () => {
    const 行们: string[] = [];
    const 订 = (msg: unknown) => 盯一个请求(msg as Parameters<typeof 盯一个请求>[0], 表, 0, (l) => 行们.push(l));
    dc.subscribe("http.server.request.start", 订);
    // 先写一块、迟迟不 end：客户端收到第一块就断开
    const s = http.createServer((_q, r) => {
      r.write("x".repeat(100));
    });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    try {
      const port = (s.address() as { port: number }).port;
      await new Promise<void>((done) => {
        const req = http.get({ host: "127.0.0.1", port, path: "/customers" }, (res) => {
          res.once("data", () => {
            req.destroy();
            done();
          });
        });
        req.on("error", () => {});
      });
      await expect.poll(() => 行们.length).toBe(1);
    } finally {
      dc.unsubscribe("http.server.request.start", 订);
      s.closeAllConnections();
      await new Promise((r) => s.close(r));
    }
    expect(JSON.parse(行们[0].slice(日志前缀.length + 1))).toMatchObject({ route: "/customers", abort: 1 });
  });
});

describe("慢请求日志：开关", () => {
  it("CRM_REQ_LOG 不是 1 时不订阅", async () => {
    const 道 = dc.channel("http.server.request.start");
    const 前 = 道.hasSubscribers;
    for (const v of [undefined, "", "0", "true"]) expect(await 开请求日志({ CRM_REQ_LOG: v })).toBe(false);
    expect(道.hasSubscribers).toBe(前);
  });
});
