/**
 * E-283 第 3 条：回访计划（售后回访顺手排的、带 afterSaleProjectId）去哪——到期提醒、数据页待办、计划页行链接三处同一个口径
 * （lib/project/after-sale-plan-link.ts 回访计划去项目）：
 *   带 afterSaleProjectId、项目没删、仍是交付结清、项目客户 = 计划客户、看的人看得到这个项目 → 去这个交付结清项目；
 *   核不过的不再按「客户最近动过的在推项目」猜（原来会带到无关的在推项目上），回落客户页（进不去的照各处原来的回落）。
 * 普通计划（不带 afterSaleProjectId）照旧。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/app/(app)/follow-ups/plans/PlansView", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 复盘待办of } from "@/lib/project/board-todos-db";
import { 回访计划去项目 } from "@/lib/project/after-sale-plan-link";
import { 到期提醒扫一遍, 忘掉到期提醒节流 } from "@/lib/enterprise/due-notice";
import { 等通知推完 } from "@/lib/enterprise/notify";
import PlansPage from "@/app/(app)/follow-ups/plans/page";
import { 补计划详情 } from "@/app/(app)/follow-ups/plans/plan-rows";
import { beijingDay } from "@/lib/business-clock";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 甲: 人, 乙: 人;
let 序 = 0;
const 造人 = async (key: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole: "sales", line: "内贸" } });
  return { id: u.id, name: key, email: `${key}@x`, role: "SALES", title: "", avatar: null };
};
const 客户 = async (ownerId: string) => (await prisma.customer.create({ data: { name: `客户${++序}`, phone: `139${String(序).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) =>
  (await prisma.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId, phase: "商机", node: "明确需求", ...extra } })).id;
const 交付 = (customerId: string, ownerId: string) => 项目(customerId, ownerId, { phase: "订单", node: "交付", result: "交付结清" });
/** 北京今天那一刻（到期提醒按北京日历） */
const 今天 = beijingDay(new Date());
const 今早 = new Date(`${今天}T10:00:00+08:00`);
const 计划 = async (customerId: string, ownerId: string, afterSaleProjectId: string | null) =>
  (await prisma.followPlan.create({ data: { subject: `回访计划${customerId}`, plannedAt: 今早, plannedOn: 今天, method: "电话沟通", customerId, ownerId, afterSaleProjectId } })).id;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  忘掉到期提醒节流();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  甲 = await 造人("jia");
  乙 = await 造人("yi");
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(async () => { await 等通知推完(); vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("回访计划去项目（三处共用的判断）", () => {
  it("核得过去交付结清项目；撤回了交付结清、删了、不是这位客户的、看的人看不到的都不给", async () => {
    const c = await 客户(甲.id);
    const 别的客户 = await 客户(甲.id);
    const 好 = await 交付(c, 甲.id);
    const 撤回 = await 项目(c, 甲.id, { phase: "订单", node: "交付" });
    const 删了 = await 项目(c, 甲.id, { phase: "订单", node: "交付", result: "交付结清", deletedAt: new Date() });
    const 别人客户的 = await 交付(别的客户, 甲.id);
    const 乙的 = await 交付(c, 乙.id);
    const 行 = (id: string, p: string | null) => ({ id, customerId: c, afterSaleProjectId: p });
    const r = await 回访计划去项目([行("a", 好), 行("b", 撤回), 行("c", 删了), 行("d", 别人客户的), 行("e", 乙的), 行("f", null)], () => 甲);
    expect([...r.entries()].map(([k, v]) => [k, v.id])).toEqual([["a", 好]]);
    // 乙负责的那个：乙看得到
    expect((await 回访计划去项目([行("e", 乙的)], () => 乙)).get("e")?.id).toBe(乙的);
  });
});

describe("到期提醒（铃铛链接）", () => {
  const 链接 = async (planId: string) => (await prisma.entNotice.findFirstOrThrow({ where: { dedupeKey: { startsWith: `due:plan:${planId}:` } } })).link;

  it("客户另有一个我的在推项目：售后计划仍去交付结清项目（原来被带到在推的）；普通计划照旧去在推的", async () => {
    const c = await 客户(甲.id);
    const 在推 = await 项目(c, 甲.id);
    const 交付了 = await 交付(c, 甲.id);
    const 售后 = await 计划(c, 甲.id, 交付了);
    const 普通 = await 计划(c, 甲.id, null);
    await 到期提醒扫一遍(今早);
    expect(await 链接(售后)).toBe(`/projects/${交付了}`);
    expect(await 链接(普通)).toBe(`/projects/${在推}`);
  });

  it("核不过（项目撤回了交付结清 / 我看不到）：不去无关的在推项目，我是客户负责人去客户页", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 甲.id);
    const 撤回 = await 项目(c, 甲.id, { phase: "订单", node: "交付" });
    const 乙的 = await 交付(c, 乙.id);
    const a = await 计划(c, 甲.id, 撤回);
    const b = await 计划(c, 甲.id, 乙的);
    await 到期提醒扫一遍(今早);
    expect(await 链接(a)).toBe(`/customers/${c}`);
    expect(await 链接(b)).toBe(`/customers/${c}`);
  });
});

describe("数据页待办（看板去处）", () => {
  const 那行 = async (u: 人, planId: string) => {
    const d = await 以谁的身份(u.id, () => 复盘待办of(u.id, { 我id: u.id, 我: u }));
    return d.行.find((x) => x.key === `plan:${planId}`)!;
  };
  it("售后计划去交付结清项目、带它的名字；普通计划照旧去在推项目", async () => {
    const c = await 客户(甲.id);
    const 在推 = await 项目(c, 甲.id);
    const 交付了 = await 交付(c, 甲.id);
    const 售后 = await 那行(甲, await 计划(c, 甲.id, 交付了));
    expect(售后.去).toMatch(new RegExp(`project=${交付了}|/projects/${交付了}`));
    expect(售后.projectName).toBe((await prisma.project.findUniqueOrThrow({ where: { id: 交付了 } })).name);
    const 普通 = await 那行(甲, await 计划(c, 甲.id, null));
    expect(普通.去).toMatch(new RegExp(`project=${在推}|/projects/${在推}`));
  });
  it("核不过：不挂在推项目，回落客户页", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 甲.id);
    const 撤回 = await 项目(c, 甲.id, { phase: "订单", node: "交付" });
    const r = await 那行(甲, await 计划(c, 甲.id, 撤回));
    expect(r.去).toBe(`/customers/${c}`);
    expect(r.projectName).toBeNull();
  });
});

describe("计划页行链接", () => {
  const 页上计划 = async (u: 人) => {
    mocks.user = { ...u };
    const el = await 以谁的身份(u.id, () => PlansPage({ searchParams: Promise.resolve({}) }));
    return (el.props as { plans: { id: string; 回访去?: string }[] }).plans;
  };
  it("售后计划带 回访去（交付结清项目），普通计划、核不过的不带；分批补详情同一个口径", async () => {
    const c = await 客户(甲.id);
    await 项目(c, 甲.id);
    const 交付了 = await 交付(c, 甲.id);
    const 撤回 = await 项目(c, 甲.id, { phase: "订单", node: "交付" });
    const 售后 = await 计划(c, 甲.id, 交付了);
    const 普通 = await 计划(c, 甲.id, null);
    const 失效 = await 计划(c, 甲.id, 撤回);
    const 们 = await 页上计划(甲);
    expect(们.find((p) => p.id === 售后)?.回访去).toMatch(new RegExp(`project=${交付了}|/projects/${交付了}`));
    expect(们.find((p) => p.id === 普通)).not.toHaveProperty("回访去");
    expect(们.find((p) => p.id === 失效)).not.toHaveProperty("回访去");
    const 补 = await 以谁的身份(甲.id, () => 补计划详情([`plan:${售后}`, `plan:${普通}`]));
    expect(补.plans.find((p) => p.id === 售后)).toMatchObject({ 回访去: expect.stringMatching(new RegExp(交付了)) });
    expect(补.plans.find((p) => p.id === 普通)).not.toHaveProperty("回访去");
  });
});
