/**
 * 一次请求里参考数据只读一遍（11-16 提速 F1：请求内去重，不跨请求）。
 *
 * 别的条数测试（ent-customer-list-queries、ent-cust-detail-queries）把 requireUser / getCurrentUser 换成了假的，
 * 量不到「会话用户」这几句。这里不换：带真的会话票（cookie），布局 + 页面一起打开（Next 一次请求两者都跑），
 * 数五个页面——首页、客户列表、客户详情、公海、客户页看板——每页一共几句、其中会话用户、Setting 各几句。
 *
 * react 的 cache() 换成按「这一次请求」记住（AsyncLocalStorage，一次请求一张表），和生产一样：
 * 两个请求同时跑各是各的表，不串。
 * 明细：REQ_DEDUPE_QUERY_DUMP=<文件> 写出每页每种 SQL 几条
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";

const 记 = vi.hoisted(() => ({ 开: false, 句: [] as string[] }));
const 请求 = vi.hoisted(() => ({ als: undefined as unknown as import("node:async_hooks").AsyncLocalStorage<{ 缓存: Map<unknown, Map<string, unknown>>; 票: string; 看法: string }> }));
请求.als = new AsyncLocalStorage();
vi.mock("@/generated/prisma", async (原) => {
  const m = await 原<typeof import("@/generated/prisma")>();
  class 记数Client extends m.PrismaClient {
    constructor(o: ConstructorParameters<typeof m.PrismaClient>[0] = {}) {
      super({ ...o, log: [{ emit: "event", level: "query" }, ...((o?.log as never[]) ?? [])] } as never);
      (this as unknown as { $on: (e: string, f: (x: { query: string; params: string }) => void) => void }).$on("query", (e) => { if (记.开) 记.句.push(/`Setting`/.test(e.query) ? `${e.query} ${e.params}` : e.query); });
    }
  }
  return { ...m, PrismaClient: 记数Client };
});
// 生产里 react 的 cache() 一次请求一份、请求外直通：这里照样（不在请求里 = 直通）
vi.mock("react", async (原) => {
  const m = await 原<typeof import("react")>();
  const cache = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A): R => {
    const s = 请求.als.getStore();
    if (!s) return fn(...a);
    let 表 = s.缓存.get(fn);
    if (!表) s.缓存.set(fn, (表 = new Map()));
    const k = JSON.stringify(a);
    if (!表.has(k)) 表.set(k, fn(...a));
    return 表.get(k) as R;
  };
  return { ...m, default: { ...m, cache }, cache };
});
vi.mock("next/headers", async (原) => ({
  ...(await 原<object>()),
  cookies: async () => {
    const s = 请求.als.getStore();
    if (!s) throw new Error("不在请求里");
    const 有 = (k: string) => (k === "crm_session" && s.票 ? s.票 : k === "customers-view" && s.看法 ? s.看法 : undefined);
    return { get: (k: string) => (有(k) ? { name: k, value: 有(k) } : undefined), set: () => {}, delete: () => {} };
  },
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false, listModelOptions: async () => [] }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { SignJWT } from "jose";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { SECRET, getCurrentUser, requireUser } from "@/lib/auth";
import AppLayout from "@/app/(app)/layout";
import DashboardPage from "@/app/(app)/dashboard/page";
import CustomersPage from "@/app/(app)/customers/page";
import CustomerPage from "@/app/(app)/customers/[id]/page";
import PoolPage from "@/app/(app)/pool/page";

type 人 = { id: string; 票: string };
const 造人 = async (key: string, bizRole: string, managerId: string | null = null): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId } });
  const 票 = await new SignJWT({ sub: u.id, ims: Date.now() }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1d").sign(SECRET);
  return { id: u.id, 票 };
};

let 甲: 人, 乙: 人, 客户: string;
beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  await setSetting("enterprise.rule.org_scope", true);
  const 经理 = await 造人("jl", "sales");
  甲 = await 造人("jia", "sales", 经理.id);
  乙 = await 造人("yi", "sales");
  for (let i = 0; i < 6; i++) {
    const c = await prisma.customer.create({ data: { name: `去重客户${i}`, phone: `1390000030${i}`, salesOwnerId: 甲.id } });
    客户 ??= c.id;
    for (let j = 0; j < i % 3; j++) {
      await prisma.project.create({ data: { name: `项目${i}-${j}`, customerId: c.id, ownerId: 甲.id, creatorId: 甲.id, phase: "商机", node: "方案敲定" } });
    }
  }
  客户 = (await prisma.customer.findFirstOrThrow({ where: { name: "去重客户2" } })).id;
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

/** 一次请求：新的一张请求内缓存，带这个人的会话票 */
const 在请求里 = <T,>(谁: 人, fn: () => Promise<T>, 看法 = ""): Promise<T> => 请求.als.run({ 缓存: new Map(), 票: 谁.票, 看法 }, fn);

type 页 = { 名: string; 开: () => Promise<unknown>; 看法?: string };
const 页们 = (): 页[] => [
  { 名: "首页", 开: () => DashboardPage({ searchParams: Promise.resolve({}) } as never) },
  { 名: "客户列表", 开: () => CustomersPage({ searchParams: Promise.resolve({}) } as never) },
  { 名: "客户详情", 开: () => CustomerPage({ params: Promise.resolve({ id: 客户 }), searchParams: Promise.resolve({}) } as never) },
  { 名: "公海", 开: () => PoolPage({ searchParams: Promise.resolve({}) } as never) },
  { 名: "看板", 开: () => CustomersPage({ searchParams: Promise.resolve({}) } as never), 看法: "board" },
];

/** 布局 + 页面一起打开一次（Next 一次请求两者并行跑）；先热两遍（第一次打开会补字典、写记号），量第三遍 */
async function 量(p: 页, 谁: 人 = 甲): Promise<string[]> {
  const 开 = () => 在请求里(谁, () => Promise.all([AppLayout({ children: null } as never), p.开()]), p.看法);
  await 开();
  await 开();
  记.句 = []; 记.开 = true;
  try { await 开(); } finally { 记.开 = false; }
  return 记.句;
}

const 平 = (q: string) => q.replace(/\s+/g, " ").replace(/`main`\./g, "");
/** 会话用户那一句：按 id 取整个 User 行（getSessionUser） */
const 是会话用户 = (q: string) => /^SELECT .*`User`\.`passwordChangedAt`.* FROM `User` WHERE \(`User`\.`id` = \? AND 1=1\) LIMIT \? OFFSET \?/.test(平(q));
const 是Setting = (q: string) => /FROM `Setting`/.test(平(q));

describe("一次请求里参考数据只读一遍（F1）", () => {
  it("五个页面（布局 + 页面）：会话用户每请求只查 1 句；字典修补记号走设置缓存、不单查；市场成员设置最多读 1 遍", async () => {
    const 明细: string[] = [];
    const 各页: [string, number, number, boolean][] = [];
    for (const p of 页们()) {
      const 句 = await 量(p);
      const 会话 = 句.filter(是会话用户).length;
      明细.push(`${p.名}\t共 ${句.length}\t会话用户 ${会话}\tSetting ${句.filter(是Setting).length}`);
      if (process.env.REQ_DEDUPE_QUERY_DUMP) {
        const 表 = new Map<string, number>();
        for (const q of 句) { const k = 平(q).replace(/^SELECT .*? FROM/, "SELECT … FROM").slice(0, 200); 表.set(k, (表.get(k) ?? 0) + 1); }
        明细.push([...表.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${n}\t${k}`).join("\n"));
      }
      const 设置句 = 句.filter(是Setting);
      各页.push([p.名, 会话, 设置句.filter((q) => q.includes("entDict.")).length, 设置句.map((q) => q.split("enterprise.market_users").length - 1).reduce((a, b) => a + b, 0) <= 1]);
    }
    if (process.env.REQ_DEDUPE_QUERY_DUMP) (await import("node:fs")).writeFileSync(process.env.REQ_DEDUPE_QUERY_DUMP, 明细.join("\n") + "\n");
    expect(各页).toEqual(页们().map((p) => [p.名, 1, 0, true]));
  });

  it("两个人同时打开：各认各的，不串（请求内缓存一次请求一份）", async () => {
    const [a, b] = await Promise.all([
      在请求里(甲, async () => [await getCurrentUser(), await requireUser()]),
      在请求里(乙, async () => [await getCurrentUser(), await requireUser()]),
    ]);
    expect(a.map((u) => u?.id)).toEqual([甲.id, 甲.id]);
    expect(b.map((u) => u?.id)).toEqual([乙.id, 乙.id]);
  });

  it("同一请求里先写库再读：会话用户读到写之后的（改名、停用），市场成员设置读到写之后的", async () => {
    await 在请求里(甲, async () => {
      expect((await requireUser()).name).toBe("jia");
      await prisma.user.update({ where: { id: 甲.id }, data: { name: "jia2" } });
      expect((await getCurrentUser())?.name).toBe("jia2");
      await prisma.user.update({ where: { id: 甲.id }, data: { active: false } });
      // 停用了：同一请求后面再问就认不出人（权限跟着变，不拿写之前那一份）
      expect(await getCurrentUser()).toBeNull();
    });
    const { 读市场成员们 } = await import("@/lib/enterprise/market-db");
    const { 读组织 } = await import("@/lib/enterprise/org");
    await 在请求里(乙, async () => {
      const org = await 读组织();
      expect((await 读市场成员们(org)).has(乙.id)).toBe(false);
      await setSetting("enterprise.market_users", [乙.id]);
      expect((await 读市场成员们(org)).has(乙.id)).toBe(true);
    });
  });

  it("同一请求里库没变：会话用户、市场成员设置各只查一遍；换一次请求重查", async () => {
    const { 读市场成员们 } = await import("@/lib/enterprise/market-db");
    const { 读组织 } = await import("@/lib/enterprise/org");
    const 数 = async () => {
      记.句 = []; 记.开 = true;
      try {
        await 在请求里(甲, async () => {
          const org = await 读组织();
          await Promise.all([getCurrentUser(), requireUser(), 读市场成员们(org)]);
          await Promise.all([getCurrentUser(), 读市场成员们(org)]);
        });
      } finally { 记.开 = false; }
      // Prisma 会把同一刻的几条 findUnique 并成一句 IN，按句数不稳：数参数里出现几次市场成员设置的 key
      return { 会话: 记.句.filter(是会话用户).length, 市场: 记.句.filter((q) => /FROM `Setting`/.test(平(q))).map((q) => q.split("enterprise.market_users").length - 1).reduce((a, b) => a + b, 0) };
    };
    // 第一次请求还要算企业版范围（跨请求缓存着，也读市场成员设置）；量第二、三次
    await 数();
    const 一 = await 数();
    expect(一).toEqual({ 会话: 1, 市场: 1 });
    expect(await 数()).toEqual(一);
  });
});
