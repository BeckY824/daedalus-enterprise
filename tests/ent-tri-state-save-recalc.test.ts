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
import { 三态夜扫, 存沟通后重算三态 } from "@/lib/enterprise/tri-state-db";
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

/** 存一条沟通后重算（写一批：一笔事务里重收一位客户的事实、算、写钟）多出的查询上限：11-12 实测关 11 / 开 32，多 21 条，上限 = 实测 +2 */
const 存沟通后多查上限 = 23;
