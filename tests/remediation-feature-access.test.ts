import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: { id: "", name: "QA", email: "qa", role: "ADMIN", title: "管理员" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => state.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
// 订单节点、供应商页两个开关连同它们的写入口 2026-10-28 已删，订单 / 供应商表 2026-10-29 删了（迁移 066），这里只剩报价明细
import { 报价明细 } from "@/lib/features";
import { saveOpportunity, 读报价 } from "@/app/(app)/opportunities/actions";

let ids: { customer: string; opportunity: string };
beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  const user = await prisma.user.create({ data: { email: "qa-features", name: "QA", role: "ADMIN", password: "unused" } });
  state.user.id = user.id;
  const c = await prisma.customer.create({ data: { name: "QA-客户", phone: "", salesOwnerId: user.id } });
  const o = await prisma.opportunity.create({ data: { name: "QA-商机", customerId: c.id, ownerId: user.id } });
  ids = { customer: c.id, opportunity: o.id };
});
afterAll(async () => { await prisma.$disconnect(); });

async function snapshot() {
  return JSON.stringify(await Promise.all([
    prisma.opportunity.findMany(), prisma.quote.findMany(), prisma.followUp.findMany(), prisma.auditLog.findMany(),
  ]));
}

describe("L-110/W-050 关闭功能的服务端同样拒绝", () => {
  it.each([
    ["保存关闭的报价明细", () => saveOpportunity({ id: ids.opportunity, name: "QA-商机修改", customerId: ids.customer, ownerId: state.user.id, amount: 1, stage: "初步沟通", status: "OPEN", probability: 20, 报价: [{ product: "QA", qty: 1, unitPrice: 1 }] })],
  ] as const)("%s：拒绝且业务库完全不变", async (_label, operation) => {
    expect(报价明细).toBe(false);
    const before = await snapshot();
    expect(await operation()).toMatchObject({ ok: false, error: expect.stringContaining("未开放") });
    expect(await snapshot()).toBe(before);
  });

  it("关闭的只读高级入口不返回遗留明细", async () => {
    expect(await 读报价(ids.opportunity)).toEqual([]);
  });
});
