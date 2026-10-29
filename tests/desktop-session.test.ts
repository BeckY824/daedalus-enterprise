/**
 * 桌面端本地模式下「哪儿都不给进」的那几道闸（lib/desktop/cloud.ts 的 归属对不上、应用壳 layout.tsx）。
 *
 * 企业版不带桌面端的自动登录路由和云端账号登录门（2026-10-29 删死代码第三批 C），
 * 这里只钉还留在仓库里的判断：归属和令牌对不上时失败即关，非本地模式一律不管。
 */
import { describe, it, expect, afterEach, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

afterEach(() => {
  delete process.env.DESKTOP_LOCAL;
  delete process.env.DESKTOP_TOKEN;
});

describe("应用壳：本地模式下令牌没了就不给进", () => {
  it("哪怕业务会话还活着，也先去清 cookie；原因原样带到登录页", () => {
    const layout = fs.readFileSync(path.resolve(__dirname, "../src/app/(app)/layout.tsx"), "utf8");
    expect(layout).toContain('if (本地模式() && !读云端凭据()) redirect("/api/auth/logout?reason=revoked");');
    const logout = fs.readFileSync(path.resolve(__dirname, "../src/app/api/auth/logout/route.ts"), "utf8");
    // 原因原样带到登录页（相对地址，见第六轮 r6-pkg B2）
    expect(logout).toContain("/login?reason=${encodeURIComponent(reason)}");
  });

  it("壳里「退出登录」一直在", () => {
    const shell = fs.readFileSync(path.resolve(__dirname, "../src/components/AppShell.tsx"), "utf8");
    expect(shell).toContain('label: "退出登录"');
    expect(shell).not.toMatch(/本机\s*\?\s*\[\]/);
  });
});

/**
 * 换了账号登录，但数据目录还是上一个账号那份。
 *
 * 2026-09-20 用户报的：在桌面端换了一个云端账号登录，进去看到的还是上一个账号的
 * 客户、跟进和 AI 对话。目录**分是分开的**（desktop/accounts.js，在桌面端仓库里钉），
 * 坏的是那道接缝——换目录这件事当时全指望登录页喊一声 `shell:switch-account`：
 *
 *   桥不在（浏览器里打开的、桥没挂上）→ 那一声没人接
 *   → 登录页退回硬跳转 /dashboard
 *   → proxy.ts 见没有会话把人弹回 /login
 *   → /login 见 .cloud.json 还在（新账号的令牌已经写进**旧目录**了）就自动登录
 *   → 会话签给旧库里那个管理员 → 乙进了甲的库，一声不响
 *
 * 所以这里钉的是**失败即关**：归属和令牌对不上时，哪条路都不给进。
 * 让它真的换过去是壳那边的事（desktop/main.js 的 盯住凭据 / 看凭据换没换，
 * 在桌面端仓库里钉）。
 */
describe("换了账号但目录还没换：哪儿都不给进", () => {
  const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-switch-"));
  const 令牌文件 = path.join(目录, ".cloud.json");
  const 归属文件 = path.join(目录, ".owner");
  afterAll(() => fs.rmSync(目录, { recursive: true, force: true }));

  /** 写一份令牌。accountId 是「手上这枚令牌属于谁」 */
  const 写令牌 = (accountId?: string) =>
    fs.writeFileSync(令牌文件, JSON.stringify({ baseUrl: "http://127.0.0.1:9", token: "dk_x", accountId, name: "", contact: "b@b.c", models: [] }));

  beforeEach(() => {
    process.env.DESKTOP_LOCAL = "1";
    process.env.DESKTOP_TOKEN = "desktop-token-for-tests";
    process.env.CRM_DATA_DIR = 目录;
    fs.rmSync(令牌文件, { force: true });
    fs.rmSync(归属文件, { force: true });
  });
  afterEach(() => delete process.env.CRM_DATA_DIR);

  it("归属是甲、令牌是乙 → 对不上", async () => {
    fs.writeFileSync(归属文件, "acc_甲");
    写令牌("acc_乙");
    const { 归属对不上 } = await import("@/lib/desktop/cloud");
    expect(归属对不上()).toBe(true);
  });

  it("同一个人 → 对得上，不能把正常使用也拦了", async () => {
    fs.writeFileSync(归属文件, "acc_甲");
    写令牌("acc_甲");
    const { 归属对不上 } = await import("@/lib/desktop/cloud");
    expect(归属对不上()).toBe(false);
  });

  it("未认领的目录（没有归属标记）→ 谁登录就归谁，不算对不上", async () => {
    写令牌("acc_乙");
    const { 归属对不上 } = await import("@/lib/desktop/cloud");
    expect(归属对不上()).toBe(false);
  });

  it("老版本写下的令牌（没有 accountId）→ 不算对不上，壳启动时会去云端补", async () => {
    fs.writeFileSync(归属文件, "acc_甲");
    写令牌(undefined);
    const { 归属对不上 } = await import("@/lib/desktop/cloud");
    expect(归属对不上()).toBe(false);
  });

  it("不是桌面端本地模式的部署一律不管这件事", async () => {
    fs.writeFileSync(归属文件, "acc_甲");
    写令牌("acc_乙");
    delete process.env.DESKTOP_LOCAL;
    const { 归属对不上 } = await import("@/lib/desktop/cloud");
    expect(归属对不上()).toBe(false);
  });

  it("应用壳：对不上就把人挡在门口——这会儿进去看到的是上一个账号的库", () => {
    const layout = fs.readFileSync(path.resolve(__dirname, "../src/app/(app)/layout.tsx"), "utf8");
    expect(layout).toContain('if (归属对不上()) redirect("/api/auth/logout?reason=switched");');
  });
});
