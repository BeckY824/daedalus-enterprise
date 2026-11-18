/**
 * 11-18 审核「分配与归属」P0-3：线索公海里的项目（客户不在客户公海），项目列表上的「分配 / 自动分配」也是在分公海，
 * 要和公海页 分配公海项目 同一套判（P-转-02、P-公海-10、P-公海-07、P-公海-04）：
 *   - 能管公海：总管理、销售管理；市场管理不能（原来市场管理在项目列表点「分配」能直接分出去）
 *   - 销管、条线总管理只能动本业务线的
 *   - 自己放回公海的人回避：不能当操作人；自动分配也不挑他。上级指定分回给他照放行（X-67）
 * 复现单测原在 tests/audit-1118/assign-ownership.test.ts（C 两条），搬进来改成正式用例，另补对照。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "市场", email: "a@x", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));

import { prisma } from "@/lib/prisma";
import { setSetting } from "@/lib/settings";
import { resetDb } from "./reset";
import { 分配线索, 自动分配线索, 批量自动分配, 设线部门 } from "@/app/(app)/leads/assign-actions";
import { 不设配额key } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";

const 当 = (id: string, name: string) => { mocks.user = { ...mocks.user, id, name }; };

let 老板: string, 市场: string, 外一: string, 外二: string, 外三: string, 外贸管: string, 内贸管: string;
let 客户号 = 0;

const 建项目 = async (name: string, extra: { pooledAt?: Date; ownerId?: string; 放的人?: string } = {}) => {
  const 客户 = (await prisma.customer.create({ data: { name: `客户${++客户号}`, phone: `1390000${String(客户号).padStart(4, "0")}`, salesOwnerId: 市场, addrCountry: "美国" } })).id;
  const id = (await prisma.project.create({ data: { name, customerId: 客户, ownerId: extra.ownerId ?? 市场, creatorId: 市场, bizLine: "外贸", ...(extra.pooledAt ? { pooledAt: extra.pooledAt } : {}) } })).id;
  // 放回公海的留痕：历史负责人 = 最近一次 pool-release 的 fromOwnerId（企业版进公海清了负责人）
  if (extra.放的人) {
    await prisma.projectNodeLog.create({ data: { projectId: id, userId: extra.放的人, toPhase: "线索", toNode: "潜客培育", kind: "pool-release", fromOwnerId: extra.放的人 } });
  }
  return id;
};
const 公海项目 = (name: string, 放的人: string) => 建项目(name, { pooledAt: new Date(), ownerId: "", 放的人 });
const 项目 = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await resetDb();
  const 部 = async (name: string, parentId: string | null = null) => (await prisma.entDept.create({ data: { name, parentId } })).id;
  const 外贸部 = await 部("外贸事业部");
  const MVP = await 部("MVP战队", 外贸部);
  const 雄鹰 = await 部("雄鹰战队", 外贸部);
  let 第几 = 0;
  const 人 = async (email: string, name: string, bizRole: string, deptId: string | null, line: string | null = null) => {
    第几++;
    const id = (await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x", active: true, createdAt: new Date(2026, 0, 第几) } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, deptId, line } });
    return id;
  };
  老板 = await 人("boss", "老板", "director", null);
  市场 = await 人("mkt", "市场", "marketing_mgr", null);
  外一 = await 人("w1", "外贸销售一", "sales", MVP, "外贸");
  外二 = await 人("w2", "外贸销售二", "sales", 雄鹰, "外贸");
  外三 = await 人("w3", "外贸销售三", "sales", MVP, "外贸");
  外贸管 = await 人("wm", "外贸销管", "sales_mgr", 外贸部, "外贸");
  内贸管 = await 人("nm", "内贸销管", "sales_mgr", null, "内贸");
  for (const k of [规则.按组织看客户.key, 规则.线索分配.key]) await setSetting(k, true);
  await setSetting(不设配额key, true);
  当(老板, "老板");
  expect(await 设线部门({ 内贸: [], 外贸: [MVP, 雄鹰] })).toEqual({ ok: true });
  当(市场, "市场");
});

describe("线索公海里的项目：市场管理不能分（P-转-02、P-公海-10）", () => {
  it("指定分配：拒，项目还在公海、负责人不变、没有分配记录", async () => {
    const P = await 公海项目("公海项目", 外三);
    const r = await 分配线索({ projectId: P, toUserId: 外二, 原负责人: null });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("销售管理") });
    expect(await 项目(P)).toMatchObject({ ownerId: "" });
    expect((await 项目(P)).pooledAt).not.toBeNull();
    expect(await prisma.entLeadAssign.count()).toBe(0);
  });

  it("自动分配：拒，项目还在公海、没标待分配", async () => {
    const P = await 公海项目("公海项目二", 外三);
    const r = await 自动分配线索(P, { 项目: true, 原负责人: null });
    expect(r.ok).toBe(false);
    const p = await 项目(P);
    expect(p.pooledAt).not.toBeNull();
    expect(p.awaitAssignAt).toBeNull();
    expect(await prisma.entLeadAssign.count()).toBe(0);
  });

  it("批量自动分配：公海那条拒，不在公海的照分", async () => {
    const P = await 公海项目("公海项目三", 外三);
    const Q = await 建项目("普通线索");
    const r = await 批量自动分配([P, Q], { 项目: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.结果.find((x) => x.leadId === P)).toMatchObject({ ok: false });
    expect(r.结果.find((x) => x.leadId === Q)).toMatchObject({ ok: true });
    expect((await 项目(P)).pooledAt).not.toBeNull();
  });

  it("对照：不在公海的线索，市场管理照常指定分配", async () => {
    const Q = await 建项目("普通线索");
    expect(await 分配线索({ projectId: Q, toUserId: 外二, 原负责人: 市场 })).toEqual({ ok: true });
    expect((await 项目(Q)).ownerId).toBe(外二);
  });
});

describe("线索公海里的项目：销管只能动本线的（P-公海-07）", () => {
  it("内贸销管分外贸线索公海里的项目：拒", async () => {
    const P = await 公海项目("外贸公海项目", 外三);
    当(内贸管, "内贸销管");
    const r = await 分配线索({ projectId: P, toUserId: 外二, 原负责人: null });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("本业务线") });
    expect((await 项目(P)).pooledAt).not.toBeNull();
  });

  it("对照：外贸销管分本线的照常", async () => {
    const P = await 公海项目("外贸公海项目", 外三);
    当(外贸管, "外贸销管");
    expect(await 分配线索({ projectId: P, toUserId: 外二, 原负责人: null })).toEqual({ ok: true });
    const p = await 项目(P);
    expect([p.ownerId, p.pooledAt]).toEqual([外二, null]);
  });
});

describe("线索公海里的项目：原负责人回避（P-公海-04）", () => {
  it("自己放回公海的销管不能分它", async () => {
    const P = await 公海项目("销管放的", 外贸管);
    当(外贸管, "外贸销管");
    const r = await 分配线索({ projectId: P, toUserId: 外二, 原负责人: null });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("回避") });
    expect((await 项目(P)).pooledAt).not.toBeNull();
  });

  it("自动分配不挑把它放回公海的人", async () => {
    当(老板, "老板");
    // 先让外一本月有 1 条：不回避时按「本月已分最少、并列最早建号」会挑到外二（放的人）
    const 先 = await 自动分配线索(await 建项目("先分一条"), { 项目: true });
    expect(先).toMatchObject({ ok: true, toUserId: 外一 });
    const P = await 公海项目("外二放的", 外二);
    const r = await 自动分配线索(P, { 项目: true, 原负责人: null });
    expect(r).toMatchObject({ ok: true, toUserId: 外三 });
  });

  it("对照：系统管理员指定分回原负责人照放行（X-67）", async () => {
    const P = await 公海项目("外二放的", 外二);
    当(老板, "老板");
    expect(await 分配线索({ projectId: P, toUserId: 外二, 原负责人: null })).toEqual({ ok: true });
    expect((await 项目(P)).ownerId).toBe(外二);
  });
});
