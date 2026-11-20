/**
 * 飞书发送队列（11-21 批次 33 批 1 · B01，lib/enterprise/feishu-queue.ts + feishu-push.ts）。
 * 钉的是：本进程每秒不超过 N 条、同一收件人两条之间至少隔 1 秒、按先后出队（超时类先出）、不重试；
 * 每个进程每秒上限就是 N（默认 4，不按进程数折算）；排太久（积压上限 8 分钟，< 收拾卡住的推送的 10 分钟）的记失败不发；
 * 进程中途退出：残留的「待推」「推送中」10 分钟后由「收拾卡住的推送」记成失败。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));

import { prisma } from "@/lib/prisma";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { resetDb } from "./reset";
import { 推送队列, 本进程每秒, type 排队条 } from "@/lib/enterprise/feishu-queue";
import {
  飞书推送开关键, 清飞书推送令牌, 推通知们, 换推送队列, 等推送队列空, 收拾卡住的推送,
  推送积压上限分钟, 推送卡住分钟, 推送卡住话, 排太久话,
} from "@/lib/enterprise/feishu-push";
import { 推送先后, 知会类先后 } from "@/lib/enterprise/notice-kinds";
import { 超时通知种类 } from "@/lib/enterprise/reply-overdue";
import { 快轮到kind } from "@/lib/enterprise/assign-eta";

type 记一笔 = { 收件人: string; 先后: number; 时刻: number; 过期: boolean; 入队: number };

/** 虚拟时钟：睡 = 把钟拨过去，不真等 */
function 虚拟钟() {
  const 钟 = { t: 1_000_000 };
  return { 钟, 现在: () => 钟.t, 睡: async (ms: number) => { 钟.t += ms; } };
}

/** 发出去的（不算过期的）：任何一个 [t, t+1000) 窗口里不超过 每秒 条 */
function 最大每秒(记: 记一笔[]): number {
  const ts = 记.filter((x) => !x.过期).map((x) => x.时刻).sort((a, b) => a - b);
  let 最多 = 0;
  for (let i = 0, j = 0; i < ts.length; i++) {
    while (ts[i] - ts[j] >= 1000) j++;
    最多 = Math.max(最多, i - j + 1);
  }
  return 最多;
}

/** 同一收件人相邻两条的最小间隔 */
function 同人最小间隔(记: 记一笔[]): number {
  const 上次 = new Map<string, number>();
  let 最小 = Infinity;
  for (const x of 记.filter((y) => !y.过期)) {
    const p = 上次.get(x.收件人);
    if (p !== undefined) 最小 = Math.min(最小, x.时刻 - p);
    上次.set(x.收件人, x.时刻);
  }
  return 最小;
}

/**
 * 先后：每发一条的时刻，排着的、收件人已过同人间隔的条里没有先后更靠前的（都是一次入队时）。
 * 返回违反的条数
 */
function 先后违反(记: 记一笔[], 同人间隔 = 1000): number {
  const 发 = 记.filter((x) => !x.过期);
  const 上次 = new Map<string, number>();
  let 违反 = 0;
  发.forEach((x, i) => {
    const 还排着 = 发.slice(i + 1);
    if (还排着.some((y) => y.先后 < x.先后 && y.入队 <= x.时刻 && (上次.get(y.收件人) ?? -Infinity) + 同人间隔 <= x.时刻)) 违反++;
    上次.set(x.收件人, x.时刻);
  });
  return 违反;
}

const 种类们 = [超时通知种类, "指定回复", "跟进到期", "跟进逾期", 快轮到kind, "自动分配", "分配"];

describe("先后表", () => {
  it("超时未跟进 > 指定回复、分到线索 > 跟进到期 / 逾期 > 快轮到等知会类；种类字面量和来源常量一致", () => {
    expect(超时通知种类).toBe("超时未跟进");
    expect(快轮到kind).toBe("快轮到");
    expect(推送先后(超时通知种类)).toBeLessThan(推送先后("指定回复"));
    expect(推送先后("指定回复")).toBeLessThan(推送先后("跟进到期"));
    expect(推送先后("跟进到期")).toBe(推送先后("跟进逾期"));
    expect(推送先后("跟进逾期")).toBeLessThan(推送先后(快轮到kind));
    // 分到线索（含超时转出 / 放弃转给接手人那条）接手人从这一刻起计超时，和指定回复同档（审查 11-20）
    for (const k of ["分配", "自动分配"]) expect(推送先后(k)).toBe(推送先后("指定回复"));
    for (const k of [快轮到kind, "交接", "没见过的种类"]) expect(推送先后(k)).toBe(知会类先后);
  });
});

describe("每进程速率", () => {
  it("每个进程默认 4 条 / 秒，不按进程数折算；ENT_FEISHU_RATE 可改，写错按 4", () => {
    expect(本进程每秒({})).toBe(4);
    expect(本进程每秒({ CRM_JOBS: "1", CRM_INSTANCE: "1" })).toBe(4);
    expect(本进程每秒({ CRM_JOBS: "0", CRM_INSTANCE: "3" })).toBe(4);
    expect(本进程每秒({ ENT_FEISHU_RATE: "6" })).toBe(6);
    expect(本进程每秒({ ENT_FEISHU_RATE: "0" })).toBe(4);
    expect(本进程每秒({ ENT_FEISHU_RATE: "abc" })).toBe(4);
  });
});

describe("队列调度（虚拟时钟）", () => {
  it("200 条混合类型一次入队：每秒不超过 4 条、同一人间隔 ≥ 1 秒、超时类先出、每条只跑一次", async () => {
    const { 现在, 睡 } = 虚拟钟();
    const 记: 记一笔[] = [];
    const q = new 推送队列({ 每秒: 4, 现在, 睡, 记: (x) => 记.push(x) });
    const 跑了 = new Map<number, number>();
    const 们: 排队条[] = Array.from({ length: 200 }, (_, i) => ({
      收件人: `ou_${i % 17}`,
      先后: 推送先后(种类们[i % 种类们.length]),
      跑: async () => void 跑了.set(i, (跑了.get(i) ?? 0) + 1),
      过期: async () => { throw new Error("不该过期"); },
    }));
    await q.入队(们);
    expect(跑了.size).toBe(200);
    expect([...跑了.values()].every((n) => n === 1)).toBe(true);
    expect(记.filter((x) => x.过期)).toEqual([]);
    expect(最大每秒(记)).toBeLessThanOrEqual(4);
    expect(同人最小间隔(记)).toBeGreaterThanOrEqual(1000);
    expect(先后违反(记)).toBe(0);
    // 收件人够多时就是严格按先后：所有超时类在第一条知会类之前发完
    const 第一条知会 = 记.findIndex((x) => x.先后 === 知会类先后);
    expect(记.slice(第一条知会).some((x) => x.先后 === 0)).toBe(false);
    // 200 条 4 条 / 秒 ≈ 50 秒发完
    expect(记.at(-1)!.时刻 - 记[0].时刻).toBeLessThan(51_000);
  });

  it("同一个人连着好几条：每条隔 1 秒，中间让别人的先发", async () => {
    const { 现在, 睡 } = 虚拟钟();
    const 记: 记一笔[] = [];
    const q = new 推送队列({ 每秒: 4, 现在, 睡, 记: (x) => 记.push(x) });
    const 条 = (收件人: string, 先后: number): 排队条 => ({ 收件人, 先后, 跑: async () => {}, 过期: async () => {} });
    await q.入队([条("甲", 0), 条("甲", 0), 条("甲", 0), 条("乙", 3), 条("丙", 3)]);
    expect(记.map((x) => x.收件人)).toEqual(["甲", "乙", "丙", "甲", "甲"]);
    expect(同人最小间隔(记)).toBeGreaterThanOrEqual(1000);
  });

  it("几批分开入队（几处同时触发）也共用一个速率", async () => {
    const { 现在, 睡 } = 虚拟钟();
    const 记: 记一笔[] = [];
    const q = new 推送队列({ 每秒: 4, 现在, 睡, 记: (x) => 记.push(x) });
    const 批 = (k: number) => Array.from({ length: 30 }, (_, i): 排队条 => ({ 收件人: `ou_${k}_${i}`, 先后: k, 跑: async () => {}, 过期: async () => {} }));
    await Promise.all([q.入队(批(3)), q.入队(批(2)), q.入队(批(0))]);
    expect(记.length).toBe(90);
    expect(最大每秒(记)).toBeLessThanOrEqual(4);
  });

  it("积压上限：排了超过 8 分钟没轮到的不发、交给 过期()；上限比收拾卡住的推送的 10 分钟短", async () => {
    expect(推送积压上限分钟).toBeLessThan(推送卡住分钟);
    const { 现在, 睡 } = 虚拟钟();
    const 记: 记一笔[] = [];
    const q = new 推送队列({ 每秒: 1, 积压上限毫秒: 推送积压上限分钟 * 60_000, 现在, 睡, 记: (x) => 记.push(x) });
    let 跑 = 0, 过期 = 0;
    // 先后最靠后的 700 条 + 超时类 10 条：1 条 / 秒，8 分钟只发得完 481 条，超时类排最前
    const 们: 排队条[] = [
      ...Array.from({ length: 700 }, (_, i): 排队条 => ({ 收件人: `ou_${i}`, 先后: 3, 跑: async () => void 跑++, 过期: async () => void 过期++ })),
      ...Array.from({ length: 10 }, (_, i): 排队条 => ({ 收件人: `ou_t${i}`, 先后: 0, 跑: async () => void 跑++, 过期: async () => void 过期++ })),
    ];
    await q.入队(们);
    expect(跑 + 过期).toBe(710);
    expect(过期).toBeGreaterThan(0);
    expect(记.slice(0, 10).every((x) => x.先后 === 0 && !x.过期)).toBe(true);
    // 发出去的每条等的都不超过上限
    for (const x of 记.filter((y) => !y.过期)) expect(x.时刻 - x.入队).toBeLessThanOrEqual(推送积压上限分钟 * 60_000);
    expect(q.排着).toBe(0);
  });
});

/* ───────────────────────── 接上库和假 fetch ───────────────────────── */

const 令牌地址 = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const 回 = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const 环境 = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;
let 人们: string[] = [];

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  清飞书推送令牌();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  process.env.ENT_FEISHU_APP_ID = "cli_test";
  process.env.ENT_FEISHU_APP_SECRET = "s3cr3t";
  await setSetting(飞书推送开关键, true);
  人们 = [];
  for (let i = 0; i < 20; i++) {
    人们.push((await prisma.user.create({ data: { email: `u${i}@x`, name: `人${i}`, title: "", role: "SALES", password: "x", feishuOpenId: `ou_${i}` } })).id);
  }
});
afterEach(async () => {
  await 等推送队列空();
  换推送队列();
  vi.unstubAllGlobals();
  process.env = { ...环境 };
});

async function 建通知(n: number, 种类of: (i: number) => string, createdAt?: Date): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await prisma.entNotice.create({
      data: { userId: 人们[i % 人们.length], kind: 种类of(i), title: `通知${i}`, body: "", dedupeKey: `k${i}`, ...(createdAt ? { createdAt } : {}) },
      select: { id: true },
    });
    ids.push(r.id);
  }
  return ids;
}

const 发消息们 = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("/im/v1/messages"));

describe("推通知们走队列", () => {
  it("200 条混合类型：全部已推、每条只发一次、速率 / 同人间隔 / 超时类先出都对", async () => {
    const { 现在, 睡 } = 虚拟钟();
    const 记: 记一笔[] = [];
    换推送队列({ 每秒: 4, 现在, 睡, 记: (x) => 记.push(x) });
    fetchMock.mockImplementation(async (url: string) => (url === 令牌地址 ? 回({ code: 0, tenant_access_token: "tok", expire: 7200 }) : 回({ code: 0 })));
    const ids = await 建通知(200, (i) => 种类们[(i * 3) % 种类们.length]);
    // 打乱顺序交进去
    await 推通知们([...ids].reverse());
    const 行们 = await prisma.entNotice.findMany({ select: { id: true, kind: true, feishuStatus: true } });
    expect(行们.filter((r) => r.feishuStatus !== "已推")).toEqual([]);
    expect(发消息们().length).toBe(200);
    expect(new Set(发消息们().map(([, init]) => JSON.parse((init as RequestInit).body as string).uuid)).size).toBe(200);
    expect(fetchMock.mock.calls.filter(([url]) => url === 令牌地址).length).toBe(1); // 并发发送也只拿一次令牌
    expect(最大每秒(记)).toBeLessThanOrEqual(4);
    expect(同人最小间隔(记)).toBeGreaterThanOrEqual(1000);
    expect(先后违反(记)).toBe(0);
    expect(记[0].先后).toBe(0);
  });

  it("飞书回限流：记失败、不重试", async () => {
    const { 现在, 睡 } = 虚拟钟();
    换推送队列({ 每秒: 4, 现在, 睡 });
    fetchMock.mockImplementation(async (url: string) =>
      url === 令牌地址 ? 回({ code: 0, tenant_access_token: "tok", expire: 7200 }) : 回({ code: 99991400, msg: "request trigger frequency limit" }, 429),
    );
    const ids = await 建通知(12, () => "跟进到期");
    await 推通知们(ids);
    expect(发消息们().length).toBe(12);
    const 行们 = await prisma.entNotice.findMany();
    expect(行们.every((r) => r.feishuStatus === "失败" && /99991400/.test(r.feishuError ?? ""))).toBe(true);
  });

  it("排太久没轮到：记失败（排太久话），一次 fetch 都不发", async () => {
    const { 钟, 现在, 睡 } = 虚拟钟();
    // 睡一下就拨过 9 分钟：第一条发完，后面的都超了积压上限
    换推送队列({ 每秒: 1, 现在, 睡: async (ms) => { await 睡(ms); 钟.t += 9 * 60_000; } });
    fetchMock.mockImplementation(async (url: string) => (url === 令牌地址 ? 回({ code: 0, tenant_access_token: "tok", expire: 7200 }) : 回({ code: 0 })));
    const ids = await 建通知(5, (i) => (i === 0 ? 超时通知种类 : 快轮到kind));
    await 推通知们(ids);
    const 行们 = await prisma.entNotice.findMany();
    expect(行们.find((r) => r.kind === 超时通知种类)!.feishuStatus).toBe("已推");
    const 没发 = 行们.filter((r) => r.kind === 快轮到kind);
    expect(没发.every((r) => r.feishuStatus === "失败" && r.feishuError === 排太久话)).toBe(true);
    expect(发消息们().length).toBe(1);
  });

  it("进程中途退出：残留的「待推」「推送中」10 分钟后由收拾卡住的推送记成失败", async () => {
    // 真时钟、1 条 / 秒：第一条发出去卡住不回（推送中），其余还在排（待推），这时进程没了
    const q = 换推送队列({ 每秒: 1 });
    fetchMock.mockImplementation((url: string) =>
      url === 令牌地址 ? Promise.resolve(回({ code: 0, tenant_access_token: "tok", expire: 7200 })) : new Promise<Response>(() => {}),
    );
    const 早 = new Date(Date.now() - 1000);
    const ids = await 建通知(6, () => "跟进到期", 早);
    void 推通知们(ids);
    await vi.waitFor(() => expect(发消息们().length).toBe(1));
    expect(q.扔掉()).toBe(5);
    const 状态 = async () => (await prisma.entNotice.findMany({ select: { feishuStatus: true } })).map((r) => r.feishuStatus).sort();
    expect(await 状态()).toEqual(["待推", "待推", "待推", "待推", "待推", "推送中"]);
    // 不到 10 分钟不收
    expect(await 收拾卡住的推送(new Date(早.getTime() + 5 * 60_000), true)).toBe(0);
    expect(await 收拾卡住的推送(new Date(早.getTime() + (推送卡住分钟 + 1) * 60_000), true)).toBe(6);
    const 行们 = await prisma.entNotice.findMany();
    expect(行们.every((r) => r.feishuStatus === "失败" && r.feishuError === 推送卡住话)).toBe(true);
    // 卡住的那条在 afterEach 里别等它
    换推送队列();
  });
});
