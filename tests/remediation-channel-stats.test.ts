/**
 * 渠道页取数趟数（原 remediation-channel-radar，2026-10-29 渠道改版后转介绍雷达整个去掉了）：
 * 渠道再多，项目只读一趟、投入只读一趟，不按渠道一个个查；交给界面的 props 里也不再有 radar。
 */
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { id: "qa_radar", name: "QA", email: "qa-radar", role: "ADMIN", title: "管理员" } }));
vi.mock("next/cache", () => ({ revalidatePath() {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => state.user }));
vi.mock("@/app/(app)/channels/ChannelsView", () => ({ default: () => null }));
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import Page from "@/app/(app)/channels/page";

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  await prisma.user.create({ data: { ...state.user, password: "qa" } });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await prisma.$disconnect();
});

it("20 个渠道：项目一趟、投入一趟读完，每行带上自己的统计，没有 radar", async () => {
  await prisma.channel.createMany({ data: Array.from({ length: 20 }, (_, i) => ({ id: `channel-${i}`, name: `渠道${i}|来源`, platform: `渠道${i}`, channelOwnerId: state.user.id })) });
  const 客户 = await prisma.customer.create({ data: { name: "甲", phone: "", salesOwnerId: state.user.id, channelId: "channel-0" } });
  await prisma.project.create({ data: { name: "项目一", customerId: 客户.id, ownerId: state.user.id, creatorId: state.user.id } });
  await prisma.entChannelInvest.create({ data: { channelId: "channel-0", amount: 100, currency: "CNY", date: new Date(), userId: state.user.id } });

  const 项目读 = vi.spyOn(prisma.project, "findMany");
  const 投入读 = vi.spyOn(prisma.entChannelInvest, "findMany");
  const props = (await Page()).props as { rows: { id: string; 统计?: { 关联项目: number; 当前投入: { 币种: string; 合计: number }[] } }[]; radar?: unknown };

  expect(项目读).toHaveBeenCalledTimes(1);
  expect(投入读).toHaveBeenCalledTimes(1);
  expect(props.rows).toHaveLength(20);
  expect(props).not.toHaveProperty("radar");
  const 第一 = props.rows.find((r) => r.id === "channel-0");
  expect(第一?.统计?.关联项目).toBe(1);
  expect(第一?.统计?.当前投入).toEqual([{ 币种: "CNY", 合计: 100 }]);
  expect(props.rows.find((r) => r.id === "channel-1")?.统计?.关联项目).toBe(0);
});
