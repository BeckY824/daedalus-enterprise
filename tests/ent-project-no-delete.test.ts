/**
 * 企业版不能删除项目（M-权限-10，10-31 晚会议「项目是公司资产」）。
 * 钉的是服务端：server action 删除项目、库函数 删项目 一律拒，谁调都一样（负责人、老板），
 * 项目原样留着、不进回收站、不记删除审计；不是企业版照旧能删（团队版、桌面端行为不变）。
 * 界面上的删除入口另外去掉（项目详情页那颗按钮归项目详情）。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss", role: "ADMIN", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 删除项目 } from "@/app/(app)/projects/actions";
import { 删项目, 项目不能删提示 } from "@/lib/project/db";

let 老板: string, 销售: string, 客户: string, 项目: string;

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = (await prisma.user.create({ data: { email: "boss", name: "老板", role: "ADMIN", password: "x" } })).id;
  销售 = (await prisma.user.create({ data: { email: "s1", name: "小王", role: "SALES", password: "x" } })).id;
  客户 = (await prisma.customer.create({ data: { name: "测试客户", phone: "13800000001", salesOwnerId: 销售 } })).id;
  项目 = (await prisma.project.create({ data: { customerId: 客户, ownerId: 销售, creatorId: 销售, name: "一期改造", phase: "商机", node: "明确需求" } })).id;
  mocks.user = { ...mocks.user, id: 老板, role: "ADMIN" };
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(() => prisma.$disconnect());

const 还在 = async () => {
  const p = await raw.project.findUnique({ where: { id: 项目 }, select: { deletedAt: true } });
  return p != null && p.deletedAt == null;
};

describe("企业版：删项目一律拒", () => {
  it("老板调 server action 删除项目：拒，项目原样还在、不进回收站、不记删除审计", async () => {
    expect(await 删除项目(项目)).toEqual({ ok: false, error: 项目不能删提示 });
    expect(await 还在()).toBe(true);
    expect(await raw.auditLog.count({ where: { entity: "Project", action: "delete" } })).toBe(0);
  });

  it("项目负责人自己删也拒", async () => {
    mocks.user = { ...mocks.user, id: 销售, role: "SALES" };
    expect(await 删除项目(项目)).toMatchObject({ ok: false, error: 项目不能删提示 });
    expect(await 删项目({ id: 销售, role: "SALES" }, 项目)).toMatchObject({ ok: false, error: 项目不能删提示 });
    expect(await 还在()).toBe(true);
  });

  it("不存在的项目 id 也是同一句（不先露「不在了」）", async () => {
    expect(await 删项目({ id: 老板, role: "ADMIN" }, "没有这个")).toEqual({ ok: false, error: 项目不能删提示 });
  });
});

describe("不是企业版：照旧能删", () => {
  it("老板删得掉，项目真删", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 删项目({ id: 老板, role: "ADMIN" }, 项目)).toMatchObject({ ok: true });
    expect(await raw.project.count({ where: { id: 项目 } })).toBe(0);
  });
});
