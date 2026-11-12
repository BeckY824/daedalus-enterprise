/**
 * 客户三态 · 审查后补的用例（批 3 / 4 的 P4、P5、P6 修订）。日子都是改出来的。
 *   - 裁决、待回收写理由继续持有：收到提醒的人一定点得了（客户外贸线、负责人内贸线）
 *   - 转让归零存下来不回改：规则 2 次改 1 次后历史归零日不变；之后的转让按新规则；撤销的转让不白归零
 *   - 夜扫和按钮同时发生：钟被动过按新钟重算，不写错留痕
 *   - 提醒发到一半中断：没送到的不算进 3 次；重跑同一天补上、不重复发
 *   - 负责人停用：不给他发，上级那一级按他停用前的上级
 *   - 已删 / 已标无效不建钟；已在公海的只标一次「公海」；离职交接待确认的不收
 *   - 进公海后钟标「公海」；被领走后按换负责人重新起算
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const 坏人 = vi.hoisted(() => new Set<string>());
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
// 模拟发到一半断掉：坏人里的人那条没记上
vi.mock("@/lib/enterprise/notify", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/notify")>();
  return { ...m, notify: (ids: readonly (string | null | undefined)[], n: Parameters<typeof m.notify>[1]) => m.notify(ids.filter((u) => !u || !坏人.has(u)), n) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 三态夜扫, 三态扫过键, 收三态客户, 写一批, 公海状态 } from "@/lib/enterprise/tri-state-db";
import { 钟上三态提醒, 三态提醒水位键 } from "@/lib/enterprise/tri-state-notice";
import { 继续持有, 暂缓回收动作 } from "@/lib/enterprise/tri-state-hold";
import { 读组织 } from "@/lib/enterprise/org";
import { 默认组织规则, 默认三态规则, type 组织规则, type 三态规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 加天 } from "@/lib/enterprise/tri-state";
import { 删被撤的换负责人记录 } from "@/lib/owner-log-db";
import { 等通知推完 } from "@/lib/enterprise/notify";

const 起 = "2026-11-01";
const 日 = (n: number) => 加天(起, n);
const 早 = (n: number) => new Date(`${日(n)}T00:10:00+08:00`);
const 八点 = (n: number) => new Date(`${日(n)}T08:10:00+08:00`);
const 白天 = (n: number) => new Date(`${日(n)}T10:00:00+08:00`);
const 开三态 = (改: Partial<三态规则> = {}): 组织规则 => ({ ...默认组织规则, 三态: { ...默认三态规则, 开: true, ...改 } });
async function 过(n: number) {
  await 三态夜扫(早(n));
  await 钟上三态提醒(八点(n));
}

const 人 = {} as Record<"乙" | "丙" | "甲" | "总内" | "总外" | "系", { id: string; name: string }>;
let 客户: string;
const 钟 = () => prisma.entCustomerClock.findUnique({ where: { customerId: 客户 } });
const 痕 = () => prisma.entCustomerStateLog.findMany({ where: { customerId: 客户 }, orderBy: [{ at: "asc" }, { id: "asc" }], select: { fromState: true, toState: true, via: true, reason: true } });
const 三态通知 = async (u: string) => prisma.entNotice.findMany({ where: { userId: u, dedupeKey: { startsWith: "tri-daily:" } }, select: { title: true, body: true } });
async function 转给(到: string, n: number) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } });
  await prisma.customerOwnerLog.create({ data: { customerId: 客户, userId: 人.系.id, fromOwnerId: c.salesOwnerId, toOwnerId: 到, kind: "assign", at: 白天(n) } });
  await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 到 } });
}
/** 被同事项目挡住：第 210 天该进公海进不去 */
async function 到期被挡() {
  await prisma.project.create({ data: { name: "同事的项目", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
  await 三态夜扫(早(180));
  await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
  await 三态夜扫(早(210));
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  坏人.clear();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  for (const k of ["乙", "丙", "甲", "总内", "总外", "系"] as const) {
    const u = await prisma.user.create({ data: { email: k, name: k, title: "", role: "SALES", password: "x" } });
    人[k] = { id: u.id, name: u.name };
  }
  await prisma.entMember.createMany({
    data: [
      { userId: 人.乙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.丙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.甲.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 人.总内.id, bizRole: "director", line: "内贸" },
      { userId: 人.总外.id, bizRole: "director", line: "外贸" },
      { userId: 人.系.id, bizRole: "director" },
    ],
  });
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 人.乙.id, createdAt: new Date("2026-10-01T10:00:00+08:00") } })).id;
  await setSetting("business", { projectMode: true });
  await setSetting("orgRules", 开三态());
});
afterEach(async () => {
  await 等通知推完();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("收到提醒的人一定点得了（客户外贸线、负责人内贸线）", () => {
  beforeEach(async () => {
    await prisma.customer.update({ where: { id: 客户 }, data: { bizLine: "外贸" } });
  });

  it("被挡请裁决推给外贸总管理，外贸总管理能暂缓回收；内贸总管理收不到也点不了；系统管理员能点", async () => {
    await 到期被挡();
    await 钟上三态提醒(八点(210));
    expect((await 三态通知(人.总外.id)).map((x) => x.title)).toEqual(["客户三态提醒：1 家到期被挡、请裁决"]);
    expect(await 三态通知(人.总内.id)).toHaveLength(0);
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(210))).toMatchObject({ ok: false, error: "只有这条线的总管理或系统管理员能裁决" });
    expect(await 暂缓回收动作(人.总外, 客户, null, 白天(210))).toEqual({ ok: true });
    const 系 = await 暂缓回收动作(人.系, 客户, null, 白天(240));
    expect(系).toEqual({ ok: true });
  });

  it("待回收「写理由继续持有」：外贸总管理（收到提醒的）、系统管理员能点，扣额度、留痕、通知负责人；内贸总管理不行；沉睡时总管理不能点", async () => {
    expect(await 继续持有(人.总外, 客户, "我来跟", 白天(100))).toMatchObject({ ok: false, error: "只有负责人本人或直属上级能继续持有" });
    expect(await 继续持有(人.总内, 客户, "我来跟", 白天(180))).toMatchObject({ ok: false });
    expect(await 继续持有(人.总外, 客户, "下月签约", 白天(180))).toEqual({ ok: true, 剩次数: 2, 剩天数: 60 });
    expect((await 痕()).find((x) => x.via === "总管理代选")).toMatchObject({ reason: "由 总外 代选：下月签约" });
    expect((await prisma.entNotice.findMany({ where: { userId: 人.乙.id } })).map((x) => x.title)).toEqual(["「客户甲」由 总外 代选了继续持有"]);
  });
});

describe("转让归零存下来，不回改历史（M-公海-20 / M-公海-37）", () => {
  it("2 次改成 1 次后历史归零日不变；之后的转让按新规则不归零", async () => {
    await 转给(人.丙.id, 10);
    await 转给(人.乙.id, 20);
    await 三态夜扫(早(30));
    expect((await prisma.customerOwnerLog.findMany({ orderBy: { at: "asc" }, select: { clockReset: true } })).map((x) => x.clockReset)).toEqual([true, true]);
    expect((await 钟())!.enteredDay).toBe(日(20));
    await setSetting("orgRules", 开三态({ 转让归零: { 次数: 1, 窗口月数: 12 } }));
    await 三态夜扫(早(31));
    expect((await 钟())!.enteredDay).toBe(日(20)); // 现算的话第 20 天那次就不归零了，钟会退回第 10 天
    await 转给(人.丙.id, 40);
    await 三态夜扫(早(41));
    expect((await prisma.customerOwnerLog.findMany({ orderBy: { at: "asc" }, select: { clockReset: true } })).map((x) => x.clockReset)).toEqual([true, true, false]);
    expect((await 钟())!.enteredDay).toBe(日(20));
  });

  it("转让后撤销（企业版删掉被撤的那一行）：钟不白归零，也不占次数（推断）", async () => {
    await 三态夜扫(早(5));
    await 转给(人.丙.id, 50);
    await 删被撤的换负责人记录(prisma, 客户, 人.乙.id, 人.丙.id);
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 人.乙.id } });
    await 三态夜扫(早(51));
    expect((await 钟())!.enteredDay).toBe(起);
    expect(await prisma.customerOwnerLog.count()).toBe(0);
  });
});

describe("夜扫和按钮同时发生", () => {
  it("夜扫读完以后有人点了继续持有：写之前按新钟重算，不按旧钟写错留痕", async () => {
    await 三态夜扫(早(95));
    expect((await 钟())!.state).toBe("沉睡");
    const 规则 = 开三态();
    const org = await 读组织();
    const 旧的 = await 收三态客户(prisma, [客户], 规则, org, 早(96));
    // 夜扫读完、还没写，这时负责人点了「我还在跟」：顺延 30 天，回到活跃
    expect(await 继续持有(人.乙, 客户, null, 早(96))).toMatchObject({ ok: true });
    const 点完 = await 痕();
    await 写一批(规则, org, 旧的, 早(96), 日(96));
    expect(await 痕()).toEqual(点完);
    expect(await 钟()).toMatchObject({ state: "活跃", holdCount: 1 });
  });
});

describe("提醒发到一半中断", () => {
  it("上级那条没记上：这位客户不算提醒过；重跑同一天补上、本人那条不重复", async () => {
    await 三态夜扫(早(180));
    坏人.add(人.甲.id);
    await 钟上三态提醒(八点(180));
    expect(await 钟()).toMatchObject({ state: "待回收", noticeCount: 0, lastNoticeDay: null });
    expect(await 三态通知(人.乙.id)).toHaveLength(1);
    expect(await 三态通知(人.甲.id)).toHaveLength(0);
    坏人.clear();
    await setSetting(三态提醒水位键, "");
    await 钟上三态提醒(new Date(`${日(180)}T09:00:00+08:00`));
    expect(await 钟()).toMatchObject({ noticeCount: 1, lastNoticeDay: 日(180) });
    expect(await 三态通知(人.乙.id)).toHaveLength(1);
    expect(await 三态通知(人.甲.id)).toHaveLength(1);
  });
});

describe("负责人停用", () => {
  it("不给他发；直属上级那一级按他停用前的上级；第 90 天本人那条没人收", async () => {
    await prisma.user.update({ where: { id: 人.乙.id }, data: { active: false } });
    await 过(90);
    expect(await 三态通知(人.乙.id)).toHaveLength(0);
    await 过(120);
    expect(await 三态通知(人.乙.id)).toHaveLength(0);
    expect((await 三态通知(人.甲.id)).map((x) => x.title)).toEqual(["客户三态提醒：1 家沉睡满 30 天"]);
  });
});

describe("不在计时的、交接中的", () => {
  it("已删、已标无效的不建钟", async () => {
    const 删的 = await prisma.customer.create({ data: { name: "删了的", phone: "13800000002", salesOwnerId: 人.乙.id, deletedAt: new Date() } });
    const 无效 = await prisma.customer.create({ data: { name: "无效的", phone: "13800000003", salesOwnerId: 人.乙.id, poolInvalidAt: new Date() } });
    await 三态夜扫(早(100));
    expect(await prisma.entCustomerClock.findMany({ where: { customerId: { in: [删的.id, 无效.id] } } })).toHaveLength(0);
  });

  it("别的路进了公海（手动放）：钟标一次「公海」，再扫不重复记", async () => {
    await 三态夜扫(早(95));
    await prisma.customerPool.create({ data: { customerId: 客户, userId: 人.乙.id, reason: "手动" } });
    await 三态夜扫(早(96));
    await 三态夜扫(早(97));
    expect((await 钟())!.state).toBe(公海状态);
    expect((await 痕()).filter((x) => x.toState === 公海状态)).toHaveLength(1);
  });

  it("离职交接待确认（没列客户 = 他名下全部）：到期不收", async () => {
    await 三态夜扫(早(180));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
    await prisma.entHandover.create({ data: { kind: "离职", fromUserId: 人.乙.id, toUserId: 人.丙.id, byUserId: 人.系.id } });
    expect(await 三态夜扫(早(210))).toMatchObject({ 交接中没收: 1, 进公海: [] });
    expect(await prisma.customerPool.findUnique({ where: { customerId: 客户 } })).toBeNull();
  });
});

describe("进公海后的钟", () => {
  it("自动进公海标「公海」；被领走后按换负责人重新起算，回到活跃", async () => {
    await 三态夜扫(早(180));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
    await 三态夜扫(早(210));
    expect(await 钟()).toMatchObject({ state: 公海状态, enteredDay: 日(210) });
    // 丙从公海领走（第 215 天）
    await prisma.customerPool.delete({ where: { customerId: 客户 } });
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 人.丙.id } });
    await prisma.customerOwnerLog.create({ data: { customerId: 客户, userId: 人.丙.id, toOwnerId: 人.丙.id, kind: "claim", at: 白天(215) } });
    await setSetting(三态扫过键, "");
    await 三态夜扫(早(216));
    expect(await 钟()).toMatchObject({ state: "活跃", enteredDay: 日(215), noticeCount: 0 });
    expect((await 痕()).at(-1)).toMatchObject({ fromState: 公海状态, toState: "活跃", reason: "从客户公海领走 / 分走，换了负责人，重新起算" });
  });
});
