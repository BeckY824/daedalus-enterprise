/**
 * 客户详情单格改负责人撞上别人刚改的（代码体检 C2，仿 X-89）：
 *   原来读一下、无条件写：两位主管同时把同一位客户改给不同的人，后到的盖先到的，两位接手人都收到「分给你」。
 *   现在进来先记下看到的负责人，按「负责人还是那位」条件写；对不上不写、不留痕、不带走活、不发通知，回一句直白的话。
 *   - 交错：甲读 → 乙改给小李 → 甲改给小丙：甲被拒，客户归小李，通知只有小李那一份
 *   - 两个请求同时发：只成一个，通知只发一份
 *   - 没人插进来：照常改、照常通知（单人路径不变）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "ADMIN", title: "", avatar: null as string | null },
  /** 改负责人的各道检查中间插进来的那一下（只跑一次） */
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
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { patchCustomer } from "@/app/(app)/customers/actions";

type 人 = { id: string; role: string };
let 老板: 人, 老板二: 人, 小王: 人, 小李: 人, 小丙: 人;
let 号 = 0;

async function 建(email: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; 忘掉企业版范围(); };
const 客户 = (salesOwnerId: string) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId } });
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 分配通知 = async () => (await prisma.entNotice.findMany({ where: { kind: "分配" }, select: { userId: true } })).map((n) => n.userId).sort();
const 改负责人留痕 = (id: string) => prisma.auditLog.count({ where: { entityId: id, action: "update" } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  号 = 0;
  mocks.中间 = null;
  老板 = await 建("boss", "ADMIN");
  老板二 = await 建("boss2", "ADMIN");
  小王 = await 建("wang", "SALES");
  小李 = await 建("li", "SALES");
  小丙 = await 建("bing", "SALES");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 老板二.id, bizRole: "director" },
      { userId: 小王.id, bizRole: "sales" },
      { userId: 小李.id, bizRole: "sales" },
      { userId: 小丙.id, bizRole: "sales" },
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  当(老板);
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("单格改负责人不盖别人刚改的（C2）", () => {
  it("甲读完、还没写的时候乙把客户改给了小李：甲被拒，客户归小李，通知只有小李一份", async () => {
    const c = await 客户(小王.id);
    mocks.中间 = async () => {
      当(老板二);
      expect(await patchCustomer(c.id, "salesOwnerId", 小李.id)).toMatchObject({ ok: true });
      当(老板);
    };
    const 甲 = await patchCustomer(c.id, "salesOwnerId", 小丙.id);
    expect(甲.ok).toBe(false);
    if (!甲.ok) expect(甲.error).toContain("被别人改过");
    expect(await 归谁(c.id)).toBe(小李.id);
    expect(await 分配通知()).toEqual([小李.id]);
    // 只有乙那一次留痕
    expect(await 改负责人留痕(c.id)).toBe(1);
    // 换负责人记录只有乙那一条
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c.id } })).toBe(1);
  });

  it("同一位主管的两个页面同时改给不同的人：只成一个，通知只发给成的那位", async () => {
    const c = await 客户(小王.id);
    const [给李, 给丙] = await Promise.all([patchCustomer(c.id, "salesOwnerId", 小李.id), patchCustomer(c.id, "salesOwnerId", 小丙.id)]);
    expect([给李.ok, 给丙.ok].filter(Boolean)).toHaveLength(1);
    const 成的 = 给李.ok ? 小李.id : 小丙.id;
    expect(await 归谁(c.id)).toBe(成的);
    expect(await 分配通知()).toEqual([成的]);
    expect(await 改负责人留痕(c.id)).toBe(1);
  });

  it("没人插进来：照常改、通知接手人", async () => {
    const c = await 客户(小王.id);
    expect(await patchCustomer(c.id, "salesOwnerId", 小李.id)).toMatchObject({ ok: true });
    expect(await 归谁(c.id)).toBe(小李.id);
    expect(await 分配通知()).toEqual([小李.id]);
    // 改成本来就是的那位：不报错
    expect(await patchCustomer(c.id, "salesOwnerId", 小李.id)).toMatchObject({ ok: true });
  });

  it("别的格不受影响：改备注照常", async () => {
    const c = await 客户(老板.id);
    expect(await patchCustomer(c.id, "remark", "记一句")).toMatchObject({ ok: true });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).remark).toBe("记一句");
  });
});
