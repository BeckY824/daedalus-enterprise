import { closeTestDatabases } from "./close-databases";
/**
 * 测试账号（lib/tenant/test-accounts.ts，2026-10-04）。用户原话：「测试用的账号 AI 不限次数，也不计算到注册用户和（活跃用户）。
 * 在检测中显示测试用户即可，不算真实用户与活跃用户。」
 *
 * 钉三件事：
 *   1. 标 / 取消：取消不删行、留痕追加；没变化不多记一行；运营账号（OPS_ACCOUNTS）默认就算
 *   2. AI 不限：测试账号次数是 0 也放行、一次都不扣；调用照样记进 AiCall；取消之后立刻回到照常扣、用完就挡
 *   3. 统计排除：模型用量的合计不算测试账号（运营台总览、用户列表、运营通知 12c 随运营台删了）
 * 外加迁移守卫：control.prisma 和 control-migrations/ 两条安装路径都有这张表，连跑两遍不炸。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const 根 = path.resolve(__dirname, "..");
const 临时根 = path.join(os.tmpdir(), `crm-test-accounts-${process.pid}`);
const 上游 = "https://upstream.example.com/v1";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

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
  delete process.env.OPS_ACCOUNTS;
  delete process.env.TEST_ACCOUNTS;
  delete process.env.GATEWAY_API_KEY;
  delete process.env.GATEWAY_BASE_URL;
  delete process.env.GATEWAY_MODELS;
  vi.unstubAllGlobals();
  await closeTestDatabases(临时根);
  fs.rmSync(临时根, { recursive: true, force: true });
});

beforeEach(async () => {
  delete process.env.OPS_ACCOUNTS;
  delete process.env.TEST_ACCOUNTS;
  const { control } = await import("@/lib/tenant/control");
  await control.testAccount.deleteMany({});
  await control.aiCharge.deleteMany({});
  await control.aiCall.deleteMany({});
  await control.accountAiUsage.deleteMany({});
  await control.accountAiGrant.deleteMany({});
  await control.deviceInfo.deleteMany({});
  await control.deviceToken.deleteMany({});
  await control.feedback.deleteMany({});
  await control.account.deleteMany({});
  const { resetAiQuota } = await import("@/lib/ai-quota");
  resetAiQuota();
  const { 重置限流 } = await import("@/lib/rate-limit");
  重置限流();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

let 序号 = 0;
async function 建账号(opts: { email?: string; 送?: number; 注册于?: Date } = {}) {
  const { control } = await import("@/lib/tenant/control");
  const id = `acc${序号++}`;
  await control.account.create({
    data: { id, email: opts.email ?? `${id}@t.test`, password: "x", name: `人${id}`, ...(opts.注册于 ? { createdAt: opts.注册于 } : {}) },
  });
  if (opts.送) {
    const { 赠送 } = await import("@/lib/tenant/credits");
    await 赠送({ kind: "account", id }, { amount: opts.送, reason: "signup", key: `${id}:signup` });
  }
  return id;
}
const 账号 = (id: string) => ({ kind: "account" as const, id });

describe("标 / 取消测试账号", () => {

  it("标上、取消、再标：取消不删行，留痕一次一行（新的在前），记下是谁标的", async () => {
    const { 是测试账号, 测试留痕, 设测试账号 } = await import("@/lib/tenant/test-accounts");
    const { control } = await import("@/lib/tenant/control");
    const id = await 建账号();
    expect(await 是测试账号(id)).toBe(false);

    expect(await 设测试账号(id, true, "口令")).toBe(true);
    expect(await 是测试账号(id)).toBe(true);

    expect(await 设测试账号(id, false, "口令")).toBe(true);
    expect(await 是测试账号(id)).toBe(false);
    expect(await control.testAccount.findUnique({ where: { accountId: id } }), "取消不删行，留痕要留着").not.toBeNull();

    await 设测试账号(id, true, "口令");
    const 痕 = await 测试留痕(id);
    expect(痕).toHaveLength(3);
    expect(痕[0]).toMatch(/标为测试账号 · 口令$/);
    expect(痕[1]).toMatch(/取消测试账号 · 口令$/);
    expect(痕[2]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} 标为测试账号/);
  });

  it("本来就是这样的不动，也不多记一行", async () => {
    const { 设测试账号, 测试留痕 } = await import("@/lib/tenant/test-accounts");
    const id = await 建账号();
    expect(await 设测试账号(id, false, "某人"), "没标过就取消：没变化").toBe(false);
    expect(await 设测试账号(id, true, "某人")).toBe(true);
    expect(await 设测试账号(id, true, "某人"), "标两次").toBe(false);
    expect(await 测试留痕(id)).toHaveLength(1);
  });

  it("运营账号（OPS_ACCOUNTS）默认就是测试账号，不用标；名单外的不算；拿出名单就不算了", async () => {
    const { 是测试账号, 测试账号们 } = await import("@/lib/tenant/test-accounts");
    const 运营 = await 建账号({ email: "boss@example.com" });
    const 路人 = await 建账号();
    expect(await 是测试账号(运营), "没配名单").toBe(false);
    process.env.OPS_ACCOUNTS = "Boss@Example.com, 13900000000";
    expect(await 是测试账号(运营)).toBe(true);
    expect(await 是测试账号(路人)).toBe(false);
    expect([...(await 测试账号们()).entries()]).toEqual([[运营, "运营"]]);
    delete process.env.OPS_ACCOUNTS;
  delete process.env.TEST_ACCOUNTS;
    expect(await 是测试账号(运营)).toBe(false);
  });
});

it("注册前预设测试名单算测试账号，不授予运营权限；移除名单恢复", async () => {
  const { 是测试账号, 测试账号们 } = await import("@/lib/tenant/test-accounts");
  const { 是运营账号 } = await import("@/lib/ops-auth");
  process.env.TEST_ACCOUNTS = "Preset@Example.test; 13900000001";
  const test = await 建账号({ email: "preset@example.test" });
  const real = await 建账号();
  expect(await 是测试账号(test)).toBe(true);
  expect(await 是测试账号(real)).toBe(false);
  expect(await 是运营账号(test)).toBe(false);
  expect([...(await 测试账号们()).entries()]).toEqual([[test, "预设"]]);
  delete process.env.TEST_ACCOUNTS;
  expect(await 是测试账号(test)).toBe(false);
});

describe("AI 不限次数", () => {
  it("测试账号次数是 0 也照样放行，一次都不扣；余额报 不限", async () => {
    const { 按问题扣一次, 扣一次, 余额, 用掉次数 } = await import("@/lib/tenant/credits");
    const { 设测试账号 } = await import("@/lib/tenant/test-accounts");
    const id = await 建账号(); // 一次都没送过
    expect((await 按问题扣一次(账号(id), "q-0")).ok, "普通账号 0 次被挡").toBe(false);

    await 设测试账号(id, true, "测");
    for (let i = 0; i < 50; i++) {
      const r = await 按问题扣一次(账号(id), i % 2 ? `q${i}` : null);
      expect(r.ok).toBe(true);
      expect(r.ok && r.扣了, "测试账号不扣").toBe(false);
    }
    expect((await 扣一次(账号(id))).ok).toBe(true);
    expect(await 用掉次数(账号(id)), "计数器一下都没动").toBe(0);
    expect(await 余额(账号(id))).toMatchObject({ 不限: true });
  });

  it("取消测试之后立刻回到照常：扣次数、用完就挡", async () => {
    const { 按问题扣一次, 余额, 用掉次数 } = await import("@/lib/tenant/credits");
    const { 设测试账号 } = await import("@/lib/tenant/test-accounts");
    const id = await 建账号({ 送: 2 });
    await 设测试账号(id, true, "测");
    await 按问题扣一次(账号(id), "a");
    await 按问题扣一次(账号(id), "b");
    await 按问题扣一次(账号(id), "c");
    expect(await 用掉次数(账号(id))).toBe(0);

    await 设测试账号(id, false, "测");
    expect(await 余额(账号(id))).toEqual({ 上限: 2, 用掉: 0, 还剩: 2 });
    expect((await 按问题扣一次(账号(id), "d")).ok).toBe(true);
    expect((await 按问题扣一次(账号(id), "e")).ok).toBe(true);
    expect((await 按问题扣一次(账号(id), "f")).ok).toBe(false);
    expect(await 用掉次数(账号(id))).toBe(2);
  });

  it("运营账号同样不限", async () => {
    const { 按问题扣一次 } = await import("@/lib/tenant/credits");
    const id = await 建账号({ email: "boss@example.com" });
    process.env.OPS_ACCOUNTS = "boss@example.com";
    const r = await 按问题扣一次(账号(id), "q");
    expect(r.ok && !r.扣了).toBe(true);
  });

  it("走网关：0 次的测试账号拿到 200，调用照样记进 AiCall（方便我们看）；/credits 报 不限", async () => {
    process.env.GATEWAY_API_KEY = "upstream-key";
    process.env.GATEWAY_BASE_URL = 上游;
    process.env.GATEWAY_MODELS = "deepseek-chat";
    const { 签发 } = await import("@/lib/tenant/device-token");
    const { 设测试账号 } = await import("@/lib/tenant/test-accounts");
    const { control } = await import("@/lib/tenant/control");
    const id = await 建账号();
    const { token } = await 签发(id, "测试机");
    let 打上游 = 0;
    vi.stubGlobal("fetch", async () => {
      打上游++;
      return new Response(JSON.stringify({ choices: [{ message: { content: "好" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const { POST } = await import("@/app/api/gateway/v1/chat/completions/route");
    const 问 = (n: number) =>
      POST(
        new Request("https://app.example.com/api/gateway/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-question-id": `q${n}` },
          body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: `第${n}句` }] }),
        }),
      );

    expect((await 问(0)).status, "普通账号 0 次：402").toBe(402);
    expect(打上游).toBe(0);

    await 设测试账号(id, true, "测");
    for (let i = 1; i <= 3; i++) expect((await 问(i)).status).toBe(200);
    expect(打上游).toBe(3);
    expect(await control.aiCall.count({ where: { ownerKind: "account", ownerId: id } })).toBe(3);
    // 前面那次 402 先加后退，行在、是 0；标成测试之后三次一下都没加
    expect((await control.accountAiUsage.findUnique({ where: { accountId: id } }))?.calls ?? 0).toBe(0);

    const { GET } = await import("@/app/api/gateway/v1/credits/route");
    const 余 = await (await GET(new Request("https://app.example.com/api/gateway/v1/credits", { headers: { Authorization: `Bearer ${token}` } }))).json();
    expect(余.不限).toBe(true);
  });
});

describe("统计排除测试账号", () => {
  async function 造一批() {
    const { control } = await import("@/lib/tenant/control");
    const { 设测试账号 } = await import("@/lib/tenant/test-accounts");
    const 真1 = await 建账号();
    const 真2 = await 建账号({ 注册于: new Date(Date.now() - 20 * 86_400_000) });
    const 测 = await 建账号();
    const 运营 = await 建账号({ email: "boss@example.com" });
    process.env.OPS_ACCOUNTS = "boss@example.com";
    await 设测试账号(测, true, "测");
    // 每人一台在用的设备、最近用过；测试账号的是 Windows，真实用户是 Mac
    for (const [id, 平台] of [[真1, "darwin"], [真2, "darwin"], [测, "win32"], [运营, "win32"]] as const) {
      await control.deviceToken.create({ data: { id: `t-${id}`, accountId: id, tokenHash: `h-${id}`, name: id, lastUsedAt: new Date() } });
      await control.deviceInfo.create({ data: { deviceTokenId: `t-${id}`, platform: 平台, version: 平台 === "win32" ? "9.9.9" : "0.46.14" } });
    }
    await control.aiCall.createMany({
      data: [
        { ownerKind: "account", ownerId: 真1, model: "m", inputTokens: 100, outputTokens: 10, feature: "ask" },
        { ownerKind: "account", ownerId: 测, model: "m", inputTokens: 5000, outputTokens: 500, feature: "brief" },
        { ownerKind: "account", ownerId: 测, model: "m", inputTokens: 5000, outputTokens: 500, feature: "brief" },
        { ownerKind: "account", ownerId: 运营, model: "m", inputTokens: 7000, outputTokens: 700, feature: "parse" },
      ],
    });
    return { 真1, 真2, 测, 运营 };
  }

  it("模型用量：合计、按天、按模型、按归属都不算测试账号，单独给一个数", async () => {
    const { 成本概览 } = await import("@/lib/tenant/ai-cost");
    const { 测试账号们 } = await import("@/lib/tenant/test-accounts");
    const { 真1 } = await 造一批();
    const 测试 = new Set((await 测试账号们()).keys());
    const c = await 成本概览(30, 测试);
    expect(c.合计).toEqual({ 次数: 1, 入: 100, 出: 10 });
    expect(c.按天.reduce((s, d) => s + d.次数, 0)).toBe(1);
    expect(c.按模型).toEqual([{ model: "m", 次数: 1, 入: 100, 出: 10 }]);
    expect(c.按归属.map((o) => o.id)).toEqual([真1]);
    expect(c.测试).toEqual({ 次数: 3, 入: 17000, 出: 1700 });
    // 不传就是老口径：全算
    expect((await 成本概览(30)).合计.次数).toBe(4);
  });
});

describe("控制面的两条安装路径要一致", () => {
  it("control.prisma 里有 TestAccount，control-migrations/018 建了这张表，整个目录连跑两遍不炸", async () => {
    expect(fs.readFileSync(path.join(根, "prisma/control.prisma"), "utf8")).toContain("model TestAccount");
    const 目录 = path.join(根, "control-migrations");
    expect(fs.existsSync(path.join(目录, "018-test-account.sql"))).toBe(true);
    const { DatabaseSync } = await import("node:sqlite");
    const 文件 = fs.readdirSync(目录).filter((f) => f.endsWith(".sql")).sort();
    const db = new DatabaseSync(path.join(临时根, "_test-account-migration.db"));
    try {
      for (let 遍 = 1; 遍 <= 2; 遍++) for (const f of 文件) db.exec(fs.readFileSync(path.join(目录, f), "utf8"));
      const 列 = (db.prepare(`pragma table_info("TestAccount")`).all() as { name: string }[]).map((c) => c.name);
      expect(列, "存量库补不上这张表，线上标了也不算").toEqual(["accountId", "on", "log", "updatedAt"]);
    } finally {
      db.close();
    }
  });
});
