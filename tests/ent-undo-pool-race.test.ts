/**
 * 撤销领取 / 撤销分配撞上别人刚改的负责人（代码体检 C1，仿 X-81 / X-89）：
 *   撤销先在事务外认「现在还归我、不在公海」，再进事务放回公海、把负责人还回去。两步之间主管把这位客户转给了别人，
 *   原来撤销照样放回公海、负责人改回旧值，盖掉主管刚做的转让。
 *   现在事务里按「负责人还是我」条件写，对不上整笔回滚：不进公海、负责人是主管转的那位、不记撤销，回一句直白的话。
 *   - 交错：甲认完 → 主管转给丙 → 甲写：甲被拒，客户归丙、不在公海
 *   - 一批里只有一位被改走：别的照常撤，被改走的那位不动
 *   - 没人插进来：照常撤（单人路径不变）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "ADMIN", title: "", avatar: null as string | null },
  /** 撤销认完「还归我」之后、进事务之前插进来的那一下（只跑一次） */
  中间: null as null | (() => Promise<void>),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/contract-owner", async (原) => {
  const 真 = await 原<typeof import("@/lib/contract-owner")>();
  return {
    ...真,
    钉住老签约: async () => {
      const 插 = mocks.中间;
      mocks.中间 = null;
      if (插) await 插();
      return 真.钉住老签约();
    },
  };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting } from "@/lib/settings";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 放进公海, 领取, 分配公海, 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { assignSalesOwner } from "@/app/(app)/customers/actions";

type 人 = { id: string; role: string };
let 老板: 人, 组长: 人, 小王: 人, 小李: 人, 小丙: 人;
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
const 占位 = async () => (await prisma.user.findUniqueOrThrow({ where: { email: 无负责人占位邮箱 } })).id;
/** 小李的客户放进公海、小王领走：回撤销要用的那包 */
async function 小王领一位() {
  const c = await 客户(小李.id);
  当(小李);
  expect(await 放进公海([c.id], "客户主动终止")).toMatchObject({ ok: true, updated: 1 });
  当(小王);
  const r = await 领取([c.id]);
  if (!r.ok) throw new Error(r.error);
  return { c, r };
}
/** 主管在撤销的两步之间把这位转给小丙 */
const 主管转给小丙 = (id: string, 撤的人: 人) => async () => {
  当(老板);
  expect(await assignSalesOwner([id], 小丙.id)).toMatchObject({ ok: true, updated: 1 });
  当(撤的人);
};

beforeEach(async () => {
  await resetDb();
  号 = 0;
  mocks.中间 = null;
  老板 = await 建("boss", "ADMIN");
  组长 = await 建("lead", "MANAGER");
  小王 = await 建("wang", "SALES");
  小李 = await 建("li", "SALES");
  小丙 = await 建("bing", "SALES");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 组长.id, bizRole: "sales_mgr" },
      { userId: 小王.id, managerId: 组长.id, bizRole: "sales" },
      { userId: 小李.id, managerId: 组长.id, bizRole: "sales" },
      { userId: 小丙.id, managerId: 组长.id, bizRole: "sales" },
    ],
  });
  当(老板);
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("撤销领取 / 分配不盖别人刚改的负责人（C1）", () => {
  it("撤销领取认完、还没写的时候主管把客户转给了丙：撤销被拒，客户归丙、不在公海", async () => {
    const { c, r } = await 小王领一位();
    mocks.中间 = 主管转给小丙(c.id, 小王);
    const 撤 = await 撤销公海("领取", r.原负责人!, r.带过来);
    expect(撤.ok).toBe(false);
    if (!撤.ok) expect(撤.error).toContain("被别人改过");
    expect(await 归谁(c.id)).toBe(小丙.id);
    expect(await 在公海(c.id)).toBe(false);
    // 主管那次转让的记录还在，没被当成「被撤的那条」删掉
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c.id, toOwnerId: 小丙.id } })).toBe(1);
    // 没记「撤销了刚才的公海领取」
    expect(await prisma.auditLog.count({ where: { summary: { contains: "撤销了刚才的公海领取" } } })).toBe(0);
  });

  it("撤销分配同理：老板二次点撤销前客户被转给丙，撤销被拒、不盖", async () => {
    const c = await 客户(小李.id);
    当(小李);
    await 放进公海([c.id], "客户主动终止");
    当(老板);
    const r = await 分配公海([c.id], 小王.id);
    if (!r.ok) throw new Error(r.error);
    mocks.中间 = async () => { await prisma.customer.update({ where: { id: c.id }, data: { salesOwnerId: 小丙.id } }); };
    const 撤 = await 撤销公海("分配", r.原负责人!, r.带过来, 小王.id);
    expect(撤.ok).toBe(false);
    expect(await 归谁(c.id)).toBe(小丙.id);
    expect(await 在公海(c.id)).toBe(false);
  });

  it("一批两位只有一位被改走：另一位照常撤回公海，被改走的不动", async () => {
    const 甲 = await 客户(小李.id);
    const 乙 = await 客户(小李.id);
    当(小李);
    await 放进公海([甲.id, 乙.id], "客户主动终止");
    当(小王);
    const r = await 领取([甲.id, 乙.id]);
    if (!r.ok) throw new Error(r.error);
    mocks.中间 = 主管转给小丙(甲.id, 小王);
    expect(await 撤销公海("领取", r.原负责人!, r.带过来)).toMatchObject({ ok: true, updated: 1, unchanged: 1 });
    expect(await 归谁(甲.id)).toBe(小丙.id);
    expect(await 在公海(甲.id)).toBe(false);
    expect(await 归谁(乙.id)).toBe(await 占位());
    expect(await 在公海(乙.id)).toBe(true);
  });

  it("没人插进来：照常撤", async () => {
    const { c, r } = await 小王领一位();
    expect(await 撤销公海("领取", r.原负责人!, r.带过来)).toMatchObject({ ok: true, updated: 1 });
    expect(await 归谁(c.id)).toBe(await 占位());
    expect(await 在公海(c.id)).toBe(true);
  });
});
