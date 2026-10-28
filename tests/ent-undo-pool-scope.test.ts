/**
 * 公海的撤销领取 / 撤销分配只撤「我自己刚才那一下」（2026-10-28 越权排查，接 ent-undo-owner-scope）：
 *   撤销提示条把 原负责人（每位领取前归谁）传回服务端。原来只认「现在还归我、不在公海、原负责人在职」，
 *   业务员把自己名下的客户当「刚领的」撤、原负责人填成同事，就能绕过交接把客户塞到同事名下（再放回公海）。
 *   现在负责人真换过的还要对上换负责人记录（lib/owner-log-db.ts 是我刚换的）。
 *   - 伪造撤销领取：不动，不进公海，不写撤销记录
 *   - 真领的照常撤：还给原负责人、放回公海
 *   - 老板撤自己的分配照常；另一位老板撤不了（那一下不是他做的）
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
import { 放进公海, 领取, 分配公海, 撤销公海 } from "@/app/(app)/customers/pool-actions";

type 人 = { id: string; role: string };
let 老板: 人, 老板二: 人, 组长: 人, 小王: 人, 小李: 人;
let 号 = 0;

async function 建(email: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; };
const 客户 = (salesOwnerId: string) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId } });
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 在公海 = async (id: string) => (await prisma.customerPool.count({ where: { customerId: id } })) > 0;
const 撤销记录数 = (customerId: string) => prisma.customerOwnerLog.count({ where: { customerId, kind: "undo" } });

beforeEach(async () => {
  await resetDb();
  号 = 0;
  老板 = await 建("boss", "ADMIN");
  老板二 = await 建("boss2", "ADMIN");
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
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("公海撤销只撤自己刚才那一下", () => {
  it("业务员拿自己的客户伪造撤销领取：不还给同事、不进公海、不写撤销记录", async () => {
    const c = await 客户(小王.id);
    const t = await prisma.task.create({ data: { title: "回电", customerId: c.id, ownerId: 小王.id } });
    当(小王);
    const r = await 撤销公海("领取", [{ id: c.id, 值: 小李.id }], { 计划: [], 待办: [t.id], 商机: [], 项目: [] });
    expect(r).toMatchObject({ ok: true, updated: 0 });
    expect(await 归谁(c.id)).toBe(小王.id);
    expect(await 在公海(c.id)).toBe(false);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).ownerId).toBe(小王.id);
    expect(await 撤销记录数(c.id)).toBe(0);
  });

  it("真从公海领的照常撤：还给原负责人、放回公海", async () => {
    const c = await 客户(小李.id);
    当(小李);
    expect(await 放进公海([c.id])).toMatchObject({ ok: true, updated: 1 });
    当(小王);
    const r = await 领取([c.id]);
    if (!r.ok) throw new Error(r.error);
    expect(await 归谁(c.id)).toBe(小王.id);
    expect(await 撤销公海("领取", r.原负责人!, r.带过来)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(c.id)).toBe(小李.id);
    expect(await 在公海(c.id)).toBe(true);
    expect(await 撤销记录数(c.id)).toBe(1);
  });

  it("老板撤自己的分配照常；另一位老板拿同样的数据撤不了", async () => {
    const c = await 客户(小李.id);
    当(小李);
    await 放进公海([c.id]);
    当(老板);
    const r = await 分配公海([c.id], 小王.id);
    if (!r.ok) throw new Error(r.error);
    当(老板二);
    expect(await 撤销公海("分配", r.原负责人!, r.带过来, 小王.id)).toMatchObject({ ok: true, updated: 0 });
    expect(await 归谁(c.id)).toBe(小王.id);
    当(老板);
    expect(await 撤销公海("分配", r.原负责人!, r.带过来, 小王.id)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(c.id)).toBe(小李.id);
    expect(await 在公海(c.id)).toBe(true);
  });
});
