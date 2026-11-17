/**
 * AI 记沟通卡按个人习惯默认沟通方式（11-18，22B；同记沟通框 lib/follow-habit.ts）：
 *   AI 没给类型 → 用这个人最近 20 条里用得最多的那种（企业版连方式一起带上）；一条都没有 → 照旧电话；AI 给了类型 → 用 AI 的
 *   卡上人换了类型：原来带的方式和类型对不上，确认时不作数（buildProposal 重新校验）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { buildProposal, type Proposal } from "@/lib/agent/proposals";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" }),
}));

let 客户 = "";

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "ADMIN", password: "x" } });
  await prisma.user.create({ data: { id: "other-id", email: "o@t", name: "同事", role: "ADMIN", password: "x" } });
  客户 = (await prisma.customer.create({ data: { name: "示例客户", phone: "13800000001", salesOwnerId: "tester-id" } })).id;
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

async function 记几条(ownerId: string, type: string, method: string | null, 条: number) {
  for (let i = 0; i < 条; i++) {
    await prisma.followUp.create({ data: { customerId: 客户, ownerId, type, method, title: "", content: `第 ${i} 条`, status: "已完成", occurredAt: new Date() } });
  }
}

async function 出卡(args: Record<string, unknown>): Promise<Proposal> {
  const { TOOL_MAP } = await import("@/lib/agent/tools");
  const { getBusiness } = await import("@/lib/business");
  const ctx = { userId: "tester-id", userName: "测试员", b: await getBusiness(), recordOffset: 0, proposals: [] as Proposal[], 号: <T,>(p: T) => p };
  const r = await TOOL_MAP.get("propose_followup")!.run({ id: 客户, content: "聊了报价细节", reason: "r", ...args }, ctx as never);
  expect(ctx.proposals, `工具回：${JSON.stringify(r.data)}`).toHaveLength(1);
  return ctx.proposals[0];
}

describe("propose_followup：AI 没给类型", () => {
  it("没有记录 → 照旧电话", async () => {
    expect(await 出卡({})).toMatchObject({ kind: "add_followup", type: "PHONE" });
  });

  it("有记录 → 用自己用得最多的那种；同事的不算", async () => {
    await 记几条("tester-id", "WECHAT", null, 3);
    await 记几条("tester-id", "EMAIL", null, 1);
    await 记几条("other-id", "VISIT", null, 6);
    expect(await 出卡({})).toMatchObject({ type: "WECHAT" });
  });

  it("AI 给了类型 → 用 AI 的，不看习惯", async () => {
    await 记几条("tester-id", "WECHAT", null, 3);
    const 卡 = await 出卡({ type: "上门拜访" });
    expect(卡).toMatchObject({ type: "VISIT" });
    expect((卡 as { method?: string }).method).toBeUndefined();
  });

  it("企业版：方式一起带上（字典里启用着的）", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    await 记几条("tester-id", "WECHAT", "微信沟通", 2);
    await 记几条("tester-id", "PHONE", "手机通话", 1);
    expect(await 出卡({})).toMatchObject({ type: "WECHAT", method: "微信沟通" });
  });
});

describe("buildProposal：方式和类型对得上才留", () => {
  const b = { sources: [], fields: {}, grades: [] } as unknown as Parameters<typeof buildProposal>[4];
  it("对得上留，对不上（人在卡上换了类型）丢掉", () => {
    const 留 = buildProposal("x", "add_followup", { id: "c", name: "c" }, { type: "WECHAT", method: "微信沟通", content: "聊了", reason: "r" }, b);
    expect(留.ok && 留.proposal).toMatchObject({ type: "WECHAT", method: "微信沟通" });
    const 丢 = buildProposal("x", "add_followup", { id: "c", name: "c" }, { type: "EMAIL", method: "微信沟通", content: "聊了", reason: "r" }, b);
    expect(丢.ok && 丢.proposal).toMatchObject({ type: "EMAIL" });
    expect(丢.ok && (丢.proposal as { method?: string }).method).toBeUndefined();
  });
});
