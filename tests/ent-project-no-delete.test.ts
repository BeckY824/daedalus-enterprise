/**
 * 企业版删项目（QA #3，11-01；原 M-权限-10「一律拒」改成只有总管理能删）。
 * 钉的是服务端：server action 删除项目、库函数 删项目 只放总管理（业务角色 director），删了进回收站（软删，能恢复）；
 * 负责人、管理员（admin，只读）、没设业务角色的账号 ADMIN 一律拒，项目原样留着、不记删除审计；
 * 不存在的 id 对别人也是同一句（不先露「不在了」）；不是企业版照旧能删（团队版、桌面端行为不变）。
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

let 老板: string, 总管: string, 管理员: string, 销售: string, 客户: string, 项目: string;

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = (await prisma.user.create({ data: { email: "boss", name: "老板", role: "ADMIN", password: "x" } })).id;
  总管 = (await prisma.user.create({ data: { email: "dir", name: "总管", role: "SALES", password: "x" } })).id;
  管理员 = (await prisma.user.create({ data: { email: "adm", name: "管理员甲", role: "SALES", password: "x" } })).id;
  销售 = (await prisma.user.create({ data: { email: "s1", name: "小王", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: 总管, bizRole: "director" }, { userId: 管理员, bizRole: "admin" }, { userId: 销售, bizRole: "sales" }] });
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

describe("企业版：删项目只有总管理", () => {
  it("没设业务角色的账号 ADMIN 调 server action：拒，项目原样还在、不记删除审计", async () => {
    expect(await 删除项目(项目)).toEqual({ ok: false, error: 项目不能删提示 });
    expect(await 还在()).toBe(true);
    expect(await raw.auditLog.count({ where: { entity: "Project", action: "delete" } })).toBe(0);
  });

  it("项目负责人自己删也拒；管理员（admin）只读也拒", async () => {
    mocks.user = { ...mocks.user, id: 销售, role: "SALES" };
    expect(await 删除项目(项目)).toMatchObject({ ok: false, error: 项目不能删提示 });
    expect(await 删项目({ id: 销售, role: "SALES" }, 项目)).toMatchObject({ ok: false, error: 项目不能删提示 });
    expect(await 删项目({ id: 管理员, role: "SALES" }, 项目)).toMatchObject({ ok: false, error: 项目不能删提示 });
    expect(await 还在()).toBe(true);
  });

  it("不存在的项目 id 对别人也是同一句（不先露「不在了」）", async () => {
    expect(await 删项目({ id: 老板, role: "ADMIN" }, "没有这个")).toEqual({ ok: false, error: 项目不能删提示 });
  });

  it("总管理删：进回收站（软删），记删除审计", async () => {
    mocks.user = { ...mocks.user, id: 总管, role: "SALES" };
    expect(await 删除项目(项目)).toEqual({ ok: true });
    const p = await raw.project.findUnique({ where: { id: 项目 }, select: { deletedAt: true } });
    expect(p?.deletedAt).not.toBeNull();
    expect(await raw.auditLog.count({ where: { entity: "Project", action: "delete" } })).toBe(1);
  });
});

describe("不是企业版：照旧能删", () => {
  it("老板删得掉，项目真删", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 删项目({ id: 老板, role: "ADMIN" }, 项目)).toMatchObject({ ok: true });
    expect(await raw.project.count({ where: { id: 项目 } })).toBe(0);
  });
});
