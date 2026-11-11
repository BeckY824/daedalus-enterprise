/**
 * 「测试连接」不会把服务端的 Key 送到任意地址，以及设置页几条容易被改坏的约定。
 *
 * 文件名沿用网页共享工作区那时的叫法：原来这里还钉着「共享工作区不给过 requireAdmin」，
 * 企业版没有共享区，那几条随 lib/shared-ws/current.ts 一起去掉了。
 * Key 只肯发给环境里配的那个地址这一道与共享区无关，照旧留着。
 */
import { describe, it, expect, afterEach } from "vitest";

const 原始 = { ...process.env };
afterEach(() => {
  process.env.LLM_API_KEY = 原始.LLM_API_KEY;
  process.env.LLM_BASE_URL = 原始.LLM_BASE_URL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
});

describe("「测试连接」不把环境里的 Key 送到别处", () => {
  it("地址和环境里配的不一样时，当作没有 Key", async () => {
    const { resolveLlmConfigForTest } = await import("@/lib/llm");
    process.env.LLM_API_KEY = "平台共用的那把";
    process.env.LLM_BASE_URL = "https://relay.example.com/v1";

    const 别处 = await resolveLlmConfigForTest({ baseUrl: "https://evil.example.net/v1", model: "x" });
    expect(别处, "环境里那把 Key 不该发到调用方自己填的地址").toBeNull();

    const 本处 = await resolveLlmConfigForTest({ baseUrl: "https://relay.example.com/v1", model: "x" });
    expect(本处?.apiKey).toBe("平台共用的那把");
  });

  it("末尾的斜杠不算另一个地址", async () => {
    const { resolveLlmConfigForTest } = await import("@/lib/llm");
    process.env.LLM_API_KEY = "k";
    process.env.LLM_BASE_URL = "https://relay.example.com/v1";
    expect((await resolveLlmConfigForTest({ baseUrl: "https://relay.example.com/v1/", model: "x" }))?.apiKey).toBe("k");
  });

  it("自己填了 Key 的，想发哪儿发哪儿——那是他自己的 Key", async () => {
    const { resolveLlmConfigForTest } = await import("@/lib/llm");
    process.env.LLM_API_KEY = "平台共用的那把";
    process.env.LLM_BASE_URL = "https://relay.example.com/v1";
    const cfg = await resolveLlmConfigForTest({ baseUrl: "https://my-own.example.net/v1", model: "x", apiKey: "我自己的" });
    expect(cfg?.apiKey).toBe("我自己的");
  });
});

describe("两条容易被下一个人改坏的约定", () => {
  it("「已登录的机器」只在托管版有：列表和退出都过 我的控制面账号 这一道", async () => {
    /**
     * 我的控制面账号 在自部署版直接回 null，界面上那一栏整个不出现（机器 && …）：
     * 那边桌面端不连控制面，压根没有设备令牌。
     */
    const fs = await import("node:fs");
    const path = await import("node:path");
    const 动作 = fs.readFileSync(path.resolve(__dirname, "../src/app/(app)/settings/actions.ts"), "utf8");
    const i = 动作.indexOf("async function 我的控制面账号");
    expect(i, "找不到 我的控制面账号").toBeGreaterThan(0);
    const 段 = 动作.slice(i, 动作.indexOf("\n}", i));
    expect(段).toContain("托管版()");
    expect(段).toContain("return null");
    // 列表和「退出」两条路都要过这道闸，只挡住一条等于没挡
    for (const 名 of ["我的机器", "退出这台机器"]) {
      const j = 动作.indexOf(`export async function ${名}`);
      expect(j, `找不到 ${名}`).toBeGreaterThan(0);
      expect(动作.slice(j, 动作.indexOf("\n}", j)), `${名} 没过 我的控制面账号`).toContain("我的控制面账号(me.id)");
    }

    const 界面 = fs.readFileSync(path.resolve(__dirname, "../src/app/(app)/settings/PasswordTab.tsx"), "utf8");
    expect(界面).toContain("已登录的机器");
    // null 就整栏不画：自部署版拿到的是 null
    expect(界面).toMatch(/\{机器 && \(/);
  });

  it("改密码那一屏要写清「所有机器都要重新登录」", async () => {
    /**
     * 改密码会把这个账号的桌面端全部踢下线（members.ts 的 改密码）。
     * /forgot 和桌面端那块面板都写了这句，设置页这一屏最早漏了——
     * 而它正是自己改密码最常走的那条路。
     */
    const fs = await import("node:fs");
    const path = await import("node:path");
    const 段 = fs.readFileSync(path.resolve(__dirname, "../src/app/(app)/settings/PasswordTab.tsx"), "utf8");
    expect(段).toMatch(/所有地方都要重新登录|所有.{0,4}机器.{0,8}重新登录/);
    expect(段, "还要指一条只退一台的路，否则人只能拿改密码当锤子").toContain("已登录的机器");
  });

  it("AI 配置的操作日志不带 detail", async () => {
    /**
     * 操作日志那一栏**不在 isAdmin 判断之内**——普通销售也看得到。
     * 而 recordAudit 的 detail 是个自由字段：哪天有人照着「业务配置」那条
     * （它传了完整的 before/after）给 AI 配置也加一个 detail，
     * 明文 Key 就会落进一张全员可读的表里。这条把现状钉住。
     */
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../src/app/(app)/settings/actions.ts"), "utf8");
    for (const 名 of ["saveLlmSettings", "clearLlmSettings"]) {
      const i = src.indexOf(`export async function ${名}`);
      expect(i, `找不到 ${名}`).toBeGreaterThan(0);
      const 段 = src.slice(i, src.indexOf("\n}", i));
      expect(段.includes("recordAudit"), `${名} 应当记一条日志`).toBe(true);
      expect(段.includes("detail:"), `${名} 的日志不能带 detail——那张表全员可读`).toBe(false);
    }
  });
});
