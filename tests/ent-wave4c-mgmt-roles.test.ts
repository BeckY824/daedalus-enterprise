/**
 * 11-18 用户定「按之前的口径，不要影响一人多角色的实际权限」：今天新加的市场限制只针对「市场成员」（是市场成员of：有市场角色、不兼销售 / 销售管理）。
 * 一人兼 条线总管理（设外贸线）+ 销售管理 + 市场管理、部门在外贸事业部的人（下称「兼管」）：
 *   1. 客户转让「指定」不按分配方向限人（P-转-26 末句，Even 11-18 问 1 选 A；P-判定-01 任一角色放行），下拉 / 批量预看也不按方向筛
 *   2. 不走市场分配指定挡（只给参与正常的人），接手人按普通转让（P-转-01）
 *   3. 新建时负责人选成别人，不记「指定分配」
 *   4. 只建客户不摆「项目分配方式」、服务端也不认
 *   5. 系统补建建给自己记「个人自持」，不记「暂不分配」
 * 另一处（不只兼管）：
 *   6. 外贸指定候选 = 外贸事业部的销售（含义乌档口）+ 参与正常，外贸销售管理不列（P-转-27「指定分配不受档口排除」、P-转-26）
 * 每条都配纯市场成员（市场管理 / 渠道运营）的对照：限制照旧生效
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
import { 自动分配不参与key, 不设配额key } from "@/lib/enterprise/lead-assign";
import { 读组织 } from "@/lib/enterprise/org";
import { 批量客户自动分配预看, 设线部门 } from "@/app/(app)/leads/assign-actions";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 建档只建客户 } from "@/app/(app)/projects/actions";
import { 要按方向指定, 指定方向候选表 } from "@/lib/enterprise/assign-direction-pick";
import { 市场分配指定挡, 市场分配限指定 } from "@/lib/enterprise/cust-auto-assign";
import { 新建算指定分配 } from "@/lib/enterprise/direct-assign";
import { 新建分配方式数据 } from "@/lib/project/after-create-assign";
import { 系统建项目分配方式 } from "@/lib/project/self-assign-mode";

afterAll(() => prisma.$disconnect());

const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, name: id, role }; };

let 老板: string, 兼管: string, 外渠: string, 市场管: string, 渠运: string;
let 外一: string, 外二: string, 外组长: string, 档口一: string, 内一: string;
let 号 = 0;

type 址 = { addrCountry?: string | null; addrProvince?: string | null; addrCity?: string | null };
const 马来西亚: 址 = { addrCountry: "马来西亚" };

/** 某人名下一位「暂不分配」的客户（项目暂不分配、在线索阶段），地址马来西亚（默认外贸），不带电话 */
async function 建客户(负责人: string) {
  号++;
  const c = await prisma.customer.create({ data: { name: `客户${号}`, phone: "", salesOwnerId: 负责人, bizLine: "外贸", ...马来西亚 } });
  await prisma.project.create({ data: { name: `项目${号}`, customerId: c.id, ownerId: 负责人, creatorId: 负责人, bizLine: "外贸", assignMode: "暂不分配" } });
  return c.id;
}
const 客户负责人 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;

/** 新建客户弹窗没开项目交上来的（建档只建客户） */
function 只建(负责人: string, 项目分配?: unknown) {
  号++;
  return {
    客户: {
      name: `新客户${号}`, phone: `1390000${String(号).padStart(4, "0")}`, school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: 负责人, channelId: null, referrerCustomerId: null, touchpoint: "公司资源", 企业资料: { bizLine: "外贸" },
      ...(项目分配 === undefined ? {} : { 项目分配 }),
    },
    联系人: { name: "王经理", position: "采购", phone: "" },
    跟进: { type: "PHONE", content: "电话聊了需求", occurredAt: "2026-10-20 10:00" },
  } as never;
}

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  号 = 0;
  const 部 = async (name: string, parentId: string | null = null) => (await prisma.entDept.create({ data: { name, parentId } })).id;
  const 外贸部 = await 部("外贸事业部");
  const 内贸部 = await 部("内贸事业部");
  const 档口 = await 部("义乌档口", 外贸部);
  const 内市场部 = await 部("市场运营部", 内贸部);
  let 第几 = 0;
  const 人 = async (email: string, bizRole: string, deptId: string | null, o: { role?: string; managerId?: string | null; line?: string | null } = {}) => {
    第几++;
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role: o.role ?? "SALES", password: "x", createdAt: new Date(2026, 0, 第几) } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, deptId, managerId: o.managerId ?? null, line: o.line ?? null } });
    return id;
  };
  老板 = await 人("boss", "director", null, { role: "ADMIN" });
  兼管 = await 人("multi", "director,sales_mgr,marketing_mgr", 外贸部, { role: "MANAGER", line: "外贸" });
  // 兼管手下的纯市场成员（渠道运营）：客户在市场手里、兼管是实线直属上级能转
  外渠 = await 人("wch", "channel_ops", 外贸部, { managerId: 兼管 });
  市场管 = await 人("mkt", "marketing_mgr", 内市场部);
  渠运 = await 人("ch", "channel_ops", 内市场部, { managerId: 市场管 });
  外一 = await 人("w1", "sales", 外贸部);
  外二 = await 人("w2", "sales", 外贸部);
  外组长 = await 人("wl", "sales_mgr", 外贸部, { role: "ADMIN" });
  档口一 = await 人("yw1", "sales", 档口);
  内一 = await 人("n1", "sales", 内贸部);

  for (const k of [规则.按组织看客户.key, 规则.线索分配.key]) await setSetting(k, true);
  await setSetting(不设配额key, true);
  当(老板, "ADMIN");
  expect(await 设线部门({ 内贸: [内贸部], 外贸: [外贸部] })).toEqual({ ok: true });
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });

describe("1. 客户转让「指定」：兼管理角色不按分配方向限人", () => {
  it("兼管把手下市场成员的暂不分配客户（默认外贸）指定给内贸销售：放行；不要按方向指定", async () => {
    const c = await 建客户(外渠);
    const org = await 读组织();
    当(兼管, "MANAGER");
    const 客户 = { id: c, salesOwnerId: 外渠, bizLine: "外贸", pool: null };
    expect(await 要按方向指定({ id: 兼管, role: "MANAGER" }, org, 客户)).toBeNull();
    expect(await assignSalesOwner([c], 内一)).toMatchObject({ ok: true });
    expect(await 客户负责人(c)).toBe(内一);
  });

  it("兼管批量预看：不给定向（下拉不按方向筛）、不给可指定（不限参与正常）；框里照样能选自动分配", async () => {
    const c = await 建客户(外渠);
    当(兼管, "MANAGER");
    const r = await 批量客户自动分配预看([c]);
    if (!r.ok) throw new Error(r.error);
    expect(r.可).toEqual([c]);
    expect(r.定向).toBeUndefined();
    expect(r.可指定).toBeUndefined();
  });

  it("对照：纯市场管理照旧按方向拦（默认外贸指定给内贸销售：拒，客户不动），预看给定向和可指定", async () => {
    const c = await 建客户(市场管);
    当(市场管);
    expect(await assignSalesOwner([c], 内一)).toMatchObject({ ok: false, error: expect.stringContaining("外贸") });
    expect(await 客户负责人(c)).toBe(市场管);
    const r = await 批量客户自动分配预看([c]);
    if (!r.ok) throw new Error(r.error);
    expect(r.定向?.默认线).toBe("外贸");
    expect(r.可指定).toBeDefined();
  });
});

describe("2. 市场分配指定挡：兼管理角色不走，接手人按普通转让（P-转-01）", () => {
  it("兼管指定给参与暂停的外贸销售：放行", async () => {
    const c = await 建客户(外渠);
    await setSetting(自动分配不参与key, { [外二]: "暂停" });
    当(兼管, "MANAGER");
    expect(市场分配限指定(await 读组织(), 兼管)).toBe(false);
    expect(await 市场分配指定挡({ id: 兼管, role: "MANAGER" }, [c], 外二)).toBeNull();
    expect(await assignSalesOwner([c], 外二)).toMatchObject({ ok: true });
    expect(await 客户负责人(c)).toBe(外二);
  });

  it("对照：渠道运营指定给参与暂停的外贸销售：拒（只给参与正常的人）", async () => {
    const c = await 建客户(渠运);
    await setSetting(自动分配不参与key, { [外二]: "暂停" });
    当(渠运);
    expect(市场分配限指定(await 读组织(), 渠运)).toBe(true);
    expect(await assignSalesOwner([c], 外二, null, "外贸")).toMatchObject({ ok: false });
    expect(await 客户负责人(c)).toBe(渠运);
  });
});

describe("3. 新建时负责人选成别人：兼管理角色不记指定分配", () => {
  it("兼管 → 不算；纯市场管理 / 渠道运营 → 算", async () => {
    const org = await 读组织();
    expect(新建算指定分配(org, 兼管, 外一)).toBe(false);
    expect(新建算指定分配(org, 市场管, 外一)).toBe(true);
    expect(新建算指定分配(org, 渠运, 外一)).toBe(true);
  });
});

describe("4. 只建客户的「项目分配方式」：只给市场成员", () => {
  it("兼管：不算市场（不摆这一格），交了服务端拒、什么都不建", async () => {
    expect((await 新建分配方式数据({ ...mocks.user, id: 兼管 })).是市场).toBe(false);
    当(兼管, "MANAGER");
    expect(await 建档只建客户(只建(兼管, { 分配方式: 3 }))).toMatchObject({ ok: false, error: "只有市场成员新建客户时能选项目分配方式" });
    expect(await prisma.customer.count()).toBe(0);
  });

  it("对照：市场管理、渠道运营照旧算市场、默认自动分配", async () => {
    for (const id of [市场管, 渠运]) {
      const 数 = await 新建分配方式数据({ ...mocks.user, id });
      expect([数.是市场, 数.默认分配方式]).toEqual([true, 1]);
    }
  });
});

describe("5. 系统补建建给自己：兼管理角色记个人自持", () => {
  it("兼管 → 个人自持；纯市场管理 / 渠道运营 → 暂不分配", async () => {
    expect(await 系统建项目分配方式(prisma, 兼管, 兼管)).toBe("个人自持");
    expect(await 系统建项目分配方式(prisma, 市场管, 市场管)).toBe("暂不分配");
    expect(await 系统建项目分配方式(prisma, 渠运, 渠运)).toBe("暂不分配");
  });
});

describe("6. 外贸指定候选：外贸事业部的销售含义乌档口、参与正常；外贸销售管理不列", () => {
  it("候选表外贸含档口销售、不含外贸销售管理和暂停的；内贸照旧", async () => {
    await setSetting(自动分配不参与key, { [外二]: "暂停" });
    const 表 = await 指定方向候选表(await 读组织());
    expect(new Set(表.外贸)).toEqual(new Set([外一, 档口一]));
    expect(表.外贸).not.toContain(外组长);
    expect(表.内贸).toEqual([内一]);
  });

  it("市场成员按外贸方向指定给档口销售：放行", async () => {
    const c = await 建客户(渠运);
    当(渠运);
    expect(await assignSalesOwner([c], 档口一)).toMatchObject({ ok: true });
    expect(await 客户负责人(c)).toBe(档口一);
  });
});
