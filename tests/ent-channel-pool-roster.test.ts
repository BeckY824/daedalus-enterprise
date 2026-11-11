/**
 * 渠道数字「另 M 条在公海」能点（11-11）：链到公海页的渠道名单（projChannel + 同口径 phase），落地条数 = M；
 *   - P-看-03 公海只在公海页出现：不是把公海项目放进项目列表，是给公海页一个带筛选的入口
 *   - 公海页渠道名单按项目一条一行：客户不在客户公海的是项目行；客户在客户公海的按名单里它名下的项目拆行（领的仍是整位客户）
 *   - M 只数公海页看得到的：项目没填来源、跟客户来源算的，客户要露；原负责人回避看不到的不算（两边同一句 公海名单条件）
 *   - N = 0、M > 0 时数字本身直接去公海页
 * 各人（总管理、销售、市场成员）各渠道各个数：N = 项目列表总数、M = 公海页渠道名单总数
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 市场成员key } from "@/lib/enterprise/market";
import { 读渠道统计 } from "@/lib/enterprise/channel-stats-db";
import { 名单链接, 公海名单链接, 数字链接, 名单段, 名单键们, type 名单键 } from "@/lib/enterprise/channel-stats";
import { 读项目列表 } from "@/lib/project/list";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";

type 人 = { id: string; name: string; role: string };
let 老板: 人, 销售: 人, 销售乙: 人, 市场: 人;
let 甲渠道: string, 全公海: string;
const 键们 = Object.keys(名单键们) as 名单键[];

const 设 = (谁: 人) => { mocks.user = { ...mocks.user, id: 谁.id, name: 谁.name, role: 谁.role }; };
const 统计of = (谁: 人) => { 设(谁); return 以谁的身份(谁.id, () => 读渠道统计([甲渠道, 全公海].map((id) => ({ id, createdAt: new Date("2026-01-01T00:00:00Z"), endDate: null })), new Date(), 谁)); };
const spof = (链: string) => Object.fromEntries(new URL(链, "http://x").searchParams);
const 列表总数 = async (谁: 人, 链: string) => { 设(谁); return (await 以谁的身份(谁.id, () => 读项目列表(谁, spof(链)))).总数; };
/** 照公海页 page.tsx 认地址栏：projChannel + phase 是渠道名单 */
const 公海页 = async (谁: 人, 链: string) => {
  设(谁);
  const q = spof(链);
  expect(new URL(链, "http://x").pathname).toBe("/pool");
  return 以谁的身份(谁.id, () => 读公海页(谁, {}, 1, 100, { channelId: q.projChannel, phase: q.phase ?? "" }));
};

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  const 建人 = async (email: string, name: string, role: string, bizRole: string): Promise<人> => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole } });
    return { id, name, role };
  };
  老板 = await 建人("boss", "老板", "ADMIN", "director");
  销售 = await 建人("s1", "销售甲", "SALES", "sales");
  销售乙 = await 建人("s2", "销售乙", "SALES", "sales");
  市场 = await 建人("m1", "市场", "SALES", "channel_ops");
  await setSetting(市场成员key, [市场.id]);
  invalidateSettingsCache();
  忘掉企业版范围();
  const 主 = (await prisma.entChannelMain.create({ data: { name: "抖音" } })).id;
  甲渠道 = (await prisma.channel.create({ data: { name: "抖音|甲号", platform: "抖音", mainId: 主, channelOwnerId: 老板.id } })).id;
  全公海 = (await prisma.channel.create({ data: { name: "抖音|乙号", platform: "抖音", mainId: 主, channelOwnerId: 老板.id } })).id;

  const 客 = async (name: string, phone: string, owner: 人, channelId: string, 进客户公海 = false) => {
    const id = (await prisma.customer.create({ data: { name, phone, salesOwnerId: owner.id, channelId } })).id;
    if (进客户公海) await prisma.customerPool.create({ data: { customerId: id, userId: owner.id, reason: "手动" } });
    return id;
  };
  const 项 = async (name: string, customerId: string, owner: 人 | null, phase: string, extra: Record<string, unknown> = {}, 放回的人?: 人) => {
    const p = await prisma.project.create({ data: { name, customerId, ownerId: owner?.id ?? "", creatorId: (owner ?? 市场).id, phase, node: phase === "线索" ? "潜客培育" : phase === "商机" ? "痛点挖掘" : "生产备货", currency: "CNY", ...extra } });
    if (放回的人) await prisma.projectNodeLog.create({ data: { projectId: p.id, userId: 放回的人.id, kind: "pool-release", fromOwnerId: 放回的人.id, toPhase: phase, toNode: "潜客培育" } });
    return p.id;
  };
  const 公 = { pooledAt: new Date() };
  const c1 = await 客("甲客户", "13900000001", 销售, 甲渠道);
  const c2 = await 客("乙客户", "13900000002", 销售乙, 甲渠道);
  // 客户在客户公海、名下两个公海项目都是甲渠道：公海页一位客户一行，渠道名单里按项目拆两行
  const c3 = await 客("公海客户", "13900000003", 销售乙, 甲渠道, true);
  const c4 = await 客("全公海客户", "13900000004", 销售乙, 全公海, true);
  const c5 = await 客("乙全公海", "13900000005", 销售乙, 全公海);
  await 项("一线索", c1, 销售, "线索");
  await 项("一商机", c1, 销售, "商机");
  // 甲渠道公海项目：客户不在客户公海（项目行），项目没填来源、跟客户来源；客户是乙的——销售甲看得到项目（公海）但客户不露 → 不算
  await 项("乙公海线索", c2, null, "线索", 公, 销售乙);
  // 项目自己选了甲渠道：谁都算
  await 项("乙公海自选", c2, null, "线索", { ...公, channelId: 甲渠道 }, 老板);
  // 销售甲放回的：原负责人回避，销售甲公海页看不到，M 也不算
  await 项("甲放回的", c1, null, "商机", 公, 销售);
  await 项("公海客户一", c3, null, "线索", 公);
  await 项("公海客户二", c3, null, "商机", 公);
  // 有结局：线索流失按结局归线索
  await 项("公海客户流失", c3, null, "线索", { ...公, result: "线索流失" });
  // 全公海渠道：项目列表里一条都没有
  await 项("全公海一", c4, null, "线索", 公);
  await 项("全公海二", c5, null, "商机", { ...公, channelId: 全公海 }, 销售乙);
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(() => prisma.$disconnect());

describe("渠道「另 M 条在公海」点到公海页，落地条数 = M", () => {
  it("每个人、每个渠道、每个数：N = 项目列表总数，M = 公海页渠道名单总数；差额 = 公海 + 只能数到", async () => {
    for (const 谁 of [老板, 销售, 销售乙, 市场]) {
      const 统 = await 统计of(谁);
      for (const ch of [甲渠道, 全公海]) {
        for (const 键 of 键们) {
          const 名 = `${谁.name} ${ch === 甲渠道 ? "甲" : "全公海"} ${键}`;
          const 名单 = 统[ch].名单![键];
          expect(名单.列表, 名).toBe(await 列表总数(谁, 名单链接(ch, 键)));
          expect(名单.公海, 名).toBe((await 公海页(谁, 公海名单链接(ch, 键))).总数);
          expect(名单.列表 + 名单.公海, 名).toBeLessThanOrEqual(统[ch][键]);
        }
      }
    }
  });

  it("老板：甲渠道线索 = 一线索 + 四条公海（拆行的客户两行、自选、跟客户来源）；公海页行名、拆出的 id 不撞", async () => {
    const 统 = await 统计of(老板);
    expect(统[甲渠道].名单!.关联线索).toEqual({ 列表: 1, 公海: 4 });
    const d = await 公海页(老板, 公海名单链接(甲渠道, "关联线索"));
    expect(d.行.map((r) => r.项目名).sort()).toEqual(["乙公海线索", "乙公海自选", "公海客户一", "公海客户流失"].sort());
    expect(new Set(d.行.map((r) => r.id)).size).toBe(4);
    // 拆出来的客户行：领取仍按客户
    expect(d.行.filter((r) => r.种 === "客户").every((r) => r.customerId === d.行.find((x) => x.项目名 === "公海客户一")!.customerId)).toBe(true);
    // 整个公海页不带名单时客户只一行
    设(老板);
    const 全 = await 以谁的身份(老板.id, () => 读公海页(老板, {}, 1, 100));
    expect(全.行.filter((r) => r.客户名 === "公海客户")).toHaveLength(1);
  });

  it("销售甲：跟客户来源、客户不露的不算；自己放回的回避，不算；两边一致", async () => {
    const 统 = await 统计of(销售);
    const 线索 = (await 公海页(销售, 公海名单链接(甲渠道, "关联线索"))).行.map((r) => r.项目名).sort();
    expect(线索).toEqual(["乙公海自选", "公海客户一", "公海客户流失"].sort());
    expect(统[甲渠道].名单!.关联线索.公海).toBe(3);
    expect((await 公海页(销售, 公海名单链接(甲渠道, "关联商机"))).行.map((r) => r.项目名)).toEqual(["公海客户二"]);
    // 老板商机里有「甲放回的」，销售甲没有
    expect((await 公海页(老板, 公海名单链接(甲渠道, "关联商机"))).行.map((r) => r.项目名).sort()).toEqual(["公海客户二", "甲放回的"].sort());
  });

  it("全在公海的渠道：N = 0、M > 0，数字直接链到公海页；落地条数 = 渠道数字", async () => {
    for (const 谁 of [老板, 销售乙, 市场]) {
      const 统 = await 统计of(谁);
      const 名单 = 统[全公海].名单!.关联项目;
      expect(名单.列表, 谁.name).toBe(0);
      expect(数字链接(全公海, "关联项目", 名单)).toBe(名单.公海 > 0 ? 公海名单链接(全公海, "关联项目") : 名单链接(全公海, "关联项目"));
      if (谁 === 老板) {
        expect(名单).toEqual({ 列表: 0, 公海: 2 });
        expect(统[全公海].关联项目).toBe(2);
        expect((await 公海页(谁, 数字链接(全公海, "关联项目", 名单))).总数).toBe(2);
      }
    }
    // 项目列表里有的：数字照旧去项目列表
    expect(数字链接(甲渠道, "关联线索", { 列表: 1, 公海: 4 })).toBe(名单链接(甲渠道, "关联线索"));
  });

  it("市场视角：项目列表只列市场圈的，公海名单照公海页能看到的算，各自落地条数对得上", async () => {
    const 统 = await 统计of(市场);
    for (const 键 of 键们) {
      expect(统[甲渠道].名单![键].公海).toBe((await 公海页(市场, 公海名单链接(甲渠道, 键))).总数);
      expect(统[甲渠道].名单![键].列表).toBe(await 列表总数(市场, 名单链接(甲渠道, 键)));
    }
  });

  it("名单段、公海名单链接", () => {
    expect(公海名单链接("c1", "关联线索")).toBe("/pool?projChannel=c1&phase=%E7%BA%BF%E7%B4%A2");
    expect(公海名单链接("c1", "关联项目")).toBe("/pool?projChannel=c1");
    expect(名单段(5, { 列表: 2, 公海: 1 })).toEqual({ 列表: 2, 公海: 1, 其余: 2 });
    expect(名单段(3, { 列表: 3, 公海: 0 })).toBeNull();
    expect(名单段(3, { 列表: 0, 公海: 9 })).toEqual({ 列表: 0, 公海: 3, 其余: 0 });
  });
});
