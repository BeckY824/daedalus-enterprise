/**
 * 客户页服务端取数并起来跑（perf/ent-customers-parallel，11-26）以后，页面上每样数都和改前一样。
 *
 * 改的是顺序（看板视图提前起看板那份、0 条时的公海兜底和主查询一起跑、JSX 里一串 await 并进 Promise.all），不是口径：
 * 这里按「列表 / 看板」×「不带 / 带关键词、有结果 / 0 条 / 公海里有」×「按金额以外的排序（不走关键词分页那条快路）」×
 * 销售、销售管理、总管理、系统管理员，把交给 CustomersView 的那几样数（总数、页码、页签数、公海匹配提示、
 * 批量按钮那几样开关和 id 名单、删除挡、看板卡片）摊成一张表钉住。快照是改前跑出来的（c7609a60）
 */
import { 回填放回人列 } from "./helpers/pool-prev-owner-seed";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
  看法: "" as string,
  在请求: false,
  /** 页面向公海那边（pool="1"）查了几次：关键词分页 + 客户筛选条件 */
  查公海: 0,
}));
vi.mock("next/headers", async (原) => ({
  ...(await 原<object>()),
  cookies: async () => {
    if (!mocks.在请求) throw new Error("不在请求里");
    return { get: (k: string) => (k === "customers-view" && mocks.看法 ? { name: k, value: mocks.看法 } : undefined) };
  },
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
vi.mock("@/app/(app)/customers/query", async (原) => {
  const m = await 原<typeof import("@/app/(app)/customers/query")>();
  const 数 = <A extends [{ pool?: string }, ...unknown[]], R>(f: (...a: A) => R) => (...a: A): R => {
    if (a[0]?.pool === "1") mocks.查公海++;
    return f(...a);
  };
  return { ...m, 关键词分页: 数(m.关键词分页), 客户筛选条件: 数(m.客户筛选条件) };
});
vi.mock("@/app/(app)/customers/CustomersView", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/HandoverPending", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/ProjectsView", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import CustomersPage from "@/app/(app)/customers/page";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string, managerId: string | null = null, role = "SALES"): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name: key, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId } });
  return { id: u.id, name: key, email, role, title: "", avatar: null };
};

let 人们: Record<string, 人> = {};
const 名表 = new Map<string, string>();
beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  mocks.看法 = "";
  mocks.查公海 = 0;
  await resetDb();
  invalidateSettingsCache();
  await setSetting("enterprise.rule.org_scope", true);
  名表.clear();
  const 总 = await 造人("zong", "director");
  const 销管 = await 造人("xg", "sales_mgr", 总.id);
  const 甲 = await 造人("jia", "sales", 销管.id);
  const 乙 = await 造人("yi", "sales");
  const 系管 = await 造人("sys", "admin", null, "ADMIN");
  人们 = { 销售: 甲, 销售管理: 销管, 总管理: 总, 系统管理员: 系管 };
  for (const u of [总, 销管, 甲, 乙, 系管]) 名表.set(u.id, u.name);
  const 客户 = async (name: string, ownerId: string, 项目 = 0) => {
    const c = await prisma.customer.create({ data: { name, phone: `139${String(名表.size).padStart(8, "0")}`, salesOwnerId: ownerId } });
    名表.set(c.id, name);
    for (let j = 0; j < 项目; j++) {
      await prisma.project.create({ data: { name: `${name}-项目${j}`, customerId: c.id, ownerId, creatorId: ownerId, phase: "商机", node: "方案敲定" } });
    }
    return c;
  };
  await 客户("关键甲一", 甲.id, 1);
  await 客户("关键甲二", 甲.id, 2);
  await 客户("关键乙一", 乙.id, 1);
  await 客户("普通销管", 销管.id, 0);
  // 公海里的两位：一位原负责人是甲（甲领不回），一位是乙
  for (const [n, o] of [["海里关键", 甲.id], ["海里另一", 乙.id]] as const) {
    const c = await 客户(n, o, 1);
    await prisma.customerPool.create({ data: { customerId: c.id, userId: o, reason: "手动" } });
  }
  // 直接塞的公海行没走放回公海的动作，回避只认 poolPrevOwnerId 列，补一遍回填（等于上线跑回填）
  await 回填放回人列(prisma);
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

type P = Record<string, unknown> & { rows: { id: string; name: string }[] };
const 名 = (ids: unknown) => (Array.isArray(ids) ? ids.map((x) => 名表.get(String(x)) ?? String(x)).sort() : ids);

async function 打开(sp: Record<string, string>, 谁: 人): Promise<P> {
  mocks.user = { ...谁 };
  忘掉企业版范围();
  mocks.在请求 = true;
  try {
    const el = (await 以谁的身份(谁.id, () => CustomersPage({ searchParams: Promise.resolve(sp) } as never))) as { props: P };
    return el.props;
  } finally {
    mocks.在请求 = false;
  }
}

/** 交给 CustomersView 的数摊平：id 换成名字、排好序，函数 / 元素只记有没有 */
function 摊(p: P) {
  const 看板 = (p.看板体 as { props?: { 列?: { 行?: { name?: string }[] }[] } } | undefined)?.props;
  return {
    total: p.total,
    page: p.page,
    requestedPage: p.requestedPage,
    公海数: p.公海数,
    客户数: p.客户数,
    // 看板视图不画「公海里有 N 位匹配 ›」：它只在 DataList 的表格空态（没对上）里，看板视图表格整块换成 替表格（看板体），这一格不渲染；
    // 页面在看板视图里不再数它（省一次公海兜底查询），这里不比
    公海里匹配: p.看板体 === undefined ? p.公海里匹配 : "看板视图不画",
    rows: p.rows.map((r) => r.name),
    能分配公海: p.能分配公海,
    能转出自己的: p.能转出自己的,
    能新建和领取: p.能新建和领取,
    公海分给: Array.isArray(p.公海分给) ? (p.公海分给 as { name: string }[]).map((u) => u.name).sort() : p.公海分给,
    能删: p.能删,
    删不了: 名(p.删不了ids),
    放不了: 名(p.放不了ids),
    公海别线: 名(p.公海别线ids),
    原负责人领不回: 名(p.原负责人领不回ids),
    只读: 名(p.只读ids),
    自动分配: typeof p.自动分配预看 === "function",
    阶段太多: p.阶段太多,
    仅项目行: Array.isArray(p.仅项目行) ? (p.仅项目行 as unknown[]).length : undefined,
    看板: p.看板体 === undefined ? null : (看板?.列 ?? []).flatMap((c) => (c.行 ?? []).map((r) => r.name)).sort(),
  };
}

const 组合: [string, Record<string, string>][] = [
  ["不带", {}],
  ["关键词有结果", { keyword: "关键" }],
  ["关键词只在公海", { keyword: "海里" }],
  ["关键词哪都没有", { keyword: "无此人" }],
  ["慢路有结果", { keyword: "关键", sort: "created-asc" }],
  ["慢路只在公海", { keyword: "海里", sort: "created-asc" }],
  ["只筛等级零条", { level: "A" }],
];

describe("客户页并起来取数：交给 CustomersView 的数和改前一样", () => {
  for (const 看法 of ["list", "board"] as const) {
    it(`${看法}：四个角色 × 七种查询`, async () => {
      mocks.看法 = 看法 === "board" ? "board" : "";
      const 表: Record<string, unknown> = {};
      for (const [角色, 谁] of Object.entries(人们)) {
        for (const [k, sp] of 组合) 表[`${角色}/${k}`] = 摊(await 打开(sp, 谁));
      }
      expect(表).toMatchSnapshot();
    });
  }
});

describe("公海关键词查询按需（11-26 小修 h）：客户页签搜到人不跑，0 条才跑", () => {
  for (const [名, sort] of [["快路", undefined], ["慢路", "created-asc"]] as const) {
    it(`${名}：客户有结果时不查公海，提示 0`, async () => {
      const p = await 打开({ keyword: "关键", ...(sort ? { sort } : {}) }, 人们.销售管理);
      expect(p.rows.length).toBeGreaterThan(0);
      expect(p.公海里匹配).toBe(0);
      expect(mocks.查公海).toBe(0);
    });
    it(`${名}：客户 0 条时才查公海，提示照出`, async () => {
      const p = await 打开({ keyword: "海里", ...(sort ? { sort } : {}) }, 人们.销售管理);
      expect(p.rows.length).toBe(0);
      expect(p.公海里匹配).toBe(2);
      expect(mocks.查公海).toBeGreaterThan(0);
    });
  }
  it("不带关键词、客户有结果：不查公海", async () => {
    await 打开({}, 人们.销售管理);
    expect(mocks.查公海).toBe(0);
  });
});
