/**
 * 客户负责人第一批阶段 3：名下事项指向哪儿。
 * 限定层放行自己名下的待办、计划，客户却可能进不去（只负责项目的人、把客户分出去的市场成员，P-转-10）：
 * 看板「去跟进」不能再指向打不开的客户详情；计划页知道哪些客户进不了（不给链接）、哪些连改删都不行（只留勾完成）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 复盘待办of, 复盘看板of } from "@/lib/project/board-todos-db";
import { 名下事项够不着 } from "@/lib/enterprise/follow-perm";

type 人 = { id: string; role: string };
let 丙: 人;
let 丁: 人;
let 市场: 人;

const 造人 = async (key: string, bizRole: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(bizRole === "sales" ? { line: "内贸" } : {}) } });
  return { id: u.id, role: "SALES" };
};
let 序 = 0;
const 客户 = async (ownerId: string) => {
  序 += 1;
  return (await prisma.customer.create({ data: { name: `客户${序}`, phone: `139${String(序).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
};
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) => {
  序 += 1;
  return (await prisma.project.create({ data: { name: `项目${序}`, customerId, ownerId, creatorId: ownerId, ...extra } })).id;
};
const 活 = async (customerId: string, ownerId: string) => {
  await prisma.task.create({ data: { title: `待办${customerId}`, customerId, ownerId } });
  await prisma.followPlan.create({ data: { subject: `计划${customerId}`, plannedAt: new Date(), customerId, ownerId } });
};
/** 这人待办看板上，这位客户那几行的去处 */
const 去处们 = async (u: 人, customerId: string) => {
  const d = await 以谁的身份(u.id, () => 复盘待办of(u.id, { 我id: u.id }));
  return [...new Set(d.行.filter((x) => x.内容.endsWith(customerId)).map((x) => x.去))];
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  丙 = await 造人("bing", "sales");
  丁 = await 造人("ding", "sales");
  市场 = await 造人("mkt", "channel_ops");
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("待办看板的去处", () => {
  it("只负责项目的人：有进行中的项目去项目", async () => {
    const c = await 客户(丁.id);
    const p = await 项目(c, 丙.id);
    await 活(c, 丙.id);
    expect(await 去处们(丙, c)).toEqual([`/projects/${p}`]);
  });

  it("只负责项目的人：项目结束了客户看不到，退到自己那个已结束的项目，不指客户详情", async () => {
    const c = await 客户(丁.id);
    const p = await 项目(c, 丙.id, { result: "丢单" });
    await 活(c, 丙.id);
    expect(await 去处们(丙, c)).toEqual([`/projects/${p}`]);
  });

  it("客户负责人没有项目：去客户详情", async () => {
    const c = await 客户(丁.id);
    await 活(c, 丁.id);
    expect(await 去处们(丁, c)).toEqual([`/customers/${c}`]);
  });

  it("市场成员把客户分出去了、项目也归了别人：不给去处（行上照样能勾）", async () => {
    const c = await 客户(丁.id);
    await 项目(c, 丁.id);
    await 活(c, 市场.id);
    expect(await 去处们(市场, c)).toEqual([null]);
  });

  it("看板布局同一个口径", async () => {
    const c = await 客户(丁.id);
    await 活(c, 市场.id);
    const 板 = await 以谁的身份(市场.id, () => 复盘看板of(市场.id, { 我id: 市场.id }));
    const 行们 = [...板.列.overdue.行, ...板.列.today.行, ...板.列.later.行].filter((x) => x.内容.endsWith(c));
    expect(行们.length).toBeGreaterThan(0);
    expect(new Set(行们.map((x) => x.去))).toEqual(new Set([null]));
  });
});

describe("名下事项够不着", () => {
  const 查 = (u: 人) => 以谁的身份(u.id, () => 名下事项够不着(u));

  it("只负责项目的人：客户进不了，但能改自己的计划（客户事项挡放行项目负责人）", async () => {
    const c = await 客户(丁.id);
    await 项目(c, 丙.id);
    await 活(c, 丙.id);
    expect(await 查(丙)).toEqual({ 进不了: [c], 改不了: [] });
  });

  it("项目已结束也算项目负责人；项目在公海不算", async () => {
    const 结束 = await 客户(丁.id);
    await 项目(结束, 丙.id, { result: "丢单" });
    await 活(结束, 丙.id);
    const 公海 = await 客户(丁.id);
    await 项目(公海, 丙.id, { pooledAt: new Date() });
    await 活(公海, 丙.id);
    const r = await 查(丙);
    expect(new Set(r.进不了)).toEqual(new Set([结束, 公海]));
    expect(r.改不了).toEqual([公海]);
  });

  it("市场成员分出去的客户：进不了、改不了", async () => {
    const c = await 客户(丁.id);
    await 活(c, 市场.id);
    expect(await 查(市场)).toEqual({ 进不了: [c], 改不了: [c] });
  });

  it("客户负责人：都够得着", async () => {
    const c = await 客户(丁.id);
    await 活(c, 丁.id);
    expect(await 查(丁)).toEqual({ 进不了: [], 改不了: [] });
  });

  it("不是企业版：一律空", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const c = await 客户(丁.id);
    await 活(c, 市场.id);
    expect(await 名下事项够不着(市场)).toEqual({ 进不了: [], 改不了: [] });
  });
});
