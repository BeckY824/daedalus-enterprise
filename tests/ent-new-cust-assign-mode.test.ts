/**
 * 新建客户给市场成员的「项目分配方式」（11-18 用户，lib/project/new-cust-assign.ts）：
 *   新建客户（没开项目：只建客户 + 自带潜客培育项目）时市场成员选 指定分配 / 自动分配 / 暂不分配，行为和建档向导一样
 *   - 指定分配：客户和潜客培育给选的销售（市场转一位），记 1 条指定分配
 *   - 自动分配：建好按分配方向分出去（没改按 区域 → 电话 → 本人事业部；改了按改的、存 assignDir），写分配记录
 *   - 暂不分配：记在自己名下、潜客培育记暂不分配，不待分配、不写分配记录
 *   - 销售交这一格、编辑时交、选项不在可选里、指定给不能接的人：服务端拒，什么都不建
 *   - 新建分配方式数据（建档向导、首页 AI 新线索卡的默认值）：市场默认自动分配，规则没开退回原默认；销售默认不变
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null } as { id: string; name: string; email: string; role: string; title: string; avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => mocks.user, requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 市场成员key } from "@/lib/enterprise/market";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 建档只建客户, 建档向导, type 建档向导输入 } from "@/app/(app)/projects/actions";
import { saveCustomer } from "@/app/(app)/customers/actions";
import { 新建分配方式数据 } from "@/lib/project/after-create-assign";
import { 新客户默认分配方式, 新客户分配方式们 } from "@/lib/enterprise/assign-line";

afterAll(() => prisma.$disconnect());

let 老板: string, 市场: string, 渠运: string, 部门市场: string, 乙: string, 丙: string;
const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: id }; };
let 号 = 0;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  号 = 0;
  const 人 = async (email: string, bizRole: string, line: string | null = null) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, line } });
    return id;
  };
  老板 = await 人("boss", "director");
  市场 = await 人("mkt", "marketing_mgr");
  渠运 = await 人("ops", "channel_ops");
  // 业务角色只是项目运营、逐人设成市场成员（读市场成员们 认）
  部门市场 = await 人("deptmkt", "project_ops");
  乙 = await 人("yi", "sales", "内贸");
  丙 = await 人("bing", "sales", "外贸");
  await setSetting(市场成员key, [部门市场]);
  await setSetting(规则.线索分配.key, true);
  // 老板不参与自动分配：内贸只剩乙、外贸只剩丙
  await setSetting(自动分配不参与key, { [老板]: "禁止" });
  当(市场);
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });

/** 新建客户弹窗没开项目交上来的（建档只建客户）：手机号大陆 = 电话判内贸 */
function 只建(负责人: string, 项目分配?: unknown, 补: Record<string, unknown> = {}) {
  号++;
  return {
    客户: {
      name: `新客户${号}`, phone: `1390000${String(号).padStart(4, "0")}`, school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: 负责人, channelId: null, referrerCustomerId: null, touchpoint: "公司资源", 企业资料: { bizLine: "内贸" },
      ...(项目分配 === undefined ? {} : { 项目分配 }), ...补,
    },
    联系人: { name: "王经理", position: "采购", phone: "" },
    跟进: { type: "PHONE", content: "电话聊了需求", occurredAt: "2026-10-20 10:00" },
  } as never;
}
const 培育of = (customerId: string) => prisma.project.findFirstOrThrow({ where: { customerId }, include: { customer: true } });
const 记录们 = () => prisma.entLeadAssign.findMany({ orderBy: { createdAt: "asc" } });

describe("新建客户（只建客户）：市场成员选项目分配方式", () => {
  it("指定分配：客户和潜客培育给选的销售（市场转一位，客户分配补非自持），记 1 条指定分配；回「已指派给」、转走", async () => {
    const r = await 建档只建客户(只建(乙, { 分配方式: 0 }));
    expect(r.ok, r.ok ? "" : (r as { error: string }).error).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ 转走: true, 提示: "已指派给 yi" });
    const p = await 培育of(r.customerId);
    expect([p.ownerId, p.creatorId, p.customer.salesOwnerId, p.assignMode, p.awaitAssignAt]).toEqual([乙, 市场, 乙, "指定分配", null]);
    expect(p.customer.assignWay).toBe("非自持");
    // 市场转一位：换负责人记录记「分配」（market-assign），不算转客户
    expect(await prisma.customerOwnerLog.findMany({ where: { customerId: r.customerId, toOwnerId: 乙 }, select: { fromOwnerId: true, kind: true } })).toEqual([{ fromOwnerId: 市场, kind: "market-assign" }]);
    expect(await 记录们()).toMatchObject([{ projectId: p.id, toUserId: 乙, byUserId: 市场, way: "指定分配", counted: true }]);
  });

  it("自动分配（没改方向）：大陆手机 → 内贸 → 分给乙，写分配记录；项目业务线补成内贸", async () => {
    const r = await 建档只建客户(只建(市场, { 分配方式: 1 }));
    expect(r.ok, r.ok ? "" : (r as { error: string }).error).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ 转走: true });
    expect((r as { 提示?: string }).提示).toContain("分给 yi");
    const p = await 培育of(r.customerId);
    expect([p.ownerId, p.creatorId, p.customer.salesOwnerId, p.assignMode, p.awaitAssignAt, p.bizLine, p.assignDir]).toEqual([乙, 市场, 乙, "自动分配", null, "内贸", null]);
    expect(await 记录们()).toMatchObject([{ projectId: p.id, toUserId: 乙, byUserId: 市场, way: "自动分配" }]);
  });

  it("自动分配、手动改成外贸：分给丙，项目存手选方向 assignDir = 外贸", async () => {
    const r = await 建档只建客户(只建(市场, { 分配方式: 1, 分配方向: "外贸" }));
    expect(r.ok, r.ok ? "" : (r as { error: string }).error).toBe(true);
    if (!r.ok) return;
    const p = await 培育of(r.customerId);
    expect([p.ownerId, p.customer.salesOwnerId, p.assignMode, p.bizLine, p.assignDir]).toEqual([丙, 丙, "自动分配", "外贸", "外贸"]);
    expect(await 记录们()).toMatchObject([{ projectId: p.id, toUserId: 丙, way: "自动分配" }]);
  });

  it("按部门认的市场成员选自动分配：按客户业务线分（外贸 → 丙）", async () => {
    当(部门市场);
    const r = await 建档只建客户(只建(部门市场, { 分配方式: 1 }, { 企业资料: { bizLine: "外贸" } }));
    expect(r.ok, r.ok ? "" : (r as { error: string }).error).toBe(true);
    if (!r.ok) return;
    const p = await 培育of(r.customerId);
    expect([p.ownerId, p.assignMode, p.bizLine]).toEqual([丙, "自动分配", "外贸"]);
    expect(await 记录们()).toHaveLength(1);
  });

  it("暂不分配：记在自己名下，潜客培育记暂不分配、不待分配，不写分配记录", async () => {
    const r = await 建档只建客户(只建(乙, { 分配方式: 3 }));
    expect(r.ok, r.ok ? "" : (r as { error: string }).error).toBe(true);
    if (!r.ok) return;
    expect((r as { 转走?: boolean }).转走).toBeUndefined();
    const p = await 培育of(r.customerId);
    // 交的负责人是乙，选了暂不分配不认：落到自己
    expect([p.ownerId, p.customer.salesOwnerId, p.assignMode, p.awaitAssignAt]).toEqual([市场, 市场, "暂不分配", null]);
    expect(await 记录们()).toHaveLength(0);
  });

  it("渠道运营（新建客户平常只能记在自己名下）选指定分配：照样给选的销售", async () => {
    当(渠运);
    const r = await 建档只建客户(只建(丙, { 分配方式: 0 }));
    expect(r.ok, r.ok ? "" : (r as { error: string }).error).toBe(true);
    if (!r.ok) return;
    const p = await 培育of(r.customerId);
    expect([p.ownerId, p.customer.salesOwnerId, p.assignMode]).toEqual([丙, 丙, "指定分配"]);
  });

  it("新建客户页（saveCustomer 直接新建）同样认：自动分配分出去", async () => {
    const r = await saveCustomer({
      name: "表单客户", phone: "13800000001", school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: 市场, channelId: null, referrerCustomerId: null, touchpoint: "公司资源", 企业资料: { bizLine: "内贸" },
      项目分配: { 分配方式: 1 },
    } as Parameters<typeof saveCustomer>[0]);
    expect(r.ok, r.ok ? "" : (r as { error: string }).error).toBe(true);
    if (!r.ok) return;
    const p = await 培育of(r.id);
    expect([p.ownerId, p.assignMode]).toEqual([乙, "自动分配"]);
    expect(await 记录们()).toHaveLength(1);
  });
});

describe("服务端拒：什么都不建", () => {
  const 空 = async () => {
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.project.count()).toBe(0);
  };

  it("销售交项目分配方式：拒（只有市场成员能用）", async () => {
    当(乙);
    const r = await 建档只建客户(只建(乙, { 分配方式: 3 }));
    expect(r).toMatchObject({ ok: false, error: "只有市场成员新建客户时能选项目分配方式" });
    await 空();
  });

  it("总管理也不认（不算市场成员）", async () => {
    当(老板);
    expect(await 建档只建客户(只建(乙, { 分配方式: 0 }))).toMatchObject({ ok: false });
    await 空();
  });

  it("选项不在可选里（公海捞取、个人自持、乱填）：拒", async () => {
    for (const 分配方式 of [2, 4, 9, "1"]) {
      expect(await 建档只建客户(只建(市场, { 分配方式 }))).toMatchObject({ ok: false, error: "新建客户的项目分配方式只能选指定分配、自动分配或暂不分配" });
    }
    await 空();
  });

  it("「线索分配」规则没开：自动分配用不了，拒", async () => {
    await setSetting(规则.线索分配.key, false);
    invalidateSettingsCache();
    expect(await 建档只建客户(只建(市场, { 分配方式: 1 }))).toMatchObject({ ok: false });
    await 空();
  });

  it("指定给不能接的人（另一位市场成员）：拒", async () => {
    expect(await 建档只建客户(只建(渠运, { 分配方式: 0 }))).toMatchObject({ ok: false, error: "线索只能分给销售或销售管理" });
    await 空();
  });

  it("分配方向乱填：拒", async () => {
    expect(await 建档只建客户(只建(市场, { 分配方式: 1, 分配方向: "火星" }))).toMatchObject({ ok: false });
    await 空();
  });

  it("编辑客户时交：拒，客户不动", async () => {
    const c = await prisma.customer.create({ data: { name: "老客户", phone: "13900000011", salesOwnerId: 市场, bizLine: "内贸" } });
    const r = await saveCustomer({
      id: c.id, updatedAt: c.updatedAt.toISOString(), name: "老客户", phone: "13900000011", school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: "改个备注",
      salesOwnerId: 市场, channelId: null, referrerCustomerId: null, 项目分配: { 分配方式: 1 },
    } as Parameters<typeof saveCustomer>[0]);
    expect(r).toMatchObject({ ok: false, error: "项目分配方式只在新建客户时选" });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).remark).toBeNull();
  });

  it("带项目的建档向导：客户上夹带的项目分配不认，照项目自己的分配方式走", async () => {
    const r = await 建档向导({
      ...(只建(市场, { 分配方式: 0 }) as unknown as 建档向导输入),
      项目: { name: "一期", amount: 0, currency: "CNY", ownerId: 市场, 分配方式: 3, 业务线: "内贸" },
      跟进: { type: "PHONE", content: "电话聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
    } as 建档向导输入);
    expect(r.ok, r.ok ? "" : (r as { error: string }).error).toBe(true);
    if (!r.ok) return;
    const 们 = await prisma.project.findMany({ where: { customerId: r.customerId } });
    expect(们.map((p) => [p.ownerId, p.assignMode])).toEqual([[市场, "暂不分配"]]);
  });
});

describe("默认值：建档向导、首页 AI 新线索卡（新建分配方式数据），新建客户的项目分配方式", () => {
  it("市场管理 / 渠运 / 按部门认的市场成员：默认自动分配，是市场", async () => {
    for (const id of [市场, 渠运, 部门市场]) {
      const 数 = await 新建分配方式数据({ ...mocks.user, id });
      expect([数.默认分配方式, 数.是市场, 数.是销售]).toEqual([1, true, false]);
      expect(新客户默认分配方式(新客户分配方式们(数.分配方式们).map((x) => x.i))).toBe(1);
    }
  });

  it("销售：默认个人自持不变，不算市场（新建客户不摆这一格）", async () => {
    const 数 = await 新建分配方式数据({ ...mocks.user, id: 乙 });
    expect([数.默认分配方式, 数.是市场, 数.是销售]).toEqual([4, false, true]);
  });

  it("「线索分配」规则没开（自动分配用不了）：向导退回原来的默认（能用的第一个），新建客户退回暂不分配", async () => {
    await setSetting(规则.线索分配.key, false);
    invalidateSettingsCache();
    const 数 = await 新建分配方式数据({ ...mocks.user, id: 市场 });
    expect(数.分配方式们.some((x) => x.i === 1)).toBe(false);
    expect(数.默认分配方式).toBe(数.分配方式们[0].i);
    expect(新客户默认分配方式(新客户分配方式们(数.分配方式们).map((x) => x.i))).toBe(3);
  });

  it("纯函数：只留指定 / 自动 / 暂不分配；都没有 = undefined", () => {
    expect(新客户分配方式们([{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }, { i: 4 }]).map((x) => x.i)).toEqual([0, 1, 3]);
    expect(新客户默认分配方式([0, 3])).toBe(3);
    expect(新客户默认分配方式([0])).toBe(0);
    expect(新客户默认分配方式([2, 4])).toBeUndefined();
  });
});
