/**
 * 渠道数字点开看名单（11-11）：
 * - 渠道页每个数（关联线索 / 有效线索 / 关联商机 / 关联订单 / 关联项目）的「名单.列表」= 点进项目列表（名单链接：渠道 + 同口径阶段）看到的条数，
 *   同一个人、同一可见范围；子渠道、只有主渠道（子渠道名留空）的来源各一条；
 * - 统计比列表多的只有公海里的（企业版项目列表不列公海），名单差话 写清；
 * - 「在哪个阶段」两边同一句（stage-dict.ts 项目在阶段）：有结局的按结局认；
 * - 项目列表按创建时间筛：北京日 00:00 到 23:59:59.999，两头都算；筛选参数不绕过可见范围。
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
import { 读渠道统计 } from "@/lib/enterprise/channel-stats-db";
import { 名单链接, 名单差话, 名单键们, type 名单键 } from "@/lib/enterprise/channel-stats";
import { 读项目列表 } from "@/lib/project/list";

type 人 = { id: string; name: string; role: string };
let 老板: 人, 销售: 人, 销售乙: 人;
let 子渠道: string, 只主: string;

const 键们 = Object.keys(名单键们) as 名单键[];
const 统计of = (谁: 人) =>
  以谁的身份(谁.id, () => 读渠道统计([子渠道, 只主].map((id) => ({ id, createdAt: new Date("2026-01-01T00:00:00Z"), endDate: null })), new Date("2026-11-11T00:00:00Z"), 谁));
/** 照名单链接的地址栏参数去读项目列表：这一页的行，带上服务端总数（11-11 起分页，渠道数字对的是总数） */
const 点进去 = async (谁: 人, channelId: string, 键: 名单键) => {
  mocks.user = { ...mocks.user, id: 谁.id, role: 谁.role };
  const sp = Object.fromEntries(new URL(名单链接(channelId, 键), "http://x").searchParams);
  const d = await 以谁的身份(谁.id, () => 读项目列表(谁, sp));
  return Object.assign([...d.行], { 总数: d.总数 });
};

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
  const 建人 = async (email: string, name: string, role: string, bizRole: string): Promise<人> => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role, password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole } });
    return { id, name, role };
  };
  老板 = await 建人("boss", "老板", "ADMIN", "director");
  销售 = await 建人("s1", "销售甲", "SALES", "sales");
  销售乙 = await 建人("s2", "销售乙", "SALES", "sales");
  // 一个有子渠道的主渠道 + 一个只有主渠道（子渠道名留空那条入口）的
  const 主1 = (await prisma.entChannelMain.create({ data: { name: "抖音" } })).id;
  const 主2 = (await prisma.entChannelMain.create({ data: { name: "展厅", allowSub: false } })).id;
  子渠道 = (await prisma.channel.create({ data: { name: "抖音|官方号", platform: "抖音", mainId: 主1, channelOwnerId: 老板.id } })).id;
  只主 = (await prisma.channel.create({ data: { name: "展厅", platform: "展厅", mainId: 主2, channelOwnerId: 老板.id } })).id;

  const 客 = async (name: string, phone: string, owner: 人, channelId: string) =>
    (await prisma.customer.create({ data: { name, phone, salesOwnerId: owner.id, channelId } })).id;
  const c1 = await 客("客户一", "13912340001", 销售, 子渠道);
  const c2 = await 客("客户二", "13912340002", 销售乙, 子渠道);
  const c3 = await 客("客户三", "13912340003", 销售, 只主);
  const 项 = (name: string, customerId: string, owner: 人 | null, phase: string, extra: Record<string, unknown> = {}) =>
    prisma.project.create({ data: { name, customerId, ownerId: owner?.id ?? "", creatorId: (owner ?? 老板).id, phase, node: phase === "线索" ? "潜客培育" : phase === "商机" ? "明确需求" : "生产备货", currency: "CNY", ...extra } });
  await 项("一线索", c1, 销售, "线索");
  await 项("一流失", c1, 销售, "线索", { result: "线索流失" });
  await 项("一商机", c1, 销售, "商机");
  await 项("一订单", c1, 销售, "订单");
  // 公海里的线索：统计数得到（人人看得见公海），项目列表不列
  await 项("一公海", c1, null, "线索", { pooledAt: new Date() });
  await 项("二线索", c2, 销售乙, "线索");
  // 客户来源是子渠道、项目自己选了只主：算只主
  await 项("二改道", c2, 销售乙, "商机", { channelId: 只主 });
  await 项("三线索", c3, 销售, "线索");
  // 库里 phase 还是线索、结局是丢单：两边都按结局算商机
  await 项("三丢单", c3, 销售, "线索", { result: "丢单" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});
afterAll(() => prisma.$disconnect());

describe("渠道数字 = 点进去的项目列表条数", () => {
  it("老板：子渠道、只主两条来源，每个数都对得上；差的只有公海那一条", async () => {
    const 统 = await 统计of(老板);
    expect(统[子渠道]).toMatchObject({ 关联线索: 4, 有效线索: 4, 关联商机: 1, 关联订单: 1, 关联项目: 6 });
    expect(统[只主]).toMatchObject({ 关联线索: 1, 关联商机: 2, 关联订单: 0, 关联项目: 3 });
    for (const ch of [子渠道, 只主]) {
      for (const 键 of 键们) {
        const 列 = await 点进去(老板, ch, 键);
        const 名单 = 统[ch].名单![键];
        expect(名单.列表, `${ch} ${键}`).toBe(列.总数);
        expect(统[ch][键] - 名单.列表, `${ch} ${键}`).toBe(名单.公海);
      }
    }
    expect(统[子渠道].名单!.关联线索).toEqual({ 列表: 3, 公海: 1 });
    expect(名单差话(4, 统[子渠道].名单!.关联线索)).toBe("项目列表里 3 条（另 1 条在公海，到公海页看）");
    expect(名单差话(1, 统[子渠道].名单!.关联商机)).toBeNull();
    expect((await 点进去(老板, 只主, "关联商机")).map((r) => r.name).sort()).toEqual(["三丢单", "二改道"]);
  });

  it("销售：只数、只列自己看得见的；两边照样对得上，筛选参数不带出同事的项目", async () => {
    for (const 谁 of [销售, 销售乙]) {
      const 统 = await 统计of(谁);
      for (const ch of [子渠道, 只主]) {
        for (const 键 of 键们) {
          const 列 = await 点进去(谁, ch, 键);
          expect(统[ch].名单![键].列表, `${谁.name} ${ch} ${键}`).toBe(列.总数);
          expect(列.every((r) => r.ownerId === 谁.id)).toBe(true);
        }
      }
    }
    const 甲 = await 统计of(销售);
    expect(甲[子渠道]).toMatchObject({ 关联线索: 3, 关联商机: 1, 关联项目: 5 });
    expect(甲[子渠道].名单!.关联线索).toEqual({ 列表: 2, 公海: 1 });
    expect((await 统计of(销售乙))[子渠道]).toMatchObject({ 关联线索: 2, 关联商机: 0 });
  });

  it("名单链接：线索 / 有效线索带 phase=线索，关联项目不带阶段", () => {
    expect(名单链接("c1", "关联线索")).toBe("/projects?channelId=c1&phase=%E7%BA%BF%E7%B4%A2");
    expect(名单链接("c1", "有效线索")).toBe(名单链接("c1", "关联线索"));
    expect(名单链接("c1", "关联项目")).toBe("/projects?channelId=c1");
  });

  it("不带「是谁在看」（单测、别处调用）不算名单，和原来一样", async () => {
    const 统 = await 读渠道统计([{ id: 子渠道, createdAt: new Date("2026-01-01T00:00:00Z"), endDate: null }]);
    expect(统[子渠道].名单).toBeUndefined();
  });

  it("名单差话：公海之外的差额另说一句", () => {
    expect(名单差话(5, { 列表: 2, 公海: 1 })).toBe("项目列表里 2 条（另 1 条在公海，到公海页看；2 条你只能数到、项目列表不列）");
    expect(名单差话(5, undefined)).toBeNull();
  });
});

describe("项目列表按创建时间筛（北京日）", () => {
  const 名们 = async (谁: 人, sp: Record<string, string>) => {
    mocks.user = { ...mocks.user, id: 谁.id, role: 谁.role };
    return (await 以谁的身份(谁.id, () => 读项目列表(谁, sp))).行.map((r) => r.name).sort();
  };
  beforeEach(async () => {
    // 北京 03-01 00:00 = UTC 02-28 16:00；北京 06-30 23:59:59 = UTC 06-30 15:59:59
    const 设 = (name: string, iso: string) => prisma.project.updateMany({ where: { name }, data: { createdAt: new Date(iso) } });
    await 设("一线索", "2026-02-28T15:59:59.999Z");
    await 设("一流失", "2026-02-28T16:00:00.000Z");
    await 设("一商机", "2026-06-30T15:59:59.999Z");
    await 设("一订单", "2026-06-30T16:00:00.000Z");
    await prisma.project.updateMany({ where: { name: { in: ["二线索", "二改道", "三线索", "三丢单"] } }, data: { createdAt: new Date("2026-04-01T04:00:00Z") } });
  });

  it("两头都算：当天 00:00 进、前一天 23:59:59.999 不进；结束日 23:59:59.999 进、次日 00:00 不进", async () => {
    expect(await 名们(老板, { channelId: 子渠道, createdFrom: "2026-03-01", createdTo: "2026-06-30" })).toEqual(["一商机", "一流失", "二线索"]);
    // 倒过来写对调；只给一头只限那一头
    expect(await 名们(老板, { channelId: 子渠道, createdFrom: "2026-06-30", createdTo: "2026-03-01" })).toEqual(["一商机", "一流失", "二线索"]);
    expect(await 名们(老板, { channelId: 子渠道, createdFrom: "2026-07-01" })).toEqual(["一订单"]);
    expect(await 名们(老板, { channelId: 子渠道, createdTo: "2026-02-28" })).toEqual(["一线索"]);
    // 写错的当没筛，filters 回空
    expect(await 名们(老板, { channelId: 子渠道, createdFrom: "乱写" })).toHaveLength(5);
    expect((await 读项目列表(老板, { createdFrom: "乱写", createdTo: "2026-06-30" })).filters).toMatchObject({ createdFrom: "", createdTo: "2026-06-30" });
  });

  it("创建时间、渠道、负责人一起筛也不绕过可见范围：销售甲看不到销售乙的", async () => {
    expect(await 名们(销售, { channelId: 子渠道, createdFrom: "2026-03-01", createdTo: "2026-06-30" })).toEqual(["一商机", "一流失"]);
    expect(await 名们(销售, { channelId: 子渠道, ownerId: 销售乙.id })).toEqual([]);
    expect(await 名们(销售, { ownerId: 销售乙.id, createdFrom: "2026-01-01", createdTo: "2026-12-31" })).toEqual([]);
  });

  it("行上带创建时间（列表可选列）", async () => {
    const 行 = (await 读项目列表(老板, { channelId: 子渠道 })).行;
    expect(行.find((r) => r.name === "一流失")?.createdAt).toBe("2026-02-28T16:00:00.000Z");
  });
});

describe("项目列表「手机号」筛选", () => {
  const 名们 = async (谁: 人, sp: Record<string, string>) => {
    mocks.user = { ...mocks.user, id: 谁.id, role: 谁.role };
    return (await 以谁的身份(谁.id, () => 读项目列表(谁, sp))).行.map((r) => r.name).sort();
  };
  it("按客户号码（后几位、带 +86）筛项目；客户看不到的不列、不放宽范围", async () => {
    expect(await 名们(老板, { phone: "340002" })).toEqual(["二改道", "二线索"]);
    expect(await 名们(老板, { phone: "+86 139 1234 0003", channelId: 只主 })).toEqual(["三丢单", "三线索"]);
    expect(await 名们(销售, { phone: "340002" })).toEqual([]);
    expect((await 读项目列表(老板, { phone: "abc" })).行).toEqual([]);
    expect((await 读项目列表(老板, { phone: "5678" })).filters.phone).toBe("5678");
  });
});
