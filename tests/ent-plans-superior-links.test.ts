/**
 * 上级看下属留下的事项（11-09，P-转-10 的上级视图）：限定层放行下属名下的待办、计划，客户却可能进不去。
 * 「上级打不开的事项不给链接、权限不放宽」：计划页、盯盘清单都不给 /customers/id 链接；客户可见范围和放行条件不动。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/app/(app)/follow-ups/plans/PlansView", () => ({ default: () => null }));
vi.mock("@/components/ui", async () => {
  const { createElement } = await import("react");
  return {
    PageHead: ({ title }: { title: string }) => createElement("h1", null, title),
    RowLink: ({ href, children }: { href: string; children: unknown }) => createElement("a", { href }, children as never),
  };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 名下事项够不着 } from "@/lib/enterprise/follow-perm";
import WatchlistPage from "@/app/(app)/follow-ups/watchlist/page";
import PlansPage from "@/app/(app)/follow-ups/plans/page";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 上级: 人;
let 成员: 人;
let 甲: 人;

const 造人 = async (key: string, bizRole: string, managerId?: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId: managerId ?? null, ...(bizRole === "sales" ? { line: "内贸" } : {}) } });
  return { id: u.id, name: key, email: `${key}@x`, role: "SALES", title: "", avatar: null };
};
let 序 = 0;
const 客户 = async (ownerId: string) => {
  序 += 1;
  return (await prisma.customer.create({ data: { name: `客户${序}`, phone: `139${String(序).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
};
const 老日子 = new Date("2020-01-01T00:00:00.000Z");
const 计划 = (customerId: string, ownerId: string, done = false) =>
  prisma.followPlan.create({ data: { subject: "回访", plannedAt: 老日子, customerId, ownerId, done, doneAt: done ? 老日子 : null } });
const 待办 = (customerId: string, ownerId: string, done = false) =>
  prisma.task.create({ data: { title: "打电话", customerId, ownerId, done, doneAt: done ? 老日子 : null } });
const 查 = (u: 人) => 以谁的身份(u.id, () => 名下事项够不着(u));

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  上级 = await 造人("mgr", "marketing_mgr");
  成员 = await 造人("mem", "channel_ops", 上级.id);
  甲 = await 造人("jia", "sales");
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("计划页：上级看下属留下的事项", () => {
  it("下属留下的计划：上级看得到事项、进不了客户 → 进不了、改不了", async () => {
    const c = await 客户(甲.id);
    await 计划(c, 成员.id);
    // 前提：事项看得到、客户看不到（可见范围不动）
    expect(await 以谁的身份(上级.id, () => prisma.followPlan.count({ where: { customerId: c } }))).toBe(1);
    expect(await 以谁的身份(上级.id, () => prisma.customer.findUnique({ where: { id: c } }))).toBeNull();
    expect(await 查(上级)).toEqual({ 进不了: [c], 改不了: [c] });
  });

  it("下属留下的待办、已完成的事项也算（已完成区同样有客户名）", async () => {
    const c1 = await 客户(甲.id);
    const c2 = await 客户(甲.id);
    await 待办(c1, 成员.id);
    await 计划(c2, 成员.id, true);
    const r = await 查(上级);
    expect([...r.进不了].sort()).toEqual([c1, c2].sort());
  });

  it("下属自己负责的客户：上级进得去，照旧给链接", async () => {
    const c = await 客户(成员.id);
    await 计划(c, 成员.id);
    expect(await 查(上级)).toEqual({ 进不了: [], 改不了: [] });
  });

  it("圈外同事的事项：上级本来就看不到，不会算进来（范围没放宽）", async () => {
    const c = await 客户(甲.id);
    await 计划(c, 甲.id);
    expect(await 以谁的身份(上级.id, () => prisma.followPlan.count({ where: { customerId: c } }))).toBe(0);
    expect(await 查(上级)).toEqual({ 进不了: [], 改不了: [] });
  });

  it("成员本人的结论不变：进不了、改不了都只有自己留下的那位", async () => {
    const c = await 客户(甲.id);
    await 计划(c, 成员.id);
    expect(await 查(成员)).toEqual({ 进不了: [c], 改不了: [c] });
  });

  it("不是企业版：一律空，不查", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const c = await 客户(甲.id);
    await 计划(c, 成员.id);
    expect(await 名下事项够不着(上级)).toEqual({ 进不了: [], 改不了: [] });
  });
});

describe("计划页：项目下一步", () => {
  type 行 = { id: string; 进不了?: boolean };
  const 下一步们 = async (u: 人) => {
    mocks.user = { ...u };
    const el = await 以谁的身份(u.id, () => PlansPage({ searchParams: Promise.resolve({}) }));
    return (el.props as { 项目下一步: 行[] }).项目下一步;
  };
  const 项目 = async (name: string, customerId: string, ownerId: string, creatorId: string) =>
    (await prisma.project.create({ data: { name, customerId, ownerId, creatorId, phase: "线索", node: "有效线索", nextStepAt: 老日子, nextStepText: "下一步" } })).id;

  it("市场成员看得到、进不了详情的项目标出来，自己负责的不标；销售不受影响", async () => {
    const c = await 客户(成员.id);
    const 分出去的 = await 项目("分出去的", c, 甲.id, 成员.id);
    const 自己的 = await 项目("自己的", c, 成员.id, 成员.id);
    const r = await 下一步们(成员);
    expect(r.find((x) => x.id === 分出去的)?.进不了).toBe(true);
    expect(r.find((x) => x.id === 自己的)?.进不了).toBe(false);
    expect((await 下一步们(甲)).find((x) => x.id === 分出去的)?.进不了).toBe(false);
  });
});

describe("盯盘清单：逾期计划带来的客户", () => {
  const 打开 = async (u: 人, scope: string) => {
    mocks.user = { ...u };
    const el = await 以谁的身份(u.id, () => WatchlistPage({ searchParams: Promise.resolve({ scope }) }));
    return renderToStaticMarkup(el as ReactElement);
  };

  it("上级的团队视图：进不了的客户只写名字，不给链接", async () => {
    const c = await 客户(甲.id);
    await 计划(c, 成员.id);
    const html = await 打开(上级, "team");
    const 名 = (await prisma.customer.findUniqueOrThrow({ where: { id: c } })).name;
    expect(html).toContain(名);
    expect(html).not.toContain(`/customers/${c}`);
  });

  it("本人的视图：把客户分出去后留下的逾期计划也不给链接", async () => {
    const c = await 客户(甲.id);
    await 计划(c, 成员.id);
    const html = await 打开(成员, "mine");
    expect(html).not.toContain(`/customers/${c}`);
  });

  it("进得去的客户：照旧给链接", async () => {
    const c = await 客户(成员.id);
    await 计划(c, 成员.id);
    const html = await 打开(上级, "team");
    expect(html).toContain(`/customers/${c}`);
  });
});
