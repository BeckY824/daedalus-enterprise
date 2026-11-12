/**
 * 客户三态 · 提醒（三态落地计划 P5，lib/enterprise/tri-state-notice.ts）。日子都是改出来的，不等真实时间。
 *   - 北京 08:00 起一天一遍；同一天再跑不重发；停机几天开机只发当天一条
 *   - 同一人 5 家只收 1 条汇总
 *   - 第 90 天当天进入沉睡提醒本人；周一周报、周二不发；第 120 天加直属上级；第 180 / 190 / 200 天推条线总管理、抄本人和上级；第 210 天自动进公海、「已回公海」单发
 *   - 找人兜底：没直属上级 → 条线总管理；客户业务线优先、没填按负责人的线；都没有 → 系统管理员
 *   - 第 2 次被自动收回起抄原负责人的直属上级
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 三态夜扫 } from "@/lib/enterprise/tri-state-db";
import { 钟上三态提醒, 过了三态提醒时刻, 三态提醒水位键 } from "@/lib/enterprise/tri-state-notice";
import { 默认组织规则, 默认三态规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 加天 } from "@/lib/enterprise/tri-state";
import { 等通知推完 } from "@/lib/enterprise/notify";

const 起 = "2026-11-01"; // 周日
const 日 = (n: number) => 加天(起, n);
const 早 = (n: number) => new Date(`${日(n)}T00:10:00+08:00`);
const 八点 = (n: number) => new Date(`${日(n)}T08:10:00+08:00`);
/** 过一天：00:05 那遍改状态，08:00 那遍发提醒 */
async function 过(n: number) {
  await 三态夜扫(早(n));
  await 钟上三态提醒(八点(n));
}

const 人 = {} as Record<"乙" | "甲" | "总内" | "总外" | "系", string>;
let 客户: string;
const 通知 = (u: string) => prisma.entNotice.findMany({ where: { userId: u }, orderBy: { createdAt: "asc" }, select: { title: true, body: true, kind: true, dedupeKey: true } });
const 三态通知 = async (u: string) => (await 通知(u)).filter((x) => x.dedupeKey.startsWith("tri-daily:"));

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  for (const k of ["乙", "甲", "总内", "总外", "系"] as const) 人[k] = (await prisma.user.create({ data: { email: k, name: k, title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({
    data: [
      { userId: 人.乙, bizRole: "sales", line: "内贸", managerId: 人.甲 },
      { userId: 人.甲, bizRole: "sales_mgr", line: "内贸" },
      { userId: 人.总内, bizRole: "director", line: "内贸" },
      { userId: 人.总外, bizRole: "director", line: "外贸" },
      { userId: 人.系, bizRole: "director" },
    ],
  });
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 人.乙, createdAt: new Date("2026-10-01T10:00:00+08:00") } })).id;
  await setSetting("business", { projectMode: true });
  await setSetting("orgRules", { ...默认组织规则, 三态: { ...默认三态规则, 开: true } });
});
afterEach(async () => {
  await 等通知推完();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("什么时候发", () => {
  it("北京 07:59 不发、08:00 起发", () => {
    expect(过了三态提醒时刻(new Date(`${日(90)}T07:59:00+08:00`))).toBe(false);
    expect(过了三态提醒时刻(new Date(`${日(90)}T08:00:00+08:00`))).toBe(true);
  });

  it("三态关着不发；同一天跑两遍只发一条", async () => {
    await setSetting("orgRules", { ...默认组织规则 });
    expect(await 钟上三态提醒(八点(90))).toBeNull();
    await setSetting("orgRules", { ...默认组织规则, 三态: { ...默认三态规则, 开: true } });
    await 过(90);
    expect(await 钟上三态提醒(new Date(`${日(90)}T15:00:00+08:00`))).toBeNull();
    expect(await 三态通知(人.乙)).toHaveLength(1);
  });

  it("停机：水位停在第 85 天，第 95 天开机只发当天一条（进入沉睡补发），不逐天补", async () => {
    await setSetting(三态提醒水位键, 日(85));
    await 过(95);
    const 乙的 = await 三态通知(人.乙);
    expect(乙的).toHaveLength(1);
    expect(乙的[0].title).toBe("客户三态提醒：1 家进入沉睡");
  });
});

describe("三级提醒链", () => {
  it("第 90 天进入沉睡只给本人；周一（第 92 天）周报、周二不发；第 120 天加直属上级；第 180 / 190 / 200 天推总管理抄本人和上级；第 210 天进公海单发一条", async () => {
    await 过(89);
    expect(await 三态通知(人.乙)).toHaveLength(0);
    await 过(90);
    expect((await 三态通知(人.乙)).map((x) => x.title)).toEqual(["客户三态提醒：1 家进入沉睡"]);
    expect(await 三态通知(人.甲)).toHaveLength(0);
    await 过(91); // 周日
    await 过(92); // 周一
    await 过(93); // 周二
    expect((await 三态通知(人.乙)).map((x) => x.title)).toEqual(["客户三态提醒：1 家进入沉睡", "客户三态提醒：1 家还在沉睡"]);
    await 过(120);
    expect((await 三态通知(人.乙)).at(-1)!.title).toBe("客户三态提醒：1 家沉睡满 30 天");
    expect((await 三态通知(人.甲)).map((x) => x.title)).toEqual(["客户三态提醒：1 家沉睡满 30 天"]);
    for (const n of [180, 181, 190, 200, 209]) await 过(n);
    const 总 = await 三态通知(人.总内);
    expect(总.map((x) => x.body)).toEqual(["「客户甲」待回收（第 1 次提醒），负责人 乙", "「客户甲」待回收（第 2 次提醒），负责人 乙", "「客户甲」待回收（第 3 次提醒），负责人 乙"]);
    expect((await 三态通知(人.乙)).filter((x) => x.title.includes("待回收"))).toHaveLength(3);
    expect((await 三态通知(人.甲)).filter((x) => x.title.includes("待回收"))).toHaveLength(3);
    expect(await 三态通知(人.总外)).toHaveLength(0);
    expect(await prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: 客户 } })).toMatchObject({ state: "待回收", noticeCount: 3, lastNoticeDay: 日(200) });
    await 过(210);
    expect(await prisma.customerPool.findUnique({ where: { customerId: 客户 } })).not.toBeNull();
    const 回 = (await 通知(人.乙)).filter((x) => x.dedupeKey.startsWith("tri-pooled:"));
    expect(回.map((x) => x.title)).toEqual(["「客户甲」待回收期满没人处理，已回客户公海"]);
    // 第 1 次被收回不抄上级
    expect((await 通知(人.甲)).filter((x) => x.dedupeKey.startsWith("tri-pooled:"))).toHaveLength(0);
  });

  it("同一人 5 家进入沉睡只收 1 条汇总，标题数家数、正文逐家列", async () => {
    for (let i = 2; i <= 5; i++) await prisma.customer.create({ data: { name: `客户${i}`, phone: `1380000000${i}`, salesOwnerId: 人.乙 } });
    await 过(90);
    const 乙的 = await 三态通知(人.乙);
    expect(乙的).toHaveLength(1);
    expect(乙的[0].title).toBe("客户三态提醒：5 家进入沉睡");
    expect(乙的[0].body.split("\n")).toHaveLength(5);
  });
});

describe("找人兜底", () => {
  it("没有直属上级：第 120 天那一级给本线条线总管理", async () => {
    await prisma.entMember.update({ where: { userId: 人.乙 }, data: { managerId: null } });
    await 过(120);
    expect(await 三态通知(人.总内)).toHaveLength(1);
    expect(await 三态通知(人.系)).toHaveLength(0);
  });

  it("客户业务线填了外贸：待回收推外贸线的总管理（负责人是内贸线）", async () => {
    await prisma.customer.update({ where: { id: 客户 }, data: { bizLine: "外贸" } });
    await 过(180);
    expect(await 三态通知(人.总外)).toHaveLength(1);
    expect(await 三态通知(人.总内)).toHaveLength(0);
  });

  it("负责人没有线、客户也没填、没有直属上级：发系统管理员", async () => {
    await prisma.entMember.update({ where: { userId: 人.乙 }, data: { managerId: null, line: null } });
    await 过(180);
    expect(await 三态通知(人.系)).toHaveLength(1);
    expect(await 三态通知(人.总内)).toHaveLength(0);
  });
});

describe("第 2 次被收回", () => {
  it("入池时抄原负责人的直属上级", async () => {
    // 之前被三态自动收回过一次（留痕），被领回来后又到期
    await prisma.entCustomerStateLog.create({ data: { customerId: 客户, fromState: "待回收", toState: "公海", via: "自动", reason: "上一次", at: new Date("2026-10-15T00:10:00+08:00") } });
    for (const n of [180, 190, 200, 210]) await 过(n);
    expect(await prisma.customerPool.findUnique({ where: { customerId: 客户 } })).not.toBeNull();
    const 甲的 = (await 通知(人.甲)).filter((x) => x.dedupeKey.startsWith("tri-pooled:"));
    expect(甲的.map((x) => x.title)).toEqual(["下属的客户「客户甲」第 2 次被自动收回，已回客户公海"]);
  });
});
