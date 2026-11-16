/**
 * 首页 AI 找客户 / 项目 / 跟进的默认范围（反馈第 1 批 1B；P-看-03：个人视角含首页只算自己负责的，公海只在公海页签出现）。
 *
 * 以前 search_customers 不传 mine 就是「限定层看得到的全部」：业务员 = 名下 + 公海 + 组员项目的客户，
 * 一张名单混着列，负责人一栏写「公海」也照列——业务员在首页问 AI，看到了不是自己的客户。
 * 钉的是：
 * - 首页 / 别的页（没有客户页筛选）默认只给我负责的，另有多少位看得到但不归我负责的只给个数；
 * - scope=team = 客户列表「客户」页签那一圈（限定层 ∧ 不在公海），每行标归属，我负责的排前面；
 * - scope=pool / 在公海页 才出公海客户；
 * - 在客户页（带页面筛选）跟页面走：页面的页签自己定含不含公海；
 * - 销售管理、总管理各按自己的限定层（下属的标「同事或下属负责的」）；
 * - list_projects、search_followups、query_records 客户表默认不带公海；find_person 撞到公海客户标「公海」，不写原负责人。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { TOOLS } from "@/lib/agent/tools";
import { DEFAULT_BUSINESS } from "@/lib/business-config";

type 人 = { id: string; name: string };
let 总管: 人, 经理: 人, 乙: 人, 丙: 人;
const id: Record<string, string> = {};

async function 造人(email: string, name: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } });
  return { id: u.id, name: u.name };
}
let 序 = 0;
async function 客户(name: string, ownerId: string, 公海 = false) {
  const c = await prisma.customer.create({ data: { name, phone: `1390000${String(++序).padStart(4, "0")}`, salesOwnerId: ownerId } });
  if (公海) await prisma.customerPool.create({ data: { customerId: c.id } });
  id[name] = c.id;
  return c.id;
}

const 跑 = (工具: string, args: Record<string, unknown>, me: 人, 补: Record<string, unknown> = {}) =>
  以谁的身份(me.id, () =>
    TOOLS.find((t) => t.name === 工具)!.run(args, { userId: me.id, userName: me.name, b: { ...DEFAULT_BUSINESS, projectMode: true }, recordOffset: 0, proposals: [], ...补 } as never),
  );
type 行 = { id: string; name: string; owner: string; 归属: string };
const 名单 = (r: { data?: unknown }) => ((r.data as { customers: 行[] }).customers ?? []);
const 名字们 = (r: { data?: unknown }) => 名单(r).map((c) => c.name).sort();

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("dir", "总管");
  经理 = await 造人("mgr", "经理");
  乙 = await 造人("yi", "乙");
  丙 = await 造人("bing", "丙");
  await prisma.entMember.createMany({
    data: [
      { userId: 总管.id, bizRole: "director" },
      { userId: 经理.id, bizRole: "sales_mgr" },
      { userId: 乙.id, bizRole: "sales", managerId: 经理.id },
      { userId: 丙.id, bizRole: "sales", managerId: 经理.id },
    ],
  });
  await setSetting("business", { projectMode: true });
  await setSetting(规则.按组织看客户.key, true);
  invalidateSettingsCache();
  忘掉企业版范围();
  // 名字都带「客户」，按关键词「客户」一搜全中
  await 客户("乙的客户A", 乙.id);
  await 客户("乙的客户B", 乙.id);
  await 客户("丙的客户", 丙.id);
  await 客户("经理的客户", 经理.id);
  await 客户("公海客户甲", 丙.id, true); // 原负责人丙，进了公海
  await 客户("公海客户乙", 总管.id, true);
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("search_customers 默认范围（P-看-03）", () => {
  it("业务员在首页问：只给我负责的，不混公海；另有看得到的只给个数", async () => {
    const r = await 跑("search_customers", { query: "客户" }, 乙);
    expect(名字们(r)).toEqual(["乙的客户A", "乙的客户B"]);
    expect(名单(r).every((c) => c.归属 === "我负责的")).toBe(true);
    expect(JSON.stringify(r.data)).not.toContain("公海客户");
    expect(JSON.stringify(r.data)).not.toContain("丙的客户");
    expect((r.data as { total: number }).total).toBe(2);
  });

  it("业务员是同事项目的组员：那位客户看得到，但默认不算我的，只报个数；scope=team 才列出并标归属", async () => {
    const p = await prisma.project.create({ data: { name: "丙的项目", customerId: id["丙的客户"], ownerId: 丙.id, creatorId: 丙.id, phase: "商机", node: "明确需求" } });
    await prisma.projectMember.create({ data: { projectId: p.id, userId: 乙.id, inviteStatus: "JOINED" } });
    忘掉企业版范围();
    const 默认 = await 跑("search_customers", { query: "客户" }, 乙);
    expect(名字们(默认)).toEqual(["乙的客户A", "乙的客户B"]);
    expect((默认.data as { 另有?: number }).另有).toBe(1);

    const 团队 = await 跑("search_customers", { query: "客户", scope: "team" }, 乙);
    expect(名单(团队).map((c) => c.name)).toEqual(expect.arrayContaining(["乙的客户A", "乙的客户B", "丙的客户"]));
    expect(名单(团队)).toHaveLength(3);
    // 我负责的排前面，别人的标出来
    expect(名单(团队).slice(0, 2).every((c) => c.归属 === "我负责的")).toBe(true);
    expect(名单(团队)[2]).toMatchObject({ name: "丙的客户", 归属: "同事或下属负责的" });
    expect(JSON.stringify(团队.data)).not.toContain("公海客户");
  });

  it("老参数 mine=true 照旧只给我负责的", async () => {
    const r = await 跑("search_customers", { mine: true }, 乙);
    expect(名字们(r)).toEqual(["乙的客户A", "乙的客户B"]);
  });

  it("scope=pool 才出公海客户，负责人写「公海」不写原负责人", async () => {
    const r = await 跑("search_customers", { query: "客户", scope: "pool" }, 乙);
    expect(名字们(r)).toEqual(["公海客户乙", "公海客户甲"].sort());
    expect(名单(r).every((c) => c.归属 === "公海" && c.owner === "公海")).toBe(true);
  });

  it("在公海页上问（页面表 = 公海）：默认就是公海", async () => {
    const r = await 跑("search_customers", { query: "客户" }, 乙, { 页面: "公海" });
    expect(名字们(r)).toEqual(["公海客户乙", "公海客户甲"].sort());
  });

  it("在客户页上问：跟页面的页签走——「客户」页签不含公海，「公海」页签只有公海", async () => {
    const 客户页 = await 跑("search_customers", { query: "客户" }, 乙, { 页面: "客户", 页面筛选: { keyword: "客户" } });
    expect(名字们(客户页)).toEqual(["乙的客户A", "乙的客户B"]);
    const 公海页签 = await 跑("search_customers", { query: "客户" }, 乙, { 页面: "客户", 页面筛选: { pool: "1" } });
    expect(名字们(公海页签)).toEqual(["公海客户乙", "公海客户甲"].sort());
    // 客户页上什么都没筛：「客户」页签那一圈。销售管理在客户页问，下属的也在（和列表一样），我负责的排前面
    const 没筛 = await 跑("search_customers", { query: "客户" }, 经理, { 页面: "客户" });
    expect(名字们(没筛)).toEqual(["丙的客户", "乙的客户A", "乙的客户B", "经理的客户"].sort());
    expect(名单(没筛)[0]).toMatchObject({ name: "经理的客户", 归属: "我负责的" });
  });

  it("销售管理：默认只给自己负责的；scope=team 列下属的并标出来，不含公海", async () => {
    const 默认 = await 跑("search_customers", { query: "客户" }, 经理);
    expect(名字们(默认)).toEqual(["经理的客户"]);
    expect((默认.data as { 另有?: number }).另有).toBe(3);

    const 团队 = await 跑("search_customers", { query: "客户", scope: "team" }, 经理);
    expect(名单(团队)[0]).toMatchObject({ name: "经理的客户", 归属: "我负责的" });
    expect(名字们(团队)).toEqual(["丙的客户", "乙的客户A", "乙的客户B", "经理的客户"].sort());
    expect(名单(团队).slice(1).every((c) => c.归属 === "同事或下属负责的")).toBe(true);
  });

  it("按负责人名字问（「丙手上有哪些」）：不再默认收成我的，按限定层给；业务员仍看不到同事的", async () => {
    const 经理看 = await 跑("search_customers", { ownerName: "丙" }, 经理);
    expect(名字们(经理看)).toEqual(["丙的客户"]);
    const 乙看 = await 跑("search_customers", { ownerName: "丙" }, 乙);
    expect(名单(乙看)).toEqual([]);
    expect(JSON.stringify(乙看.data)).not.toContain("公海客户甲");
  });

  it("总管理：scope=team 全部非公海客户，自己的排前面（自己没有就全是别人的）", async () => {
    const r = await 跑("search_customers", { query: "客户", scope: "team" }, 总管);
    expect(名字们(r)).toEqual(["丙的客户", "乙的客户A", "乙的客户B", "经理的客户"].sort());
  });
});

describe("别的读客户的工具同一个默认", () => {
  it("list_projects：默认不列公海里的项目，pooled=true 才列", async () => {
    await prisma.project.create({ data: { name: "乙在推", customerId: id["乙的客户A"], ownerId: 乙.id, creatorId: 乙.id, phase: "商机", node: "明确需求" } });
    await prisma.project.create({ data: { name: "公海里的项目", customerId: id["公海客户乙"], ownerId: 总管.id, creatorId: 总管.id, phase: "商机", node: "明确需求", pooledAt: new Date() } });
    const 默认 = await 跑("list_projects", {}, 乙);
    const 名 = (r: { data?: unknown }) => (r.data as { 项目: { 名称: string; 归属?: string }[] }).项目.map((p) => p.名称);
    expect(名(默认)).toEqual(["乙在推"]);
    expect((默认.data as { 项目: { 归属: string }[] }).项目[0].归属).toBe("我负责的");
    const 公海 = await 跑("list_projects", { pooled: true }, 乙);
    expect(名(公海)).toEqual(["公海里的项目"]);
  });

  it("search_followups：默认不出公海客户身上的沟通，每条标客户归属", async () => {
    await prisma.followUp.create({ data: { customerId: id["乙的客户A"], type: "PHONE", title: "电话", content: "谈了预算", ownerId: 乙.id } });
    await prisma.followUp.create({ data: { customerId: id["公海客户甲"], type: "PHONE", title: "电话", content: "也谈了预算", ownerId: 丙.id } });
    const r = await 跑("search_followups", { keyword: "预算" }, 乙);
    const 记录 = (r.data as { 记录: { 客户: string; 归属: string }[] }).记录;
    expect(记录.map((x) => x.客户)).toEqual(["乙的客户A"]);
    expect(记录[0].归属).toBe("我负责的");
  });

  it("query_records 客户表：不带页面筛选时不含公海里的；公海表照常查得到", async () => {
    const 客户表 = JSON.stringify((await 跑("query_records", { 表: "客户", 条件: [{ 字段: "姓名", 运算: "包含", 值: "客户" }] }, 乙)).data);
    expect(客户表).toContain("乙的客户A");
    expect(客户表).not.toContain("公海客户");
    const 公海表 = JSON.stringify((await 跑("query_records", { 表: "公海", 条件: [] }, 乙)).data);
    expect(公海表).toContain("公海客户");
  });

  it("find_person：撞到公海客户标「公海」，不露原负责人", async () => {
    const r = await 跑("find_person", { name: "公海客户甲" }, 乙);
    const s = JSON.stringify(r.data);
    expect(s).toContain("公海客户甲");
    expect(s).not.toContain("\"丙\"");
    expect(s).toContain("公海");
  });
});
