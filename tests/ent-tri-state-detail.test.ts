/**
 * 客户详情的三态几样（P-界面-19，构想页 C10–C13；lib/enterprise/tri-state-detail.ts）：
 *   - 状态条：活跃 / 三态关着 / 市场成员名下不出；沉睡、待回收、暂缓回收中各按身份给按钮（服务端算好），和按钮动作同一套判定
 *   - 冷项目：线索 / 商机项目没动静满标冷天数才标，换节点、挂项目的沟通清掉
 *   - 状态留痕的说法、短沟通提示的原因
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 三态夜扫 } from "@/lib/enterprise/tri-state-db";
import { 加天 } from "@/lib/enterprise/tri-state";
import { 继续持有, 暂缓回收动作 } from "@/lib/enterprise/tri-state-hold";
import { 读三态条, 读冷项目, 读三态留痕, 留痕说法, 短沟通提示 } from "@/lib/enterprise/tri-state-detail";
import { 无效沟通原因of, 短沟通话of } from "@/lib/enterprise/tri-state-quota";
import { 默认组织规则, 默认三态规则, type 组织规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 等通知推完 } from "@/lib/enterprise/notify";

const 起 = "2026-11-01";
const 日 = (n: number) => 加天(起, n);
const 早 = (n: number) => new Date(`${日(n)}T00:10:00+08:00`);
const 白天 = (n: number) => new Date(`${日(n)}T10:00:00+08:00`);
const 开三态 = (): 组织规则 => ({ ...默认组织规则, 三态: { ...默认三态规则, 开: true } });

const 人 = {} as Record<"乙" | "丙" | "甲" | "总内" | "总外" | "系", { id: string; name: string }>;
let 客户: string;
const 条 = (k: keyof typeof 人, n: number) => 读三态条(人[k], 客户, 白天(n));
const 按钮 = async (k: keyof typeof 人, n: number) => ((await 条(k, n))?.按钮们 ?? []).map((b) => b.字);

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
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
  vi.unstubAllEnvs();
});

describe("C10 状态条", () => {
  it("三态关着、活跃：都不出条；关着时连客户钟都不查", async () => {
    await 三态夜扫(早(5));
    expect(await 条("乙", 5)).toBeNull();
    await setSetting("orgRules", { ...默认组织规则 });
    await 三态夜扫(早(95));
    const 查 = vi.spyOn(prisma.entCustomerClock, "findUnique");
    expect(await 条("乙", 95)).toBeNull();
    expect(查).not.toHaveBeenCalled();
  });

  it("沉睡：本人「我还在跟」（悬停写额度）；上级第 30 天前只有说明、之后能代选；别人只有说明", async () => {
    await 三态夜扫(早(95));
    const 本人 = (await 条("乙", 95))!;
    expect(本人).toMatchObject({ 状态: "沉睡", 文字: "已 95 天没有有效沟通 · 再 85 天进入待回收" });
    expect(本人.按钮们).toMatchObject([{ 动作: "继续持有", 字: "我还在跟", 要理由: false, 主: true }]);
    expect(本人.按钮们[0].说明).toBe("「我还在跟」和「写理由继续持有」共用一个额度：每次顺延 30 天、钟不归零；沉睡轮、待回收轮各限一次；累计最多 3 次、合计 90 天；已用 0 次");
    expect(本人.旁注).toContain("客户转让");
    expect(await 条("甲", 95)).toMatchObject({ 按钮们: [], 旁注: "沉睡满 30 天（第 120 天）起你也能代选「我还在跟」" });
    expect(await 条("丙", 95)).toMatchObject({ 按钮们: [], 旁注: "沉睡阶段由负责人和直属上级处理" });
    expect(await 条("总内", 95)).toMatchObject({ 按钮们: [] });
    await 三态夜扫(早(121));
    expect(await 按钮("甲", 121)).toEqual(["我还在跟"]);
  });

  it("沉睡：本轮点过了不再给按钮，说一句为什么；额度用完换成「额度已用完」那句", async () => {
    await 三态夜扫(早(95));
    expect(await 继续持有(人.乙, 客户, null, 白天(95))).toMatchObject({ ok: true });
    // 推后 30 天，第 125 天还在沉睡
    await 三态夜扫(早(125));
    const 再 = (await 条("乙", 125))!;
    expect(再.状态).toBe("沉睡");
    expect(再.按钮们).toEqual([]);
    expect(再.旁注).toBeTruthy();
    await prisma.entCustomerStateLog.createMany({
      data: [130, 131].map((n) => ({ customerId: 客户, fromState: "沉睡", toState: "沉睡", via: "本人", userId: 人.乙.id, reason: "我还在跟", holdDays: 30, at: 白天(n) })),
    });
    await 三态夜扫(早(200));
    expect((await 条("乙", 200))?.旁注).toBe("额度已用完，可以转让、退回公海，或记一条有效沟通");
  });

  it("待回收：只有这条线的条线总管理看到「写理由继续持有」；本人和上级看到已推给总管理；系统管理员、别线总管理不给按钮", async () => {
    await 三态夜扫(早(185));
    const 总 = (await 条("总内", 185))!;
    expect(总.状态).toBe("待回收");
    expect(总.文字).toMatch(/^\d+ 天后自动进公海 · 已提醒 0\/3 次$/);
    expect(总.按钮们).toMatchObject([{ 动作: "继续持有", 字: "写理由继续持有", 要理由: true }]);
    expect(await 条("乙", 185)).toMatchObject({ 按钮们: [], 旁注: expect.stringContaining("已推给条线总管理裁决") });
    expect(await 条("甲", 185)).toMatchObject({ 按钮们: [] });
    expect(await 按钮("系", 185)).toEqual([]);
    expect(await 按钮("总外", 185)).toEqual([]);
  });

  it("暂缓回收中：线总看到客户转让 / 让同事结束项目 / 暂缓回收；用满或 30 天内换成写理由继续持有；其余人只有说明", async () => {
    await prisma.project.create({ data: { name: "同事的项目", customerId: 客户, ownerId: 人.丙.id, creatorId: 人.丙.id, createdAt: new Date("2026-10-20T10:00:00+08:00") } });
    await 三态夜扫(早(180));
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { noticeCount: 3, lastNoticeDay: 日(200) } });
    await 三态夜扫(早(210));
    const 总 = (await 条("总内", 210))!;
    expect(总).toMatchObject({ 状态: "暂缓回收中", 文字: "到期该进公海，但名下有 1 位同事在推的项目，收不了" });
    expect(总.按钮们.map((b) => b.字)).toEqual(["客户转让", "让同事结束项目", "暂缓回收"]);
    expect(await 条("乙", 210)).toMatchObject({ 按钮们: [], 旁注: "由条线总管理处理" });
    expect(await 按钮("系", 210)).toEqual([]);
    expect(await 暂缓回收动作(人.总内, 客户, null, 白天(210))).toEqual({ ok: true });
    // 30 天内不给暂缓，没用满 2 次时继续持有也不给（服务端同一句话）
    const 后 = (await 条("总内", 215))!;
    expect(后.按钮们.map((b) => b.字)).toEqual(["客户转让", "让同事结束项目"]);
    expect(后.旁注).toContain("天内不用再裁决");
  });

  it("负责人是市场成员：不计时，不出条", async () => {
    await 三态夜扫(早(95));
    await prisma.entMember.update({ where: { userId: 人.乙.id }, data: { bizRole: "marketing_mgr" } });
    expect(await 条("乙", 95)).toBeNull();
  });
});

describe("C11 冷项目", () => {
  it("线索 / 商机没动静满 90 天标冷（从起算日数）；换节点、挂项目的沟通清掉；订单、结束了、关着都不标", async () => {
    const 建 = (name: string, x: object = {}) => prisma.project.create({ data: { name, customerId: 客户, ownerId: 人.乙.id, creatorId: 人.乙.id, createdAt: new Date("2026-10-01T10:00:00+08:00"), ...x } }).then((p) => p.id);
    const 线索 = await 建("线索的"), 换过 = await 建("换过节点"), 沟通过 = await 建("记过沟通"), 订单 = await 建("订单的", { phase: "订单", node: "签约" }), 丢了 = await 建("丢单的", { result: "丢单" });
    await prisma.projectNodeLog.create({ data: { projectId: 换过, userId: 人.乙.id, toPhase: "线索", toNode: "初步接触", at: 白天(30) } });
    await prisma.followUp.create({ data: { customerId: 客户, ownerId: 人.乙.id, type: "PHONE", title: "", content: "电话聊了预算", status: "已完成", occurredAt: 白天(40), projectNode: { create: { projectId: 沟通过, node: "初步接触" } } } });
    const ids = [线索, 换过, 沟通过, 订单, 丢了];
    expect(await 读冷项目(ids, 白天(89))).toEqual({});
    expect(await 读冷项目(ids, 白天(90))).toEqual({ [线索]: 90 });
    expect(await 读冷项目(ids, 白天(130))).toEqual({ [线索]: 130, [换过]: 100, [沟通过]: 90 });
    await setSetting("orgRules", { ...默认组织规则 });
    const 查 = vi.spyOn(prisma, "$queryRawUnsafe");
    expect(await 读冷项目(ids, 白天(130))).toEqual({});
    expect(查).not.toHaveBeenCalled();
  });
});

describe("C13 状态留痕 / C12 短沟通", () => {
  it("留痕说法：状态变化、继续持有、裁决、撤销转让各一句；三态关着不读", async () => {
    expect(留痕说法({ fromState: "活跃", toState: "沉睡", via: "自动", reason: "满 90 天没有有效沟通", holdDays: null })).toBe("活跃 → 沉睡（满 90 天没有有效沟通）");
    expect(留痕说法({ fromState: "沉睡", toState: "沉睡", via: "上级代选", reason: "由 甲 代选：我还在跟", holdDays: 30 })).toBe("继续持有，顺延 30 天：由 甲 代选：我还在跟");
    expect(留痕说法({ fromState: "待回收", toState: "待回收", via: "总管理裁决", reason: "暂缓回收", holdDays: null })).toBe("暂缓回收");
    expect(留痕说法({ fromState: null, toState: "活跃", via: "撤销转让·计次", reason: null, holdDays: null })).toBe("撤销转让（计入 7 天内撤销次数）");
    await 三态夜扫(早(95));
    await 继续持有(人.乙, 客户, null, 白天(95));
    const 行们 = (await 读三态留痕(客户, new Map([[人.乙.id, "乙"]])))!;
    expect(行们.slice(0, 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ 谁: "乙", 事: "继续持有，顺延 30 天：我还在跟" }),
      expect.objectContaining({ 谁: "系统", 事: "沉睡 → 活跃（继续持有顺延 30 天，三个节点一起往后挪）" }),
    ]));
    expect(行们.at(-1)!.谁).toBe("系统");
    await setSetting("orgRules", { ...默认组织规则 });
    expect(await 读三态留痕(客户, new Map())).toBeNull();
  });

  it("短沟通：原因按同一个判定；客户在计时才提示，AI 起草的、三态关着的不提示", async () => {
    expect([无效沟通原因of("Call"), 无效沟通原因of("跟进"), 无效沟通原因of("https://x.cn/a"), 无效沟通原因of("电话聊了预算"), 无效沟通原因of("跟进跟进已联系")])
      .toEqual(["太短", "占位词", "只有链接", null, "占位词"]);
    expect(短沟通话of({ ok: true, 短沟通: "太短" })).toBe("已保存。这条太短，不计入有效沟通，不会重置回收倒计时");
    expect(短沟通话of({ ok: true })).toBeNull();
    const 记 = (content: string) => prisma.followUp.create({ data: { customerId: 客户, ownerId: 人.乙.id, type: "PHONE", title: "", content, status: "已完成" } }).then((f) => f.id);
    const 短 = await 记("OK");
    expect(await 短沟通提示(短, "OK")).toBeNull(); // 还没有钟（夜扫没跑过）
    await 三态夜扫(早(5));
    expect(await 短沟通提示(短, "OK")).toBe("太短");
    expect(await 短沟通提示(await 记("电话聊了预算"), "电话聊了预算")).toBeNull();
    const ai = await 记("OK");
    await prisma.followUpSource.create({ data: { followUpId: ai, text: "速记原文" } });
    expect(await 短沟通提示(ai, "OK")).toBeNull();
    await setSetting("orgRules", { ...默认组织规则 });
    expect(await 短沟通提示(短, "OK")).toBeNull();
  });
});
