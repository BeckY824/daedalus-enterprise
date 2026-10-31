/**
 * M-公海-14 / A-15（10-31 会议）：企业版项目模式下新客户至少带 1 个潜客培育项目。
 *   - 企业版 + 项目模式：saveCustomer 新建就带一个，落在线索阶段第一个节点（潜客培育）、记一行节点变更，负责人跟客户
 *   - 不是企业版（项目模式没开）：一个不建
 *   - 向导已经建了项目的不再补；编辑客户不补（老数据不补）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ 开: true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" }),
}));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.开 }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { saveCustomer, patchCustomer } from "@/app/(app)/customers/actions";
import { 要补潜客培育, 补潜客培育 } from "@/lib/project/nurture";
import { 第一个节点 } from "@/lib/project/nodes";

let 销售: string;
let 序 = 0;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.开 = true;
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "ADMIN", password: "x" } });
  销售 = (await prisma.user.create({ data: { email: "s@t", name: "销售", role: "SALES", password: "x" } })).id;
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

async function 新建(): Promise<string> {
  const r = await saveCustomer({
    name: `培育客户${++序}`, phone: `1370000${String(1000 + 序).slice(-4)}`, school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
    salesOwnerId: 销售, channelId: null, referrerCustomerId: null,
  } as Parameters<typeof saveCustomer>[0]);
  if (!r.ok) throw new Error(r.error);
  return r.id!;
}

describe("要补潜客培育（开关）", () => {
  it("企业版且项目模式开着才补", () => {
    expect(要补潜客培育(true, true)).toBe(true);
    expect(要补潜客培育(true, false)).toBe(false);
    expect(要补潜客培育(true, undefined)).toBe(false);
    expect(要补潜客培育(false, true)).toBe(false);
  });
});

describe("saveCustomer 新建", () => {
  it("企业版项目模式：新客户带 1 个潜客培育项目，负责人跟客户、记节点变更", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    const id = await 新建();
    const 项目们 = await prisma.project.findMany({ where: { customerId: id } });
    expect(项目们).toHaveLength(1);
    expect(项目们[0]).toMatchObject({ phase: 第一个节点.phase, node: "潜客培育", ownerId: 销售, creatorId: "tester-id", name: `培育客户${序}`, result: null, pooledAt: null });
    expect(await prisma.projectNodeLog.count({ where: { projectId: 项目们[0].id, toNode: "潜客培育" } })).toBe(1);
  });

  it("没开项目模式（企业版开关在、项目模式关）：一个不建", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    mocks.开 = false;
    const id = await 新建();
    expect(await prisma.project.count({ where: { customerId: id } })).toBe(0);
    expect(await prisma.projectNodeLog.count()).toBe(0);
  });

  it("不是企业版（团队版开了项目模式也不补）：一个不建", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    const id = await 新建();
    expect(await prisma.project.count({ where: { customerId: id } })).toBe(0);
  });

  it("编辑老客户不补（A-15 老数据不补）", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    mocks.开 = false;
    const id = await 新建();
    mocks.开 = true;
    expect(await patchCustomer(id, "remark", "改个备注")).toMatchObject({ ok: true });
    expect(await prisma.project.count({ where: { customerId: id } })).toBe(0);
  });
});

describe("补潜客培育", () => {
  it("已经有项目（向导刚建的）不再补；没有才建", async () => {
    const c = await prisma.customer.create({ data: { name: "  空项目客户  ", phone: `139${Date.now().toString().slice(-8)}`, salesOwnerId: 销售 } });
    const 新 = await prisma.$transaction((tx) => 补潜客培育(tx, { customerId: c.id, 客户名: c.name, ownerId: 销售, creatorId: "tester-id" }));
    expect(新).toBeTruthy();
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 新! } })).name).toBe("空项目客户");
    const 再 = await prisma.$transaction((tx) => 补潜客培育(tx, { customerId: c.id, 客户名: c.name, ownerId: 销售, creatorId: "tester-id" }));
    expect(再).toBeNull();
    expect(await prisma.project.count({ where: { customerId: c.id } })).toBe(1);
  });
});
