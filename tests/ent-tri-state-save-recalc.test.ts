/**
 * 客户三态 · 沟通生效日（M-公海-54）和存沟通后马上重算（用户 11-12「按建议」）：
 *   - 一条沟通算哪天的动静 = 沟通日期和写入时间里较早的（tri-state-quota.ts 沟通生效时刻），客户的钟按它拨：
 *     补录 100 天前的有效沟通只把钟推到 100 天前那天、沉睡不变；沟通日期填了未来的按写入时间算
 *   - 新建 / 改 / 删 / 撤销沟通后马上重算这一位并写回钟（tri-state-db.ts 存沟通后重算三态 = 夜扫的 写一批）：
 *     沉睡客户存一条有效沟通，钟上立刻变活跃；无效短沟通、补录旧沟通不变；三态关着一条不多查；出错不影响保存
 *   - 保存动作多出的查询条数钉在上限里
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const 记 = vi.hoisted(() => ({ 开: false, 句: [] as string[], 们: new Set<{ $queryRawUnsafe: (sql: string) => Promise<unknown> }>() }));
vi.mock("@/generated/prisma", async (原) => {
  const m = await 原<typeof import("@/generated/prisma")>();
  class 记数Client extends m.PrismaClient {
    async $disconnect() {
      记.们.delete(this as never);
      return super.$disconnect();
    }
    constructor(o: ConstructorParameters<typeof m.PrismaClient>[0] = {}) {
      super({ ...o, log: [{ emit: "event", level: "query" }, ...((o?.log as never[]) ?? [])] } as never);
      (this as unknown as { $on: (e: string, f: (x: { query: string }) => void) => void }).$on("query", (e) => { if (记.开) 记.句.push(e.query); });
      // 量的时候每个客户端都要等日志齐（tests/query-log.ts 都等齐）；断开的不再算
      记.们.add(this as never);
    }
  }
  return { ...m, PrismaClient: 记数Client };
});
const mocks = vi.hoisted(() => ({ user: { id: "", name: "乙", email: "乙", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
/** 同事的客户（团队互看「加跟进」档）那条拼接 SQL 分支：单测里凑不出团队互看，开了这个开关就让 只读客户 直接说「加跟进」 */
const 互看 = vi.hoisted(() => ({ 加跟进: false }));
vi.mock("@/lib/team-scope", async (原) => {
  const m = await 原<typeof import("@/lib/team-scope")>();
  return { ...m, 只读客户: async (...a: Parameters<typeof m.只读客户>) => (互看.加跟进 ? ("加跟进" as const) : m.只读客户(...a)) };
});
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 都等齐 } from "./query-log";
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
import { saveFollowUp, deleteFollowUp } from "@/app/(app)/customers/[id]/actions";
import { 记项目沟通 } from "@/lib/project/db";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 同号再次录入, 同号只记备注 } from "@/lib/enterprise/same-number-collab";
import { 同号节点, 同号标题不许用话, 标题占了同号 } from "@/lib/enterprise/same-number-mark";
import { 验号码 } from "@/lib/enterprise/contact-format";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读冷项目 } from "@/lib/enterprise/tri-state-detail";

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
  // 11-17 沟通必须挂项目：客户页记的沟通要有一个在推项目（一个就自动挂它），和客户一样是 400 天前建的
  await prisma.project.create({ data: { name: "项目", customerId: 客户, ownerId: 乙, creatorId: 乙, phase: "商机", node: "明确需求", createdAt: 那天(400), updatedAt: 那天(400) } });
  invalidateSettingsCache();
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  互看.加跟进 = false;
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
      记.句 = []; 记.开 = true; await 都等齐(记.们, 记.句); 记.句 = [];
      try { expect(await 记跟进(content)).toMatchObject({ ok: true }); await 都等齐(记.们, 记.句); } finally { 记.开 = false; }
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
 * 同号再次录入（same-number-collab.ts）是系统留痕、不算沟通（11-03 设计，用户 11-20 再定）：别人又录了这个号，
 * 记下的那条不替负责人续钟——写完不马上重算；之后的夜扫、存别的沟通后的重算、冷项目、最近跟进也都不把它算进去。负责人自己记的有效沟通照旧续
 */
describe("同号再次录入不续三态钟（11-20）", () => {
  const 丙录同号 = async () => {
    const 丙 = (await prisma.user.create({ data: { email: "丙", name: "丙", title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 丙, bizRole: "sales", line: "内贸" } });
    const 号 = 验号码("手机号", "13800000001");
    if (!号.ok) throw new Error("号码样例没过格式");
    const 我 = { id: 丙, name: "丙", email: "丙", role: "SALES" };
    忘掉企业版范围();
    const r = await 以谁的身份(丙, () => 同号再次录入(我, 号, { 入口: "手工建档", 内容: "展会上又聊了一次预算和交付时间" }));
    忘掉企业版范围();
    expect(r.走).toBe(true);
    return r;
  };
  const 最近跟进 = async () => (await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } })).lastFollowAt;

  it("沉睡客户被同号录入：钟马上不变，之后夜扫、手动重算也不变；归零日、最近跟进都不动", async () => {
    await 开三态(95);
    await 三态夜扫();
    expect(await 钟()).toBe("沉睡");
    const 前状态 = (await 读一位三态(客户))!;
    const 痕数 = await prisma.entCustomerStateLog.count({ where: { customerId: 客户 } });
    await 丙录同号();
    // 立即：录入本身不重算、不续钟
    expect(await 钟()).toBe("沉睡");
    // 之后：夜扫和别处的重算都把这条排除
    await 三态夜扫();
    expect(await 钟()).toBe("沉睡");
    await 存沟通后重算三态(客户);
    expect(await 钟()).toBe("沉睡");
    expect((await 读一位三态(客户))!).toMatchObject({ 状态: "沉睡", 归零日: 前状态.归零日 });
    expect(await prisma.entCustomerStateLog.count({ where: { customerId: 客户 } })).toBe(痕数);
    expect(await 最近跟进()).toBeNull();
    // 不记有效沟通标记
    const f = await prisma.followUp.findFirstOrThrow({ where: { customerId: 客户 } });
    expect(await prisma.entFollowUpFirstValid.count({ where: { followUpId: f.id } })).toBe(0);
  });

  it("同号留痕在先，负责人再记沟通：补录旧沟通只推到那天、最近跟进不被同号那条顶上去；当天有效沟通照旧变活跃（防误伤）", async () => {
    await 开三态(150);
    await 三态夜扫();
    await 丙录同号();
    expect(await 记跟进("电话聊了预算和交付时间", 100)).toMatchObject({ ok: true });
    expect(await 钟()).toBe("沉睡");
    expect((await 读一位三态(客户))!).toMatchObject({ 状态: "沉睡", 归零日: 前(100) });
    expect(beijingDay((await 最近跟进())!)).toBe(前(100));
    // 负责人当天记的有效沟通：照旧续钟、续最近跟进
    expect(await 记跟进("电话确认了下周来厂看样")).toMatchObject({ ok: true });
    expect(await 钟()).toBe("活跃");
    expect((await 读一位三态(客户))!.归零日).toBe(今天);
    expect(beijingDay((await 最近跟进())!)).toBe(今天);
  });

  it("导入撞号的同号备注（同号只记备注）：夜扫同样不算、钟不变", async () => {
    await 开三态(95);
    await 三态夜扫();
    const 号 = 验号码("手机号", "13800000001");
    if (!号.ok) throw new Error("号码样例没过格式");
    const id = await prisma.$transaction((tx) => 同号只记备注(tx, { customerId: 客户, 操作人: 乙, 号, 入口: "飞书", 来源: "展会" }));
    expect(id).toBeTruthy();
    await 三态夜扫();
    await 存沟通后重算三态(客户);
    expect(await 钟()).toBe("沉睡");
  });

  it("同事的客户（互看只许加跟进，拼接 SQL 那条分支）：同号留痕不把最近跟进顶上去", async () => {
    await 开三态(150);
    await 丙录同号();
    互看.加跟进 = true;
    expect(await 记跟进("电话聊了预算和交付时间", 100)).toMatchObject({ ok: true });
    expect(beijingDay((await 最近跟进())!)).toBe(前(100));
  });

  it("删掉一条真沟通：最近跟进回落到前一条真沟通，不落到同号留痕的时间", async () => {
    await 开三态(150);
    expect(await 记跟进("电话聊了预算和交付时间", 100)).toMatchObject({ ok: true });
    await 丙录同号();
    const r = await 记跟进("电话确认了下周来厂看样");
    expect(beijingDay((await 最近跟进())!)).toBe(今天);
    // 删沟通要系统管理员（M-权限-09：销售负责人本人删不了）
    const 管 = (await prisma.user.create({ data: { email: "管", name: "管", title: "", role: "ADMIN", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: 管, bizRole: "director" } });
    mocks.user = { ...mocks.user, id: 管, name: "管", email: "管", role: "ADMIN" };
    expect(await deleteFollowUp((r as { id: string }).id, 客户)).toMatchObject({ ok: true });
    expect(beijingDay((await 最近跟进())!)).toBe(前(100));
  });

  it("用户写的标题不许以「同号再次录入」开头（客户页记沟通、项目记沟通都拦）；改那条系统留痕本身、标题原样不动的放过", async () => {
    await 开三态(150);
    for (const title of ["同号再次录入", "  同号再次录入（来源不同）", "同号再次录入：又聊了"])
      expect(await saveFollowUp({ customerId: 客户, type: "PHONE", status: "已完成", content: "电话聊了预算和交付时间", occurredAt: `${今天} 00:00`, title })).toEqual({ ok: false, error: 同号标题不许用话 });
    // 不在开头的照存
    expect(await saveFollowUp({ customerId: 客户, type: "PHONE", status: "已完成", content: "电话聊了预算和交付时间", occurredAt: `${今天} 00:00`, title: "关于同号再次录入的说明" })).toMatchObject({ ok: true });
    const 项目 = (await prisma.project.findFirstOrThrow({ where: { customerId: 客户 } })).id;
    expect(await 记项目沟通({ id: 乙, role: "SALES" } as never, 项目, { type: "PHONE", content: "电话聊了预算和交付时间", occurredAt: `${今天} 00:00`, 下一步: "下周报价", 阶段: "商机", 额外: { title: "同号再次录入" } } as never)).toMatchObject({ ok: false, error: 同号标题不许用话 });
    expect(await prisma.followUp.count({ where: { customerId: 客户, title: { startsWith: "同号再次录入" } } })).toBe(0);
    // 纯判定：编辑时标题和库里原样一致 = 放过；改成别的同号开头 = 拦
    expect(标题占了同号("同号再次录入", "同号再次录入")).toBe(false);
    expect(标题占了同号(" 同号再次录入 ", "同号再次录入")).toBe(false);
    expect(标题占了同号("同号再次录入（来源不同）", "同号再次录入")).toBe(true);
    expect(标题占了同号("同号再次录入")).toBe(true);
    expect(标题占了同号("")).toBe(false);
    expect(标题占了同号(undefined)).toBe(false);
  });

  it("冷项目：同号留痕挂在项目上不清冷标；负责人记一条挂项目的有效沟通才清", async () => {
    await 开三态(95);
    const 项目 = (await prisma.project.findFirstOrThrow({ where: { customerId: 客户 } })).id;
    expect((await 读冷项目([项目]))[项目]).toBe(95);
    await 丙录同号();
    expect(await prisma.followUpProject.count({ where: { projectId: 项目, node: 同号节点 } })).toBe(1);
    expect((await 读冷项目([项目]))[项目]).toBe(95);
    expect(await 记跟进("电话聊了预算和交付时间")).toMatchObject({ ok: true });
    expect((await 读冷项目([项目]))[项目]).toBeUndefined();
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
  额度、暂缓次数重置（M-公海-54，客户 11-12 更正）：同一位客户当天只重置一次。实时记的有效沟通（生效日 = 首次有效那天）就重置，
  不管当天是否已有建项目、换节点；补录的（含先存无效后改有效）要严格晚于改动前的「当前最近动静日」；起算日（设置里的）及以前的不算；
  只换节点、只建项目只推钟、不重置次数（M-公海-54，客户 11-12 确认：动钟和动次数是两套条件，动次数只认有效沟通和公海领取 / 分配）；
  按事实算，撤销了回到没记时的样子。「实时」看的是这条沟通第一次被判为有效的时刻（EntFollowUpFirstValid，没有那一行按建的时刻），
  不看 updatedAt：事后改字、挂接联系人、客户恢复都不改变它是当天实时记的
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
  /** 沟通日期第 日 天、第 写 天写进来（建的时候就有效：首次有效时刻 = 建的时刻） */
  const 沟通 = (日: number, 写: number, 时 = "10:00", content = "电话聊了预算和交付时间") => prisma.followUp.create({ data: { customerId: 客户, ownerId: 乙, type: "PHONE", title: "", content, occurredAt: 第(日, 时), createdAt: 第(写, 时), updatedAt: 第(写, 时) } });
  /** 记完的沟通只有管理能改（follow-perm.ts）：要改沟通的用例把乙换成销售管理 */
  const 当管理 = async () => { await prisma.entMember.update({ where: { userId: 乙 }, data: { bizRole: "sales_mgr" } }); invalidateSettingsCache(); };
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

  it("只换节点、没有有效沟通：只推钟、不重置（M-公海-54，客户 11-12 确认）", async () => {
    await 推进(140);
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 归零日: 加天(起算, 140), 重置日: null });
  });

  it("只建档 / 只建项目（没带沟通）：只推钟、不重置继续持有和暂缓回收次数（M-公海-54，客户 11-12 确认）", async () => {
    await prisma.project.create({ data: { name: "只建项目", customerId: 客户, ownerId: 乙, creatorId: 乙, createdAt: 第(140, "09:00") } });
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 归零日: 加天(起算, 140), 重置日: null });
  });

  it("从公海领取 / 分配：重置继续持有和暂缓回收次数", async () => {
    await prisma.customerOwnerLog.create({ data: { customerId: 客户, userId: 乙, fromOwnerId: null, toOwnerId: 乙, kind: "claim", at: 第(140) } });
    expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 重置日: 加天(起算, 140) });
    await 持有过(150);
    await 暂缓过(151);
    await prisma.customerOwnerLog.create({ data: { customerId: 客户, userId: 乙, fromOwnerId: null, toOwnerId: 乙, kind: "pool-assign", at: 第(160) } });
    expect(await 看()).toMatchObject({ 额度用了: 0, 暂缓: 0, 重置日: 加天(起算, 160) });
  });

  it("实时记的有效沟通事后被改（第五轮）：第 D 天记有效沟通并换节点、之后又推进；第 D+1 天改错别字、挂接联系人、客户软删再恢复 → 重置日、次数都不变", async () => {
    await 推进(140, "09:00");
    const f = await 沟通(140, 140, "10:00");
    await 推进(145);
    const 前后 = { 额度用了: 0, 暂缓: 0, 重置日: 加天(起算, 140) };
    expect(await 看()).toMatchObject(前后);
    // 改错别字：走真实的保存动作（updatedAt 记成现在；记完的沟通只有管理能改，乙换成销售管理）
    await 当管理();
    expect(await saveFollowUp({ id: f.id, customerId: 客户, type: "PHONE", status: "已完成", content: "电话聊了预算和交付时问", occurredAt: `${加天(起算, 140)} 10:00` })).toMatchObject({ ok: true });
    expect(await prisma.entFollowUpFirstValid.count()).toBe(0);
    expect(await 看()).toMatchObject(前后);
    // 挂接联系人（customers/[id]/actions.ts 挂上 只改 contactId）、客户软删再恢复连带的改动：都只刷新 updatedAt
    const 人 = await prisma.contact.create({ data: { name: "联系人", customerId: 客户 } });
    await prisma.followUp.update({ where: { id: f.id }, data: { contactId: 人.id, updatedAt: 第(141) } });
    await prisma.followUp.updateMany({ where: { customerId: 客户 }, data: { deletedAt: 第(141, "12:00"), updatedAt: 第(141, "12:00") } });
    await 看已删(() => prisma.followUp.updateMany({ where: { customerId: 客户 }, data: { deletedAt: null, updatedAt: 第(141, "13:00") } }));
    expect(await prisma.followUp.count({ where: { customerId: 客户 } })).toBe(1);
    expect(await 看()).toMatchObject(前后);
  });

  it("首次有效时刻（第五轮）：新建就有效的不记行（= 建的时刻）；先无效后改有效记改的那一刻；之后改字、改回无效再改有效都不动", async () => {
    const 新 = await 记跟进("电话聊了预算和交付时间");
    expect(新).toMatchObject({ ok: true });
    expect(await prisma.entFollowUpFirstValid.count()).toBe(0);
    const 短 = await 记跟进("OK");
    if (!短.ok) throw new Error("没存上");
    const 改 = (content: string) => saveFollowUp({ id: 短.id, customerId: 客户, type: "PHONE", status: "已完成", content, occurredAt: `${今天} 00:00` });
    await 当管理();
    const 改前 = Date.now();
    expect(await 改("客户要华东三个仓的报价")).toMatchObject({ ok: true });
    const 行 = await prisma.entFollowUpFirstValid.findUniqueOrThrow({ where: { followUpId: 短.id } });
    expect(行.at.getTime()).toBeGreaterThanOrEqual(改前 - 1000);
    expect(行.at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    for (const c of ["客户要华南三个仓的报价", "OK", "客户要华北三个仓的报价"]) expect(await 改(c)).toMatchObject({ ok: true });
    expect((await prisma.entFollowUpFirstValid.findUniqueOrThrow({ where: { followUpId: 短.id } })).at).toEqual(行.at);
    expect(await prisma.entFollowUpFirstValid.count()).toBe(1);
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
    // 改成有效的那一刻记进首次有效时刻（保存动作里 记首次有效 写的就是这一行）
    await prisma.followUp.update({ where: { id: f.id }, data: { content: "电话聊了预算和交付时间", updatedAt: 第(140) } });
    await prisma.entFollowUpFirstValid.create({ data: { followUpId: f.id, at: 第(140) } });
    expect(await 看()).toMatchObject({ 额度用了: 1, 暂缓: 1, 重置日: null });
    const g = await 沟通(150, 150, "10:00", "OK");
    await prisma.followUp.update({ where: { id: g.id }, data: { content: "电话聊了预算和交付时间", updatedAt: 第(150, "11:00") } });
    await prisma.entFollowUpFirstValid.create({ data: { followUpId: g.id, at: 第(150, "11:00") } });
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
    "lib/enterprise/same-number-collab.ts#同号只记备注": "只有导入在用（apply.ts），整批；系统留痕不算沟通，夜扫也按标题排除",
    "lib/enterprise/same-number-collab.ts#同号再次录入": "系统留痕不算沟通、不续钟（11-03 设计、用户 11-20）；夜扫按标题排除（same-number-mark.ts）",
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
    "lib/project/wizard.ts#只建客户接着建": ["app/(app)/projects/actions.ts#只建客户写"],
    "lib/project/from-lead.ts#线索建项目": ["app/(app)/leads/actions.ts#转项目之后"],
    "lib/enterprise/soft-delete.ts#表": ["lib/enterprise/soft-delete.ts#恢复一条"],
    "lib/enterprise/dedupe-claim.ts#查重领取记沟通": ["app/(app)/customers/pool-actions.ts#查重领取"],
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
