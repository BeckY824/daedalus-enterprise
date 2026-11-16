/**
 * 客户列表员工反馈第 1 批（11-16）：
 *   1C 企业版国家筛选按客户地址里的国家（Customer.addrCountry，列表「国家」一列那一格）；下拉只给看得到的客户里真有的。
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
});
