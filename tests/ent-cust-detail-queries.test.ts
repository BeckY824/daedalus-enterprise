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
import { 默认组织规则, 默认三态规则 } from "@/lib/project/org-rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import CustomerPage from "@/app/(app)/customers/[id]/page";
import { 企业字典, 页面字典, 预读页面字典, 字典种类们 } from "@/lib/enterprise/dict";

/**
 * 上限：11-12 改完实测 92 条（客户层 52、项目区 40）+ 小余量。改前主干 184 条（#270 之前 77 条）。
 * 往上调之前先 CUST_DETAIL_QUERY_DUMP=<文件> 跑一遍看明细，是不是又把同一条查了两遍（字典逐类读、看得到的客户、沟通负责人……）
 */
const 客户详情查询上限 = 100;
/** 三态开着、钟上沉睡 / 待回收的客户：比关着多查的上限（收三态客户 一套，客户行连钟、换负责人记录、占位词复用页面的）。
 * 11-12 第一轮实测多 26 条；第二轮同一请求去重后多 11 条（关 92 / 活跃 95 / 沉睡 103）；最近沟通日改一句 SQL（沟通生效日）后多 8 条（沉睡 100），上限 = 实测 +2 */
const 三态沉睡多查上限 = 10;

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

  /*
    客户三态（P-界面-19）：关着一条都不多（先量关着的基数，同上面那条）；开着时活跃的客户只多 客户钟、状态留痕、冷项目一句 SQL 三条，
    不随项目数涨；钟上沉睡 / 待回收的才收齐事实现算（收三态客户 一套固定条数，也不随项目数涨），另给一个上限
  */
  it("三态关着不多查；开着、活跃的客户多 ≤ 3 条；沉睡的客户另有上限，都不随项目数涨", async () => {
    // 每种情形量两遍取第二遍：第一遍会顺手建默认字典、存归零这类一次性的写
    const 量稳 = async () => { await 量(); return 量(); };
    const 关着句 = await 量稳();
    const 关着 = 关着句.length;
    // 关着时交给客户详情的东西和原来一样（状态条、留痕不给，页签不带冷标）：界面上什么都不多
    const 元素 = (await 以谁的身份(甲.id, () => CustomerPage({ params: Promise.resolve({ id: 客户 }), searchParams: Promise.resolve({}) } as never))) as { props: Record<string, unknown> };
    expect(元素.props.三态条).toBeNull();
    expect(元素.props.三态留痕).toBeNull();
    expect((元素.props.项目数据 as { 页签们: object[] }).页签们.every((t) => !("冷天数" in t))).toBe(true);
    // 关着：三态的表、冷项目那句 SQL 一条都不碰（11-12 实测和改前一样 92 条）
    expect(关着句.filter((q) => /EntCustomerClock|EntCustomerStateLog|FollowUpProject" fp/.test(q))).toEqual([]);
    await setSetting("business", { projectMode: true });
    await setSetting("orgRules", { ...默认组织规则, 三态: { ...默认三态规则, 开: true } });
    await prisma.entCustomerClock.create({ data: { customerId: 客户, state: "活跃", enteredDay: "2026-11-01" } });
    invalidateSettingsCache();
    const 活跃 = (await 量稳()).length;
    expect(活跃 - 关着).toBeLessThanOrEqual(3);
    await prisma.entCustomerClock.update({ where: { customerId: 客户 }, data: { state: "沉睡", enteredDay: "2026-11-01" } });
    const 沉睡 = (await 量稳()).length;
    expect(沉睡 - 关着).toBeLessThanOrEqual(三态沉睡多查上限);
    // 多两个项目，条数不变
    for (const n of ["项目四", "项目五"]) await prisma.project.create({ data: { name: n, customerId: 客户, ownerId: 甲.id, creatorId: 甲.id, phase: "商机", node: "需求确认" } });
    const 多项目 = (await 量稳()).length;
    await setSetting("orgRules", { ...默认组织规则 });
    invalidateSettingsCache();
    const 关着多项目 = (await 量稳()).length;
    expect(多项目 - 关着多项目).toBe(沉睡 - 关着);
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

