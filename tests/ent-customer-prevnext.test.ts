/**
 * 客户详情「上一条 / 下一条」（E-332）：相邻两位和进来前那张客户列表同一个顺序（筛选、排序、跨页），只在看得到的客户里走。
 * 钉的是：
 *   - 路由 GET /api/customers/adjacent 给的上一位 / 下一位 = 列表页（customers/page.tsx）同一地址上那一页的前后两行；页头 / 页尾跨到上一页末位 / 下一页首位
 *   - 第一条没有上一位、最后一条没有下一位（界面上那颗灰着）
 *   - 可见范围走限定层：别人的客户不进相邻、拿别人的客户 id 来问 = null
 *   - 看板视图、不是客户列表的地址、这一位不在那一页 = null（详情页不摆箭头）
 *   - lib/list-return.ts 定详情来源：只认从客户列表进来、按箭头换过来、刷新 / 后退回来的
 *   - 带关键词、默认排序：相邻走 关键词分页 那条快路，顺序和它给的 ids 逐位一致（PR #492 审查必改 1）
 *   - 地址上的页码越界（page=99）：照列表页钳到末页，跨页页码从末页往前推（必改 2）
 * 箭头的样子（电脑 / 手机 390、到头置灰）见 tests/ent-customer-prevnext.ui.test.ts
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
  看法: "" as string,
  在请求: false,
  /** 关键词分页 接住了几次、客户筛选条件（老路）拼了几次：看相邻走的哪条路 */
  计数: { 快: 0, 老: 0 },
}));
// 只在问的那一下像在请求里（造数据、清库时照真的一样抛，限定层靠它认出是测试自己）
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
  return {
    ...m,
    关键词分页: async (...a: Parameters<typeof m.关键词分页>) => { const r = await m.关键词分页(...a); if (r) mocks.计数.快++; return r; },
    客户筛选条件: async (...a: Parameters<typeof m.客户筛选条件>) => { mocks.计数.老++; return m.客户筛选条件(...a); },
  };
});
vi.mock("@/app/(app)/customers/CustomersView", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/HandoverPending", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import CustomersPage from "@/app/(app)/customers/page";
import { NextRequest } from "next/server";
import { GET as 相邻路由 } from "@/app/api/customers/adjacent/route";
import { 找相邻, 查询串of, 每页条数, type 相邻 } from "@/app/(app)/customers/[id]/adjacent";
import { 客户排序, 关键词分页 } from "@/app/(app)/customers/query";
import { 生效客户范围 } from "@/lib/enterprise/customer-scope";
import { 定详情来源, 读详情来源, 记详情来源, 清详情来源 } from "@/lib/list-return";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole } });
  return { id: u.id, name: key, email, role: "SALES", title: "", avatar: null };
};

let 甲: 人, 乙: 人;
const 等级 = ["A", "B", "C", "D", null];
beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  mocks.看法 = "";
  await resetDb();
  invalidateSettingsCache();
  await setSetting("enterprise.rule.org_scope", true);
  甲 = await 造人("jia", "sales");
  乙 = await 造人("yi", "sales");
  const 起 = Date.UTC(2026, 9, 1);
  // 甲 25 位（建档时间各不相同、等级轮着来、一半跟进过）；乙 5 位夹在中间：甲看不到，不能出现在甲的相邻里
  for (let i = 0; i < 30; i++) {
    const 乙的 = i % 6 === 3;
    const c = await prisma.customer.create({
      data: {
        name: `相邻客户${String(i).padStart(2, "0")}`, phone: `1390000${String(2000 + i)}`, salesOwnerId: 乙的 ? 乙.id : 甲.id,
        createdAt: new Date(起 + i * 3600_000), lastFollowAt: i % 2 ? new Date(起 + (40 - i) * 3600_000) : null,
      },
    });
    const lv = 等级[i % 5];
    if (lv) await prisma.customerExtra.upsert({ where: { customerId: c.id }, create: { customerId: c.id, level: lv }, update: { level: lv } });
  }
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

/** 照详情页那样调路由（id + 列表地址 + 这一位在第几页），回 JSON 体 */
const 相邻客户 = async (来源: { href: string; page: number }, id: string): Promise<相邻 | null> => {
  const r = await 相邻路由(new NextRequest(`http://t/api/customers/adjacent?${new URLSearchParams({ id, href: 来源.href, page: String(来源.page) })}`));
  expect(r.status).toBe(200);
  return (await r.json()) as 相邻 | null;
};

const 在请求里 = async <T,>(谁: 人, fn: () => Promise<T>): Promise<T> => {
  mocks.user = { ...谁 };
  mocks.在请求 = true;
  try { return await 以谁的身份(谁.id, fn); } finally { mocks.在请求 = false; }
};

/** 列表页这一地址上这一页的行 id（真 customers/page.tsx 交给 CustomersView 的 rows） */
async function 列表页ids(谁: 人, href: string): Promise<string[]> {
  const sp = 查询串of(href);
  const el = await 在请求里(谁, () => (CustomersPage as (a: never) => Promise<unknown>)({ searchParams: Promise.resolve(sp) } as never));
  return ((el as { props: { rows: { id: string }[] } }).props.rows).map((r) => r.id);
}

/** 按列表把整张表摊平（每页 10 条翻到底），再逐位问 相邻客户：每一位的上 / 下都得是摊平后的前后那位 */
async function 逐位核对(谁: 人, 查询: string) {
  const 全: { id: string; page: number }[] = [];
  for (let p = 1; p < 10; p++) {
    const href = `/customers?${查询}${查询 ? "&" : ""}pageSize=10&page=${p}`;
    const ids = await 列表页ids(谁, href);
    if (!ids.length || (全.length && ids[0] === 全[0].id)) break;
    全.push(...ids.map((id) => ({ id, page: p })));
    if (ids.length < 10) break;
  }
  expect(全.length).toBeGreaterThan(1);
  for (let i = 0; i < 全.length; i++) {
    const { id, page } = 全[i];
    const 邻 = await 在请求里(谁, () => 相邻客户({ href: `/customers?${查询}${查询 ? "&" : ""}pageSize=10&page=${page}`, page }, id));
    expect(邻, `第 ${i} 位`).toEqual({ 上: 全[i - 1] ?? null, 下: 全[i + 1] ?? null });
  }
  return 全;
}

describe("相邻两位 = 列表同一顺序", () => {
  it("默认排序（建档新的在前）：逐位和列表页一样；跨页接得上；第一条没有上、最后一条没有下；乙的客户不在里头", async () => {
    const 全 = await 逐位核对(甲, "");
    expect(全.length).toBe(25);
    const 乙的 = new Set((await prisma.customer.findMany({ where: { salesOwnerId: 乙.id }, select: { id: true } })).map((c) => c.id));
    expect(全.some((x) => 乙的.has(x.id))).toBe(false);
  });

  it("按等级排 + 筛等级：和筛过、排过的列表一样", async () => {
    expect((await 逐位核对(甲, "sort=level-desc")).length).toBe(25);
    const 筛 = await 逐位核对(甲, "sort=follow-asc&level=C");
    expect(筛.length).toBeLessThan(25);
  });

  it("带关键词、默认排序（列表页走关键词分页那条快路）：和列表一样", async () => {
    const 筛 = await 逐位核对(甲, `keyword=${encodeURIComponent("相邻客户1")}`);
    expect(筛.length).toBeLessThan(25);
  });

  it("按建档旧的在前：和列表一样", async () => {
    await 逐位核对(甲, "sort=created-asc");
  });

  it("按金额（高的在前 / 低的在前，含金额相同的并列）：逐位和列表页一样", async () => {
    const 甲的 = await prisma.customer.findMany({ where: { salesOwnerId: 甲.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
    // 一半有签约（几位金额相同），一半 0：并列的按建档新的在前
    for (let i = 0; i < 甲的.length; i += 2) await prisma.contract.create({ data: { customerId: 甲的[i].id, amount: 1000 * (i % 3), signedAt: new Date() } });
    expect((await 逐位核对(甲, "sort=amount-desc")).length).toBe(25);
    expect((await 逐位核对(甲, "sort=amount-asc")).length).toBe(25);
  });

  it("按最近跟进（含 lastFollowAt 为空的并列）：两个方向都逐位和列表页一样", async () => {
    const 新到旧 = await 逐位核对(甲, "sort=follow-desc");
    expect(新到旧.length).toBe(25);
    const 旧到新 = await 逐位核对(甲, "sort=follow-asc");
    expect(旧到新.length).toBe(25);
    // 空的那一截真有并列（不然没测到 nulls first / last 和建档时间兜底）
    const 没跟进 = await prisma.customer.count({ where: { salesOwnerId: 甲.id, lastFollowAt: null } });
    expect(没跟进).toBeGreaterThan(1);
  });
});

describe("关键词快路、越界页（PR #492 审查）", () => {
  it("带关键词、默认排序：相邻的顺序和 关键词分页 给的 ids 逐位一致（跨页也是）", async () => {
    const 词 = "相邻客户";
    const 全: { id: string; page: number }[] = [];
    for (let p = 1; p <= 3; p++) {
      const 快 = await 在请求里(甲, () => 关键词分页({ keyword: 词, scope: 生效客户范围(undefined, false) }, p, 10));
      expect(快, "甲这张列表接得住快路").not.toBeNull();
      expect(快!.page).toBe(p);
      全.push(...快!.ids.map((id) => ({ id, page: p })));
    }
    expect(全.length).toBe(25);
    // 相邻走的是快路：每次都是 关键词分页 接住，一次也没拼老路的 客户筛选条件（它里头那遍不限范围的 GLOB 就是慢的来源）
    mocks.计数 = { 快: 0, 老: 0 };
    for (let i = 0; i < 全.length; i++) {
      const { id, page } = 全[i];
      const 邻 = await 在请求里(甲, () => 相邻客户({ href: `/customers?keyword=${encodeURIComponent(词)}&pageSize=10&page=${page}`, page }, id));
      expect(邻, `第 ${i} 位`).toEqual({ 上: 全[i - 1] ?? null, 下: 全[i + 1] ?? null });
    }
    expect(mocks.计数.快).toBeGreaterThanOrEqual(全.length);
    expect(mocks.计数.老).toBe(0);
  });

  it("page=99：拿到末页的相邻，跨页页码从末页往前推（默认、关键词快路、按金额、按等级各一遍）", async () => {
    for (const 查询 of ["", `keyword=${encodeURIComponent("相邻客户")}&`, "sort=amount-desc&", "sort=level-desc&"]) {
      const 越界 = `/customers?${查询}pageSize=10&page=99`;
      // 列表页自己钳到第 3 页（25 位每页 10）
      const 末页 = await 列表页ids(甲, 越界);
      expect(末页, 查询).toEqual(await 列表页ids(甲, `/customers?${查询}pageSize=10&page=3`));
      expect(末页.length, 查询).toBe(5);
      const 第二页 = await 列表页ids(甲, `/customers?${查询}pageSize=10&page=2`);
      const 头 = await 在请求里(甲, () => 相邻客户({ href: 越界, page: 99 }, 末页[0]));
      expect(头, 查询).toEqual({ 上: { id: 第二页[9], page: 2 }, 下: { id: 末页[1], page: 3 } });
      const 尾 = await 在请求里(甲, () => 相邻客户({ href: 越界, page: 99 }, 末页[4]));
      expect(尾, 查询).toEqual({ 上: { id: 末页[3], page: 3 }, 下: null });
    }
  });
});

describe("看不到、对不上的不摆", () => {
  it("拿乙的客户 id 来问（甲看不到）：null；乙自己问自己的那张列表只在乙的客户里走", async () => {
    const 乙的 = await prisma.customer.findFirstOrThrow({ where: { salesOwnerId: 乙.id }, select: { id: true } });
    expect(await 在请求里(甲, () => 相邻客户({ href: "/customers", page: 1 }, 乙的.id))).toBeNull();
    // 地址上写「我可见的」（销售没有管理范围，列表页照样收回「我负责的」）：还是看不到
    expect(await 在请求里(甲, () => 相邻客户({ href: "/customers?scope=visible", page: 1 }, 乙的.id))).toBeNull();
    const 邻 = await 在请求里(乙, () => 相邻客户({ href: "/customers", page: 1 }, 乙的.id));
    const 乙ids = new Set((await prisma.customer.findMany({ where: { salesOwnerId: 乙.id }, select: { id: true } })).map((c) => c.id));
    for (const x of [邻?.上, 邻?.下]) if (x) expect(乙ids.has(x.id)).toBe(true);
  });

  it("看板视图、不是客户列表的地址、这一位不在那一页：null", async () => {
    const ids = await 列表页ids(甲, "/customers");
    mocks.看法 = "board";
    expect(await 在请求里(甲, () => 相邻客户({ href: "/customers", page: 1 }, ids[1]))).toBeNull();
    mocks.看法 = "";
    expect(await 在请求里(甲, () => 相邻客户({ href: "/pool", page: 1 }, ids[1]))).toBeNull();
    expect(await 在请求里(甲, () => 相邻客户({ href: "/projects", page: 1 }, ids[1]))).toBeNull();
    expect(await 在请求里(甲, () => 相邻客户({ href: "/customers", page: 2 }, ids[1]))).toBeNull();
    expect(await 在请求里(甲, () => 相邻客户({ href: "/customers", page: 1 }, "没有这位"))).toBeNull();
  });

  it("路由：没登录 401；缺参数、page 乱写当第 1 页", async () => {
    const ids = await 列表页ids(甲, "/customers");
    const 问 = (q: string) => 相邻路由(new NextRequest(`http://t/api/customers/adjacent?${q}`));
    mocks.user = null as unknown as typeof mocks.user;
    expect((await 问(`id=${ids[1]}&href=%2Fcustomers&page=1`)).status).toBe(401);
    mocks.user = { ...甲 };
    mocks.在请求 = true;
    try {
      expect(await (await 以谁的身份(甲.id, () => 问("href=%2Fcustomers"))).json()).toBeNull();
      const 乱 = await (await 以谁的身份(甲.id, () => 问(`id=${ids[1]}&href=%2Fcustomers&page=abc`))).json();
      expect(乱).toEqual({ 上: { id: ids[0], page: 1 }, 下: { id: ids[2], page: 1 } });
    } finally { mocks.在请求 = false; }
  });
});

describe("纯函数", () => {
  it("找相邻：只在头尾才多取一页", async () => {
    const 页们: Record<number, string[]> = { 1: ["a", "b", "c"], 2: ["d", "e", "f"], 3: ["g"] };
    const 取了: number[] = [];
    const 取页 = async (p: number) => { 取了.push(p); return { ids: 页们[p] ?? [], 还有下页: p < 3 }; };
    expect(await 找相邻("b", 1, 取页)).toEqual({ 上: { id: "a", page: 1 }, 下: { id: "c", page: 1 } });
    expect(取了).toEqual([1]);
    取了.length = 0;
    expect(await 找相邻("d", 2, 取页)).toEqual({ 上: { id: "c", page: 1 }, 下: { id: "e", page: 2 } });
    expect(取了.sort()).toEqual([1, 2]);
    expect(await 找相邻("a", 1, 取页)).toEqual({ 上: null, 下: { id: "b", page: 1 } });
    expect(await 找相邻("g", 3, 取页)).toEqual({ 上: { id: "f", page: 2 }, 下: null });
    expect(await 找相邻("z", 1, 取页)).toBeNull();
  });

  it("找相邻：取页钳了页码（越界）就从钳过的那页往前后推", async () => {
    const 页们: Record<number, string[]> = { 1: ["a", "b"], 2: ["c", "d"] };
    const 取了: number[] = [];
    const 取页 = async (p: number) => { 取了.push(p); const page = Math.min(p, 2); return { ids: 页们[page], 还有下页: page < 2, page }; };
    expect(await 找相邻("c", 99, 取页)).toEqual({ 上: { id: "b", page: 1 }, 下: { id: "d", page: 2 } });
    expect(取了.sort((x, y) => x - y)).toEqual([1, 99]);
    expect(await 找相邻("d", 99, 取页)).toEqual({ 上: { id: "c", page: 2 }, 下: null });
  });

  it("客户排序：金额另走；默认、等级、跟进、建档各一份；每页条数照列表 10–100", () => {
    expect(客户排序("amount-desc")).toEqual({ 金额: "amount-desc" });
    expect(客户排序(undefined)).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(客户排序("created-asc")).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
    expect(Array.isArray(客户排序("level-asc"))).toBe(true);
    expect(每页条数(undefined)).toBe(20);
    expect(每页条数("5")).toBe(10);
    expect(每页条数("500")).toBe(100);
    expect(查询串of("/customers?a=1&a=2&b=%E4%B8%AD")).toEqual({ a: "1", b: "中" });
  });

  it("定详情来源：从客户列表进来新记；从详情（按箭头）、刷新 / 后退只认记过的；别处进来不算", () => {
    const 地址们 = { 客户: "/customers?sort=level-desc&page=3" };
    const 新 = 定详情来源("c1", { 从: "/customers", 刷新或后退: false }, null, 地址们);
    expect(新).toEqual({ href: "/customers?sort=level-desc&page=3", 位: { c1: 3 } });
    const 记的 = { href: 新!.href, 位: { c1: 3, c2: 4 } };
    expect(定详情来源("c2", { 从: "/customers/c1", 刷新或后退: false }, 记的, 地址们)).toBe(记的);
    expect(定详情来源("c2", { 从: null, 刷新或后退: true }, 记的, 地址们)).toBe(记的);
    expect(定详情来源("c2", { 从: "/projects/p1", 刷新或后退: true }, 记的, 地址们)).toBe(记的);
    // 记的里没有这位：从详情里点到了别的客户（关联客户之类）
    expect(定详情来源("c9", { 从: "/customers/c1", 刷新或后退: false }, 记的, 地址们)).toBeNull();
    // 公海、项目、首页、新开的链接
    for (const 从 of ["/pool", "/projects", "/projects/p1", "/dashboard", null]) expect(定详情来源("c2", { 从, 刷新或后退: false }, 记的, 地址们)).toBeNull();
    // 没记过客户列表地址：第 1 页的默认地址
    expect(定详情来源("c1", { 从: "/customers", 刷新或后退: false }, null, {})).toEqual({ href: "/customers", 位: { c1: 1 } });
  });

  it("记 / 读 / 清详情来源：坏数据当没记；位 最多留 300 位", () => {
    清详情来源();
    expect(读详情来源()).toBeNull();
    记详情来源({ href: "/customers?page=2", 位: { a: 2, b: 0 as number, c: 1.5 as number } });
    expect(读详情来源()).toEqual({ href: "/customers?page=2", 位: { a: 2 } });
    记详情来源({ href: "/pool", 位: { a: 1 } });
    expect(读详情来源()).toBeNull();
    记详情来源({ href: "/customers", 位: Object.fromEntries(Array.from({ length: 320 }, (_, i) => [`k${i}`, 1])) });
    const 位 = 读详情来源()!.位;
    expect(Object.keys(位).length).toBe(300);
    expect(位.k319).toBe(1);
    expect(位.k0).toBeUndefined();
    清详情来源();
    expect(读详情来源()).toBeNull();
  });
});
