/**
 * 企业版报错告警（E-417 阶段 1）：scripts/ent-alert.mjs。伪造运行记录文件 + 注入 fetch 替身，不碰网络、不碰库。
 * 覆盖：四条规则、发客户的只 3 类、单员工个案只发我方、去重 60 分钟、仍在发生每小时补、30 分钟为 0 发恢复、
 * 每小时 ≤6、心跳 09:00 只发我方、发送失败不抛、--dry 不发、飞书签名、消息不带个人信息。
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { 运行, 签名, 读配置, 评规则 } from "../scripts/ent-alert.mjs";

const 根 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-alert-"));
afterAll(() => fs.rmSync(根, { recursive: true, force: true }));

const OURS = "https://ours.test/hook";
const EVEN = "https://even.test/hook";
/** 北京 07:00：离 09:00 心跳还早（心跳单独测） */
const T0 = Date.parse("2026-11-19T23:00:00Z");
const 分 = 60_000;

let 目录 = "";
let 序 = 0;
type 行 = Record<string, unknown>;
type 调用 = { url: string; body: { msg_type: string; content: { text: string }; timestamp?: string; sign?: string } };
let 调用们: 调用[] = [];
let 健康好 = true;
let 发送模式: "ok" | "http500" | "throw" | "code" = "ok";

beforeEach(() => {
  目录 = path.join(根, `d${++序}`);
  fs.mkdirSync(path.join(目录, "telemetry"), { recursive: true });
  fs.writeFileSync(path.join(目录, ".alert-env"), `# 测试\nALERT_WEBHOOK_OURS=${OURS}\nALERT_SECRET_OURS=so\nALERT_WEBHOOK_EVEN=${EVEN}\nALERT_SECRET_EVEN="se"\nALERT_INSTANCE=c2\n`);
  调用们 = [];
  健康好 = true;
  发送模式 = "ok";
});

const 假取 = (async (url: string, init?: { body?: string }) => {
  if (String(url).includes("/api/health")) return { ok: 健康好, status: 健康好 ? 200 : 503, json: async () => ({}) };
  if (发送模式 === "throw") throw new Error("network down");
  调用们.push({ url: String(url), body: JSON.parse(String(init?.body)) });
  if (发送模式 === "http500") return { ok: false, status: 500, json: async () => ({}) };
  if (发送模式 === "code") return { ok: true, status: 200, json: async () => ({ code: 19021 }) };
  return { ok: true, status: 200, json: async () => ({ code: 0 }) };
}) as unknown as typeof fetch;

/** 往运行记录里追加：n 条，时刻 ago 分钟前，u 是人员短号数组轮着用 */
function 记(n: number, ago: number, 改: Partial<行> = {}, 人: (string | undefined)[] = ["a", "b"]) {
  const 文件 = path.join(目录, "telemetry", "tel-2026-11-19.p1.jsonl");
  const 行们 = Array.from({ length: n }, (_, i) => {
    const x: 行 = { t: new Date(T0 - ago * 分 + i * 1000).toISOString(), k: "err", src: "server", type: "服务端出错", name: "TypeError", route: "/customers/[id]", kind: "render", role: "sales", digest: "9988", ...改 };
    const u = 人[i % 人.length];
    if (u) x.u = u;
    return JSON.stringify(x);
  });
  fs.appendFileSync(文件, `${行们.join("\n")}\n`);
}
const 跑 = (现在 = T0, 选项: Record<string, unknown> = {}) => 运行({ 目录, 现在, 取: 假取, 输出: () => {}, ...选项 }) as Promise<{ 发出: { 内容: string; 客户: boolean }[] }>;
const 发往 = (url: string) => 调用们.filter((c) => c.url === url);
const 文本 = (c: 调用) => c.body.content.text;

describe("规则", () => {
  it("R1：同类 5 次 + 不止 1 人 → 我方 + 客户群；4 次不报", async () => {
    记(4, 3);
    expect((await 跑()).发出).toHaveLength(0);
    记(1, 2);
    const r = await 跑();
    expect(r.发出).toHaveLength(1);
    expect(r.发出[0].客户).toBe(true);
    expect(发往(OURS)).toHaveLength(1);
    expect(发往(EVEN)).toHaveLength(1);
    expect(文本(发往(EVEN)[0])).toContain("同类错误");
    expect(文本(发往(EVEN)[0])).toContain("5 次");
  });

  it("R1：同一个人撞 5 次 = 单员工个案，只发我方", async () => {
    记(6, 3, {}, ["a"]);
    const r = await 跑();
    expect(r.发出).toHaveLength(1);
    expect(r.发出[0].客户).toBe(false);
    expect(发往(OURS)).toHaveLength(1);
    expect(发往(EVEN)).toHaveLength(0);
    expect(文本(发往(OURS)[0])).toContain("个案");
  });

  it("R1：10 分钟之外的不算；错误名、错误码、路由任一不同不合并", async () => {
    记(5, 15);
    记(3, 2);
    记(3, 2, { name: "RangeError" });
    记(3, 2, { route: "/other" });
    记(3, 2, { code: "P5000" });
    expect((await 跑()).发出).toHaveLength(0);
  });

  it("R1：浏览器错误边界也算；浏览器别的类别（未捕获错误）不算", async () => {
    记(5, 3, { src: "browser", type: "错误边界", name: "Error", route: "/customers" });
    expect((await 跑()).发出.length).toBe(1);
    const 目录2 = 目录;
    目录 = path.join(根, `d${++序}`);
    fs.mkdirSync(path.join(目录, "telemetry"), { recursive: true });
    fs.copyFileSync(path.join(目录2, ".alert-env"), path.join(目录, ".alert-env"));
    记(8, 3, { src: "browser", type: "未捕获错误" });
    expect((await 跑()).发出).toHaveLength(0);
  });

  it("R2：服务端合计 ≥15 次，分散在不同路由、只 2 个人 → 只发我方", async () => {
    for (let i = 0; i < 15; i++) 记(1, 3, { route: `/r${i}` }, [i % 2 ? "a" : "b"]);
    const r = await 跑();
    expect(r.发出).toHaveLength(1);
    expect(r.发出[0].客户).toBe(false);
    expect(文本(发往(OURS)[0])).toContain("总量");
    expect(发往(EVEN)).toHaveLength(0);
  });

  it("R2：≥3 位员工碰到（各 1 次）→ 发客户群；2 位不报", async () => {
    记(1, 3, { route: "/a" }, ["a"]);
    记(1, 3, { route: "/b" }, ["b"]);
    expect((await 跑()).发出).toHaveLength(0);
    记(1, 3, { route: "/c" }, ["c"]);
    const r = await 跑();
    expect(r.发出).toHaveLength(1);
    expect(r.发出[0].客户).toBe(true);
    expect(文本(发往(EVEN)[0])).toContain("3 位员工");
  });

  it("R3：P20xx 合计 ≥3 次 → 发客户群；2 次、非 P20xx 不报", async () => {
    记(2, 3, { code: "P2029" }, ["a"]);
    记(5, 3, { code: "P1001", route: "/p1" }, ["a"]); // 同路由同名分组：单人，每组 ≤5 且 P1001 不是 P20xx
    expect((await 跑()).发出.filter((x) => x.内容.includes("数据库"))).toHaveLength(0);
    记(1, 2, { code: "P2024", route: "/z" }, ["a"]);
    const r = await 跑();
    const 库 = r.发出.filter((x) => x.内容.includes("数据库类"));
    expect(库).toHaveLength(1);
    expect(库[0].客户).toBe(true);
    expect(库[0].内容).toContain("P2029×2");
    expect(库[0].内容).toContain("P2024×1");
  });

  it("R4：探活连续 2 次不通才报，只发我方；通了发已恢复", async () => {
    fs.appendFileSync(path.join(目录, ".alert-env"), "ALERT_HEALTH_URLS=http://127.0.0.1:3010/api/health, http://127.0.0.1:3011/api/health\n");
    健康好 = false;
    expect((await 跑(T0)).发出).toHaveLength(0);
    const r2 = await 跑(T0 + 2 * 分);
    expect(r2.发出).toHaveLength(2);
    expect(r2.发出.every((x) => !x.客户)).toBe(true);
    expect(发往(EVEN)).toHaveLength(0);
    expect(文本(发往(OURS)[0])).toContain("服务挂了");
    expect(文本(发往(OURS)[0])).toContain("127.0.0.1:3010");
    expect((await 跑(T0 + 4 * 分)).发出).toHaveLength(0); // 去重
    健康好 = true;
    const r4 = await 跑(T0 + 6 * 分);
    expect(r4.发出).toHaveLength(2);
    expect(文本(发往(OURS)[2])).toContain("已恢复");
  });

  it("评规则是纯函数：空记录没有命中", () => {
    expect(评规则([], T0)).toEqual([]);
  });
});

describe("去重 / 静默 / 恢复 / 限频", () => {
  it("同一条 60 分钟内只报一次，满 60 分钟补一条「仍在发生」带过去 60 分钟次数", async () => {
    记(6, 3);
    expect((await 跑(T0)).发出).toHaveLength(1);
    // 之后每 10 分钟补一批新记录，保持仍在发生
    let n = 1;
    for (const 加 of [10, 20, 30, 40, 50]) {
      const 前 = T0 + 加 * 分;
      const 文件 = path.join(目录, "telemetry", "tel-2026-11-19.p1.jsonl");
      fs.appendFileSync(文件, `${Array.from({ length: 6 }, (_, i) => JSON.stringify({ t: new Date(前 - 3 * 分 + i * 1000).toISOString(), k: "err", src: "server", type: "服务端出错", name: "TypeError", route: "/customers/[id]", role: "sales", u: i % 2 ? "a" : "b" })).join("\n")}\n`);
      expect((await 跑(前)).发出).toHaveLength(0);
    }
    const 文件 = path.join(目录, "telemetry", "tel-2026-11-19.p1.jsonl");
    const 前 = T0 + 60 * 分;
    fs.appendFileSync(文件, `${Array.from({ length: 6 }, (_, i) => JSON.stringify({ t: new Date(前 - 3 * 分 + i * 1000).toISOString(), k: "err", src: "server", type: "服务端出错", name: "TypeError", route: "/customers/[id]", role: "sales", u: i % 2 ? "a" : "b" })).join("\n")}\n`);
    const r = await 跑(前);
    n = r.发出.filter((x) => x.内容.includes("仍在发生")).length;
    expect(n).toBe(1);
    expect(r.发出[0].内容).toMatch(/过去 60 分钟 \d+ 次/);
    expect(r.发出[0].客户).toBe(true);
  });

  it("连续 30 分钟为 0 发「已恢复」，之后不再发；恢复沿用原来的受众", async () => {
    记(6, 3);
    await 跑(T0);
    expect((await 跑(T0 + 20 * 分)).发出).toHaveLength(0); // 记录在 17–23 分钟前，不满 30 分钟
    const r = await 跑(T0 + 40 * 分);
    expect(r.发出).toHaveLength(1);
    expect(r.发出[0].内容).toContain("已恢复");
    expect(r.发出[0].客户).toBe(true);
    expect(发往(EVEN).map(文本).some((t) => t.includes("已恢复"))).toBe(true);
    expect((await 跑(T0 + 50 * 分)).发出).toHaveLength(0);
  });

  it("单员工个案的恢复也只发我方", async () => {
    记(6, 3, {}, ["a"]);
    await 跑(T0);
    await 跑(T0 + 40 * 分);
    expect(发往(EVEN)).toHaveLength(0);
    expect(发往(OURS)).toHaveLength(2);
  });

  it("全局每小时最多 6 条，多的留到下一小时", async () => {
    for (let i = 0; i < 8; i++) 记(5, 3, { route: `/r${i}` }, ["a", "b"]);
    const r = await 跑(T0);
    expect(r.发出).toHaveLength(6);
    expect(发往(OURS)).toHaveLength(6);
    expect((await 跑(T0 + 2 * 分)).发出).toHaveLength(0);
    // 一个小时后：旧记录已出窗口，但留着的 2 条（记录在 T0-3 分钟）不再命中 → 不补发；状态里 sent 已清
    const 状态 = JSON.parse(fs.readFileSync(path.join(目录, "alert-state.json"), "utf8"));
    expect(状态.sent).toHaveLength(6);
  });

  it("留到下次的在额度恢复后补发", async () => {
    for (let i = 0; i < 8; i++) 记(5, 3, { route: `/r${i}` }, ["a", "b"]);
    await 跑(T0);
    // 把记录往后挪：新增同样 8 组、时刻在 61 分钟后窗口内，原来 6 条已满 60 分钟 → 额度恢复
    const 前 = T0 + 61 * 分;
    const 文件 = path.join(目录, "telemetry", "tel-2026-11-19.p1.jsonl");
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 5; j++) fs.appendFileSync(文件, `${JSON.stringify({ t: new Date(前 - 2 * 分 + j * 1000).toISOString(), k: "err", src: "server", type: "服务端出错", name: "TypeError", route: `/r${i}`, role: "sales", u: j % 2 ? "a" : "b" })}\n`);
    const r = await 跑(前);
    expect(r.发出.length).toBeGreaterThan(0);
    expect(r.发出.length).toBeLessThanOrEqual(6);
  });
});

describe("心跳", () => {
  it("北京 09:00 起当天第一次发，只发我方，带摘要；同一天不重复；不占每小时额度", async () => {
    记(2, 30, { route: "/x" }, ["a"]);
    const 九点 = Date.parse("2026-11-20T01:00:00Z");
    expect((await 跑(九点 - 分)).发出).toHaveLength(0);
    const r = await 跑(九点);
    expect(r.发出).toHaveLength(1);
    expect(r.发出[0].客户).toBe(false);
    expect(发往(OURS)).toHaveLength(1);
    expect(发往(EVEN)).toHaveLength(0);
    expect(文本(发往(OURS)[0])).toContain("告警通道正常");
    expect(文本(发往(OURS)[0])).toContain("运行记录摘要");
    expect((await 跑(九点 + 2 * 分)).发出).toHaveLength(0);
    const 次日 = Date.parse("2026-11-21T01:00:00Z");
    expect((await 跑(次日)).发出).toHaveLength(1);
  });
});

describe("发送、dry、消息内容", () => {
  it("发送失败（抛错 / HTTP 500 / 飞书 code≠0）不抛，状态照写（不重试）", async () => {
    for (const 模式 of ["throw", "http500", "code"] as const) {
      目录 = path.join(根, `d${++序}`);
      fs.mkdirSync(path.join(目录, "telemetry"), { recursive: true });
      fs.writeFileSync(path.join(目录, ".alert-env"), `ALERT_WEBHOOK_OURS=${OURS}\n`);
      发送模式 = 模式;
      记(6, 3);
      await expect(跑()).resolves.toBeTruthy();
      const 状态 = JSON.parse(fs.readFileSync(path.join(目录, "alert-state.json"), "utf8"));
      expect(Object.keys(状态.alerts)).toHaveLength(1);
      expect((await 跑(T0 + 2 * 分)).发出).toHaveLength(0);
    }
  });

  it("命令行：发送地址不通也是退出码 0", () => {
    记(6, 3);
    fs.writeFileSync(path.join(目录, ".alert-env"), "ALERT_WEBHOOK_OURS=http://127.0.0.1:9/hook\n");
    const out = execFileSync(process.execPath, [path.resolve(__dirname, "../scripts/ent-alert.mjs"), "--dir", 目录, "--now", new Date(T0).toISOString()], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(out).toBe("");
  });

  it("命令行：缺 --dir 退出码 2", () => {
    expect(() => execFileSync(process.execPath, [path.resolve(__dirname, "../scripts/ent-alert.mjs")], { stdio: "pipe" })).toThrow();
  });

  it("--dry 不发、不写状态，只打印将发什么", async () => {
    记(6, 3);
    const 印: string[] = [];
    const r = await 跑(T0, { dry: true, 输出: (s: string) => 印.push(s) });
    expect(r.发出).toHaveLength(1);
    expect(调用们).toHaveLength(0);
    expect(fs.existsSync(path.join(目录, "alert-state.json"))).toBe(false);
    expect(印.join("\n")).toContain("将发：我方 + 客户群");
  });

  it("客户群地址空 = 不发客户群；没有 .alert-env 也不抛", async () => {
    fs.writeFileSync(path.join(目录, ".alert-env"), `ALERT_WEBHOOK_OURS=${OURS}\nALERT_WEBHOOK_EVEN=\n`);
    记(6, 3);
    await 跑();
    expect(发往(OURS)).toHaveLength(1);
    expect(发往(EVEN)).toHaveLength(0);
    fs.rmSync(path.join(目录, ".alert-env"));
    记(6, 3, { route: "/y" });
    await expect(跑(T0 + 70 * 分)).resolves.toBeTruthy();
  });

  it("没有运行记录目录不抛", async () => {
    fs.rmSync(path.join(目录, "telemetry"), { recursive: true });
    expect((await 跑()).发出).toHaveLength(0);
  });

  it("飞书签名：timestamp\\nsecret 作 key、内容空、base64；有密钥才带", async () => {
    记(6, 3);
    await 跑();
    const c = 发往(OURS)[0];
    const ts = String(Math.floor(T0 / 1000));
    expect(c.body.timestamp).toBe(ts);
    expect(c.body.sign).toBe(crypto.createHmac("sha256", `${ts}\nso`).update("").digest("base64"));
    expect(发往(EVEN)[0].body.sign).toBe(签名(ts, "se"));
    expect(c.body.msg_type).toBe("text");
    fs.writeFileSync(path.join(目录, ".alert-env"), `ALERT_WEBHOOK_OURS=${OURS}\n`);
    记(6, 3, { route: "/nosign" });
    调用们 = [];
    await 跑(T0 + 70 * 分);
    expect(调用们[0].body.sign).toBeUndefined();
  });

  it("消息：实例名、北京 + 伦敦时间、错误名/路由/次数/人数/角色/编号样例；不含人员短号和报错原文", async () => {
    记(6, 3, { msg: "bad value for 某某公司 13800138000" }, ["u-secret1", "u-secret2"]);
    await 跑();
    const t = 文本(发往(OURS)[0]);
    expect(t).toContain("c2");
    expect(t).toContain("北京 11-20 06:57 / 伦敦 11-19 22:57");
    expect(t).toContain("TypeError");
    expect(t).toContain("/customers/[id]");
    expect(t).toContain("6 次");
    expect(t).toContain("人数：2");
    expect(t).toContain("sales×6");
    expect(t).toContain("编号样例：9988");
    expect(t).not.toContain("u-secret");
    expect(t).not.toContain("某某公司");
    expect(t).not.toContain("1380013");
  });

  it("读配置：注释、引号、空值", () => {
    fs.writeFileSync(path.join(目录, ".alert-env"), "# x\nA_B='v1'\nC=\n  D = \"v 2\" \nbad line\n");
    expect(读配置(目录)).toEqual({ A_B: "v1", C: "", D: "v 2" });
  });
});
