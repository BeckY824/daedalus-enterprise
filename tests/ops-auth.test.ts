import { closeTestDatabases } from "./close-databases";
/**
 * 运营名单、进门码、运营票（lib/ops-auth.ts，2026-09-28）。运营台页面和 /api/ops/* 12c 删了，
 * lib 还被 lib/tenant/test-accounts.ts（运营名单）引着，留到 tenant 那批一起删；这里只钉 lib 本身：
 * 名单解析、码用第二次 / 过期、签票后被移出名单、业务会话冒充。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";


const 临时根 = path.join(os.tmpdir(), `crm-ops-auth-${process.pid}`);

beforeAll(() => {
  fs.mkdirSync(临时根, { recursive: true });
  process.env.MULTI_TENANT = "1";
  process.env.CONTROL_DATABASE_URL = `file:${path.join(临时根, "control.db")}`;
  const sql = execFileSync(
    process.execPath,
    [path.resolve("node_modules/prisma/build/index.js"), "migrate", "diff", "--from-empty", "--to-schema-datamodel", "prisma/control.prisma", "--script"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const ddl = path.join(临时根, "control.sql");
  fs.writeFileSync(ddl, sql);
  execFileSync("node", ["--experimental-sqlite", "-e", `
    const { DatabaseSync } = require('node:sqlite');
    const fs = require('node:fs');
    const db = new DatabaseSync(process.argv[1]);
    db.exec(fs.readFileSync(process.argv[2], 'utf8'));
    db.close();
  `, path.join(临时根, "control.db"), ddl], { stdio: "pipe" });
});

afterAll(async () => {
  delete process.env.MULTI_TENANT;
  await closeTestDatabases(临时根);
  fs.rmSync(临时根, { recursive: true, force: true });
});

beforeEach(async () => {
  const { control } = await import("@/lib/tenant/control");
  await control.machineSignup.deleteMany({});
  await control.accountAiGrant.deleteMany({});
  await control.accountAiUsage.deleteMany({});
  await control.aiGrant.deleteMany({});
  await control.aiUsage.deleteMany({});
  const { 重置限流 } = await import("@/lib/rate-limit");
  重置限流();
});



/** 这一次「请求」带着的 cookie。页面和动作的门都经 next/headers 读它 */
let 当前cookie: Record<string, string> = {};
// 动作成功后会 revalidatePath，单测里没有 Next 的缓存上下文（admin-guard 那组同样这么做）
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (k in 当前cookie ? { name: k, value: 当前cookie[k] } : undefined), set: () => {}, delete: () => {} }),
}));

let 序号 = 0;
async function 建账号(email: string) {
  const { createAccount } = await import("@/lib/tenant/accounts");
  return createAccount({ target: { kind: "email", value: email }, password: "abcd1234", name: `人${序号++}` });
}

beforeEach(() => {
  当前cookie = {};
  process.env.OPS_ACCOUNTS = "boss@example.com";
});
afterEach(() => {
  delete process.env.OPS_ACCOUNTS;
});

describe("运营名单", () => {
  it("逗号、分号、空格都能分，大小写不算", async () => {
    const { 运营名单 } = await import("@/lib/ops-auth");
    expect(运营名单({ OPS_ACCOUNTS: " Boss@Example.com ; 13800001111,  x@y.z " })).toEqual(["boss@example.com", "13800001111", "x@y.z"]);
    expect(运营名单({})).toEqual([]);
  });
});

describe("进门码：一次性、60 秒", () => {
  it("用一次就作废", async () => {
    const { 发进门码, 用进门码 } = await import("@/lib/ops-auth");
    const c = 发进门码("acc-1");
    expect(用进门码(c)).toBe("acc-1");
    expect(用进门码(c)).toBeNull();
  });
  it("过了 60 秒不认；乱填的不认", async () => {
    const { 发进门码, 用进门码 } = await import("@/lib/ops-auth");
    const 早 = Date.now();
    const c = 发进门码("acc-2", 早);
    expect(用进门码(c, 早 + 61_000)).toBeNull();
    expect(用进门码("乱填的")).toBeNull();
    expect(用进门码(null)).toBeNull();
  });
});

describe("运营票：签出去之后名单说了算，业务票冒充不了", () => {
  it("票签出去之后把他移出名单：下一次点击就进不去，不用等 12 小时", async () => {
    const boss = await 建账号("boss2@example.com");
    process.env.OPS_ACCOUNTS = "boss2@example.com";
    const { 签运营票, 认运营票 } = await import("@/lib/ops-auth");
    const 票 = await 签运营票(boss.id);
    expect(await 认运营票(票)).toBe(boss.id);
    process.env.OPS_ACCOUNTS = "someone-else@example.com";
    expect(await 认运营票(票)).toBeNull();
  });

  it("业务登录的会话票不能冒充运营台票（同一把密钥，用途不同）", async () => {
    const boss = await 建账号("boss3@example.com");
    process.env.OPS_ACCOUNTS = "boss3@example.com";
    const { SignJWT } = await import("jose");
    const { SECRET } = await import("@/lib/auth");
    const 业务票 = await new SignJWT({ sub: boss.id }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(SECRET);
    const { 认运营票 } = await import("@/lib/ops-auth");
    expect(await 认运营票(业务票)).toBeNull();
  });
});
