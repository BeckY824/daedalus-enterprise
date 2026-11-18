/**
 * 市场管理改分已在销售名下的线索（11-19 客户答复）：接手人照旧收「分给你」，再给原负责人和他的直属上级各发一条站内通知，
 * 写明谁、哪一条、从谁改到谁。
 *   - 操作人自己不收（他就是原负责人的直属上级时也不收）；直属上级没填只发原负责人、不报错
 *   - 只在操作人是市场管理、原负责人是另一位销售时发：市场名下的首次分给销售（X-18）、待分配的、别的角色改分都照现在（只接手人收）
 *   - 客户层（批量改负责人）原负责人已有「改负责人通知」，只补直属上级
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 分配线索, 自动分配线索, 批量自动分配 } from "@/app/(app)/leads/assign-actions";
import { 自动分配不参与key, 不设配额key } from "@/lib/enterprise/lead-assign";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 市场成员key } from "@/lib/enterprise/market";
import { 市场改分通知 } from "@/lib/enterprise/notice-sources";
import { 编辑项目 } from "@/app/(app)/projects/actions";

let 老板: string, 市场: string, 经理: string, 小王: string, 小张: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role, name: id }; };
let 序 = 0;
async function 线索项目(ownerId: string, 客户归: string = ownerId, 建的人: string = ownerId, 补: Record<string, unknown> = {}) {
  序++;
  const c = (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: 客户归 } })).id;
  const p = (await prisma.project.create({ data: { name: `项目${序}`, customerId: c, ownerId, creatorId: 建的人, phase: "线索", ...补 } })).id;
  return { c, p };
}
/** 每人收到的通知标题（只看分配类） */
async function 收到(): Promise<Record<string, string[]>> {
  const 行 = await prisma.entNotice.findMany({ where: { kind: "分配" }, orderBy: { createdAt: "asc" } });
  const 出: Record<string, string[]> = {};
  for (const r of 行) (出[r.userId] ??= []).push(r.title);
  return 出;
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  序 = 0;
  const 人 = async (email: string, role = "SALES") => (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id;
  老板 = await 人("boss", "ADMIN");
  市场 = await 人("mkt");
  经理 = await 人("smgr", "MANAGER");
  小王 = await 人("s1");
  小张 = await 人("s2");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板, bizRole: "director" },
      { userId: 市场, bizRole: "marketing_mgr" },
      { userId: 经理, bizRole: "sales_mgr" },
      { userId: 小王, bizRole: "sales", managerId: 经理 },
      { userId: 小张, bizRole: "sales" },
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  await setSetting(规则.线索分配.key, true);
  await setSetting(市场成员key, [市场]);
  忘掉企业版范围();
  当(市场);
});
afterEach(() => { vi.unstubAllEnvs(); });

const 名 = () => new Map([[老板, "boss"], [市场, "mkt"], [经理, "smgr"], [小王, "s1"], [小张, "s2"]]);
const 分 = (谁: string, input: Parameters<typeof 分配线索>[0]) => {
  当(谁, 谁 === 老板 ? "ADMIN" : "SALES");
  mocks.user = { ...mocks.user, name: 名().get(谁) ?? 谁 };
  return 以谁的身份(谁, () => 分配线索(input));
};

describe("市场管理改分销售名下的线索（11-19）", () => {
  it("原负责人、他的直属上级各收一条（写明谁、哪条、从谁到谁），接手人照旧收分给你，操作人自己不收", async () => {
    const { p } = await 线索项目(小王, 市场, 市场);
    expect(await 分(市场, { projectId: p, toUserId: 小张 })).toEqual({ ok: true });
    const 们 = await 收到();
    expect(们[小张]).toEqual([expect.stringContaining("分给你")]);
    expect(们[小王]).toEqual(["mkt 把你名下的线索「项目1」改分给了 s2"]);
    expect(们[经理]).toEqual(["mkt 把 s1 名下的线索「项目1」改分给了 s2"]);
    expect(们[市场]).toBeUndefined();
    const 正文 = await prisma.entNotice.findFirstOrThrow({ where: { userId: 经理, kind: "分配" } });
    expect(正文.body).toBe("从 s1 改到 s2");
  });

  it("直属上级没填：只发原负责人，不报错；操作人就是原负责人的直属上级：他自己不收", async () => {
    await prisma.entMember.update({ where: { userId: 小王 }, data: { managerId: null } });
    const a = await 线索项目(小王, 市场, 市场);
    expect(await 分(市场, { projectId: a.p, toUserId: 小张 })).toEqual({ ok: true });
    let 们 = await 收到();
    expect(Object.keys(们).sort()).toEqual([小王, 小张].sort());

    await prisma.entNotice.deleteMany();
    await prisma.entMember.update({ where: { userId: 小王 }, data: { managerId: 市场 } });
    const b = await 线索项目(小王, 市场, 市场);
    expect(await 分(市场, { projectId: b.p, toUserId: 小张 })).toEqual({ ok: true });
    们 = await 收到();
    expect(们[市场]).toBeUndefined();
    expect(们[小王]).toEqual([expect.stringContaining("把你名下的线索")]);
  });

  it("销售管理改分（原负责人的直属上级把下属名下的改给另一位）：只接手人收，不通知原负责人和上级", async () => {
    const { p } = await 线索项目(小王);
    expect(await 分(经理, { projectId: p, toUserId: 小张 })).toEqual({ ok: true });
    const 们 = await 收到();
    expect(Object.keys(们)).toEqual([小张]);
  });

  it("别的角色改分（总管理 / 系统管理员）、市场名下的首次分给销售、待分配的：只接手人收，照现在", async () => {
    const 别人分 = await 线索项目(小王, 市场, 市场);
    expect(await 分(老板, { projectId: 别人分.p, toUserId: 小张 })).toEqual({ ok: true });
    const 首次 = await 线索项目(市场);
    expect(await 分(市场, { projectId: 首次.p, toUserId: 小张 })).toEqual({ ok: true });
    const 待分 = await 线索项目(小王, 市场, 市场, { awaitAssignAt: new Date() });
    expect(await 分(市场, { projectId: 待分.p, toUserId: 小张 })).toEqual({ ok: true });
    const 们 = await 收到();
    expect(Object.keys(们)).toEqual([小张]);
    expect(们[小张]).toHaveLength(3);
  });
});

describe("自动分配、批量自动分配也一样（11-19）", () => {
  beforeEach(async () => {
    await prisma.entMember.updateMany({ where: { userId: { in: [小王, 小张] } }, data: { line: "内贸" } });
    await setSetting(不设配额key, true);
    // 自动分配只留小张：结果确定
    await setSetting(自动分配不参与key, { [老板]: "禁止", [经理]: "禁止", [小王]: "禁止" });
    invalidateSettingsCache();
    忘掉企业版范围();
  });
  const 内贸项目 = async () => {
    序++;
    const c = (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1391111${String(序).padStart(4, "0")}`, salesOwnerId: 市场, bizLine: "内贸", addrCountry: "中国", addrProvince: "浙江省" } })).id;
    return (await prisma.project.create({ data: { name: `项目${序}`, customerId: c, ownerId: 小王, creatorId: 市场, phase: "线索", bizLine: "内贸" } })).id;
  };
  const 以市场 = <T,>(f: () => Promise<T>) => { 当(市场); mocks.user = { ...mocks.user, name: "mkt" }; return 以谁的身份(市场, f); };

  it("单条自动分配：原负责人、直属上级各一条，接手人收自动分配", async () => {
    const p = await 内贸项目();
    expect(await 以市场(() => 自动分配线索(p, { 项目: true, 原负责人: 小王 }))).toMatchObject({ ok: true, toUserId: 小张 });
    const 们 = await 收到();
    expect(们[小王]).toEqual([expect.stringContaining("把你名下的线索")]);
    expect(们[经理]).toEqual([expect.stringContaining("把 s1 名下的线索")]);
    expect(await prisma.entNotice.count({ where: { userId: 小张, kind: "自动分配" } })).toBe(1);
  });

  it("批量自动分配两条：原负责人、直属上级各收合成的一条", async () => {
    const a = await 内贸项目();
    const b = await 内贸项目();
    const r = await 以市场(() => 批量自动分配([a, b], { 项目: true }));
    expect(r).toMatchObject({ ok: true, 结果: [{ ok: true }, { ok: true }] });
    const 们 = await 收到();
    expect(们[小王]).toEqual(["mkt 把你名下的 2 条改分给了别人"]);
    expect(们[经理]).toEqual(["mkt 把下属名下的 2 条改分给了别人"]);
  });
});

describe("项目转让（编辑项目改负责人）", () => {
  it("市场管理是原负责人的直属上级、转给另一位销售：原负责人收一条，操作人自己不收；系统管理员转照现在", async () => {
    await prisma.entMember.update({ where: { userId: 小王 }, data: { managerId: 市场 } });
    const { p } = await 线索项目(小王, 市场, 市场);
    当(市场);
    mocks.user = { ...mocks.user, name: "mkt" };
    const r = await 以谁的身份(市场, () => 编辑项目(p, { ownerId: 小张 }));
    expect(r).toMatchObject({ ok: true });
    const 们 = await 收到();
    expect(们[小王]).toEqual(["mkt 把你名下的线索「项目1」改分给了 s2"]);
    expect(们[市场]).toBeUndefined();
  });
});

describe("市场改分通知 本身", () => {
  it("客户层：原负责人另有通知时只补直属上级；接手人就是直属上级时不重复发；几条合成一条", async () => {
    const a = await 线索项目(小王);
    const b = await 线索项目(小王);
    await 市场改分通知({ id: 市场, name: "mkt" }, [{ 原: 小王, 新: 小张, customerId: a.c }, { 原: 小王, 新: 小张, customerId: b.c }], { 原负责人另有通知: true });
    let 们 = await 收到();
    expect(Object.keys(们)).toEqual([经理]);
    expect(们[经理]).toEqual(["mkt 把下属名下的 2 条改分给了别人"]);
    const 正文 = await prisma.entNotice.findFirstOrThrow({ where: { userId: 经理 } });
    expect(正文.body).toBe("客户「客户1」从 s1 改到 s2、客户「客户2」从 s1 改到 s2");
    expect(正文.link).toBe("/customers");

    await prisma.entNotice.deleteMany();
    await 市场改分通知({ id: 市场, name: "mkt" }, [{ 原: 小王, 新: 经理, projectId: a.p }]);
    们 = await 收到();
    expect(Object.keys(们)).toEqual([小王]);
  });

  it("号码打码照现有规则；原负责人停用了、是占位 / 没负责人、操作人不是市场管理：都不发", async () => {
    const 号 = await prisma.project.create({ data: { name: "13912345678 的询盘", customerId: (await 线索项目(小王)).c, ownerId: 小王, creatorId: 小王, phase: "线索" } });
    await 市场改分通知({ id: 市场, name: "mkt" }, [{ 原: 小王, 新: 小张, projectId: 号.id }]);
    const 行 = await prisma.entNotice.findFirstOrThrow({ where: { userId: 小王 } });
    expect(行.title).not.toContain("13912345678");
    await prisma.entNotice.deleteMany();

    await 市场改分通知({ id: 老板, name: "boss" }, [{ 原: 小王, 新: 小张, projectId: 号.id }]);
    await 市场改分通知({ id: 市场, name: "mkt" }, [{ 原: null, 新: 小张, projectId: 号.id }, { 原: "不存在的人", 新: 小张, projectId: 号.id }]);
    await prisma.user.update({ where: { id: 小王 }, data: { active: false } });
    await 市场改分通知({ id: 市场, name: "mkt" }, [{ 原: 小王, 新: 小张, projectId: 号.id }]);
    expect(await prisma.entNotice.count()).toBe(0);
  });
});
