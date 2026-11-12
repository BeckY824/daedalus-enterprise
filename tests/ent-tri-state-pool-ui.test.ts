/**
 * 公海「号码不全」按钮上的数（三态界面 B 组，C14；用户 11-12 定要带数）：
 * 口径 = 在现在这些筛选上再点「号码不全」会列出几行（11-12 审查：数和点开后看到的行数一致；同一份全量行内存里再筛，不多查库）；
 * 三态关着不数、不给；开着公海页查询条数和关着一样。地址栏带 phoneIncomplete=1 时三态关着当没筛
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const 记 = vi.hoisted(() => ({ 开: false, 句: [] as string[], 缓存: new Map<unknown, Map<string, unknown>>() }));
vi.mock("@/generated/prisma", async (原) => {
  const m = await 原<typeof import("@/generated/prisma")>();
  class 记数Client extends m.PrismaClient {
    constructor(o: ConstructorParameters<typeof m.PrismaClient>[0] = {}) {
      super({ ...o, log: [{ emit: "event", level: "query" }, ...((o?.log as never[]) ?? [])] } as never);
      (this as unknown as { $on: (e: string, f: (x: { query: string }) => void) => void }).$on("query", (e) => { if (记.开) 记.句.push(e.query); });
    }
  }
  return { ...m, PrismaClient: 记数Client };
});
vi.mock("react", async (原) => {
  const m = await 原<typeof import("react")>();
  const cache = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A): R => {
    let 表 = 记.缓存.get(fn);
    if (!表) 记.缓存.set(fn, (表 = new Map()));
    const k = JSON.stringify(a);
    if (!表.has(k)) 表.set(k, fn(...a));
    return 表.get(k) as R;
  };
  return { ...m, default: { ...m, cache }, cache };
});
const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/pool/PoolView", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 默认组织规则, 默认三态规则 } from "@/lib/project/org-rules";
import PoolPage from "@/app/(app)/pool/page";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, line: "内贸" } });
  return { id: u.id, name: key, email: `${key}@x`, role: "SALES", title: "", avatar: null };
};
let 甲: 人;
async function 公海客户(名: string, 不全: boolean) {
  const 占位 = await prisma.user.upsert({ where: { email: 无负责人占位邮箱 }, update: {}, create: { email: 无负责人占位邮箱, name: "无负责人", title: "", role: "SALES", password: "x", active: false } });
  const c = await prisma.customer.create({ data: { name: 名, phone: "", salesOwnerId: 占位.id } });
  await prisma.customerPool.create({ data: { customerId: c.id, userId: null, reason: "自动进客户公海", phoneIncomplete: 不全 } });
  return c.id;
}
type 公海参 = { 行: { customerId: string; 号码不全?: boolean }[]; 三态开?: boolean; 号码不全数?: number | null };
async function 量(sp: Record<string, string> = {}): Promise<{ 句: string[]; p: 公海参 }> {
  mocks.user = { ...甲 };
  const 开 = () => 以谁的身份(甲.id, () => PoolPage({ searchParams: Promise.resolve(sp) } as never)) as Promise<{ props: 公海参 }>;
  记.缓存.clear();
  await 开();
  记.缓存.clear(); 记.句 = []; 记.开 = true;
  try { const el = await 开(); return { 句: 记.句, p: el.props }; } finally { 记.开 = false; }
}

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  甲 = await 造人("jia", "sales");
  await 公海客户("不全一", true);
  await 公海客户("不全二", true);
  await 公海客户("号码齐的", false);
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

describe("公海「号码不全」按钮带数（C14）", () => {
  it("三态关着：不给数、不开标签；带 phoneIncomplete=1 也当没筛", async () => {
    const { p } = await 量();
    expect(p.三态开).toBe(false);
    expect(p.号码不全数).toBeUndefined();
    expect((await 量({ phoneIncomplete: "1" })).p.行).toHaveLength(3);
  });

  it("三态开着：数 = 点开「号码不全」后的行数；不多查库；筛 phoneIncomplete=1 只剩这几位", async () => {
    const 关 = (await 量()).句.length;
    await setSetting("orgRules", { ...默认组织规则, 三态: { ...默认三态规则, 开: true } });
    invalidateSettingsCache();
    const 开 = await 量();
    expect(开.p.三态开).toBe(true);
    expect(开.p.号码不全数).toBe(2);
    if (process.env.POOL_QUERY_DUMP) (await import("node:fs")).appendFileSync(process.env.POOL_QUERY_DUMP, `公海页 关 ${关} 开 ${开.句.length}\n`);
    expect(开.句.length).toBe(关);
    const 筛 = await 量({ phoneIncomplete: "1" });
    expect(筛.p.行.map((r) => r.号码不全)).toEqual([true, true]);
    expect(筛.p.号码不全数).toBe(筛.p.行.length);
    // 跟着这一页别的筛选走：按关键词只剩「号码齐的」→ 再点号码不全一行都没有，数是 0
    expect((await 量({ keyword: "号码齐" })).p.号码不全数).toBe(0);
    const 不全一 = await 量({ keyword: "不全一" });
    expect(不全一.p.号码不全数).toBe(1);
    expect((await 量({ keyword: "不全一", phoneIncomplete: "1" })).p.行).toHaveLength(不全一.p.号码不全数!);
  });
});
