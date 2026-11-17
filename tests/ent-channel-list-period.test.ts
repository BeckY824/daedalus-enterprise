/**
 * 渠道列表统计跟看板同一个时间段（员工反馈第 2 批 2D）：
 * - 看板切 本月 / 本季 / 全部 / 自定义，列表那一排数（线索、有效、商机、订单、项目、成交、投入、产出比、两个转化率）跟着换；
 * - 口径：项目、线索按创建时间落在这一段（同看板「总线索」）；商机、订单、成交按头一回到达该阶段的时间（同看板）；
 *   投入按投入日期；全部 = 原来的列表（不变）；累计运营天数不分时段；
 * - 两边一致：本月 / 本季 / 自定义下列表的关联项目、关联商机、关联订单、累计成交 = 看板同一段的总线索、商机、订单、成交额；
 * - 点数字带同一段创建时间进项目列表，条数对得上（名单.列表）；商机、订单按到达时间数，点开不带时间段。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 读渠道统计, 读渠道分期统计 } from "@/lib/enterprise/channel-stats-db";
import { 读看板底数 } from "@/lib/enterprise/channel-dash-db";
import { 名单链接, 名单键们, 到达口径键, type 名单键 } from "@/lib/enterprise/channel-stats";
import { 算分期统计, 看板时段 } from "@/lib/enterprise/channel-dash";
import { 读项目列表 } from "@/lib/project/list";
import { 补建创建人 } from "@/lib/project/system-created";

type 人 = { id: string; name: string; role: string };
let 老板: 人;
let 渠道: string;
// 北京 11-17；本月从北京 11-01 00:00（UTC 10-31 16:00）起，本季从北京 10-01 00:00（UTC 09-30 16:00）起
const 今 = new Date("2026-11-17T04:00:00Z");
const 渠道们 = () => [{ id: 渠道, createdAt: new Date("2026-01-01T00:00:00Z"), endDate: null }];
const 键们 = Object.keys(名单键们) as 名单键[];

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
  const id = (await prisma.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: id, bizRole: "director" } });
  老板 = { id, name: "老板", role: "ADMIN" };
  const 主 = (await prisma.entChannelMain.create({ data: { name: "抖音" } })).id;
  渠道 = (await prisma.channel.create({ data: { name: "抖音|官方号", platform: "抖音", mainId: 主, channelOwnerId: id } })).id;
  const c = (await prisma.customer.create({ data: { name: "客户一", phone: "13912340001", salesOwnerId: id, channelId: 渠道 } })).id;
  const 项 = (name: string, phase: string, createdAt: string, extra: Record<string, unknown> = {}) =>
    prisma.project.create({
      data: { name, customerId: c, ownerId: id, creatorId: id, phase, node: phase === "线索" ? "潜客培育" : phase === "商机" ? "明确需求" : "生产备货", currency: "CNY", createdAt: new Date(createdAt), ...extra },
    });
  // 本月：线索 2（一条刚好北京 11-01 00:00）、订单 1（成交 500）
  await 项("本月线索甲", "线索", "2026-10-31T16:00:00.000Z");
  await 项("本月线索乙", "线索", "2026-11-10T02:00:00Z");
  await 项("本月订单", "订单", "2026-11-12T02:00:00Z", { amount: 500 });
  // 本季、不在本月：北京 10-31 23:59:59.999 那一刻、商机 1
  await 项("十月商机", "商机", "2026-10-31T15:59:59.999Z");
  // 本季之前：线索 1、订单 1（成交 2000）
  await 项("春天线索", "线索", "2026-04-01T02:00:00Z");
  await 项("春天订单", "订单", "2026-04-02T02:00:00Z", { amount: 2000 });
  // 九月建、10-15 转商机、11-03 进订单（成交 700）：按创建时间不在本季，按到达时间商机算本季、订单算本月
  const 转 = await 项("九月转单", "订单", "2026-09-10T02:00:00Z", { amount: 700 });
  for (const [from, to, at] of [[null, "线索", "2026-09-10T02:00:00Z"], ["线索", "商机", "2026-10-15T02:00:00Z"], ["商机", "订单", "2026-11-03T02:00:00Z"]] as const) {
    await prisma.projectNodeLog.create({ data: { projectId: 转.id, userId: id, kind: "node", fromPhase: from, toPhase: to, toNode: to, at: new Date(at) } });
  }
  // 投入：本月 100、十月 300、春天 1000
  for (const [d, amount] of [["2026-11-05T00:00:00Z", 100], ["2026-10-10T00:00:00Z", 300], ["2026-04-01T00:00:00Z", 1000]] as const) {
    await prisma.entChannelInvest.create({ data: { channelId: 渠道, amount, currency: "CNY", date: new Date(d), userId: id } });
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});
afterAll(() => prisma.$disconnect());

describe("渠道列表统计跟看板时间段", () => {
  it("本月 / 本季 / 全部各算各的；全部 = 原来的列表统计", async () => {
    const 分 = await 以谁的身份(老板.id, () => 读渠道分期统计(渠道们(), 今, null, 老板));
    // 本月：新建 3 个（线索 2）；到商机：本月订单（直接是订单也算到过商机）；进订单：本月订单 + 九月转单（11-03），成交 1200
    expect(分.本月[渠道]).toMatchObject({ 关联线索: 2, 关联商机: 1, 关联订单: 2, 关联项目: 3, 累计成交: [{ 币种: "CNY", 合计: 1200 }], 当前投入: [{ 币种: "CNY", 合计: 100 }], 产出比: 12 });
    // 本季：新建 4 个；到商机：本月订单、十月商机、九月转单（10-15）
    expect(分.本季[渠道]).toMatchObject({ 关联线索: 2, 关联商机: 3, 关联订单: 2, 关联项目: 4, 累计成交: [{ 币种: "CNY", 合计: 1200 }], 当前投入: [{ 币种: "CNY", 合计: 400 }], 产出比: 3 });
    // 全部不变：眼下在哪个阶段
    expect(分.全部[渠道]).toMatchObject({ 关联线索: 3, 关联商机: 1, 关联订单: 3, 关联项目: 7, 累计成交: [{ 币种: "CNY", 合计: 3200 }], 当前投入: [{ 币种: "CNY", 合计: 1400 }] });
    // 没带区间就没有 自定义
    expect(分.自定义).toBeUndefined();
    // 累计运营天数不分时段
    expect(分.本月[渠道].累计运营天数).toBe(分.全部[渠道].累计运营天数);
    const 原 = await 以谁的身份(老板.id, () => 读渠道统计(渠道们(), 今, 老板));
    expect(分.全部[渠道]).toEqual(原[渠道]);
  });

  it("自定义：两头都含（北京日界线）", async () => {
    // 北京 10-01 ~ 10-31：新建只有十月商机；到商机：十月商机（10-31 23:59:59.999）、九月转单（10-15）；十月那笔投入
    const 区间 = { from: new Date("2026-09-30T16:00:00Z"), to: new Date("2026-10-31T15:59:59.999Z") };
    const 分 = await 以谁的身份(老板.id, () => 读渠道分期统计(渠道们(), 今, 区间, 老板));
    expect(分.自定义![渠道]).toMatchObject({ 关联线索: 0, 关联商机: 2, 关联订单: 0, 关联项目: 1, 累计成交: [], 当前投入: [{ 币种: "CNY", 合计: 300 }] });
  });

  it.each([
    ["北京 04-01 ~ 11-30", { from: new Date("2026-03-31T16:00:00Z"), to: new Date("2026-11-30T15:59:59.999Z") }],
    ["北京 10-01 ~ 10-31", { from: new Date("2026-09-30T16:00:00Z"), to: new Date("2026-10-31T15:59:59.999Z") }],
    ["北京 11-03 当天", { from: new Date("2026-11-02T16:00:00Z"), to: new Date("2026-11-03T15:59:59.999Z") }],
  ])("列表同名列 = 看板同一段：项目 = 总线索、商机、订单、成交额，切哪段都一致（自定义 %s）", async (_名, 区间) => {
    const [分, 板] = await 以谁的身份(老板.id, () => Promise.all([读渠道分期统计(渠道们(), 今, 区间, 老板), 读看板底数([渠道], 今, 区间, 老板)]));
    for (const 期 of ["本月", "本季", "自定义"] as const) {
      const 列 = 分[期]![渠道], 看 = 板[期]![渠道];
      expect({ 项目: 列.关联项目, 商机: 列.关联商机, 订单: 列.关联订单, 成交: 列.累计成交 }, 期).toEqual({ 项目: 看.线索, 商机: 看.商机, 订单: 看.订单, 成交: 看.成交 });
    }
    // 全部：关联项目 = 总线索；商机、订单是「眼下在这个阶段」（原列表口径，不动），看板全部是「到过」
    expect(分.全部[渠道].关联项目).toBe(板.全部[渠道].线索);
  });

  it("点数字带同一段创建时间进项目列表，条数对得上", async () => {
    const 分 = await 以谁的身份(老板.id, () => 读渠道分期统计(渠道们(), 今, null, 老板));
    for (const 期 of ["本月", "本季"] as const) {
      const 时段 = 看板时段(期, 今, null);
      for (const 键 of 键们.filter((k) => !到达口径键.includes(k))) {
        const sp = Object.fromEntries(new URL(名单链接(渠道, 键, 时段), "http://x").searchParams);
        mocks.user = { ...mocks.user, id: 老板.id, role: 老板.role };
        const d = await 以谁的身份(老板.id, () => 读项目列表(老板, sp));
        expect(分[期][渠道].名单![键].列表, `${期} ${键}`).toBe(d.总数);
        expect(分[期][渠道][键], `${期} ${键}`).toBe(d.总数);
      }
    }
    // 带了时段 = 这段时间新建的：再带 onlyNew=1，列表排掉补建的项目（同分档的数，project/system-created.ts）
    expect(名单链接(渠道, "关联项目", { createdFrom: "2026-11-01" })).toBe(`/projects?channelId=${渠道}&createdFrom=2026-11-01&onlyNew=1`);
    expect(名单链接(渠道, "关联项目", null)).toBe(名单链接(渠道, "关联项目"));
  });
});

describe("补建的项目（老客户补的潜客培育，creatorId = system）", () => {
  it("分档的关联项目不算它，点数字进列表也排掉、条数对得上；「全部」照算；自己按创建时间筛的列表照旧列它", async () => {
    const c = (await prisma.customer.findFirstOrThrow({ where: { name: "客户一" } })).id;
    await prisma.project.create({ data: { name: "补建培育", customerId: c, ownerId: 老板.id, creatorId: 补建创建人, phase: "线索", node: "潜客培育", createdAt: new Date("2026-11-11T02:00:00Z") } });
    const 分 = await 以谁的身份(老板.id, () => 读渠道分期统计(渠道们(), 今, null, 老板));
    const 板 = await 以谁的身份(老板.id, () => 读看板底数([渠道], 今, null, 老板));
    expect(分.本月[渠道].关联项目).toBe(3);
    expect(板.本月[渠道].线索).toBe(3);
    expect(分.全部[渠道].关联项目).toBe(8);
    const 时段 = 看板时段("本月", 今, null);
    const sp = Object.fromEntries(new URL(名单链接(渠道, "关联项目", 时段), "http://x").searchParams);
    mocks.user = { ...mocks.user, id: 老板.id, role: 老板.role };
    expect((await 以谁的身份(老板.id, () => 读项目列表(老板, sp))).总数).toBe(3);
    const { onlyNew: _不要, ...自己筛 } = sp;
    expect((await 以谁的身份(老板.id, () => 读项目列表(老板, 自己筛))).总数).toBe(4);
  });
});

describe("算分期统计（纯函数）", () => {
  it("没有创建时间 / 投入日期的只进全部", () => {
    const c = { id: "c", createdAt: new Date("2026-01-01T00:00:00Z"), endDate: null };
    const 分 = 算分期统计([c], [{ channelId: "c", phase: "线索", result: null, amount: 0, currency: "CNY" }], [{ channelId: "c", amount: 10, currency: "CNY" }], 今);
    expect(分.全部.c).toMatchObject({ 关联线索: 1, 当前投入: [{ 币种: "CNY", 合计: 10 }] });
    expect(分.本月.c).toMatchObject({ 关联线索: 0, 当前投入: [] });
  });
});
