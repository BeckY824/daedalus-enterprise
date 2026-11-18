/**
 * 「暂不分配」的线索分出去之后，项目「分配方式」写成这次实际的方式（审核 11-18 第 11 项）：
 * 口径表 V-分配方式 / P-转-03 / X-90 只说「暂不分配 = 留在建的人名下、潜客培育」，没有「分出后仍保留暂不分配」，
 * 所以分出去（线索列表指定 / 自动、客户转让框指定 / 自动、定时分配到点）= 改成这次的方式（字典当前叫法）；
 * 一起随客户带过去的暂不分配项目同样改；撤销按原样还成暂不分配。原来就是别的方式（个人自持……）的不改。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 分配线索, 自动分配线索, 撤销自动分配, 客户自动分配, type 自动分配结果 } from "@/app/(app)/leads/assign-actions";
import { 自动分配不参与key, 不设配额key } from "@/lib/enterprise/lead-assign";
import { assignSalesOwner, 撤销改负责人 } from "@/app/(app)/customers/actions";
import { 定时分配扫一遍 } from "@/lib/enterprise/scheduled-assign";
import { 企业字典 } from "@/lib/enterprise/dict";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总管: 人, 市场: 人, 甲: 人, 乙: 人;
const 造人 = async (key: string, name: string, role: string, bizRole: string, line: string | null = null): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, line } });
  return { id: u.id, name, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
let 序号 = 0;
const 客户 = async (ownerId: string) =>
  (await prisma.customer.create({ data: { name: `客户${++序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: ownerId, bizLine: "内贸", addrCountry: "中国", addrProvince: "浙江省" } })).id;
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) =>
  (await prisma.project.create({ data: { name: `项目${++序号}`, customerId, ownerId, creatorId: ownerId, bizLine: "内贸", assignMode: "暂不分配", ...extra } })).id;
const 方式of = async (p: string) => (await prisma.project.findUniqueOrThrow({ where: { id: p }, select: { assignMode: true } })).assignMode;
const 成了 = (r: 自动分配结果) => { if (!r.ok) throw new Error(r.error); return r; };

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("dir", "总管理", "ADMIN", "director");
  市场 = await 造人("mkt", "市场同事", "SALES", "marketing_mgr");
  甲 = await 造人("jia", "销售甲某", "SALES", "sales", "内贸");
  乙 = await 造人("yi", "销售乙某", "SALES", "sales", "内贸");
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(规则.线索分配.key, true);
  await setSetting(不设配额key, true);
  // 自动分配只留甲：结果确定
  await setSetting(自动分配不参与key, { [总管.id]: "禁止", [乙.id]: "禁止" });
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("线索列表分出去：暂不分配 → 这次的方式", () => {
  it("指定分配：这条和随客户带过去的暂不分配项目都改成「指定分配」；原来个人自持的不改", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    const 带 = await 项目(c, 市场.id);
    const 自持 = await 项目(c, 市场.id, { assignMode: "个人自持" });
    expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
    expect(await 方式of(p)).toBe("指定分配");
    expect(await 方式of(带)).toBe("指定分配");
    expect(await 方式of(自持)).toBe("个人自持");
  });

  it("自动分配：改成「自动分配」；撤销自动分配还成「暂不分配」（这条和带过去的）", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    const 带 = await 项目(c, 市场.id);
    const r = 成了(await 以(市场, () => 自动分配线索(p, { 项目: true, 原负责人: 市场.id })));
    expect(r.toUserId).toBe(甲.id);
    expect(await 方式of(p)).toBe("自动分配");
    expect(await 方式of(带)).toBe("自动分配");
    expect(await 以(市场, () => 撤销自动分配(p, JSON.parse(JSON.stringify(r.还原))))).toEqual({ ok: true });
    expect(await 方式of(p)).toBe("暂不分配");
    expect(await 方式of(带)).toBe("暂不分配");
  });

  it("本来就是指定分配 / 自动分配建的：照旧，不动；撤销也不改成暂不分配", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id, { assignMode: "自动分配", awaitAssignAt: new Date() });
    const r = 成了(await 以(市场, () => 自动分配线索(p, { 项目: true, 原负责人: 市场.id })));
    expect(await 方式of(p)).toBe("自动分配");
    expect(await 以(市场, () => 撤销自动分配(p, JSON.parse(JSON.stringify(r.还原))))).toEqual({ ok: true });
    expect(await 方式of(p)).toBe("自动分配");
  });

  it("字典里改过叫法：写当前叫法", async () => {
    await 企业字典("assign");
    await prisma.entDictItem.update({ where: { id: "dict-assign-0" }, data: { name: "专人指派" } });
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    expect(await 以(市场, () => 分配线索({ projectId: p, toUserId: 甲.id, line: "内贸" }))).toEqual({ ok: true });
    expect(await 方式of(p)).toBe("专人指派");
  });
});

describe("客户转让框：暂不分配的客户", () => {
  it("指定（客户层转让）：名下暂不分配项目改成「指定分配」；撤销改负责人还成「暂不分配」", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    const r = await 以(市场, () => assignSalesOwner([c], 甲.id));
    expect(r).toMatchObject({ ok: true, updated: 1 });
    expect(await 方式of(p)).toBe("指定分配");
    if (!r.ok) throw new Error("没转成");
    expect(await 以(市场, () => 撤销改负责人(r.原值 ?? [], 甲.id, r.带过来))).toMatchObject({ ok: true, updated: 1 });
    expect(await 方式of(p)).toBe("暂不分配");
  });

  it("自动：改成「自动分配」", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    expect(await 以(市场, () => 客户自动分配(c, null))).toMatchObject({ ok: true, toUserId: 甲.id });
    expect(await 方式of(p)).toBe("自动分配");
  });
});

describe("定时分配到点", () => {
  it("暂不分配的项目定时自动分：改成「自动分配」；定时指定给甲：改成「指定分配」", async () => {
    const c1 = await 客户(市场.id);
    const 早 = new Date(Date.now() - 60_000);
    const p1 = await 项目(c1, 市场.id, { awaitAssignAt: new Date(Date.now() - 3_600_000), scheduledAssignAt: 早, scheduledAssignTo: null });
    const c2 = await 客户(市场.id);
    const p2 = await 项目(c2, 市场.id, { awaitAssignAt: new Date(Date.now() - 3_600_000), scheduledAssignAt: 早, scheduledAssignTo: 甲.id });
    expect(await 定时分配扫一遍(new Date())).toMatchObject({ 执行: 2, 没分出去: 0 });
    expect([(await prisma.project.findUniqueOrThrow({ where: { id: p1 } })).ownerId, await 方式of(p1)]).toEqual([甲.id, "自动分配"]);
    expect([(await prisma.project.findUniqueOrThrow({ where: { id: p2 } })).ownerId, await 方式of(p2)]).toEqual([甲.id, "指定分配"]);
  });
});
