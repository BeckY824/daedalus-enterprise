/**
 * 撤销改负责人只撤「我自己刚才那一下」（2026-10-28 越权排查）：
 *   撤销提示条把 原值（每位原来归谁）和 新负责人 传回服务端。原来只认「现在还归新负责人、原负责人在职、原值是我自己或我看得到」，
 *   业务员把原值填成自己、新负责人填成同事，就能把同事的客户连同名下的活一起「撤」到自己名下。
 *   现在还要对上换负责人记录：这位最近一条记录得是我把他从原值换给新负责人的（lib/owner-log-db.ts 是我刚换的）。
 *   - 业务员拿同事客户的 id 伪造撤销：不动，负责人、待办都还在同事名下，不写撤销记录
 *   - 原来是我的、被老板转给了同事：我也撤不回来（那一下不是我做的）
 *   - 自己转出去的照常撤；老板、业务主管撤自己刚才那一下照常
 *   - 只认 30 分钟内的那一下（2026-10-28 审查）：提示条只亮几秒，拿旧的撤销参数隔几天还能把已经不归自己的客户拉回来
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting } from "@/lib/settings";
import { assignSalesOwner, 撤销改负责人 } from "@/app/(app)/customers/actions";

type 人 = { id: string; role: string };
let 老板: 人, 组长: 人, 小王: 人, 小李: 人;
let 号 = 0;

async function 建(email: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; };
const 客户 = (salesOwnerId: string) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1380000${String(号).padStart(4, "0")}`, salesOwnerId } });
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 撤销记录数 = (customerId: string) => prisma.customerOwnerLog.count({ where: { customerId, kind: "undo" } });
/** 把这位客户的换负责人记录往前挪 分钟 分钟（模拟「隔了一阵子才撤」） */
const 记录挪到 = (customerId: string, 分钟: number) =>
  prisma.customerOwnerLog.updateMany({ where: { customerId }, data: { at: new Date(Date.now() - 分钟 * 60_000) } });

beforeEach(async () => {
  await resetDb();
  号 = 0;
  老板 = await 建("boss", "ADMIN");
  组长 = await 建("lead", "MANAGER");
  小王 = await 建("wang", "SALES");
  小李 = await 建("li", "SALES");
  await prisma.entMember.createMany({
    data: [
      { userId: 组长.id, bizRole: "sales_mgr" },
      { userId: 小王.id, managerId: 组长.id },
      { userId: 小李.id, managerId: 组长.id },
    ],
  });
  当(老板);
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  // 交接要确认关着：转给别人当场换负责人、给撤销条（开着时走交接，不给撤销）
  await setSetting("enterprise.rule.handover_confirm", false);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("撤销改负责人只撤自己刚才那一下", () => {
  it("业务员拿同事客户的 id 伪造撤销：负责人和名下的活都不动，不写撤销记录", async () => {
    const c = await 客户(小李.id);
    const t = await prisma.task.create({ data: { title: "回电", customerId: c.id, ownerId: 小李.id } });
    当(小王);
    const r = await 撤销改负责人([{ id: c.id, 值: 小王.id }], 小李.id, { 计划: [], 待办: [t.id], 商机: [], 项目: [] });
    expect(r).toMatchObject({ ok: true, updated: 0 });
    expect(await 归谁(c.id)).toBe(小李.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).ownerId).toBe(小李.id);
    expect(await 撤销记录数(c.id)).toBe(0);
  });

  it("原来是我的、被老板转给了同事：那一下不是我做的，我撤不回来", async () => {
    const c = await 客户(小王.id);
    当(老板);
    expect(await assignSalesOwner([c.id], 小李.id)).toMatchObject({ ok: true, updated: 1 });
    当(小王);
    expect(await 撤销改负责人([{ id: c.id, 值: 小王.id }], 小李.id)).toMatchObject({ ok: true, updated: 0 });
    expect(await 归谁(c.id)).toBe(小李.id);
  });

  it("业务员自己转出去的照常撤回来，名下带过去的活一起还", async () => {
    const c = await 客户(小王.id);
    const t = await prisma.task.create({ data: { title: "回电", customerId: c.id, ownerId: 小王.id } });
    当(小王);
    const r = await assignSalesOwner([c.id], 小李.id);
    if (!r.ok) throw new Error(r.error);
    expect(await 归谁(c.id)).toBe(小李.id);
    expect(await 撤销改负责人(r.原值!, 小李.id, r.带过来)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(c.id)).toBe(小王.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).ownerId).toBe(小王.id);
    expect(await 撤销记录数(c.id)).toBe(1);
  });

  it("老板、业务主管撤自己刚才那一下照常", async () => {
    const a = await 客户(小李.id);
    const b = await 客户(小王.id);
    当(老板);
    const r1 = await assignSalesOwner([a.id], 小王.id);
    if (!r1.ok) throw new Error(r1.error);
    expect(await 撤销改负责人(r1.原值!, 小王.id, r1.带过来)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(a.id)).toBe(小李.id);

    当(组长);
    const r2 = await assignSalesOwner([b.id], 小李.id);
    if (!r2.ok) throw new Error(r2.error);
    expect(await 归谁(b.id)).toBe(小李.id);
    expect(await 撤销改负责人(r2.原值!, 小李.id, r2.带过来)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(b.id)).toBe(小王.id);
  });

  it("撤过一次就不能再撤：最近一条记录变成撤销了", async () => {
    const c = await 客户(小王.id);
    当(小王);
    const r = await assignSalesOwner([c.id], 小李.id);
    if (!r.ok) throw new Error(r.error);
    expect(await 撤销改负责人(r.原值!, 小李.id, r.带过来)).toMatchObject({ updated: 1 });
    // 小李又被老板转回去不算：那一下是老板做的
    当(老板);
    await assignSalesOwner([c.id], 小李.id);
    当(小王);
    expect(await 撤销改负责人(r.原值!, 小李.id, r.带过来)).toMatchObject({ ok: true, updated: 0 });
    expect(await 归谁(c.id)).toBe(小李.id);
  });

  it("只认 30 分钟内的那一下：31 分钟前自己转出去的撤不回来，负责人和名下的活都不动", async () => {
    const c = await 客户(小王.id);
    const t = await prisma.task.create({ data: { title: "回电", customerId: c.id, ownerId: 小王.id } });
    当(小王);
    const r = await assignSalesOwner([c.id], 小李.id);
    if (!r.ok) throw new Error(r.error);
    await 记录挪到(c.id, 31);
    expect(await 撤销改负责人(r.原值!, 小李.id, r.带过来)).toMatchObject({ ok: true, updated: 0 });
    expect(await 归谁(c.id)).toBe(小李.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).ownerId).toBe(小李.id);
    expect(await 撤销记录数(c.id)).toBe(0);
  });

  it("29 分钟前自己转出去的照常撤（网络慢、标签页挂着）", async () => {
    const c = await 客户(小王.id);
    当(小王);
    const r = await assignSalesOwner([c.id], 小李.id);
    if (!r.ok) throw new Error(r.error);
    await 记录挪到(c.id, 29);
    expect(await 撤销改负责人(r.原值!, 小李.id, r.带过来)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(c.id)).toBe(小王.id);
  });
});
