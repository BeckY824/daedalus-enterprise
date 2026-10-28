/**
 * 企业版只用项目时，AI 记跟进卡确认后挂项目（10-28，dashboard/apply.ts 的 add_followup）。
 * 钉的是：这位客户看得到的在推项目（lib/project/active.ts 在推项目条件：没结局、不在公海）只有一个 → 挂上；
 * 好几个 → 不挂（卡片上挑项目是后续的事）；已结束 / 在公海的不算数；不是企业版 → 照旧不挂。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "小王", email: "s1", role: "SALES", title: "", avatar: null },
  企业版: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => mocks.企业版 }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";
import { applyProposal } from "@/app/(app)/dashboard/apply";

let 销售: string, 客户: string;
let 序 = 0;
const 项目 = (补: Record<string, unknown> = {}) =>
  prisma.project.create({ data: { name: `项目${++序}`, customerId: 客户, ownerId: 销售, creatorId: 销售, phase: "商机", node: "明确需求", ...补 } });
// 每张卡内容不同：同一张卡 10 分钟内确认第二次会被拦
const 确认跟进卡 = () => applyProposal({
  id: `f${++序}`, kind: "add_followup", customerId: 客户, customerName: "客户甲", reason: "测试",
  type: "PHONE", title: "", content: `电话聊了报价 ${序}`, occurredAt: dayjs().subtract(1, "hour").toISOString(),
});
const 挂的项目 = async () => {
  const f = await prisma.followUp.findFirstOrThrow({ orderBy: { createdAt: "desc" }, select: { id: true } });
  return (await prisma.followUpProject.findUnique({ where: { followUpId: f.id } }))?.projectId ?? null;
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.企业版 = true;
  销售 = (await prisma.user.create({ data: { email: "s1", name: "小王", title: "", role: "SALES", password: "x" } })).id;
  mocks.user = { ...mocks.user, id: 销售 };
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 销售 } })).id;
  await setSetting("business", { projectMode: true });
  invalidateSettingsCache();
});

describe("AI 记跟进卡挂项目", () => {
  it("只有一个在推项目：挂上它（已结束、在公海的不算数）", async () => {
    const p = await 项目();
    await 项目({ result: "丢单" });
    await 项目({ pooledAt: new Date() });
    expect(await 确认跟进卡()).toMatchObject({ ok: true });
    expect(await 挂的项目()).toBe(p.id);
  });

  it("两个在推项目：不挂，跟进照样记在客户下", async () => {
    await 项目();
    await 项目();
    expect(await 确认跟进卡()).toMatchObject({ ok: true });
    expect(await 挂的项目()).toBeNull();
    expect(await prisma.followUp.count({ where: { customerId: 客户 } })).toBe(1);
  });

  // 企业版里项目模式是锁死开着的（business-config 企业版锁定），所以「关」只有不是企业版这一种
  it("不是企业版：照旧不挂", async () => {
    await 项目();
    mocks.企业版 = false;
    expect(await 确认跟进卡()).toMatchObject({ ok: true });
    expect(await 挂的项目()).toBeNull();
    expect(await prisma.followUp.count({ where: { customerId: 客户 } })).toBe(1);
  });
});
