import { beforeEach, afterAll, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { id: "", name: "QA", email: "qa", role: "ADMIN", title: "管理员" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => state.user }));
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { BUSINESS_PRESETS } from "@/lib/business-config";
// 商机的新建 / 编辑 / 拖阶段入口 2026-11-11 删了（企业版只用项目，走不到），只剩签约那条线还引着的 setOppStatus
import { setOppStatus } from "@/app/(app)/opportunities/actions";
let customerId: string;
beforeEach(async () => {
  await resetDb(); invalidateSettingsCache();
  state.user.id = (await prisma.user.create({ data: { name: "QA", email: "qa-opp", password: "unused", role: "ADMIN" } })).id;
  customerId = (await prisma.customer.create({ data: { name: "QA客户", phone: "", salesOwnerId: state.user.id } })).id;
});
afterAll(async () => { await prisma.$disconnect(); });
const create = (patch = {}) => prisma.opportunity.create({ data: { name: "QA商机", customerId, ownerId: state.user.id, amount: 100, stage: "方案报价", status: "OPEN", probability: 75, ...patch } });
it.each(["WON", "LOST"])("J-091 %s重新打开，不留下赢单阶段/关闭概率", async (status) => {
  const o = await create({ status, stage: status === "WON" ? "赢单成交" : "方案报价", probability: status === "WON" ? 100 : 0, closed: { create: {} } });
  expect((await setOppStatus(o.id, "OPEN")).ok).toBe(true);
  const after = await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id }, include: { closed: true } });
  expect(after.stage).not.toBe("赢单成交"); expect(after.probability).toBeGreaterThan(0); expect(after.probability).toBeLessThan(100); expect(after.closed).toBeNull();
});
it("W-008 外贸不能无订单标成已转订单", async () => {
  await setSetting("business", BUSINESS_PRESETS["外贸出口"]); invalidateSettingsCache();
  const o = await create();
  expect(await setOppStatus(o.id, "WON")).toMatchObject({ ok: false, error: expect.stringContaining("订单") });
  expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("OPEN");
  expect(await prisma.auditLog.count()).toBe(0);
});
it("W-008 改状态不能绕过已转订单的回退限制（订单表 2026-10-29 删了，认签约连着的商机）", async () => {
  await setSetting("business", BUSINESS_PRESETS["外贸出口"]); invalidateSettingsCache();
  const o = await create({ status: "WON", stage: "赢单成交", probability: 100 });
  const c = await prisma.contract.create({ data: { customerId, amount: 100, signedAt: new Date() } });
  await prisma.contractWin.create({ data: { opportunityId: o.id, contractId: c.id, prevStage: "方案报价", prevProbability: 75 } });
  expect(await setOppStatus(o.id, "OPEN")).toMatchObject({ ok: false, error: expect.stringContaining("已经转成订单") });
  expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("WON");
});
it("结单写入故障时阶段和状态整体回滚", async () => {
  const o = await create();
  await prisma.$executeRawUnsafe("CREATE TRIGGER qa_close_failure BEFORE INSERT ON OpportunityClose BEGIN SELECT RAISE(ABORT, 'QA close unavailable'); END");
  try { try { await setOppStatus(o.id, "WON"); } catch {} } finally { await prisma.$executeRawUnsafe("DROP TRIGGER qa_close_failure"); }
  expect(await prisma.opportunity.findUniqueOrThrow({ where: { id: o.id } })).toEqual(o);
  expect(await prisma.auditLog.count()).toBe(0);
});
