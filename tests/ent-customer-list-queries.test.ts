/**
 * 客户列表一次打开发多少条 SQL（11-12 客户详情合并第 3 批：表格加「当前节点」「项目数」两列）。
 * 客户列表 HTML p95 约 310–360ms，速度线 400ms：两列要一句合并取（这一页的客户一次取项目），不能每行各查一遍。
 * 钉的是：按组织看的销售打开客户列表（这一页 6 位客户、各挂 0–3 个项目），一共不超过 上限 条；
 * 每行各查一次的话 6 位客户就多 6 条以上，这里就红。
 *
 * 量法同 tests/ent-cust-detail-queries.test.ts：生成的 PrismaClient 换成带 query 事件的子类，react 的 cache() 换成一次请求内记住
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

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/customers/CustomersView", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/HandoverPending", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import CustomersPage from "@/app/(app)/customers/page";
import { 最近有动静的 } from "@/lib/project/customer-list-projects";

/**
 * 上限：11-12 改前实测 35 条；加两列后 38 条（这一页的项目一句 + 项目上我加入没有一句 + 原负责人回避名单一句，和每页几位客户无关）+ 小余量。
 * 往上调之前先 CUST_LIST_QUERY_DUMP=<文件> 跑一遍看明细，是不是又每行查了一遍
 */
const 客户列表查询上限 = 42;

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string, managerId: string | null = null): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId } });
  return { id: u.id, name: key, email, role: "SALES", title: "", avatar: null };
};

let 甲: 人, 乙: 人, 经理: 人;
beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  await setSetting("enterprise.rule.org_scope", true);
  经理 = await 造人("jl", "sales");
  甲 = await 造人("jia", "sales", 经理.id);
  乙 = await 造人("yi", "sales");
  for (let i = 0; i < 6; i++) {
    const c = await prisma.customer.create({ data: { name: `列表客户${i}`, phone: `1390000010${i}`, salesOwnerId: 甲.id } });
    for (let j = 0; j < i % 4; j++) {
      await prisma.project.create({ data: { name: `项目${i}-${j}`, customerId: c.id, ownerId: j === 2 ? 乙.id : 甲.id, creatorId: j === 2 ? 乙.id : 甲.id, phase: "商机", node: "方案敲定" } });
    }
  }
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

/** 打开一次客户列表：先热一遍，再清掉请求内缓存量第二遍 */
async function 量(sp: Record<string, string> = {}, 谁: 人 = 甲): Promise<{ 句: string[]; el: unknown }> {
  mocks.user = { ...谁 };
  const 开 = () => 以谁的身份(谁.id, () => CustomersPage({ searchParams: Promise.resolve(sp) } as never));
  await 开();
  记.缓存.clear(); 记.句 = []; 记.开 = true;
  let el: unknown;
  try { el = await 开(); } finally { 记.开 = false; }
  return { 句: 记.句, el };
}

describe("客户列表一次打开的查询条数", () => {
  it("按组织看的销售、一页 6 位客户：一共不超过上限条", async () => {
    const { 句 } = await 量();
    const 表 = new Map<string, number>();
    for (const q of 句) {
      const k = q.replace(/\s+/g, " ").replace(/`main`\./g, "").slice(0, 140);
      表.set(k, (表.get(k) ?? 0) + 1);
    }
    if (process.env.CUST_LIST_QUERY_DUMP) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.CUST_LIST_QUERY_DUMP, `共 ${句.length} 条\n\n${[...表.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}\t${k}`).join("\n")}\n\n顺序：\n${句.map((q) => q.replace(/\s+/g, " ").replace(/`main`\./g, "").slice(0, 160)).join("\n")}\n`);
    }
    expect(句.length).toBeLessThanOrEqual(客户列表查询上限);
  });
});

type 视图参数 = { rows: { id: string; name: string }[]; 项目概况?: Record<string, { 项目数: number; 当前节点: string | null }>; filters: Record<string, string> };
const 参数 = (el: unknown) => (el as { props: 视图参数 }).props;
const 按名 = (p: 视图参数) => Object.fromEntries(p.rows.map((r) => [r.name, p.项目概况?.[r.id] ?? null]));

describe("「当前节点」「项目数」两列（11-12 第 3 批）", () => {
  it("只算我能看的：销售只数自己的项目，同事的不计入、不显示", async () => {
    const p = 参数((await 量()).el);
    const 们 = 按名(p);
    expect(们["列表客户0"]).toBeNull();
    expect(们["列表客户1"]).toMatchObject({ 项目数: 1, 当前节点: "方案敲定" });
    // 列表客户3 名下 3 个项目，第三个是乙的：甲只数 2 个
    expect(们["列表客户3"]?.项目数).toBe(2);
  });

  it("上级算自己和下属的：经理看甲负责的客户，项目数和甲一样（乙不是他的下属，照样不算）", async () => {
    const p = 参数((await 量({}, 经理)).el);
    const 们 = 按名(p);
    expect(们["列表客户3"]?.项目数).toBe(2);
    expect(们["列表客户2"]?.项目数).toBe(2);
  });

  it("多个项目时写最近有动静（updatedAt 最新）的那个的节点；一样新取节点更靠后的", async () => {
    const c = await prisma.customer.findFirstOrThrow({ where: { name: "列表客户2" }, select: { id: true } });
    const ps = await prisma.project.findMany({ where: { customerId: c.id }, orderBy: { name: "asc" } });
    await prisma.project.update({ where: { id: ps[0].id }, data: { phase: "订单", node: "生产备货", updatedAt: new Date("2026-11-01T08:00:00Z") } });
    await prisma.project.update({ where: { id: ps[1].id }, data: { phase: "线索", node: "线索验证", updatedAt: new Date("2026-11-02T08:00:00Z") } });
    // 后改的是线索那个：它最近有动静
    expect(按名(参数((await 量()).el))["列表客户2"]?.当前节点).toBe("线索验证");
    const 同时 = new Date("2026-11-01T00:00:00Z");
    expect(最近有动静的([
      { phase: "线索", node: "线索验证", result: null, updatedAt: 同时 },
      { phase: "订单", node: "生产备货", result: null, updatedAt: 同时 },
      { phase: "商机", node: "方案敲定", result: null, updatedAt: 同时 },
    ])?.node).toBe("生产备货");
    expect(最近有动静的([
      { phase: "订单", node: "尾款结算", result: null, updatedAt: new Date("2026-10-01") },
      { phase: "线索", node: "潜客培育", result: null, updatedAt: 同时 },
    ])?.node).toBe("潜客培育");
    expect(最近有动静的([])).toBeNull();
  });

  it("「全部阶段」「全部进程」：名下有一个我能看的项目在这一阶段 / 进程上；同事的项目不算", async () => {
    const c3 = await prisma.customer.findFirstOrThrow({ where: { name: "列表客户3" }, select: { id: true } });
    // 乙那个项目改到订单：甲按订单筛不该筛出列表客户3
    await prisma.project.updateMany({ where: { customerId: c3.id, ownerId: 乙.id }, data: { phase: "订单", node: "生产备货" } });
    expect(参数((await 量({ phase: "订单" })).el).rows.map((r) => r.name)).toEqual([]);
    expect(参数((await 量({ phase: "商机" })).el).rows.map((r) => r.name).sort()).toEqual(["列表客户1", "列表客户2", "列表客户3", "列表客户5"]);
    expect(参数((await 量({ node: "方案敲定" })).el).rows.length).toBe(4);
    expect(参数((await 量({ phase: "商机" })).el).filters).toMatchObject({ phase: "商机", node: "" });
    // 带关键词也认（快路径接不住阶段，走老路）
    expect(参数((await 量({ phase: "商机", keyword: "列表客户1" })).el).rows.map((r) => r.name)).toEqual(["列表客户1"]);
  });
});
