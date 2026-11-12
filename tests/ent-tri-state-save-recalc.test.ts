/**
 * 客户三态 · 沟通生效日（M-公海-54）和存沟通后马上重算（用户 11-12「按建议」）：
 *   - 一条沟通算哪天的动静 = 沟通日期和写入时间里较早的（tri-state-quota.ts 沟通生效时刻），客户的钟按它拨：
 *     补录 100 天前的有效沟通只把钟推到 100 天前那天、沉睡不变；沟通日期填了未来的按写入时间算
 *   - 新建 / 改 / 删 / 撤销沟通后马上重算这一位并写回钟（tri-state-db.ts 存沟通后重算三态 = 夜扫的 写一批）：
 *     沉睡客户存一条有效沟通，钟上立刻变活跃；无效短沟通、补录旧沟通不变；三态关着一条不多查；出错不影响保存
 *   - 保存动作多出的查询条数钉在上限里
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const 记 = vi.hoisted(() => ({ 开: false, 句: [] as string[] }));
vi.mock("@/generated/prisma", async (原) => {
  const m = await 原<typeof import("@/generated/prisma")>();
  class 记数Client extends m.PrismaClient {
    constructor(o: ConstructorParameters<typeof m.PrismaClient>[0] = {}) {
      super({ ...o, log: [{ emit: "event", level: "query" }, ...((o?.log as never[]) ?? [])] } as never);
      (this as unknown as { $on: (e: string, f: (x: { query: string }) => void) => void }).$on("query", (e) => { if (记.开) 记.句.push(e.query); });
    }
  }
  return { ...m, PrismaClient: 记数Client };
});
const mocks = vi.hoisted(() => ({ user: { id: "", name: "乙", email: "乙", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 默认组织规则, 默认三态规则 } from "@/lib/project/org-rules";
import { 三态夜扫, 存沟通后重算三态, 收三态客户 } from "@/lib/enterprise/tri-state-db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 读组织 } from "@/lib/enterprise/org";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { 加天 } from "@/lib/enterprise/tri-state";
import { 沟通生效时刻 } from "@/lib/enterprise/tri-state-quota";
import { 读一位三态 } from "@/lib/enterprise/tri-state-hold";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { beijingDay } from "@/lib/business-clock";
import { saveFollowUp } from "@/app/(app)/customers/[id]/actions";

/*
  保存动作用真实的现在（写入时间是数据库引擎记的，假不了 Date），所以按今天往回数：系统起算日设成 起算前 天前，
  今天就是第 起算前 天（默认 90 天沉睡、180 天待回收）
*/
const 今天 = beijingDay(new Date());
const 前 = (n: number) => 加天(今天, -n);
const 那天 = (n: number) => new Date(`${前(n)}T00:00:00+08:00`);

let 乙: string, 客户: string;
const 钟 = async () => (await prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: 客户 } })).state;
/** 记一条已完成的电话沟通；几天前 = 沟通日期填几天前（0 = 今天，零点，不会落到未来） */
const 记跟进 = (content: string, 几天前 = 0) => saveFollowUp({ customerId: 客户, type: "PHONE", status: "已完成", content, occurredAt: `${前(几天前)} 00:00` });
const 开三态 = (起算前: number) => setSetting("orgRules", { ...默认组织规则, 超时回收: { ...默认组织规则.超时回收, 起算日: 前(起算前) }, 三态: { ...默认三态规则, 开: true } });

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  乙 = (await prisma.user.create({ data: { email: "乙", name: "乙", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: 乙, bizRole: "sales", line: "内贸" } });
  mocks.user = { ...mocks.user, id: 乙 };
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 乙, createdAt: 那天(400) } })).id;
  invalidateSettingsCache();
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
});
afterAll(async () => { await prisma.$disconnect(); });

describe("沟通生效日（M-公海-54）", () => {
  it("取沟通日期和写入时间里较早的；沟通日期空的落到写入时间", () => {
    const 早的 = new Date("2026-08-01T10:00:00+08:00"), 今 = new Date("2026-11-12T10:00:00+08:00"), 未来 = new Date("2027-01-01T10:00:00+08:00");
    expect(沟通生效时刻(早的, 今)).toBe(早的);
    expect(沟通生效时刻(未来, 今)).toBe(今);
    expect(沟通生效时刻(null, 今)).toBe(今);
  });

  it("客户的钟：今天补录沟通日期 100 天前的有效沟通，钟只拨到 100 天前那天、沉睡不变", async () => {
    await 开三态(150);
    await 三态夜扫();
    expect(await 钟()).toBe("沉睡");
    expect(await 记跟进("电话聊了预算和交付时间", 100)).toMatchObject({ ok: true });
    expect(await 钟()).toBe("沉睡");
    expect((await 读一位三态(客户))!).toMatchObject({ 状态: "沉睡", 归零日: 前(100) });
  });

  it("沟通日期填了未来的（导入、旧数据）：按写入时间算，今天写的就是今天的动静", async () => {
    await 开三态(150);
    await 三态夜扫();
    await prisma.followUp.create({ data: { customerId: 客户, ownerId: 乙, type: "PHONE", title: "", content: "电话聊了预算和交付时间", occurredAt: new Date(Date.now() + 30 * 86400_000) } });
    await 存沟通后重算三态(客户);
    expect(await 钟()).toBe("活跃");
    expect((await 读一位三态(客户))!.归零日).toBe(今天);
  });
});

describe("存沟通后马上重算", () => {
  it("沉睡客户存一条有效沟通：钟上立刻变活跃，不等夜扫；无效短沟通不变（还回一句轻提示）", async () => {
    await 开三态(95);
    await 三态夜扫();
    expect(await 钟()).toBe("沉睡");
    expect(await 记跟进("OK")).toMatchObject({ ok: true, 短沟通: "太短" });
    expect(await 钟()).toBe("沉睡");
    expect(await 记跟进("电话聊了预算和交付时间")).toMatchObject({ ok: true });
    expect(await 钟()).toBe("活跃");
    const 痕 = await prisma.entCustomerStateLog.findMany({ where: { customerId: 客户 }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 1 });
    expect(痕[0]).toMatchObject({ fromState: "沉睡", toState: "活跃", via: "自动" });
  });

  it("删掉那条有效沟通后马上重算：回沉睡；三态关着不重算、不碰钟", async () => {
    await 开三态(95);
    await 三态夜扫();
    const r = await 记跟进("电话聊了预算和交付时间");
    expect(await 钟()).toBe("活跃");
    await prisma.followUp.update({ where: { id: (r as { id: string }).id }, data: { deletedAt: new Date() } });
    await 存沟通后重算三态(客户);
    expect(await 钟()).toBe("沉睡");
    await setSetting("orgRules", { ...默认组织规则 });
    invalidateSettingsCache();
    expect(await 记跟进("电话又聊了一次交付")).toMatchObject({ ok: true });
    expect(await 钟()).toBe("沉睡");
  });

  it("重算出错不影响保存（吞掉）", async () => {
    await expect(存沟通后重算三态({ bad: 1 } as unknown as string)).resolves.toBeUndefined();
  });

  it("保存动作多出的查询：三态关着 0 条；开着时一位客户的重算一套，不随沟通条数涨", async () => {
    await 开三态(95);
    await 三态夜扫();
    const 量 = async (content: string) => {
      记.句 = []; 记.开 = true;
      try { expect(await 记跟进(content)).toMatchObject({ ok: true }); } finally { 记.开 = false; }
      return 记.句;
    };
    await 量("电话聊了预算和交付时间"); // 第一条会建默认字典这类一次性的
    const 开着 = (await 量("电话又聊了一次交付时间")).length;
    for (let i = 0; i < 30; i++) await prisma.followUp.create({ data: { customerId: 客户, ownerId: 乙, type: "PHONE", title: "", content: "OK", occurredAt: 那天(5), createdAt: 那天(5) } });
    const 多沟通 = (await 量("再聊了一次交付和付款")).length;
    await setSetting("orgRules", { ...默认组织规则 });
    invalidateSettingsCache();
    await 量("关着时记一条沟通");
    const 关着句 = await 量("关着时再记一条沟通");
    expect(关着句.filter((q) => /EntCustomerClock|EntCustomerStateLog/.test(q))).toEqual([]);
    expect(多沟通).toBe(开着);
    expect(开着 - 关着句.length).toBeLessThanOrEqual(存沟通后多查上限);
  });
});

/**
 * 存一条沟通后重算多出的查询上限（钟不用改的那种：事务外收一遍事实、算完不开写事务）。
 * 11-12 第一版（总是开写事务）实测关 11 / 开 32，多 21；第三轮先算后写，实测多 19 条，上限 = 实测 +2。要写钟时再加一遍事务里的重收和写
 */
const 存沟通后多查上限 = 21;

/** 软删一条沟通再重算（撤销 / 删除动作最后都是这两步：沟通不算了 → 存沟通后重算三态） */
const 删了重算 = async (id: string) => {
  await prisma.followUp.update({ where: { id }, data: { deletedAt: new Date() } });
  await 存沟通后重算三态(客户);
};
const 钟行 = () => prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: 客户 } });

describe("存了又撤：本轮已发的提醒和没发生过一样（第三轮第 1 条）", () => {
  it("待回收、已提醒 2 次 → 存有效沟通（变活跃）→ 撤销：仍是 2 次、最近提醒日不变、不重发、最早进公海日不变", async () => {
    await 开三态(185);
    await 三态夜扫();
    expect(await 钟()).toBe("待回收");
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 2, lastNoticeDay: 前(1) } });
    const 前r = (await 读一位三态(客户))!;
    const r = await 记跟进("电话聊了预算和交付时间");
    expect(await 钟()).toBe("活跃");
    await 删了重算((r as { id: string }).id);
    const 后 = await 钟行();
    expect(后).toMatchObject({ state: "待回收", noticeCount: 2, lastNoticeDay: 前(1) });
    const 后r = (await 读一位三态(客户))!;
    expect(后r.最早进公海日).toBe(前r.最早进公海日);
    expect(后r.提醒).toEqual(前r.提醒);
  });

  it("沉睡、进入沉睡那条已发 → 存了又删：不重发进入沉睡", async () => {
    await 开三态(95);
    await 三态夜扫();
    expect((await 读一位三态(客户))!.提醒).toMatchObject({ 事由: "进入沉睡" });
    // 进入沉睡那条发过了（提醒那遍发成会记最近提醒日）
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { lastNoticeDay: 今天 } });
    expect((await 读一位三态(客户))!.提醒).toBeNull();
    const 钟前 = await 钟行();
    const r = await 记跟进("电话聊了预算和交付时间");
    expect(await 钟()).toBe("活跃");
    await 删了重算((r as { id: string }).id);
    expect(await 钟行()).toMatchObject({ state: "沉睡", lastNoticeDay: 今天, noticeCount: 钟前.noticeCount });
    expect((await 读一位三态(客户))!.提醒).toBeNull();
  });

  it("回到的不是进活跃之前那个状态不算同一轮（第四轮第 2 条）：待回收时记当天沟通变活跃、再把日期改早落到沉睡 = 直接补录同日期沟通", async () => {
    await 开三态(195);
    const 另一位 = (await prisma.customer.create({ data: { name: "客户乙", phone: "13800000002", salesOwnerId: 乙, createdAt: 那天(400) } })).id;
    await 三态夜扫();
    // 两位都待回收、第 190 天（5 天前）发过 1 次待回收提醒
    await prisma.entCustomerClock.updateMany({ where: { customerId: { in: [客户, 另一位] } }, data: { noticeCount: 1, lastNoticeDay: 前(5) } });
    expect((await prisma.entCustomerClock.findMany({ where: { customerId: { in: [客户, 另一位] } } })).map((x) => x.state)).toEqual(["待回收", "待回收"]);
    // 路一：今天记一条当天的有效沟通（变活跃），再把沟通日期改到第 100 天
    const r = await 记跟进("电话聊了预算和交付时间");
    expect(await 钟()).toBe("活跃");
    await prisma.followUp.update({ where: { id: (r as { id: string }).id }, data: { occurredAt: 那天(95) } });
    await 存沟通后重算三态(客户);
    // 路二：直接补录一条第 100 天的有效沟通
    await prisma.followUp.create({ data: { customerId: 另一位, ownerId: 乙, type: "PHONE", title: "", content: "电话聊了预算和交付时间", occurredAt: 那天(95) } });
    await 存沟通后重算三态(另一位);
    const 取 = async (id: string) => {
      const k = await prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: id } });
      return { state: k.state, enteredDay: k.enteredDay, noticeCount: k.noticeCount, lastNoticeDay: k.lastNoticeDay, 提醒: (await 读一位三态(id))!.提醒?.事由 ?? null };
    };
    const 一 = await 取(客户), 二 = await 取(另一位);
    expect(一).toEqual(二);
    expect(一).toMatchObject({ state: "沉睡", noticeCount: 0, lastNoticeDay: null, 提醒: "进入沉睡" });
  });

  it("夜扫隔了一轮真的变活跃再到期：照旧清零、重新起一轮", async () => {
    await 开三态(185);
    await 三态夜扫();
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 2, lastNoticeDay: 前(1) } });
    expect(await 记跟进("电话聊了预算和交付时间")).toMatchObject({ ok: true });
    expect(await 钟行()).toMatchObject({ state: "活跃", noticeCount: 2 }); // 活跃时这几列没人读，先留着
    // 100 天后夜扫：沉睡是新一轮（节点日晚于上次提醒），清零，进入沉睡那条要重新发
    const 以后 = new Date(Date.now() + 100 * 86400_000);
    await 三态夜扫(以后);
    expect(await 钟行()).toMatchObject({ state: "沉睡", noticeCount: 0, lastNoticeDay: null });
    expect((await 读一位三态(客户, 以后))!.提醒).toMatchObject({ 事由: "进入沉睡" });
  });
});

/*
  额度、暂缓次数重置（M-公海-54，客户 11-12 更正）：同一位客户当天只重置一次。实时记的有效沟通（生效日 = 最后改动那天）就重置，
  不管当天是否已有建项目、换节点；补录的（含先存无效后改有效）要严格晚于改动前的「当前最近动静日」；起算日（设置里的）及以前的不算；
  只换节点、只建项目不重置（X-109 待客户确认）；按事实算，撤销了回到没记时的样子
*/
describe("额度与暂缓次数重置只认真推进了钟的沟通", () => {
  let 起算: string;
  const 第 = (n: number, 时 = "10:00") => new Date(`${加天(起算, n)}T${时}:00+08:00`);
  const 持有过 = (n: number) => prisma.entCustomerStateLog.create({ data: { customerId: 客户, fromState: "沉睡", toState: "沉睡", via: "本人", userId: 乙, reason: "我还在跟", holdDays: 30, at: 第(n) } });
  const 暂缓过 = (n: number) => prisma.entCustomerStateLog.create({ data: { customerId: 客户, fromState: "待回收", toState: "待回收", via: "总管理裁决", userId: 乙, reason: "暂缓回收", at: 第(n) } });
  const 推进 = async (n: number, 时 = "09:00") => {
    const p = await prisma.project.findFirst({ where: { customerId: 客户 } }) ?? await prisma.project.create({ data: { name: "项目", customerId: 客户, ownerId: 乙, creatorId: 乙, createdAt: 第(1) } });
    await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 乙, toPhase: "线索", toNode: "初步接触", at: 第(n, 时) } });
  };
  /** 沟通日期第 日 天、第 写 天写进来（最后改动也是那时） */
  const 沟通 = (日: number, 写: number, 时 = "10:00", content = "电话聊了预算和交付时间") => prisma.followUp.create({ data: { customerId: 客户, ownerId: 乙, type: "PHONE", title: "", content, occurredAt: 第(日, 时), createdAt: 第(写, 时), updatedAt: 第(写, 时) } });
  const 看 = async () => {
    const 规则 = await 生效组织规则();
    const c = (await 收三态客户(prisma, [客户], 规则, await 读组织(), new Date())).get(客户)!;
    return { 额度用了: (await 读一位三态(客户))!.继续持有.已用次数, 暂缓: c.事实.暂缓回收次数, 归零日: (await 读一位三态(客户))!.归零日, 重置日: c.事实.额度重置日 };
  };

  beforeEach(async () => {
    await 开三态(200);
    invalidateSettingsCache();
    起算 = (await 生效组织规则()).超时回收.起算日!;
    await 持有过(95);
    await 暂缓过(96);
  });

  it("客户原话的例子：第 95 天用过一次继续持有，第 130 天项目推进，今天补录第 100 天的有效沟通 → 不推钟、不重置、第 95 天那次仍算用掉", async () => {
    await 推进(130);
    await 沟通(100, 199);
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 归零日: 加天(起算, 130), 重置日: null });
  });

  it("当天只重置一次、不看当天有没有别的动静：先换节点、再实时记一条有效沟通 → 重置", async () => {
    await 推进(140, "09:00");
    await 沟通(140, 140, "10:00");
    expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 归零日: 加天(起算, 140), 重置日: 加天(起算, 140) });
  });

  it("只换节点、没有有效沟通：只推钟、不重置（X-109 待客户确认）", async () => {
    await 推进(140);
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 归零日: 加天(起算, 140), 重置日: null });
  });

  it("建项目同时带出的首条沟通（向导 / 新建项目 / 转项目）：有真实内容的重置一次，占位文案不重置", async () => {
    const 建 = async (content: string) => {
      const p = await prisma.project.create({ data: { name: "新项目", customerId: 客户, ownerId: 乙, creatorId: 乙, createdAt: 第(140, "09:00") } });
      await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 乙, toPhase: "线索", toNode: "潜客培育", at: 第(140, "09:00") } });
      const f = await 沟通(140, 140, "09:00", content);
      await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: p.id, node: "潜客培育" } });
      return p.id;
    };
    const p = await 建("跟进");
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 归零日: 加天(起算, 140) });
    await prisma.project.update({ where: { id: p }, data: { deletedAt: new Date() } });
    await 建("客户要华东三个仓的报价，下周给方案");
    expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 重置日: 加天(起算, 140) });
  });

  it("防倒补（第四轮第 1 条）：第 129 天记无效短沟通、第 130 天项目推进、第 140 天把它改成有效 → 不重置；当天记无效、当天改成有效、期间没别的动静 → 照常重置", async () => {
    await 推进(130);
    const f = await 沟通(129, 129, "10:00", "OK");
    await prisma.followUp.update({ where: { id: f.id }, data: { content: "电话聊了预算和交付时间", updatedAt: 第(140) } });
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 重置日: null });
    const g = await 沟通(150, 150, "10:00", "OK");
    await prisma.followUp.update({ where: { id: g.id }, data: { content: "电话聊了预算和交付时间", updatedAt: 第(150, "11:00") } });
    expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 重置日: 加天(起算, 150) });
  });

  it("删了项目额度不往回翻（第四轮第 3 条）：挡住补录沟通的那次推进所在的项目软删了，照样挡", async () => {
    await 推进(130);
    await 沟通(100, 199);
    expect(await 看()).toMatchObject({ 额度用了: 1 });
    await prisma.project.updateMany({ where: { customerId: 客户 }, data: { deletedAt: new Date() } });
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 重置日: null });
  });

  it("同一天第二条沟通不另算：第一条已经重置，第二条不再挪重置日", async () => {
    await 沟通(140, 140, "10:00");
    await 沟通(140, 140, "15:00");
    expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 重置日: 加天(起算, 140) });
  });

  it("起算日及以前的一律不算：补录起算日前的沟通不推钟、不重置", async () => {
    await 沟通(-10, 199);
    await 沟通(0, 199);
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 重置日: null });
  });

  it("严格晚于当前最近动静日的才重置（继续持有、暂缓回收一起）；撤销了按事实回去", async () => {
    await 推进(130);
    const f = await 沟通(140, 140);
    expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 归零日: 加天(起算, 140), 重置日: 加天(起算, 140) });
    await prisma.followUp.update({ where: { id: f.id }, data: { deletedAt: new Date() } });
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 归零日: 加天(起算, 130), 重置日: null });
  });

  it("实时记的沟通后来才有项目推进：那条沟通当时推进了钟，照样算重置", async () => {
    await 沟通(140, 140, "10:00");
    await 推进(140, "15:00");
    await 推进(150);
    expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 重置日: 加天(起算, 140) });
  });
});

/*
  静态守卫（第三轮第 4 条，第四轮改成按调用点）：每个写 / 改 / 删 / 恢复沟通（FollowUp）的调用点，所在的那个函数里要调 存沟通后重算三态；
  写沟通那段跑在调用方事务里的，列出调用方函数（它们里面要调）；别的逐点豁免、写明为什么。新加一个写 FollowUp 的调用点没接，这条会红。
  「所在的函数」按源码里顶格的 function / const 声明切（嵌在里面的小函数算进外层那个）
*/
describe("写沟通的调用点都接了存沟通后重算三态", () => {
  const 根 = path.resolve("src");
  const 豁免: Record<string, string> = {
    "app/(app)/demo-data.ts#清除演示数据": "清演示数据，整批",
    "app/(app)/customers/import-actions.ts#撤这一批": "导入撤销，整批，夜扫补",
    "app/(app)/customers/[id]/actions.ts#挂上": "联系人挂接沟通，只改 contactId，不改内容和日期",
    "app/(app)/customers/[id]/actions.ts#restoreContact": "恢复联系人时把沟通挂回去，只改 contactId",
    "lib/shared-ws/dataset.ts#灌演示数据": "桌面端示例数据，不跑三态",
    "lib/enterprise/legacy-cleanup.ts#清理老数据": "只把沟通从商机上解挂，不改内容和日期",
    "lib/enterprise/same-number-collab.ts#同号只记备注": "只有导入在用（apply.ts），整批，夜扫补",
    "lib/enterprise/soft-delete.ts#清过期": "回收站过期真删，删的本来就是已软删、不算数的沟通",
    "lib/enterprise-import/apply.ts#建": "导入，整批，夜扫补",
    "lib/enterprise-import/apply.ts#改": "导入，整批，夜扫补",
    "lib/enterprise-import/revert.ts#删": "导入撤销，整批，夜扫补",
    "lib/enterprise-import/revert.ts#建回": "导入撤销，整批，夜扫补",
  };
  /** 写沟通的那段跑在调用方事务里（或是通用表映射）：调用方这些函数里要调。线索建项目另有导入、启动时一次性转项目两个调用方，都是整批、夜扫补 */
  const 调用方接: Record<string, string[]> = {
    "lib/project/db.ts#记项目沟通": ["app/(app)/projects/actions.ts#记项目沟通Action"],
    "lib/project/wizard.ts#向导接着建": ["app/(app)/projects/actions.ts#建档向导"],
    "lib/project/from-lead.ts#线索建项目": ["app/(app)/leads/actions.ts#转项目之后"],
    "lib/enterprise/soft-delete.ts#表": ["lib/enterprise/soft-delete.ts#恢复一条"],
  };
  const 写沟通 = /\.followUp\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b|(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"FollowUp"|FollowUp:\s*tx\.followUp/;
  const 声明 = /^(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*([^\s(<]+)|^(export\s+)?const\s+([^\s:=]+)\s*(:[^=]+)?=\s*(cache\()?(async\s*)?(\(|function|[A-Za-z_一-鿿]+\s*=>)/;
  const 文件们 = (d: string): string[] => readdirSync(d).flatMap((n) => {
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) return n === "generated" ? [] : 文件们(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
  /** 一个文件切成顶格声明的函数：名字 → 函数体（到下一个顶格声明为止） */
  const 切函数 = (文: string) => {
    const 出 = new Map<string, string>();
    let 名 = "(顶层)", 体: string[] = [];
    const 收 = () => 出.set(名, (出.get(名) ?? "") + 体.join("\n"));
    for (const 行 of 文.split("\n")) {
      const m = 声明.exec(行);
      if (m) { 收(); 名 = m[4] ?? m[6]; 体 = []; }
      体.push(行);
    }
    收();
    return 出;
  };
  const 全 = new Map<string, Map<string, string>>();
  for (const f of 文件们(根)) 全.set(path.relative(根, f).split(path.sep).join("/"), 切函数(readFileSync(f, "utf8")));
  const 接了 = (键: string) => {
    const [文件, 名] = 键.split("#");
    return !!全.get(文件)?.get(名)?.includes("存沟通后重算三态(");
  };

  it("没接、也没豁免的写沟通调用点：没有；名单里没有过期的条目", () => {
    const 没接: string[] = [];
    const 见到 = new Set<string>();
    for (const [文件, 函数们] of 全) {
      if (文件 === "lib/enterprise/tri-state-db.ts") continue;
      for (const [名, 体] of 函数们) {
        if (!写沟通.test(体)) continue;
        const 键 = `${文件}#${名}`;
        见到.add(键);
        if (接了(键) || 键 in 豁免) continue;
        const 上 = 调用方接[键];
        if (上 && 上.every(接了)) continue;
        没接.push(键);
      }
    }
    expect(没接).toEqual([]);
    // 名单里的调用点都还在（改了函数名、挪了位置，名单要跟着改）
    expect([...Object.keys(豁免), ...Object.keys(调用方接)].filter((k) => !见到.has(k))).toEqual([]);
  });
});
