/**
 * 客户详情一次打开发多少条 SQL（11-12 速度闸门「B：按组织看」客户详情 HTML p95 从 291ms 涨到 372 / 438ms）。
 * 库的写连接只有 1 个、读通道 4 个，30 人并发时查询在 Prisma 这一层排队：条数比并行更要紧。
 * 钉的是：按组织看的销售打开一位有 3 个项目的客户（默认停在一个项目页签上），客户页 + 项目区一共不超过 上限 条；
 * 谁把重复的查询加回去（权限组织、负责人候选、客户行、项目列表、联系人……各查一遍）这里就红。
 *
 * 量法：把生成的 PrismaClient 换成一个带 query 事件的子类，主连接、只读通道都记；react 的 cache() 在测试里是直通的，
 * 这里换成「一次请求内记住」，和 Next 渲染时一样（不然缓存了的查询会被多数）。只数页面函数本身（异步子组件 SameNumberBanner 另算）
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
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/projects/[id]/ProjectDetail", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/[id]/SameNumberBanner", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/[id]/CustomerDetail", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import CustomerPage from "@/app/(app)/customers/[id]/page";
import { 企业字典, 页面字典, 预读页面字典, 字典种类们 } from "@/lib/enterprise/dict";

/**
 * 上限：11-12 改完实测 92 条（客户层 52、项目区 40）+ 小余量。改前主干 184 条（#270 之前 77 条）。
 * 往上调之前先 CUST_DETAIL_QUERY_DUMP=<文件> 跑一遍看明细，是不是又把同一条查了两遍（字典逐类读、看得到的客户、沟通负责人……）
 */
const 客户详情查询上限 = 100;

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole } });
  return { id: u.id, name: key, email, role: "SALES", title: "", avatar: null };
};

let 甲: 人, 客户: string;
beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  await setSetting("enterprise.rule.org_scope", true);
  甲 = await 造人("jia", "sales");
  const 乙 = await 造人("yi", "sales");
  客户 = (await prisma.customer.create({ data: { name: "量查询的客户", phone: "13900000021", salesOwnerId: 甲.id, contacts: { create: [{ name: "张三", isPrimary: true }, { name: "李四" }] } } })).id;
  const 建 = (name: string, ownerId: string, x: object = {}) => prisma.project.create({ data: { name, customerId: 客户, ownerId, creatorId: ownerId, phase: "商机", node: "需求确认", ...x } }).then((p) => p.id);
  const 项目们 = [await 建("项目一", 甲.id), await 建("项目二", 甲.id), await 建("项目三", 甲.id, { result: "丢单" }), await 建("同事的", 乙.id)];
  for (const [i, pid] of 项目们.slice(0, 2).entries()) {
    await prisma.followUp.create({ data: { customerId: 客户, ownerId: 甲.id, type: "PHONE", title: "", content: `沟通${i}`, status: "已完成", projectNode: { create: { projectId: pid, node: "需求确认" } } } });
  }
  await prisma.task.create({ data: { title: "回个电话", customerId: 客户, ownerId: 甲.id } });
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

/** 打开一次客户详情：先热一遍（设置缓存、组织缓存这类跨请求的照生产一样是热的），再清掉请求内缓存量第二遍 */
async function 量(): Promise<string[]> {
  mocks.user = { ...甲 };
  const 开 = () => 以谁的身份(甲.id, () => CustomerPage({ params: Promise.resolve({ id: 客户 }), searchParams: Promise.resolve({}) } as never));
  await 开();
  记.缓存.clear(); 记.句 = []; 记.开 = true;
  try { await 开(); } finally { 记.开 = false; }
  return 记.句;
}

describe("客户详情一次打开的查询条数", () => {
  it("按组织看的销售、有 3 个项目的客户：一共不超过上限条", async () => {
    const 句 = await 量();
    const 表 = new Map<string, number>();
    for (const q of 句) {
      const k = q.replace(/\s+/g, " ").replace(/`main`\./g, "").slice(0, 140);
      表.set(k, (表.get(k) ?? 0) + 1);
    }
    // 明细：CUST_DETAIL_QUERY_DUMP=<文件> 写出每种 SQL 几条（按条数倒排）和执行顺序
    if (process.env.CUST_DETAIL_QUERY_DUMP) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.CUST_DETAIL_QUERY_DUMP, `共 ${句.length} 条\n\n${[...表.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}\t${k}`).join("\n")}\n\n顺序：\n${句.map((q) => q.replace(/\s+/g, " ").replace(/`main`\./g, "").slice(0, 160)).join("\n")}\n`);
    }
    expect(句.length).toBeLessThanOrEqual(客户详情查询上限);
  });

  it("字典合读（预读页面字典）和逐类现读 企业字典 一个结果：新库第一次（要建默认）、建好以后（走合读）都一样", async () => {
    for (const 轮 of ["新库", "建好以后"]) {
      记.缓存.clear();
      预读页面字典(字典种类们);
      const 合读 = await Promise.all(字典种类们.map((k) => 页面字典(k)));
      const 现读 = await Promise.all(字典种类们.map((k) => 企业字典(k)));
      expect(合读.map((x) => x.map((i) => [i.id, i.name, i.active, i.sort])), 轮).toEqual(现读.map((x) => x.map((i) => [i.id, i.name, i.active, i.sort])));
    }
  });
});

