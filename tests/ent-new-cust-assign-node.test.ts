/**
 * 合并交叉：新建客户 saveCustomer 同时带了两处改动——
 *   - 审核 11-18「市场分给销售进线索验证」（market-assign-node.ts：建给销售的潜客培育推到线索验证）
 *   - 新建客户给市场成员的「项目分配方式」（new-cust-assign.ts：指定 / 自动 / 暂不分配）
 * 钉住三种选法合在一起的结果（市场成员新建客户，项目模式，客户自带潜客培育项目）：
 *   - 指定分配给销售：项目进线索验证（留一行节点变更），记一条计名额的分配记录（EntLeadAssign counted），客户分配记「非自持」
 *   - 自动分配：分出去的项目同样进线索验证
 *   - 暂不分配：留在潜客培育，客户、项目负责人都是自己，不写分配记录
 * 名字、号码全是编造的
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null } as { id: string; name: string; email: string; role: string; title: string; avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => mocks.user, requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 市场分配进验证理由 } from "@/lib/enterprise/market-assign-node";
import { saveCustomer } from "@/app/(app)/customers/actions";

afterAll(() => prisma.$disconnect());

let 老板: string, 市场: string, 乙: string;
const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: id }; };
let 号 = 0;

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  号 = 0;
  const 人 = async (email: string, bizRole: string, line: string | null = null) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, line } });
    return id;
  };
  老板 = await 人("boss", "director");
  市场 = await 人("mkt", "marketing_mgr");
  乙 = await 人("yi", "sales", "内贸");
  await 人("bing", "sales", "外贸");
  await setSetting(规则.线索分配.key, true);
  // 老板不参与自动分配：内贸只剩乙
  await setSetting(自动分配不参与key, { [老板]: "禁止" });
  当(市场);
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });

/** 新建客户页（不带 接着）：saveCustomer 自己补潜客培育。手机号大陆 = 电话判内贸 */
const 建 = (负责人: string, 项目分配: unknown) => {
  号++;
  return saveCustomer({
    name: `新客户${号}`, phone: `1370000${String(号).padStart(4, "0")}`, school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
    salesOwnerId: 负责人, channelId: null, referrerCustomerId: null, 企业资料: { bizLine: "内贸" }, 项目分配,
  } as Parameters<typeof saveCustomer>[0]);
};
const 唯一项目 = async (customerId: string) => {
  const ps = await prisma.project.findMany({ where: { customerId }, include: { customer: true } });
  expect(ps).toHaveLength(1);
  return ps[0];
};
const 进验证痕 = (projectId: string) =>
  prisma.projectNodeLog.findMany({ where: { projectId, fromNode: "潜客培育", toNode: "线索验证" }, select: { userId: true, reason: true } });

describe("市场成员新建客户：项目分配方式 × 市场分给销售进线索验证", () => {
  it("指定分配给销售：项目进线索验证，记一条计名额的分配记录，客户分配记非自持", async () => {
    const r = await 建(乙, { 分配方式: 0 });
    if (!r.ok) throw new Error(r.error);
    const p = await 唯一项目(r.id!);
    expect([p.ownerId, p.creatorId, p.customer.salesOwnerId, p.phase, p.node, p.assignMode]).toEqual([乙, 市场, 乙, "线索", "线索验证", "指定分配"]);
    expect(await 进验证痕(p.id)).toEqual([{ userId: 市场, reason: 市场分配进验证理由 }]);
    expect(p.customer.assignWay).toBe("非自持");
    const 记录 = await prisma.entLeadAssign.findMany({ where: { projectId: p.id } });
    expect(记录).toHaveLength(1);
    expect(记录[0]).toMatchObject({ toUserId: 乙, byUserId: 市场, way: "指定分配", counted: true });
  });

  it("自动分配：分给销售，项目同样进线索验证", async () => {
    const r = await 建(市场, { 分配方式: 1 });
    if (!r.ok) throw new Error(r.error);
    const p = await 唯一项目(r.id!);
    expect([p.ownerId, p.creatorId, p.customer.salesOwnerId, p.phase, p.node, p.assignMode]).toEqual([乙, 市场, 乙, "线索", "线索验证", "自动分配"]);
    expect(await 进验证痕(p.id)).toHaveLength(1);
    expect(await prisma.entLeadAssign.findMany({ where: { projectId: p.id } })).toMatchObject([{ toUserId: 乙, byUserId: 市场, way: "自动分配" }]);
  });

  it("暂不分配：留在潜客培育，客户和项目负责人是自己，不写分配记录", async () => {
    const r = await 建(乙, { 分配方式: 3 });
    if (!r.ok) throw new Error(r.error);
    const p = await 唯一项目(r.id!);
    expect([p.ownerId, p.customer.salesOwnerId, p.phase, p.node, p.assignMode, p.awaitAssignAt]).toEqual([市场, 市场, "线索", "潜客培育", "暂不分配", null]);
    expect(await 进验证痕(p.id)).toHaveLength(0);
    expect(await prisma.entLeadAssign.count()).toBe(0);
  });
});
