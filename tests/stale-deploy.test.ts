/**
 * 发版后老页面（lib/stale-deploy.ts、lib/build-id.ts、/api/version）：
 *   1. 认得出 Next 16 客户端真抛的那个错（拿 Next 自己的 UnrecognizedActionError 类、照它的原话造），别的错不认
 *   2. 换话：老版本动作 → 「系统刚更新了，请刷新页面后再提交」，顺手发一声点亮横幅；别的照原话
 *   3. 版本比对：两边都是认得出的编号、不一样才算换了版本；空的、坏的、502 页都不算
 *   4. /api/version 只回 id、不缓存；开发模式固定 "dev"；生产按 deploymentId（构建清单）> NEXT_DEPLOYMENT_ID > BUILD_ID，读不到回 null
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UnrecognizedActionError, unstable_isUnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { 是旧版本动作错, 动作出错话, 出错原话, 刷新再提交话, 有新版本话, 版本变了, 旧版本事件 } from "@/lib/stale-deploy";

/** 照 next/dist/client/components/router-reducer/reducers/server-action-reducer.js 那一行原样造 */
const Next抛的 = () =>
  new UnrecognizedActionError('Server Action "7f3a9c0e1b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a12" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action');

describe("认老版本动作的错", () => {
  it("Next 客户端抛的 UnrecognizedActionError 认得出；名字是写死的字符串（压缩后还在）", () => {
    const e = Next抛的();
    expect(unstable_isUnrecognizedActionError(e)).toBe(true);
    expect(e.name).toBe("UnrecognizedActionError");
    expect(是旧版本动作错(e)).toBe(true);
  });

  it("被包过一层（只剩原话）、服务端那句透传过来也认", () => {
    expect(是旧版本动作错(new Error(Next抛的().message))).toBe(true);
    expect(是旧版本动作错(new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.'))).toBe(true);
  });

  it("别的错不认：断网、普通报错、空的、字符串", () => {
    for (const e of [new TypeError("Failed to fetch"), new Error("没权限"), null, undefined, "Server Action", { name: "X" }]) expect(是旧版本动作错(e)).toBe(false);
  });
});

describe("换话", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("老版本动作 → 刷新再提交，并发一声点亮横幅；别的照原来那句", () => {
    const 听到: string[] = [];
    vi.stubGlobal("window", { dispatchEvent: (e: Event) => 听到.push(e.type) });
    expect(动作出错话(Next抛的(), "没改成，请稍后再试")).toBe(刷新再提交话);
    expect(听到).toEqual([旧版本事件]);
    expect(动作出错话(new Error("boom"), "没改成，请稍后再试")).toBe("没改成，请稍后再试");
    expect(听到).toHaveLength(1);
  });

  it("出错原话：老版本动作不把英文给人看；别的错照旧给 message", () => {
    vi.stubGlobal("window", { dispatchEvent: () => true });
    expect(出错原话(Next抛的(), "解析失败")).toBe(刷新再提交话);
    expect(出错原话(new Error("额度用完了"), "解析失败")).toBe("额度用完了");
    expect(出错原话("x", "解析失败")).toBe("解析失败");
  });

  it("服务端（没有 window）调到也不炸", () => {
    expect(动作出错话(Next抛的(), "x")).toBe(刷新再提交话);
  });

  it("给人看的话都是中文、短", () => {
    for (const 话 of [刷新再提交话, 有新版本话]) {
      expect(话).not.toMatch(/[A-Za-z]/);
      expect(话.length).toBeLessThanOrEqual(30);
    }
  });
});

describe("版本变了", () => {
  it("两边都是编号、不一样才算", () => {
    expect(版本变了("a1", { id: "b2" })).toBe(true);
    expect(版本变了("a1", { id: "a1" })).toBe(false);
  });
  it("载入时没有编号、回来的不像样（null、空串、不是对象、没有 id、502 错页解析出来的东西）都不算", () => {
    expect(版本变了(null, { id: "b2" })).toBe(false);
    expect(版本变了("", { id: "b2" })).toBe(false);
    for (const x of [null, undefined, "b2", {}, { id: null }, { id: "" }, { id: 3 }, []]) expect(版本变了("a1", x)).toBe(false);
  });
});

describe("/api/version 与构建号", () => {
  const 原目录 = process.cwd();
  afterEach(async () => {
    process.chdir(原目录);
    vi.unstubAllEnvs();
    (await import("@/lib/build-id")).重读构建号();
  });

  it("开发 / 测试里固定 dev（dev 重启不算发版）；只回 id、不缓存", async () => {
    const { GET } = await import("@/app/api/version/route");
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ id: "dev" });
  });

  it("生产读 <distDir>/BUILD_ID（进程里只读一次）；读不到、内容不像样回 null", async () => {
    const { 本次构建号, 重读构建号 } = await import("@/lib/build-id");
    const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-build-id-"));
    fs.mkdirSync(path.join(目录, ".next"));
    fs.writeFileSync(path.join(目录, ".next", "BUILD_ID"), "Abc_123-x\n");
    process.chdir(目录);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_DIST_DIR", "");
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "");
    重读构建号();
    expect(本次构建号()).toBe("Abc_123-x");
    // 文件换了（下一次发版），这个进程跑的还是老代码：照旧报老编号
    fs.writeFileSync(path.join(目录, ".next", "BUILD_ID"), "new");
    expect(本次构建号()).toBe("Abc_123-x");
    fs.writeFileSync(path.join(目录, ".next", "BUILD_ID"), "<html>坏的</html>");
    重读构建号();
    expect(本次构建号()).toBeNull();
    fs.rmSync(path.join(目录, ".next", "BUILD_ID"));
    重读构建号();
    expect(本次构建号()).toBeNull();
  });

  it("编号先后：构建清单里的 deploymentId > 环境变量 NEXT_DEPLOYMENT_ID > BUILD_ID（配了 deploymentId 时 BUILD_ID 每次都一样）", async () => {
    const { 本次构建号, 重读构建号 } = await import("@/lib/build-id");
    const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-build-id-"));
    const 写 = (名: string, 内容: string) => fs.writeFileSync(path.join(目录, ".next", 名), 内容);
    const 清单 = (deploymentId: unknown) => 写("required-server-files.json", JSON.stringify({ version: 1, config: { deploymentId }, files: [] }));
    const 读 = () => { 重读构建号(); return 本次构建号(); };
    fs.mkdirSync(path.join(目录, ".next"));
    process.chdir(目录);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_DIST_DIR", "");
    // Next 16.4 配了 deploymentId 时写死的那串
    写("BUILD_ID", "build-TfctsWXpff2fKS");
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "env-dpl-1");
    清单("a1b2c3d4e5f6");
    expect(读()).toBe("a1b2c3d4e5f6");
    // 进程里只读一次：清单换了照旧报老的
    清单("ffff0000");
    expect(本次构建号()).toBe("a1b2c3d4e5f6");
    // 清单里是空串（没配 deploymentId）、没这个键、清单坏了、没有清单：都退到环境变量
    for (const 换 of [() => 清单(""), () => 清单(undefined), () => 写("required-server-files.json", "{坏的"), () => fs.rmSync(path.join(目录, ".next", "required-server-files.json"))]) {
      换();
      expect(读()).toBe("env-dpl-1");
    }
    // 环境变量也没有：退到 BUILD_ID
    vi.stubEnv("NEXT_DEPLOYMENT_ID", "");
    expect(读()).toBe("build-TfctsWXpff2fKS");
    // 清单里的 deploymentId 不像编号：不往下乱找，回 null（横幅不问）
    清单("<html>");
    expect(读()).toBeNull();
    // 开发模式照旧 dev，不读文件
    vi.stubEnv("NODE_ENV", "development");
    清单("a1b2c3d4e5f6");
    expect(读()).toBe("dev");
  });
});
