/**
 * 客户三态 · 按钮的服务端动作（三态落地计划 P6，lib/enterprise/tri-state-hold.ts、permissions.ts 三个判定）。日子都是改出来的。
 *   - 权限矩阵：本人 / 直属上级（第 120 天起代选）/ 隔级 / 本线总管理 / 别线总管理 / 系统管理员
 *   - 每轮一次；累计 3 次用满被拒；换负责人后接着用剩下的次数；代选扣 1 次、留痕「由 XX 代选」、通知原负责人
 *   - 待回收要写理由；单次天数改 15 后合计 90 天先拦
 *   - 记有内容的沟通回满（挂客户 / 挂同事项目都算）、空内容不回满、第二天再记又回满；换负责人不回满
 *   - 暂缓回收：只给被挡的、不扣额度、30 天内再点被拒；让同事结束项目通知同事
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 继续持有, 暂缓回收动作, 让同事结束项目动作, 读一位三态 } from "@/lib/enterprise/tri-state-hold";
import { 三态夜扫 } from "@/lib/enterprise/tri-state-db";
import { 能继续持有三态, 能代选三态, 能裁决三态 } from "@/lib/enterprise/permissions";
import { 读组织 } from "@/lib/enterprise/org";
import { 默认组织规则, 默认三态规则, type 组织规则, type 三态规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 加天 } from "@/lib/enterprise/tri-state";

const 起 = "2026-11-01";
const 第 = (n: number) => new Date(`${加天(起, n)}T10:00:00+08:00`);
const 开三态 = (改: Partial<三态规则> = {}): 组织规则 => ({ ...默认组织规则, 三态: { ...默认三态规则, 开: true, ...改 } });

const 人 = {} as Record<"乙" | "丙" | "甲" | "顶" | "总内" | "总外" | "系", { id: string; name: string }>;
let 客户: string;

const 痕 = () => prisma.entCustomerStateLog.findMany({ where: { customerId: 客户, via: { not: "自动" } }, orderBy: { at: "asc" }, select: { via: true, reason: true, holdDays: true, userId: true } });
/** 记一次换负责人（转让） */
async function 转给(到: string, n: number) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } });
  await prisma.customerOwnerLog.create({ data: { customerId: 客户, userId: 人.系.id, fromOwnerId: c.salesOwnerId, toOwnerId: 到, kind: "assign", at: 第(n) } });
  await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 到 } });
}
const 沟通 = (n: number, content = "回访了", customerId = 客户) => prisma.followUp.create({ data: { type: "PHONE", title: "", content, customerId, ownerId: 人.乙.id, occurredAt: 第(n) } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  for (const k of ["乙", "丙", "甲", "顶", "总内", "总外", "系"] as const) {
    const u = await prisma.user.create({ data: { email: k, name: k, title: "", role: "SALES", password: "x" } });
    人[k] = { id: u.id, name: u.name };
  }
  await prisma.entMember.createMany({
    data: [
      { userId: 人.乙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.丙.id, bizRole: "sales", line: "内贸", managerId: 人.甲.id },
      { userId: 人.甲.id, bizRole: "sales_mgr", line: "内贸", managerId: 人.顶.id },
      { userId: 人.顶.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 人.总内.id, bizRole: "director", line: "内贸" },
      { userId: 人.总外.id, bizRole: "director", line: "外贸" },
      { userId: 人.系.id, bizRole: "director" },
    ],
  });
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 人.乙.id, createdAt: new Date("2026-10-01T10:00:00+08:00") } })).id;
  await setSetting("business", { projectMode: true });
  await setSetting("orgRules", 开三态());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("权限判定（permissions.ts）", () => {
  it("继续持有本人：只有负责人；代选：实线直属上级一级；裁决：本线总管理、系统管理员", async () => {
    const org = await 读组织();
    const c = { salesOwnerId: 人.乙.id };
    expect(能继续持有三态(人.乙, c, org)).toBe(true);
    expect(能继续持有三态(人.甲, c, org)).toBe(false);
    expect(能代选三态(人.甲, c, org)).toBe(true);
    expect(能代选三态(人.乙, c, org)).toBe(false); // 本人不算代选
    expect(能代选三态(人.顶, c, org)).toBe(false); // 隔级
    expect(能代选三态(人.总内, c, org)).toBe(false);
    expect(能裁决三态(人.总内, c, org)).toBe(true);
    expect(能裁决三态(人.总外, c, org)).toBe(false); // 别线
    expect(能裁决三态(人.系, c, org)).toBe(true);
    expect(能裁决三态(人.甲, c, org)).toBe(false);
    expect(能裁决三态(人.乙, c, org)).toBe(false);
  });

  it("三态没开：动作一律拒", async () => {
    await setSetting("orgRules", { ...默认组织规则 });
    expect(await 继续持有(人.乙, 客户, null, 第(100))).toEqual({ ok: false, error: "客户三态没开" });
  });
});

describe("继续持有", () => {
  it("活跃时不能点；沉睡第 90 天当天本人能点，钟不拨零、三个节点顺延 30 天；同一轮再点被拒", async () => {
    expect(await 继续持有(人.乙, 客户, null, 第(89))).toMatchObject({ ok: false, error: "只有沉睡、待回收时能继续持有" });
    expect(await 继续持有(人.乙, 客户, null, 第(90))).toEqual({ ok: true, 剩次数: 2, 剩天数: 60 });
    expect(await 痕()).toEqual([{ via: "本人", reason: "我还在跟", holdDays: 30, userId: 人.乙.id }]);
    const 钟 = await prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: 客户 } });
    expect(钟).toMatchObject({ holdCount: 1, holdDays: 30, holdUntil: 加天(起, 120), holdReason: "我还在跟", state: "活跃" });
    // 顺延后第 119 天还活跃，第 120 天回到沉睡（= 第 90 天 + 30）
    expect((await 读一位三态(客户, 第(119)))!.状态).toBe("活跃");
    expect((await 读一位三态(客户, 第(120)))!.状态).toBe("沉睡");
    expect(await 继续持有(人.乙, 客户, null, 第(120))).toMatchObject({ ok: false, error: "沉睡这一轮已经继续持有过一次" });
  });

  it("待回收要写理由；写了理由能点", async () => {
    expect(await 继续持有(人.乙, 客户, "  ", 第(180))).toMatchObject({ ok: false, error: "待回收时要写理由才能继续持有" });
    expect(await 继续持有(人.乙, 客户, "下月签约", 第(180))).toMatchObject({ ok: true, 剩次数: 2 });
    expect((await 痕())[0]).toMatchObject({ via: "本人", reason: "下月签约" });
  });

  it("直属上级：第 119 天不能代选、第 120 天能；扣 1 次、留痕「由 甲 代选」、通知原负责人；隔级、别人不行", async () => {
    expect(await 继续持有(人.甲, 客户, null, 第(119))).toMatchObject({ ok: false, error: "直属上级从沉睡第 30 天（第 120 天）起才能代选" });
    expect(await 继续持有(人.顶, 客户, null, 第(120))).toMatchObject({ ok: false, error: "只有负责人本人或直属上级能继续持有" });
    expect(await 继续持有(人.丙, 客户, null, 第(120))).toMatchObject({ ok: false });
    expect(await 继续持有(人.甲, 客户, null, 第(120))).toEqual({ ok: true, 剩次数: 2, 剩天数: 60 });
    expect(await 痕()).toEqual([{ via: "上级代选", reason: "由 甲 代选：我还在跟", holdDays: 30, userId: 人.甲.id }]);
    const 通知 = await prisma.entNotice.findMany({ where: { userId: 人.乙.id } });
    expect(通知).toHaveLength(1);
    expect(通知[0].title).toContain("由 甲 代选");
    // 本人在同一轮再点被拒（代选占了这一轮）
    expect(await 继续持有(人.乙, 客户, null, 第(121))).toMatchObject({ ok: false, error: "沉睡这一轮已经继续持有过一次" });
  });

  it("额度挂客户：换负责人后新负责人接着用剩下的；第 4 次被拒；换负责人不回满", async () => {
    expect(await 继续持有(人.乙, 客户, null, 第(90))).toMatchObject({ ok: true, 剩次数: 2 });
    await 转给(人.丙.id, 125); // 钟归零：第 125 天起重新数
    expect(await 继续持有(人.丙, 客户, null, 第(125 + 90))).toMatchObject({ ok: true, 剩次数: 1 });
    await 转给(人.乙.id, 300);
    expect(await 继续持有(人.乙, 客户, null, 第(300 + 90))).toMatchObject({ ok: true, 剩次数: 0, 剩天数: 0 });
    // 第 3 次转让（12 个月内已满 2 次）不归零：钟接着走，已用满
    await 转给(人.丙.id, 395);
    const r = await 读一位三态(客户, 第(510));
    expect(r).toMatchObject({ 状态: "待回收", 继续持有: { 已用次数: 3, 能推: false } });
    expect(await 继续持有(人.丙, 客户, "还在谈", 第(510))).toMatchObject({ ok: false, error: "继续持有已用满 3 次" });
  });

  it("单次天数改 15：次数上限 10、合计 90 天，第 7 次被合计天数拦", async () => {
    await setSetting("orgRules", 开三态({ 继续持有: { 每次天数: 15, 累计次数: 10, 累计天数: 90 } }));
    // 6 次推后（各 15 天）都在一次转让以前：不在这一轮钟里，额度照算
    for (let i = 0; i < 6; i++) {
      await prisma.entCustomerStateLog.create({ data: { customerId: 客户, fromState: "沉睡", toState: "沉睡", via: "本人", userId: 人.乙.id, reason: "我还在跟", holdDays: 15, at: 第(10 + i) } });
    }
    await 转给(人.丙.id, 20);
    const r = await 读一位三态(客户, 第(20 + 90));
    expect(r!.继续持有).toMatchObject({ 已用次数: 6, 已用天数: 90, 能推: false });
    expect(await 继续持有(人.丙, 客户, null, 第(20 + 90))).toMatchObject({ ok: false, error: "继续持有合计最多顺延 90 天，已顺延 90 天" });
  });
});

describe("额度回满（M-公海-38）", () => {
  it("记有内容的沟通回满并记下重置日；空内容不回满；第二天再记又回满；挂在同事项目上的沟通也算", async () => {
    expect(await 继续持有(人.乙, 客户, null, 第(90))).toMatchObject({ 剩次数: 2 });
    // 空内容：不拨钟、不回满
    await 沟通(95, "   ");
    await 三态夜扫(第(96));
    expect((await 读一位三态(客户, 第(96)))!.继续持有.剩次数).toBe(2);
    // 有内容：回满，钟上记重置日
    await 沟通(100, "回访了");
    await 三态夜扫(第(101));
    expect((await 读一位三态(客户, 第(101)))!.继续持有).toMatchObject({ 已用次数: 0, 剩次数: 3, 剩天数: 90 });
    expect(await prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: 客户 } })).toMatchObject({ quotaResetDay: 加天(起, 100), holdCount: 0 });
    // 沉睡里再点一次（第 100 + 90 天），第二天在同事项目上记一条沟通：又回满，重置日挪到那天
    expect(await 继续持有(人.乙, 客户, null, 第(190))).toMatchObject({ 剩次数: 2 });
    const 同事项目 = await prisma.project.create({ data: { name: "同事的", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: 第(1) } });
    const f = await 沟通(191, "同事那边跟了");
    await prisma.followUpProject.create({ data: { followUpId: f.id, projectId: 同事项目.id, node: "潜客培育" } });
    await 三态夜扫(第(192));
    expect((await 读一位三态(客户, 第(192)))!.继续持有.剩次数).toBe(3);
    expect((await prisma.entCustomerClock.findUniqueOrThrow({ where: { customerId: 客户 } })).quotaResetDay).toBe(加天(起, 191));
  });
});

describe("被挡裁决", () => {
  async function 到期被挡() {
    await prisma.project.create({ data: { name: "同事的项目", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
    await 三态夜扫(第(180));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 加天(起, 200) } });
    await 三态夜扫(第(210));
  }

  it("没被挡的不能裁决；被挡后本线总管理暂缓回收：不扣额度、30 天内再点被拒、第 30 天能再点", async () => {
    expect(await 暂缓回收动作(人.总内, 客户, null, 第(100))).toMatchObject({ ok: false, error: "只有到期该进公海、被同事在推的项目挡住的客户才要裁决" });
    await 到期被挡();
    expect(await 暂缓回收动作(人.总外, 客户, null, 第(210))).toMatchObject({ ok: false, error: "只有这条线的总管理或系统管理员能裁决" });
    expect(await 暂缓回收动作(人.甲, 客户, null, 第(210))).toMatchObject({ ok: false });
    expect(await 暂缓回收动作(人.总内, 客户, "等同事收尾", 第(210))).toEqual({ ok: true });
    expect(await 痕()).toEqual([{ via: "总管理裁决", reason: "暂缓回收：等同事收尾", holdDays: null, userId: 人.总内.id }]);
    const r = await 读一位三态(客户, 第(211));
    expect(r!.继续持有.已用次数).toBe(0);
    expect(await 暂缓回收动作(人.系, 客户, null, 第(239))).toMatchObject({ ok: false });
    expect(await 暂缓回收动作(人.系, 客户, null, 第(240))).toEqual({ ok: true });
  });

  it("让同事结束项目：通知同事、留一行痕；没被挡的被拒", async () => {
    expect(await 让同事结束项目动作(人.总内, 客户, 第(100))).toMatchObject({ ok: false });
    await 到期被挡();
    expect(await 让同事结束项目动作(人.总内, 客户, 第(210))).toEqual({ ok: true, 通知了: 1 });
    expect((await prisma.entNotice.findMany({ where: { userId: 人.丙.id } }))[0].title).toContain("被你负责的项目挡住了");
    expect((await 痕())[0]).toMatchObject({ via: "总管理裁决", reason: "让同事结束项目（1 位同事）" });
    // 被挡时继续持有不给
    expect(await 继续持有(人.乙, 客户, "还在跟", 第(210))).toMatchObject({ ok: false, error: "只有沉睡、待回收时能继续持有" });
  });
});
