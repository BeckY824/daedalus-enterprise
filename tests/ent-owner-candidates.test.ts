/**
 * 企业版谁能当负责人（11-03 完成度 D3-9 / C3-1）：只认业务角色——在职、设了业务角色、不是只读管理员。
 *   原来候选按账号角色（排除账号 ADMIN），没设业务角色的人、只读管理员都在下拉里，选了也能存；
 *   账号 ADMIN、业务角色是销售的人反而选不到。转让、交接、停用接收人、改项目、分配公海项目同一口径，服务器端拒。
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", () => ({ 当前是共享区: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 负责人候选 } from "@/lib/owners";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { deactivateUser } from "@/app/(app)/settings/actions";
import { 交接全部, 交接客户 } from "@/app/(app)/projects/handover/actions";
import { 分配公海项目 } from "@/app/(app)/pool/actions";
import { 改项目 } from "@/lib/project/db";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";

type 人 = { id: string; role: string };
let 老板: 人, 管理员: 人, 双角色: 人, 没角色: 人, 销售: 人, 账号管理员销售: 人;
let 号 = 0;
async function 建(email: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; };
const 客户 = (salesOwnerId: string) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1380000${String(号).padStart(4, "0")}`, salesOwnerId } });
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  号 = 0;
  老板 = await 建("boss", "ADMIN");
  管理员 = await 建("ro", "ADMIN");
  双角色 = await 建("both", "SALES");
  没角色 = await 建("none", "SALES");
  销售 = await 建("sales", "SALES");
  账号管理员销售 = await 建("adminsales", "ADMIN");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 管理员.id, bizRole: "admin" },
      { userId: 双角色.id, bizRole: "admin,director" },
      { userId: 销售.id, bizRole: "sales" },
      { userId: 账号管理员销售.id, bizRole: "sales" },
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  忘掉企业版范围();
  当(老板);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("企业版负责人候选只认业务角色", () => {
  it("候选：没角色的、只读管理员不在；账号 ADMIN 但业务是销售的在；总管理兼管理员在", async () => {
    const ids = (await 负责人候选()).map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([老板.id, 双角色.id, 销售.id, 账号管理员销售.id]));
    expect(ids).not.toContain(管理员.id);
    expect(ids).not.toContain(没角色.id);
  });

  it("转让客户给只读管理员、没角色的人被拒，负责人不变；给账号 ADMIN 的销售能转", async () => {
    const c = await 客户(销售.id);
    expect(await assignSalesOwner([c.id], 管理员.id)).toMatchObject({ ok: false, error: expect.stringContaining("只读") });
    expect(await assignSalesOwner([c.id], 没角色.id)).toMatchObject({ ok: false, error: expect.stringContaining("业务角色") });
    expect(await 归谁(c.id)).toBe(销售.id);
    expect(await assignSalesOwner([c.id], 账号管理员销售.id)).toMatchObject({ ok: true });
    expect(await 归谁(c.id)).toBe(账号管理员销售.id);
  });

  it("离职交接接手人是只读管理员 / 没角色：拒，客户不动（11-03 办离职不选接手人，接手人在离职交接里选）", async () => {
    const c = await 客户(销售.id);
    expect(await deactivateUser(销售.id, 管理员.id, "转交")).toEqual({ ok: true });
    expect(await 归谁(c.id)).toBe(销售.id);
    expect(await 交接全部(销售.id, 管理员.id)).toMatchObject({ ok: false, error: expect.stringContaining("只读") });
    expect(await 交接全部(销售.id, 没角色.id)).toMatchObject({ ok: false, error: expect.stringContaining("业务角色") });
    expect(await 交接客户(销售.id, c.id, 没角色.id)).toMatchObject({ ok: false, error: expect.stringContaining("业务角色") });
    expect(await 归谁(c.id)).toBe(销售.id);
    expect(await 交接客户(销售.id, c.id, 账号管理员销售.id)).toMatchObject({ ok: true });
    expect(await 归谁(c.id)).toBe(账号管理员销售.id);
  });

  it("改项目负责人、分配公海项目给没角色的人：拒", async () => {
    const c = await 客户(销售.id);
    const p = await prisma.project.create({ data: { name: "项目一", customerId: c.id, ownerId: 销售.id, creatorId: 销售.id, phase: "线索" } });
    expect(await 改项目(老板, p.id, { name: "项目一", ownerId: 没角色.id, amount: 0 })).toMatchObject({ ok: false, error: expect.stringContaining("业务角色") });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(销售.id);

    await prisma.project.update({ where: { id: p.id }, data: { pooledAt: new Date() } });
    expect(await 分配公海项目([p.id], 管理员.id)).toMatchObject({ ok: false, error: expect.stringContaining("只读") });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).pooledAt).not.toBeNull();
  });
});
