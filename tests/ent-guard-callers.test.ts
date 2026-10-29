/**
 * 两处「函数本身不查人、靠调用方挡」的补上自己挡（2026-10-28）：绕过入口、直接调函数。
 * 企业版规矩：业务员只看自己 + 公海，老板 / 销售管理看全队（按组织看客户开着）。
 *   - 记号码：往「已有」客户上记号，业务员记到同事的客户上被拒、一行不写；自己的照记；
 *     「刚建的」（同一笔事务里刚建、可能建给了别人）照记
 *   - 了结：业务员直接调，撤回 / 确认 / 拒收别人的交接都不成、仍是待确认；接手人确认、发起人撤回、管理员撤回照成
 *   - 交接中的客户：业务员只看得到自己看得到的那几位；老板全看得到
 * 数据照 tests/ent-undo-owner-scope.test.ts 搭：老板、组长（销售管理）、小王 / 小李（组长的实线下属）
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
import { 以谁的身份 } from "@/lib/enterprise/visibility";
import { 记号码, type 验好的号 } from "@/lib/enterprise/contact-dedupe";
import { 了结, 交接中的客户 } from "@/lib/enterprise/handover-db";

type 人 = { id: string; role: string };
let 老板: 人, 组长: 人, 小王: 人, 小李: 人;
let 序 = 0;

async function 建(email: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 客户 = (salesOwnerId: string) =>
  prisma.customer.create({ data: { name: `守卫客户${++序}`, phone: `1370000${String(序).padStart(4, "0")}`, salesOwnerId } });
const 微信 = (n: string): 验好的号 => ({ 类型: "微信", 值: `wx_guard_${n}`, 键: `wx_guard_${n}` });
const 号数 = (customerId: string) => prisma.contactMethod.count({ where: { customerId } });

beforeEach(async () => {
  await resetDb();
  序 = 0;
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
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  await setSetting("enterprise.rule.handover_confirm", true);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("记号码", () => {
  it("业务员直接往同事的客户上记号：被拒，一行不写", async () => {
    const 李的 = await 客户(小李.id);
    await expect(以谁的身份(小王.id, () => prisma.$transaction((tx) => 记号码(tx, { 已有: 李的.id }, null, 微信("li"))))).rejects.toThrow(/不在你能改的范围/);
    expect(await 号数(李的.id)).toBe(0);
  });

  it("自己的客户照记；同一个号不记第二行", async () => {
    const 王的 = await 客户(小王.id);
    await 以谁的身份(小王.id, () => prisma.$transaction((tx) => 记号码(tx, { 已有: 王的.id }, null, 微信("wang"))));
    await 以谁的身份(小王.id, () => prisma.$transaction((tx) => 记号码(tx, { 已有: 王的.id }, null, 微信("wang"))));
    expect(await 号数(王的.id)).toBe(1);
  });

  it("刚建的：组长给范围外的人建档、同一笔事务里记号，照记", async () => {
    const id = await 以谁的身份(组长.id, () => prisma.$transaction(async (tx) => {
      const c = await tx.customer.create({ data: { name: "刚建的", phone: "13700009999", salesOwnerId: 老板.id } });
      await 记号码(tx, { 刚建的: c.id }, null, 微信("new"));
      return c.id;
    }));
    expect(await 号数(id)).toBe(1);
  });
});

describe("了结", () => {
  const 一笔 = async () => {
    const c = await 客户(小李.id);
    return prisma.entHandover.create({ data: { kind: "转让", fromUserId: 小李.id, toUserId: 组长.id, byUserId: 组长.id, customerIds: JSON.stringify([c.id]) } });
  };
  const 状态 = async (id: string) => (await prisma.entHandover.findUniqueOrThrow({ where: { id } })).status;

  it("业务员直接调：撤回、确认、拒收别人的交接都不成，仍是待确认", async () => {
    const h = await 一笔();
    for (const s of ["已撤回", "已确认", "已拒收"] as const) {
      expect(await 以谁的身份(小王.id, () => 了结(prisma, h.id, s, 小王))).toBe(false);
    }
    expect(await 状态(h.id)).toBe("待确认");
  });

  it("接手人确认照成", async () => {
    const h = await 一笔();
    expect(await 了结(prisma, h.id, "已确认", 组长)).toBe(true);
    expect(await prisma.entHandover.findUniqueOrThrow({ where: { id: h.id } })).toMatchObject({ status: "已确认", doneById: 组长.id });
  });

  it("发起人、管理员撤回照成；不是发起人的主管撤不了", async () => {
    const h1 = await 一笔();
    expect(await 了结(prisma, h1.id, "已撤回", 组长)).toBe(true);
    const h2 = await 一笔();
    expect(await 了结(prisma, h2.id, "已撤回", 老板)).toBe(true);
    const h3 = await prisma.entHandover.create({ data: { kind: "转让", fromUserId: 小李.id, toUserId: 小王.id, byUserId: 老板.id, customerIds: "[]" } });
    expect(await 了结(prisma, h3.id, "已撤回", 组长)).toBe(false);
    expect(await 状态(h3.id)).toBe("待确认");
  });
});

describe("交接中的客户", () => {
  it("业务员只看得到自己看得到的那几位；老板全看得到", async () => {
    const 李的 = await 客户(小李.id), 王的 = await 客户(小王.id);
    await prisma.entHandover.create({ data: { kind: "转让", fromUserId: 小李.id, toUserId: 组长.id, byUserId: 组长.id, customerIds: JSON.stringify([李的.id]) } });
    await prisma.entHandover.create({ data: { kind: "转让", fromUserId: 小王.id, toUserId: 组长.id, byUserId: 组长.id, customerIds: JSON.stringify([王的.id]) } });
    expect([...(await 以谁的身份(小王.id, () => 交接中的客户([李的.id, 王的.id])))]).toEqual([王的.id]);
    expect(new Set(await 以谁的身份(老板.id, () => 交接中的客户([李的.id, 王的.id])))).toEqual(new Set([李的.id, 王的.id]));
  });
});
