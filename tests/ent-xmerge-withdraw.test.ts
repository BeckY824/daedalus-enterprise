/**
 * 跨负责人项目直接合并 · 阶段 1（服务端核心，E-380；lib/enterprise/project-merge-request.ts，迁移 195）：
 *   发起（留下项目的负责人发申请；确认人 / 系统管理员自己发起 = 直接并；被并走的负责人不能发起；同客户、都线索阶段、未结束、负责人不同、客户负责人是销售）、
 *   确认人（实线上级 / 同线条线总管理 / 都没有给系统管理员）、确认 / 拒绝 / 5 个工作日失效、确认后同事务并 + 原负责人记待补、
 *   和客户合并申请互斥、待确认期间验证时限和超时自动转暂停（结束后从头计时）。人名、客户名都是编造的。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
const 登录 = vi.hoisted(() => ({ 人: null as null | { id: string; name: string; role: string } }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<object>()), requireUser: async () => ({ email: "", title: "", ...登录.人! }) }));

import { prisma, defaultClient as raw } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 撤回项目合并, 执行项目合并, 项目合并通知种类 } from "@/lib/enterprise/project-merge";
import { 发起跨负责人并, 处理跨并申请 } from "@/lib/enterprise/project-merge-request";

type 人 = { id: string; name: string; role: string };
let 老板: 人, 销管: 人, 线总: 人, 乙: 人, 丙: 人, 丁: 人, 渠运: 人;
let 序 = 0;
const 京 = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);
const 周五下午 = 京("2026-11-27 15:00");

async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await raw.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name, role };
}
const 客户 = async (ownerId: string) => (await raw.customer.create({ data: { name: `测试客户${++序}`, phone: "", salesOwnerId: ownerId } })).id;
const 项目 = async (ownerId: string, customerId: string, 补: Record<string, unknown> = {}) =>
  (await raw.project.create({ data: { name: `项目${++序}`, customerId, ownerId, creatorId: ownerId, bizLine: "内贸", ...补 } })).id;
/** 乙的项目 a（留下）、丙的项目 b（被并走），同一位客户（销售乙负责） */
async function 一对() {
  const c = await 客户(乙.id);
  return { c, a: await 项目(乙.id, c), b: await 项目(丙.id, c) };
}
const 发 = async (a: string, b: string, me: 人, 现在 = 周五下午) => {
  const r = await 发起跨负责人并(prisma, a, b, me, { 现在 });
  if (!r.ok) throw new Error(r.error);
  return r;
};
const 请 = async (a: string, b: string, me: 人 = 乙, 现在 = 周五下午) => {
  const r = await 发(a, b, me, 现在);
  if (r.方式 !== "申请") throw new Error("应该是申请");
  return r.requestId;
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板", "ADMIN");
  销管 = await 造人("xg", "销管甲", "SALES");
  线总 = await 造人("xz", "线总甲", "SALES");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  丁 = await 造人("ding", "丁", "SALES");
  渠运 = await 造人("qy", "渠运甲", "SALES");
  await raw.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 销管.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 线总.id, bizRole: "director", line: "内贸" },
      { userId: 乙.id, bizRole: "sales", line: "内贸" },
      { userId: 丙.id, bizRole: "sales", line: "内贸", managerId: 销管.id },
      { userId: 丁.id, bizRole: "sales", line: "内贸" },
      { userId: 渠运.id, bizRole: "channel_ops" },
    ],
  });
  await setSetting("business", { projectMode: true });
});
afterEach(async () => {
  await 等通知推完();
  vi.unstubAllEnvs();
  忘掉企业版范围();
});


const 通知们 = (userId: string) => raw.entNotice.findMany({ where: { userId, kind: 项目合并通知种类, dedupeKey: { startsWith: "merge-project-undo:" } } });

describe("E-484 1：撤回跨负责人合并一律通知被并走的原负责人、留痕", () => {
  const 并好 = async (方式: "申请" | "直接") => {
    const { a, b } = await 一对();
    if (方式 === "申请") {
      const id = await 请(a, b);
      expect(await 处理跨并申请(prisma, id, 销管, "确认")).toMatchObject({ ok: true });
      return { a, b, mergeId: (await raw.entProjectMergeRequest.findUniqueOrThrow({ where: { id } })).mergeId! };
    }
    const r = await 发(a, b, 销管);
    if (r.方式 !== "直接并") throw new Error("应该直接并");
    return { a, b, mergeId: r.mergeId };
  };
  for (const [谁, 取人] of [["发起人", () => 乙], ["确认人", () => 销管], ["系统管理员", () => 老板]] as const) {
    it(`${谁}撤：原负责人收到站内通知（链到回来的项目）+ 两个项目各有一条通知留痕`, async () => {
      const { b, mergeId } = await 并好("申请");
      expect(await 撤回项目合并(prisma, mergeId, 取人())).toMatchObject({ ok: true });
      await 等通知推完();
      const 们 = await 通知们(丙.id);
      expect(们).toHaveLength(1);
      expect(们[0].link).toBe(`/projects/${b}`);
      expect(们[0].body).toContain(取人().name);
      expect(await raw.auditLog.count({ where: { action: "merge-undo-notice", entityId: b } })).toBe(1);
    });
  }
  it("直接并（本人发起）后撤也通知", async () => {
    const { mergeId } = await 并好("直接");
    expect(await 撤回项目合并(prisma, mergeId, 老板)).toMatchObject({ ok: true });
    expect(await 通知们(丙.id)).toHaveLength(1);
  });
  it("原负责人自己撤（系统管理员兼）不给自己发", async () => {
    const { b, mergeId } = await 并好("申请");
    await raw.project.update({ where: { id: b }, data: { ownerId: 丙.id } });
    expect(await 撤回项目合并(prisma, mergeId, 老板)).toMatchObject({ ok: true });
    expect(await 通知们(乙.id)).toHaveLength(0);
  });
  it("同负责人的合并撤回：不发这条通知、不记通知留痕（行为不变）", async () => {
    const c = await 客户(乙.id);
    const [a, b] = [await 项目(乙.id, c), await 项目(乙.id, c)];
    const r = await 执行项目合并(prisma, a, b, 乙, { 已核未开票: true });
    if (!r.ok) throw new Error(r.error);
    expect(await 撤回项目合并(prisma, r.mergeId, 乙)).toMatchObject({ ok: true });
    expect(await raw.entNotice.count({ where: { dedupeKey: { startsWith: "merge-project-undo:" } } })).toBe(0);
    expect(await raw.auditLog.count({ where: { action: "merge-undo-notice" } })).toBe(0);
  });
});

describe("E-484 2：撤回后合并单标已撤回，同一对项目不能再直接并，申请仍可", () => {
  it("合并单状态已撤回；同对（正向、反向）直接并被拦、提示重新发起申请；走申请照样发得起来、确认也成", async () => {
    const { a, b } = await 一对();
    const r = await 发(a, b, 销管);
    if (r.方式 !== "直接并") throw new Error("应该直接并");
    expect(await 撤回项目合并(prisma, r.mergeId, 销管)).toMatchObject({ ok: true });
    expect(await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: r.mergeId } })).toMatchObject({ status: "已撤回", undoneById: 销管.id });
    // 确认人 / 系统管理员直接并（正向）
    for (const 人 of [销管, 老板]) {
      expect(await 发起跨负责人并(prisma, a, b, 人, { 现在: 周五下午 })).toMatchObject({ ok: false, error: expect.stringContaining("撤回过，要并请重新发起申请") });
    }
    // 反向（b 留下、a 并走：乙是被并走的负责人，让老板直接并）
    expect(await 发起跨负责人并(prisma, b, a, 老板, { 现在: 周五下午 })).toMatchObject({ ok: false, error: expect.stringContaining("撤回过，要并请重新发起申请") });
    // 走申请：发起人发申请、确认人确认
    const id = await 请(a, b);
    expect(await 处理跨并申请(prisma, id, 销管, "确认")).toMatchObject({ ok: true });
  });
  it("别的一对不受影响；同负责人普通直接并不受影响", async () => {
    const { a, b, c } = await 一对();
    const r = await 发(a, b, 销管);
    if (r.方式 !== "直接并") throw new Error("应该直接并");
    await 撤回项目合并(prisma, r.mergeId, 销管);
    const b2 = await 项目(丙.id, c);
    expect(await 发起跨负责人并(prisma, a, b2, 销管, { 现在: 周五下午 })).toMatchObject({ ok: true });
  });
  it("30 天从合并生效时刻起算（不是申请发起时刻）", async () => {
    const { a, b } = await 一对();
    const id = await 请(a, b, 乙, 京("2026-10-01 10:00"));
    expect(await 处理跨并申请(prisma, id, 销管, "确认", { 现在: 京("2026-10-03 10:00") })).toMatchObject({ ok: true });
    const mergeId = (await raw.entProjectMergeRequest.findUniqueOrThrow({ where: { id } })).mergeId!;
    expect((await raw.entCustomerMerge.findUniqueOrThrow({ where: { id: mergeId } })).at.getTime()).toBe(京("2026-10-03 10:00").getTime());
    // 距合并 29 天可撤（距申请已超 30 天）
    expect(await 撤回项目合并(prisma, mergeId, 乙, 京("2026-11-01 10:00"))).toMatchObject({ ok: true });
  });
});
