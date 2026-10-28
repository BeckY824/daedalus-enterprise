/**
 * 企业版只用项目时老入口加闸（10-28 定版前收口，src/lib/enterprise/project-only.ts 只用项目挡老入口）。
 *
 *   合同（saveContract / deleteContract）、商机（saveOpportunity / moveStage / setOppStatus / restoreOpportunities）、
 *   只用项目时拒绝、一行不写（订单页和它的写入口 2026-10-28 已整页删除）
 *   没开项目模式、或不是企业版：不挡（团队版 / 个人版照旧）
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ 开: true, user: { id: "", name: "老板", email: "a@x", role: "ADMIN", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.开 }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 只用项目挡老入口 } from "@/lib/enterprise/project-only";
import { saveContract, deleteContract } from "@/app/(app)/customers/actions";
import { saveOpportunity, moveStage, setOppStatus, restoreOpportunities } from "@/app/(app)/opportunities/actions";

let 客户 = "";

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.开 = true;
  vi.stubEnv("CRM_ENTERPRISE", "1");
  mocks.user.id = (await prisma.user.create({ data: { email: "a@x", name: "老板", title: "", role: "ADMIN", password: "x" } })).id;
  客户 = (await prisma.customer.create({ data: { name: "云帆科技", phone: "13900000001", salesOwnerId: mocks.user.id } })).id;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe("只用项目挡老入口", () => {
  it("只用项目：说清并进项目了；没开项目模式、不是企业版：不挡", async () => {
    expect(await 只用项目挡老入口("合同")).toBe("这里合同已并进项目：请到项目页推进或记成交");
    mocks.开 = false;
    expect(await 只用项目挡老入口("合同")).toBeNull();
    mocks.开 = true;
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 只用项目挡老入口("商机")).toBeNull();
  });

  it("合同、商机的写入口都拒绝，一行不写", async () => {
    const 挡 = (东西: string) => ({ ok: false, error: `这里${东西}已并进项目：请到项目页推进或记成交` });
    expect(await saveContract({ customerId: 客户, amount: 1000, signedAt: new Date() } as never)).toEqual(挡("合同"));
    expect(await deleteContract("x", 客户, null)).toEqual(挡("合同"));
    expect(await saveOpportunity({ customerId: 客户, name: "二期", amount: 1000, stage: "初步沟通", probability: 20 } as never)).toEqual(挡("商机"));
    expect(await moveStage("x", "初步沟通")).toEqual(挡("商机"));
    expect(await setOppStatus("x", "WON")).toEqual(挡("商机"));
    expect(await restoreOpportunities([])).toEqual(挡("商机"));
    expect([await prisma.contract.count(), await prisma.opportunity.count()]).toEqual([0, 0]);
  });

  it("没开项目模式：照旧能记合同、建商机", async () => {
    mocks.开 = false;
    expect(await saveContract({ customerId: 客户, amount: 1000, signedAt: new Date() } as never)).toMatchObject({ ok: true });
    expect(await saveOpportunity({ customerId: 客户, name: "二期", amount: 1000, stage: "初步沟通", status: "OPEN", probability: 20, expectedDealAt: null, remark: "" } as never)).toMatchObject({ ok: true });
    expect([await prisma.contract.count(), await prisma.opportunity.count()]).toEqual([1, 1]);
  });
});
