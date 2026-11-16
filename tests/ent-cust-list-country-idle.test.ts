/**
 * 客户列表员工反馈第 1 批（11-16）：
 *   1C 企业版国家筛选按客户地址里的国家（Customer.addrCountry，列表「国家」一列那一格）；下拉只给看得到的客户里真有的。
 *   1I「超过 N 天没跟进」筛选（从没跟进过的按建档时间算）+ 按最近跟进排（正序 = 最久没跟进的在前，从没跟进过的最前）。
 * 只收窄这个人本来看得到的（按组织看的销售看不到同事的客户），公海里的照旧不进「客户」页签（P-看-03）。
 * 打开页面的量法同 tests/ent-customer-list-queries.test.ts：CustomersView 换成空的，拿它收到的 props 看
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
  在请求: false,
}));
vi.mock("next/headers", async (原) => ({
  ...(await 原<object>()),
  cookies: async () => {
    if (!mocks.在请求) throw new Error("不在请求里");
    return { get: () => undefined };
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
import { 久未跟进条件, 久未跟进天数 } from "@/app/(app)/customers/query";
import { dayjs } from "@/lib/utils";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string, managerId: string | null = null): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId } });
  return { id: u.id, name: key, email, role: "SALES", title: "", avatar: null };
};
type 视图参数 = { rows: { id: string; name: string; addrCountry: string | null }[]; total: number; filters: Record<string, string>; 国家们: string[] };

async function 打开(sp: Record<string, string>, 谁: 人): Promise<视图参数> {
  mocks.user = { ...谁 };
  mocks.在请求 = true;
  try {
    const el = await 以谁的身份(谁.id, () => (CustomersPage as (a: never) => Promise<unknown>)({ searchParams: Promise.resolve(sp) } as never));
    return (el as { props: 视图参数 }).props;
  } finally { mocks.在请求 = false; }
}
const 名们 = (p: 视图参数) => p.rows.map((r) => r.name).sort();

let 甲: 人, 乙: 人;
let 号 = 0;
const 客户 = (name: string, salesOwnerId: string, data: Record<string, unknown> = {}) =>
  prisma.customer.create({ data: { name, salesOwnerId, phone: `1390000${String(++号).padStart(4, "0")}`, ...data } });

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  await setSetting("enterprise.rule.org_scope", true);
  甲 = await 造人("jia", "sales");
  乙 = await 造人("yi", "sales");
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

describe("1C 企业版国家筛选", () => {
  beforeEach(async () => {
    await 客户("阿联酋甲一", 甲.id, { addrCountry: "阿联酋" });
    await 客户("阿联酋甲二", 甲.id, { addrCountry: "阿联酋" });
    await 客户("越南甲", 甲.id, { addrCountry: "越南" });
    await 客户("没填国家甲", 甲.id);
    // 外贸档案里写着阿联酋、客户地址没填：企业版不按档案的国家筛
    const 档案 = await 客户("只有档案国家甲", 甲.id);
    await prisma.customerExtra.create({ data: { customerId: 档案.id, country: "阿联酋" } });
    // 同事的、公海里的：甲本来就看不到 / 不在客户页签，筛了国家也不该冒出来
    await 客户("阿联酋乙", 乙.id, { addrCountry: "阿联酋" });
    const 公海 = await 客户("阿联酋公海", 甲.id, { addrCountry: "阿联酋" });
    await prisma.customerPool.create({ data: { customerId: 公海.id } });
    // 乙才有的国家：甲的下拉里不给
    await 客户("沙特乙", 乙.id, { addrCountry: "沙特" });
    // 只有公海里的客户才有的国家：甲在「客户」页签里筛不出任何人，下拉里也不给（公海人人看得到，但不进客户页签）
    const 公海巴西 = await 客户("巴西公海", 甲.id, { addrCountry: "巴西" });
    await prisma.customerPool.create({ data: { customerId: 公海巴西.id } });
    const 别人公海 = await 客户("智利公海", 乙.id, { addrCountry: "智利" });
    await prisma.customerPool.create({ data: { customerId: 别人公海.id } });
  });

  it("按客户地址里的国家筛：只出甲自己负责、不在公海的；外贸档案的国家不算", async () => {
    const p = await 打开({ country: "阿联酋" }, 甲);
    expect(名们(p)).toEqual(["阿联酋甲一", "阿联酋甲二"]);
    expect(p.total).toBe(2);
    expect(p.filters.country).toBe("阿联酋");
  });

  it("不筛国家时范围不变：甲看到自己负责、不在公海的 5 位（含没填国家的）", async () => {
    const p = await 打开({}, 甲);
    expect(名们(p)).toEqual(["只有档案国家甲", "没填国家甲", "越南甲", "阿联酋甲一", "阿联酋甲二"].sort());
  });

  it("带关键词（关键词快路）也按国家筛", async () => {
    const p = await 打开({ keyword: "甲", country: "越南" }, 甲);
    expect(名们(p)).toEqual(["越南甲"]);
  });

  it("国家下拉 = 甲看得到的客户里真有的国家（同事才有的不给）", async () => {
    const p = await 打开({}, 甲);
    expect(p.国家们).toContain("阿联酋");
    expect(p.国家们).toContain("越南");
    expect(p.国家们).not.toContain("沙特");
  });

  it("国家下拉和客户页签同一个范围：只在公海里出现的国家不给（选了是 0 条）", async () => {
    const p = await 打开({}, 甲);
    expect(p.国家们).toEqual(["越南", "阿联酋"].sort());
    expect((await 打开({ country: "巴西" }, 甲)).total).toBe(0);
  });
});

describe("1I 超过 N 天没跟进 + 按最近跟进排", () => {
  /** 今天北京 0 点往前 d 天，再挪 分 分钟 */
  const 前 = (d: number, 分 = 0) => dayjs().startOf("day").subtract(d, "day").add(分, "minute").toDate();
  beforeEach(async () => {
    await 客户("90天前跟进", 甲.id, { lastFollowAt: 前(90, 600), createdAt: 前(400) });
    await 客户("31天前跟进", 甲.id, { lastFollowAt: 前(31, 600), createdAt: 前(400) });
    // 边界：N = 30 时「30 天前那天」跟进过的不算超过 30 天；前一天深夜的算
    await 客户("正好30天前跟进", 甲.id, { lastFollowAt: 前(30, 1), createdAt: 前(400) });
    await 客户("30天前前一刻跟进", 甲.id, { lastFollowAt: 前(30, -1), createdAt: 前(400) });
    await 客户("昨天跟进", 甲.id, { lastFollowAt: 前(1, 600), createdAt: 前(400) });
    // 从没跟进过：按建档时间算
    await 客户("从没跟进老客户", 甲.id, { createdAt: 前(40) });
    await 客户("从没跟进更老客户", 甲.id, { createdAt: 前(200) });
    await 客户("从没跟进新客户", 甲.id, { createdAt: 前(2) });
    // 同事的、公海里的：再久没跟进也不进甲的客户页签
    await 客户("同事的久未跟进", 乙.id, { lastFollowAt: 前(300), createdAt: 前(400) });
    const 公海 = await 客户("公海久未跟进", 甲.id, { lastFollowAt: 前(300), createdAt: 前(400) });
    await prisma.customerPool.create({ data: { customerId: 公海.id } });
  });

  it("天数只认 1–3650 的整数；口径：早于今天往前 N 天的 0 点，从没跟进过的按建档时间", () => {
    expect(["1", "30", "3650"].map(久未跟进天数)).toEqual([1, 30, 3650]);
    expect(["", "0", "-3", "1.5", "abc", "3651", "99999", undefined].map((x) => 久未跟进天数(x))).toEqual(Array(8).fill(null));
    const 今 = new Date("2026-11-16T15:00:00+08:00");
    expect(久未跟进条件("30", 今)).toEqual({ OR: [{ lastFollowAt: { lt: new Date("2026-10-17T00:00:00+08:00") } }, { lastFollowAt: null, createdAt: { lt: new Date("2026-10-17T00:00:00+08:00") } }] });
    expect(久未跟进条件("x", 今)).toBeNull();
  });

  it("超过 30 天没跟进：只出甲自己负责、不在公海、30 天前那天之前跟进的和建档早于那天还没跟进过的", async () => {
    const p = await 打开({ idleDays: "30" }, 甲);
    expect(名们(p)).toEqual(["90天前跟进", "31天前跟进", "30天前前一刻跟进", "从没跟进老客户", "从没跟进更老客户"].sort());
    expect(p.total).toBe(5);
    expect(p.filters.idleDays).toBe("30");
  });

  it("带关键词（关键词快路）也按天数筛；认不得的天数当没筛（范围不变）", async () => {
    expect(名们(await 打开({ keyword: "跟进", idleDays: "60" }, 甲))).toEqual(["90天前跟进", "从没跟进更老客户"].sort());
    for (const idleDays of ["0", "abc", "99999"]) expect((await 打开({ idleDays }, 甲)).total, idleDays).toBe(8);
  });

  it("按最近跟进正序：从没跟进过的最前（建档早的在前），再从最久没跟进的往近排；倒序反过来", async () => {
    const 正 = (await 打开({ sort: "follow-asc" }, 甲)).rows.map((r) => r.name);
    expect(正).toEqual(["从没跟进更老客户", "从没跟进老客户", "从没跟进新客户", "90天前跟进", "31天前跟进", "30天前前一刻跟进", "正好30天前跟进", "昨天跟进"]);
    const 倒 = (await 打开({ sort: "follow-desc" }, 甲)).rows.map((r) => r.name);
    expect(倒).toEqual(["昨天跟进", "正好30天前跟进", "30天前前一刻跟进", "31天前跟进", "90天前跟进", "从没跟进新客户", "从没跟进老客户", "从没跟进更老客户"]);
  });

  it("筛选 + 正序一起用：只排筛出来的那些，从没跟进过的在前", async () => {
    const 一 = (await 打开({ idleDays: "30", sort: "follow-asc", pageSize: "10" }, 甲)).rows.map((r) => r.name);
    expect(一).toEqual(["从没跟进更老客户", "从没跟进老客户", "90天前跟进", "31天前跟进", "30天前前一刻跟进"]);
  });
});
