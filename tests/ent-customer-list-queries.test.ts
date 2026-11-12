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
  /** 客户页记的「列表 / 看板」（lib/customers-view-pref.ts 的 cookie）；空 = 没记 */
  看法: "" as string,
  在请求: false,
}));
// 只在打开页面那一下像在请求里（别的时候照真的一样抛：限定层等靠「不在请求里」认出是测试自己在造数据、清库）
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
vi.mock("@/app/(app)/customers/CustomersView", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/HandoverPending", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/ProjectsView", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import CustomersPage from "@/app/(app)/customers/page";
import ProjectsPage from "@/app/(app)/projects/page";
import { 最近有动静的, 设阶段命中上限 } from "@/lib/project/customer-list-projects";
import { 市场成员key } from "@/lib/enterprise/market";
import { 企业版根目录 } from "@/lib/enterprise/nav";
import { 默认组织规则, 默认三态规则 } from "@/lib/project/org-rules";
import { 加天 } from "@/lib/enterprise/tri-state";
import { beijingDay } from "@/lib/business-clock";
import { 收客户页面筛选 } from "@/lib/ai-page-filters";
import { 三态标字, type 三态标 } from "@/lib/enterprise/tri-state-label";
import { 客户筛选条件, 关键词分页 } from "@/app/(app)/customers/query";

/**
 * 上限：11-12 改前实测 35 条；加两列后 37 条，页头摆离职交接（C15）后 38 条（多 1 条；离职交接入口里的下属、停用下属改从组织里取，不再另查；这一页的项目一句 + 项目上我加入没有一句，和每页几位客户无关；公海项目不算，不用再读回避名单）+ 小余量。
 * 往上调之前先 CUST_LIST_QUERY_DUMP=<文件> 跑一遍看明细，是不是又每行查了一遍
 */
const 客户列表查询上限 = 42;
/**
 * 看板视图（cookie 记着「看板」）：客户页的页头、页签数、筛选选项照取，这一页客户行和两列不取，多取项目看板那一份（projects/board-page.tsx）。
 * 11-12 实测 48 条（客户页页头那份 ~22 + 项目看板那份 ~26），客户、项目多少不变（见用例）；上限 = 实测 + 小余量
 */
const 客户页看板查询上限 = 52;
/**
 * 客户三态开着（11-12 三态界面 B 组，P-界面-19 ①）：「状态」一列一次取钟，内外贸两套进公海天数不同再一句项目选套 —— 比关着多 ≤ 2 条。
 * 上限 = 关着的上限 + 2
 */
const 客户列表三态开着上限 = 客户列表查询上限 + 2;
/**
 * /projects（项目页，看板 / 列表在浏览器里切，服务端两份都取）：改成看板每列各自取数（11-12）以后——
 * 列表这一页先只取 id，再和看板每列的卡片一起一句 include（最近留痕另一句 groupBy，替掉原来 include 里的那一句）：比改前 23 条多 1 条 = 24；
 * 每有一列超过 20 个，多 1 句只取这一列前 20 的 id。按负责人排 25 → 26（同上多 1 条；这一页落在几位名下都最多 3 句，不随人数涨）
 */
const 项目页查询数 = 24;
const 项目页按负责人查询数 = 26;

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
  mocks.看法 = "";
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
async function 量(sp: Record<string, string> = {}, 谁: 人 = 甲, 页 = CustomersPage as (a: never) => Promise<unknown>): Promise<{ 句: string[]; el: unknown }> {
  mocks.user = { ...谁 };
  const 开 = async () => {
    mocks.在请求 = true;
    try { return await 以谁的身份(谁.id, () => 页({ searchParams: Promise.resolve(sp) } as never)); } finally { mocks.在请求 = false; }
  };
  // 热身前也清：上一条用例的请求内缓存还留着（库已经清过），热身就不会把第一次读顺手建的字典建上
  记.缓存.clear();
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

describe("客户页「看板」视图（11-12 第 3 批 C17 / C18：页头、筛选行照客户列表，表格换成按节点分列的项目看板）", () => {
  const 明细 = (句: string[]) => [...句.reduce((m, q) => { const k = q.replace(/\s+/g, " ").replace(/`main`\./g, "").slice(0, 140); return m.set(k, (m.get(k) ?? 0) + 1); }, new Map<string, number>())].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}\t${k}`).join("\n");
  type 卡 = { customerName: string | null; name: string; 只看进度?: boolean };
  type 看板参数 = { 客户页?: boolean; 行: 卡[]; 列: { 列: string; 数: number; 行: 卡[] }[]; 每列?: Record<string, 卡[]>; 总数: number };
  const 看板of = (el: unknown) => ((参数(el) as unknown as { 看板体?: { props: 看板参数 } }).看板体)?.props;
  /** 客户页看板每列各自取数（11-12）：卡片在各列里（列.行），整页共用的列表页（行）不取 */
  const 卡们 = (p: 看板参数) => p.列.flatMap((c) => c.行);
  it("记着看板：客户页照画（页头、筛选行），看板体是客户页模式的项目看板；不取这一页客户行和两列；条数不超过上限、不随客户和项目多少变", async () => {
    mocks.看法 = "board";
    const 看板 = await 量();
    const p = 看板of(看板.el)!;
    expect(p.客户页).toBe(true);
    expect(卡们(p).length).toBeGreaterThan(0);
    expect(p.每列).toBeDefined();
    expect(p.行).toEqual([]);
    expect(参数(看板.el).rows).toEqual([]);
    expect(参数(看板.el).项目概况).toBeUndefined();
    expect(看板.句.some((q) => /FROM `Customer` .*ORDER BY `Customer`\.`createdAt`/.test(q.replace(/`main`\./g, "")))).toBe(false);
    if (process.env.CUST_BOARD_QUERY_DUMP) (await import("node:fs")).writeFileSync(process.env.CUST_BOARD_QUERY_DUMP, `客户页看板 ${看板.句.length} 条\n\n${明细(看板.句)}\n`);
    expect(看板.句.length).toBeLessThanOrEqual(客户页看板查询上限);
    // 多 12 位客户、每位 2 个项目（「方案敲定」一列从 6 个变 30 个，超过每列 20）：
    // 首屏 = 1 句 include 取卡片 + 超过 20 个的列每列 1 句只取 id（list.ts 读项目列表 看板每列），所以只多这一列的 1 句，不按行查
    const 加 = async (起: number) => {
      for (let i = 起; i < 起 + 12; i++) {
        const c = await prisma.customer.create({ data: { name: `加的客户${i}`, phone: `1390000020${String(i).padStart(2, "0")}`, salesOwnerId: 甲.id } });
        for (let j = 0; j < 2; j++) await prisma.project.create({ data: { name: `加的项目${i}-${j}`, customerId: c.id, ownerId: 甲.id, creatorId: 甲.id, phase: "商机", node: "方案敲定" } });
      }
    };
    await 加(0);
    const 大一列 = await 量();
    expect(大一列.句.length).toBe(看板.句.length + 1);
    expect(看板of(大一列.el)!.列.find((c) => c.列 === "方案敲定")).toMatchObject({ 数: 30 });
    expect(看板of(大一列.el)!.列.find((c) => c.列 === "方案敲定")!.行).toHaveLength(20);
    // 再多 24 个：条数不再涨（这一列已经是一句 take 20）
    await 加(12);
    expect((await 量()).句.length).toBe(大一列.句.length);
    expect(大一列.句.length).toBeLessThanOrEqual(客户页看板查询上限);
  });

  it("/projects 首屏（看板每列 + 列表这一页）：条数钉住；一列超过 20 个只多这一列的 1 句，再多项目不涨", async () => {
    const 项目页 = (sp: Record<string, string> = {}) => 量(sp, 甲, ProjectsPage as never);
    expect((await 项目页()).句.length).toBe(项目页查询数);
    expect((await 项目页({ sort: "owner-asc" })).句.length).toBe(项目页按负责人查询数);
    const 加 = async (起: number) => {
      for (let i = 起; i < 起 + 12; i++) {
        const c = await prisma.customer.create({ data: { name: `项目页加的${i}`, phone: `1390000060${String(i).padStart(2, "0")}`, salesOwnerId: 甲.id } });
        for (let j = 0; j < 2; j++) await prisma.project.create({ data: { name: `项目页加的${i}-${j}`, customerId: c.id, ownerId: 甲.id, creatorId: 甲.id, phase: "商机", node: "方案敲定" } });
      }
    };
    await 加(0);
    const 大 = await 项目页();
    expect(大.句.length).toBe(项目页查询数 + 1);
    const 列 = (大.el as { props: { 列: { 列: string; 数: number; 行: unknown[] }[]; 行: unknown[] } }).props;
    expect(列.列.find((c) => c.列 === "方案敲定")).toMatchObject({ 数: 30 });
    expect(列.列.find((c) => c.列 === "方案敲定")!.行).toHaveLength(20);
    expect(列.行).toHaveLength(20);
    await 加(12);
    expect((await 项目页()).句.length).toBe(大.句.length);
    expect((await 项目页({ sort: "owner-asc" })).句.length).toBe(项目页按负责人查询数 + 1);
  });

  it("同一行筛选（C18）：先按客户筛、再出这些客户的项目卡；阶段 / 进程按项目筛；只按页签 = 不收窄", async () => {
    mocks.看法 = "board";
    const 全 = 看板of((await 量()).el)!;
    expect(new Set(卡们(全).map((r) => r.customerName))).toEqual(new Set(["列表客户1", "列表客户2", "列表客户3", "列表客户5"]));
    const 搜 = 看板of((await 量({ keyword: "列表客户3" })).el)!;
    expect(new Set(卡们(搜).map((r) => r.customerName))).toEqual(new Set(["列表客户3"]));
    await prisma.project.updateMany({ where: { name: "项目3-1" }, data: { phase: "订单", node: "签约" } });
    const 阶 = 看板of((await 量({ keyword: "列表客户3", phase: "订单" })).el)!;
    expect(卡们(阶).map((r) => r.name)).toEqual(["项目3-1"]);
    const 没对上 = 看板of((await 量({ keyword: "没有这位" })).el)!;
    expect(卡们(没对上)).toEqual([]);
  });

  it("子集（导入这一批）、记着列表、没记都画列表（没有看板体）", async () => {
    mocks.看法 = "board";
    expect(看板of((await 量({ batch: "b1" })).el)).toBeUndefined();
    mocks.看法 = "list";
    expect(看板of((await 量()).el)).toBeUndefined();
    expect(参数((await 量()).el).rows.length).toBe(6);
    mocks.看法 = "";
    expect(看板of((await 量()).el)).toBeUndefined();
  });

  it("市场成员（X-107，用户 11-12「按第 1 种做」）：左栏没有「项目」；客户页两个视图——列表 = 原来的客户列表，看板 = 原项目页那套市场视角（我分出去的）；没记过进我分出去的；被挡转来的（hl）一律进我分出去的并高亮；销售和上级不变", async () => {
    const 小市 = await 造人("xs", "channel_ops");
    await setSetting(市场成员key, [小市.id]);
    忘掉企业版范围();
    const c = await prisma.customer.create({ data: { name: "市场线索客户", phone: "13900000300", salesOwnerId: 乙.id } });
    const pid = (await prisma.project.create({ data: { name: "市场线索", customerId: c.id, ownerId: 乙.id, creatorId: 小市.id, phase: "线索", node: "线索验证" } })).id;
    const 自己的 = await prisma.customer.create({ data: { name: "市场自己的客户", phone: "13900000301", salesOwnerId: 小市.id } });
    type 项目页参 = { 市场: { 视角: string } | null; 行: { id: string; name: string; 只看进度?: boolean }[]; 基址?: string; 标题?: string; 客户页?: boolean; 高亮?: string; 换回客户列表?: boolean; filters: Record<string, string> };
    const 是我分出去的 = (el: unknown) => (el as { props: 项目页参 }).props.换回客户列表 === true;
    for (const 记 of ["", "board"]) {
      mocks.看法 = 记;
      const el = (await 量({}, 小市)).el;
      expect(是我分出去的(el), 记).toBe(true);
      const p = (el as { props: 项目页参 }).props;
      expect(p.市场?.视角, 记).toBe("市场成员");
      expect(p).toMatchObject({ 基址: "/customers", 标题: "客户", 客户页: false });
      // 已分出去的那行只看进度（点不进详情）
      expect(p.行.map((r) => [r.name, r.只看进度])).toEqual([["市场线索", true]]);
    }
    // 记着列表：原来的客户列表（他看得到的客户照原来的范围），切换叫「客户列表 / 我分出去的」
    mocks.看法 = "list";
    const 列表 = 参数((await 量({}, 小市)).el) as unknown as { rows: { id: string }[]; 市场视图?: boolean; 看板体?: unknown };
    expect(列表.市场视图).toBe(true);
    expect(列表.看板体).toBeUndefined();
    expect(列表.rows.map((r) => r.id)).toContain(自己的.id);
    // 被挡转来的：哪怕记着列表也落到我分出去的，搜项目名、高亮那行
    const 转来 = ((await 量({ q: "市场线索", hl: pid }, 小市)).el as { props: 项目页参 }).props;
    expect(转来.换回客户列表).toBe(true);
    expect(转来.高亮).toBe(pid);
    expect(转来.filters.keyword).toBe("市场线索");
    // /projects 路由本身留着可进，照旧是这一套（落在 /projects，没有回客户列表那颗切换）
    const 原页 = ((await 量({}, 小市, ProjectsPage as never)).el as { props: 项目页参 }).props;
    expect(原页.市场?.视角).toBe("市场成员");
    expect(原页.基址).toBeUndefined();
    expect(原页.换回客户列表).toBe(false);
    // 客户页自己的入口（新建）照旧画客户页
    mocks.看法 = "";
    expect(是我分出去的((await 量({ new: "1" }, 小市)).el)).toBe(false);
    expect(企业版根目录("客户").map((x) => x.key)).not.toContain("/projects");
    // 销售、上级：没记过照旧是客户列表，切换照旧叫「列表 / 看板」
    for (const 谁 of [甲, 经理]) {
      const p = 参数((await 量({}, 谁)).el) as unknown as { rows: unknown[]; 市场视图?: boolean; 换回客户列表?: boolean };
      expect(Array.isArray(p.rows), 谁.name).toBe(true);
      expect(p.市场视图, 谁.name).toBe(false);
    }
  });

  it("阶段筛选命中上千位客户（客户id集合拼成一个 OR，不让 Prisma 拆句）：总数对、翻页按建档时间倒序接得上", async () => {
    const 基 = Date.UTC(2026, 0, 1);
    const n = 1100;
    await prisma.customer.createMany({ data: Array.from({ length: n }, (_, i) => ({ id: `many${String(i).padStart(4, "0")}`, name: `多客户${String(i).padStart(4, "0")}`, phone: `137${String(i).padStart(8, "0")}`, salesOwnerId: 甲.id, createdAt: new Date(基 + i * 1000) })) });
    await prisma.project.createMany({ data: Array.from({ length: n }, (_, i) => ({ name: `多项目${i}`, customerId: `many${String(i).padStart(4, "0")}`, ownerId: 甲.id, creatorId: 甲.id, phase: "订单", node: "签约" })) });
    const 名 = (i: number) => `多客户${String(i).padStart(4, "0")}`;
    const 第一页 = 参数((await 量({ phase: "订单", pageSize: "100" })).el) as unknown as { rows: { name: string }[]; total: number };
    expect(第一页.total).toBe(n);
    expect(第一页.rows.map((r) => r.name)).toEqual(Array.from({ length: 100 }, (_, k) => 名(n - 1 - k)));
    const 末页 = 参数((await 量({ phase: "订单", pageSize: "100", page: "11" })).el) as unknown as { rows: { name: string }[] };
    expect(末页.rows.map((r) => r.name)).toEqual(Array.from({ length: 100 }, (_, k) => 名(99 - k)));
  }, 60_000);

  it("地址栏手写 ?客户=…（内部键）：客户页看板、/projects 都不报错、结果和不带一样", async () => {
    mocks.看法 = "board";
    const 名们 = (el: unknown) => 卡们(看板of(el)!).map((r) => r.name).sort();
    const 原 = 名们((await 量()).el);
    expect(原.length).toBeGreaterThan(0);
    expect(名们((await 量({ 客户: "x" } as Record<string, string>)).el)).toEqual(原);
    const 项目名 = (el: unknown) => (el as { props: { 行: { name: string }[] } }).props.行.map((r) => r.name).sort();
    const 项目原 = 项目名((await 量({}, 甲, ProjectsPage as never)).el);
    expect(项目名((await 量({ 客户: "x" } as Record<string, string>, 甲, ProjectsPage as never)).el)).toEqual(项目原);
  });

  it("阶段筛选：看全部的（系统管理员）在库里用关联条件筛、不把项目读进内存；别的范围命中超过点名上限不报错、当没中并提示", async () => {
    const 管 = await 造人("gl", "director");
    忘掉企业版范围();
    const 管看 = await 量({ phase: "商机" }, 管);
    expect(参数(管看.el).rows.map((r) => r.name).sort()).toEqual(["列表客户1", "列表客户2", "列表客户3", "列表客户5"]);
    // 没有按阶段把项目整批取回来的那一句（我能看的项目们 带 bizLine、members）
    const 句们 = 管看.句.map((q) => q.replace(/`main`\./g, ""));
    expect(句们.some((q) => /^SELECT `Project`/.test(q) && /WHERE .*`Project`\.`phase`/.test(q))).toBe(false);
    expect(句们.some((q) => /FROM `Customer`/.test(q) && /`Project`/.test(q) && /`phase`/.test(q))).toBe(true);
    // 对照：销售照旧把这个阶段的可见项目取回来逐个判（上面那条判据认得出这一句）
    expect((await 量({ phase: "商机" })).句.map((q) => q.replace(/`main`\./g, "")).some((q) => /^SELECT `Project`/.test(q) && /WHERE .*`Project`\.`phase`/.test(q))).toBe(true);
    // 销售：上限调到 2，命中 4 位 → 不报错、一位都没有、带「太多」
    设阶段命中上限(2);
    try {
      const 销 = 参数((await 量({ phase: "商机" })).el) as unknown as { rows: unknown[]; 阶段太多?: boolean; total: number };
      expect(销.rows).toEqual([]);
      expect(销.total).toBe(0);
      expect(销.阶段太多).toBe(true);
      // 管理员走关联条件，不受点名上限影响
      expect((参数((await 量({ phase: "商机" }, 管)).el) as unknown as { 阶段太多?: boolean; rows: unknown[] })).toMatchObject({ 阶段太多: false });
    } finally { 设阶段命中上限(30000); }
    expect((参数((await 量({ phase: "商机" })).el) as unknown as { 阶段太多?: boolean }).阶段太多).toBe(false);
  });

  it("「项目数」「当前节点」和阶段筛选不算公海里的项目", async () => {
    const c1 = await prisma.customer.findFirstOrThrow({ where: { name: "列表客户1" }, select: { id: true } });
    await prisma.project.updateMany({ where: { customerId: c1.id }, data: { pooledAt: new Date() } });
    const 们 = 按名(参数((await 量()).el));
    expect(们["列表客户1"]).toBeNull();
    expect(参数((await 量({ phase: "商机" })).el).rows.map((r) => r.name)).not.toContain("列表客户1");
  });
});

/**
 * 客户三态的「状态」一列、「全部回收状态」筛选、客户页看板色点（P-界面-19 ①②，构想页 C2 / C5）。
 * 三态关着：上面那些用例照旧（列不出、条数不变）；开着：列表多 ≤ 2 条（钟一句；内外贸两套进公海天数不同才再一句项目选套），不随行数涨
 */
describe("客户三态开着：状态列、回收状态筛选、看板色点（11-12 三态界面 B 组）", () => {
  type 三态参 = { rows: { id: string; name: string }[]; 三态标?: Record<string, { 态: string; 几天后进公海?: number }>; filters: Record<string, string>; total: number };
  const 参三 = (el: unknown) => 参数(el) as unknown as 三态参;
  const 今天 = () => beijingDay(new Date());
  const 开三态 = async (三态: Partial<typeof 默认三态规则> = {}) => {
    await setSetting("orgRules", { ...默认组织规则, 三态: { ...默认三态规则, ...三态, 开: true } });
    invalidateSettingsCache();
  };
  const 名id = async (n: string) => (await prisma.customer.findFirstOrThrow({ where: { name: n }, select: { id: true } })).id;
  const 造钟 = async () => {
    await prisma.entCustomerClock.create({ data: { customerId: await 名id("列表客户0"), state: "沉睡", enteredDay: 加天(今天(), -3) } });
    await prisma.entCustomerClock.create({ data: { customerId: await 名id("列表客户1"), state: "待回收", enteredDay: 加天(今天(), -10), noticeCount: 1, lastNoticeDay: 加天(今天(), -10) } });
    await prisma.entCustomerClock.create({ data: { customerId: await 名id("列表客户2"), state: "待回收", enteredDay: 加天(今天(), -40), blocked: true } });
    await prisma.entCustomerClock.create({ data: { customerId: await 名id("列表客户3"), state: "活跃", enteredDay: 今天() } });
  };

  it("三态关着：没有状态列、没有回收状态筛选；地址栏带了 triState 也当没筛", async () => {
    await 造钟();
    const p = 参三((await 量()).el);
    expect(p.三态标).toBeUndefined();
    expect("triState" in p.filters).toBe(false);
    expect(参三((await 量({ triState: "沉睡" })).el).rows.length).toBe(6);
    // 关着：带关键词时 triState 不挡关键词快路（一条 SQL 出 id）；开着才退回老路
    const 快 = () => 以谁的身份(甲.id, () => 关键词分页({ keyword: "列表客户", triState: "沉睡" }, 1, 20));
    expect(await 快()).not.toBeNull();
    expect((await 量({ keyword: "列表客户", triState: "沉睡" })).句.length).toBe((await 量({ keyword: "列表客户" })).句.length);
    await 开三态();
    expect(await 快()).toBeNull();
  });

  it("开着：活跃不标；沉睡 / 待回收（带几天后进公海）/ 暂缓回收中；条数比关着多不超过 2 条、不随行数涨", async () => {
    await 造钟();
    const 关 = (await 量()).句.length;
    await 开三态();
    const 开 = await 量();
    const 按名三 = (p: 三态参) => Object.fromEntries(p.rows.map((r) => [r.name, p.三态标?.[r.id] ?? null]));
    const 们 = 按名三(参三(开.el));
    expect(们["列表客户0"]).toEqual({ 态: "沉睡" });
    expect(们["列表客户1"]).toEqual({ 态: "待回收", 几天后进公海: 20 });
    expect(们["列表客户2"]).toEqual({ 态: "暂缓回收中" });
    expect(们["列表客户3"]).toBeNull();
    expect(们["列表客户4"]).toBeNull();
    expect(参三(开.el).filters.triState).toBe("");
    expect(开.句.length - 关).toBeLessThanOrEqual(1);
    expect(开.句.length).toBeLessThanOrEqual(客户列表三态开着上限);
    // 内外贸进公海天数不同：多一句项目选套，外贸项目的客户按外贸那套算
    await 开三态({ 外贸: { 沉睡: 90, 待回收: 180, 进公海: 60 } });
    const c1 = await 名id("列表客户1");
    await prisma.project.updateMany({ where: { customerId: c1 }, data: { bizLine: "外贸" } });
    const 两套 = await 量();
    expect(参三(两套.el).三态标?.[c1]).toEqual({ 态: "待回收", 几天后进公海: 50 });
    if (process.env.TRI_QUERY_DUMP) (await import("node:fs")).appendFileSync(process.env.TRI_QUERY_DUMP, `客户列表 关 ${关} 开 ${开.句.length} 两套天数不同 ${两套.句.length}\n`);
    expect(两套.句.length - 关).toBeLessThanOrEqual(2);
    expect(两套.句.length).toBeLessThanOrEqual(客户列表三态开着上限);
    // 多 30 位待回收的客户：条数一样
    for (let i = 0; i < 30; i++) {
      const c = await prisma.customer.create({ data: { name: `加的待回收${i}`, phone: `1390000040${String(i).padStart(2, "0")}`, salesOwnerId: 甲.id } });
      await prisma.entCustomerClock.create({ data: { customerId: c.id, state: "待回收", enteredDay: 今天() } });
    }
    const 多 = await 量({ pageSize: "50" });
    expect(参三(多.el).rows.length).toBe(36);
    // 三态那几句（钟、选套取项目业务线）条数不随行数涨；整页别的句子随一页 50 行另有起伏（成员、设置读取，和三态无关）
    const 三态句 = (q: string[]) => q.filter((x) => x.includes("EntCustomerClock") || x.includes("`Project`.`bizLine` FROM")).length;
    expect(三态句(两套.句)).toBe(2);
    expect(三态句(多.句)).toBe(三态句(两套.句));
  });

  it("「N 天后进公海」同服务端排期：刚过进公海节点、3 次提醒没发够的不写「即将进公海」", async () => {
    await 开三态();
    const c1 = await 名id("列表客户1");
    // 进待回收 31 天（默认进公海间隔 30 天，提醒间隔 10 天），只发了 2 次、最近一次昨天：第 3 次排到昨天 + 10，再隔 10 天才进
    await prisma.entCustomerClock.create({ data: { customerId: c1, state: "待回收", enteredDay: 加天(今天(), -31), noticeCount: 2, lastNoticeDay: 加天(今天(), -1) } });
    const 标 = 参三((await 量()).el).三态标?.[c1];
    expect(标).toEqual({ 态: "待回收", 几天后进公海: 19 });
    expect(三态标字(标 as 三态标)).not.toContain("即将");
    // 一次没发（夜扫漏跑）：今天补第 1 次，进公海排到今天 + 30
    await prisma.entCustomerClock.update({ where: { customerId: c1 }, data: { noticeCount: 0, lastNoticeDay: null } });
    expect(参三((await 量()).el).三态标?.[c1]).toEqual({ 态: "待回收", 几天后进公海: 30 });
    // 3 次发够、最后一次 10 天前：今天就到（即将进公海）
    await prisma.entCustomerClock.update({ where: { customerId: c1 }, data: { noticeCount: 3, lastNoticeDay: 加天(今天(), -10) } });
    const 到 = 参三((await 量()).el).三态标?.[c1] as 三态标;
    expect(到).toEqual({ 态: "待回收", 几天后进公海: 0 });
    expect(三态标字(到)).toContain("即将进公海");
  });

  it("负责人是市场成员的写「不计时」，不看钟；回收状态筛选四个值都对；导出、AI 白名单认 triState", async () => {
    await 造钟();
    await 开三态();
    const 小市 = await 造人("xs2", "channel_ops");
    await setSetting(市场成员key, [小市.id]);
    忘掉企业版范围();
    const 市场的 = await prisma.customer.create({ data: { name: "市场名下客户", phone: "13900000500", salesOwnerId: 小市.id } });
    // 钟停在沉睡（换到市场成员名下以后夜扫不再写）：照样写不计时，也不进「沉睡」筛选
    await prisma.entCustomerClock.create({ data: { customerId: 市场的.id, state: "沉睡", enteredDay: 今天() } });
    // 经理能看到全部门下的；用系统管理员看全量省事：直接按甲 + 市场名下的各看各的
    const 管 = await 造人("gl", "director");
    const 全 = 参三((await 量({}, 管)).el);
    expect(全.三态标?.[市场的.id]).toEqual({ 态: "不计时" });
    const 筛 = async (v: string) => 参三((await 量({ triState: v }, 管)).el).rows.map((r) => r.name).sort();
    expect(await 筛("沉睡")).toEqual(["列表客户0"]);
    expect(await 筛("待回收")).toEqual(["列表客户1"]);
    expect(await 筛("暂缓回收中")).toEqual(["列表客户2"]);
    expect(await 筛("不计时")).toEqual(["市场名下客户"]);
    expect(await 筛("乱写的")).toHaveLength(7);
    expect(收客户页面筛选({ triState: "沉睡" })).toEqual({ triState: "沉睡" });
    // 导出走同一份条件（customers/export-action.ts 客户筛选条件）
    const w = await 以谁的身份(管.id, () => 客户筛选条件({ triState: "待回收" }));
    expect((await prisma.customer.findMany({ where: w, select: { name: true } })).map((c) => c.name)).toEqual(["列表客户1"]);
  });

  it("客户页看板：沉睡 / 待回收 / 暂缓回收中的客户给色点，活跃不给；三态关着不给、条数不变", async () => {
    await 造钟();
    mocks.看法 = "board";
    type 看板参三 = { 三态点?: Record<string, { 态: string }> };
    const 点of = (el: unknown) => ((参数(el) as unknown as { 看板体?: { props: 看板参三 } }).看板体)?.props.三态点;
    const 关 = await 量();
    expect(点of(关.el)).toBeUndefined();
    await 开三态();
    const 开 = await 量();
    const 点 = 点of(开.el)!;
    expect(点[await 名id("列表客户1")]).toEqual({ 态: "待回收", 几天后进公海: 20 });
    expect(点[await 名id("列表客户2")]).toEqual({ 态: "暂缓回收中" });
    expect(点[await 名id("列表客户3")]).toBeUndefined();
    if (process.env.TRI_QUERY_DUMP) (await import("node:fs")).appendFileSync(process.env.TRI_QUERY_DUMP, `客户页看板 关 ${关.句.length} 开 ${开.句.length}\n`);
    expect(开.句.length - 关.句.length).toBeLessThanOrEqual(2);
    expect(开.句.length).toBeLessThanOrEqual(客户页看板查询上限 + 2);
  });
});
