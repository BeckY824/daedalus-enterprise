/**
 * 企业版「沟通必须挂项目」（11-17 客户定，取代 P-界面-35 / X-144；lib/project/follow-needs-project.ts）。
 *   客户页记沟通（saveFollowUp）：没项目 / 没在推项目 / 都记不了 → 拦下说清楚、一条不存；几个在推项目没选 → 要选；只有一个 → 自动挂；
 *     公海客户没项目 → 先领取（不顺手领取）；待办 / 提醒照旧只挂客户；背调存档（不挂项目也能存）照旧；
 *     没挂项目的待办改成沟通 → 拦（老的客户沟通照旧能改）
 *   完成跟进计划（saveFollowUp 的 附带.完成计划）：有项目照常记一笔 + 完成计划；没项目整条不存、计划不动（小框改走「只标完成」）
 *   项目详情记沟通（记项目沟通）：已进组的组员能记、ownerId 是记的人；已结束的项目不记
 *   首页 AI 记沟通卡（applyProposal）：卡上选了项目就挂它；几个没选要选；没项目拦下
 *   沟通可选项目：给完成计划小框、AI 卡用的那张单
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "小王", email: "s1", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";
import { saveFollowUp, 沟通可选项目, type FollowUpInput } from "@/app/(app)/customers/[id]/actions";
import { applyProposal } from "@/app/(app)/dashboard/apply";
import { 记项目沟通 } from "@/lib/project/db";
import { 存背调到客户 } from "@/lib/research/actions";
import { 初始状态 } from "@/lib/research/state";
import { 无效客户不能记沟通话 } from "@/lib/enterprise/pool-rules";
import {
  不挂项目也能存, 沟通没项目话, 沟通没在推项目话, 沟通要选项目话, 沟通都不能记话, 沟通客户在公海话, 沟通项目已结束话, 沟通不是组员话, 待办改沟通话,
} from "@/lib/project/follow-needs-project";

let 我: string, 同事: string, 客户: string;
let 序 = 0;
const 项目 = (补: Record<string, unknown> = {}) =>
  prisma.project.create({ data: { name: `项目${++序}`, customerId: 客户, ownerId: 我, creatorId: 我, phase: "商机", node: "明确需求", ...补 } });
const 记 = (补: Partial<FollowUpInput> = {}) => saveFollowUp({
  customerId: 客户, type: "PHONE", content: "聊了报价", status: "已完成", occurredAt: dayjs().format("YYYY-MM-DD HH:mm"), ...补,
});
const 挂在 = async (followUpId: string) => (await prisma.followUpProject.findUnique({ where: { followUpId } }))?.projectId ?? null;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  我 = (await prisma.user.create({ data: { email: "s1", name: "小王", title: "", role: "SALES", password: "x" } })).id;
  同事 = (await prisma.user.create({ data: { email: "s2", name: "小李", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: 我, bizRole: "sales" }, { userId: 同事, bizRole: "sales" }] });
  mocks.user = { ...mocks.user, id: 我, role: "SALES" };
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 我 } })).id;
});

describe("客户页记沟通", () => {
  it("客户一个项目都没有：拦下说先建项目，一条不存", async () => {
    expect(await 记()).toEqual({ ok: false, error: 沟通没项目话, 没项目: true });
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("项目都已结束或在公海：拦下说没有在推的项目", async () => {
    await 项目({ result: "丢单" });
    await 项目({ pooledAt: new Date() });
    expect(await 记()).toEqual({ ok: false, error: 沟通没在推项目话, 没项目: true });
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("在推项目都是同事的、我不在组里：拦下说找负责人或新建", async () => {
    await 项目({ ownerId: 同事, creatorId: 同事 });
    expect(await 记()).toEqual({ ok: false, error: 沟通都不能记话 });
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("几个在推项目、没选：要选（不猜）；选了挂选的那个", async () => {
    await 项目();
    const 二 = await 项目();
    expect(await 记()).toEqual({ ok: false, error: 沟通要选项目话 });
    expect(await prisma.followUp.count()).toBe(0);
    const r = await 记({ projectId: 二.id });
    expect(r).toMatchObject({ ok: true });
    expect(await 挂在((r as { id: string }).id)).toBe(二.id);
  });

  it("只有一个能记的在推项目（另有同事的、已结束的）：没选也自动挂它", async () => {
    const 我的 = await 项目();
    await 项目({ ownerId: 同事, creatorId: 同事 });
    await 项目({ result: "成功交付" });
    const r = await 记();
    expect(r).toMatchObject({ ok: true });
    expect(await 挂在((r as { id: string }).id)).toBe(我的.id);
  });

  it("选了已结束的项目：不存（不再记成客户沟通）", async () => {
    await 项目();
    const 结束 = await 项目({ result: "丢单" });
    expect(await 记({ projectId: 结束.id })).toEqual({ ok: false, error: 沟通项目已结束话 });
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("待办、提醒：没项目照样只挂客户", async () => {
    const 后天 = dayjs().add(2, "day").format("YYYY-MM-DD HH:mm");
    for (const type of ["TASK", "REMIND"]) {
      const r = await 记({ type, content: `要做的事 ${type}`, status: "待处理", dueAt: 后天, dueHasTime: true });
      expect(r).toMatchObject({ ok: true });
      expect(await 挂在((r as { id: string }).id)).toBeNull();
    }
  });

  it("背调存档（不挂项目也能存）：没项目照样记在客户下；存背调到客户走的就是这条路", async () => {
    expect(await 不挂项目也能存(() => 记({ type: "OTHER", content: "背调报告" }))).toMatchObject({ ok: true });
    const 背调 = { ...初始状态({ name: "客户甲" }), done: true };
    expect(await 存背调到客户(客户, 背调)).toMatchObject({ ok: true });
    expect(await prisma.followUp.count({ where: { customerId: 客户, type: "OTHER" } })).toBe(2);
    expect(await prisma.followUpProject.count()).toBe(0);
    // 那一段过了就不免了
    expect(await 记({ type: "OTHER", content: "随手记" })).toMatchObject({ ok: false, error: 沟通没项目话 });
  });

  it("公海客户没在推项目：说先领取，不顺手领走", async () => {
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 同事 } });
    await prisma.customerPool.create({ data: { customerId: 客户, reason: "手动", userId: 同事 } });
    expect(await 记()).toEqual({ ok: false, error: 沟通客户在公海话, 没项目: true });
    expect(await prisma.customerPool.count({ where: { customerId: 客户 } })).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } })).salesOwnerId).toBe(同事);
  });

  // 11-20 c2 实操：公海回收站里的无效客户（P-公海-09）领不了（M-权限-03）。真正的沟通挂不上在推项目：整条不存、说先恢复（原来照存一条、领取悄悄没成）
  it("标了无效的公海客户、名下没有我能记的在推项目：沟通不记、不领，说要先恢复", async () => {
    const 项 = await 项目({ ownerId: "", pooledAt: new Date() });
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 同事, poolInvalidAt: new Date() } });
    await prisma.customerPool.create({ data: { customerId: 客户, reason: "手动", userId: 同事 } });
    expect(await 记()).toEqual({ ok: false, error: 无效客户不能记沟通话 });
    expect(await 记({ projectId: 项.id })).toEqual({ ok: false, error: 无效客户不能记沟通话 });
    expect(await 记({ type: "OTHER", content: "随手记" })).toEqual({ ok: false, error: 无效客户不能记沟通话 });
    expect(await prisma.followUp.count({ where: { customerId: 客户 } })).toBe(0);
    expect(await prisma.customerPool.count({ where: { customerId: 客户 } })).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } })).salesOwnerId).toBe(同事);
  });

  // 审查 29A：同事 A 把客户退回公海、又标了无效，我名下在推的项目留在原处（pooledAt 空）。首页 AI 记沟通卡 / 完成计划带 projectId 走这里，
  // 和项目页 记项目沟通Action 一样照记、挂我的项目；客户不领、还在公海、无效标不动
  it("标了无效的公海客户、我名下在推项目留在原处：挂上这个项目照记，不领客户", async () => {
    const 项 = await 项目({ ownerId: 我 });
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 同事, poolInvalidAt: new Date() } });
    await prisma.customerPool.create({ data: { customerId: 客户, reason: "手动", userId: 同事 } });
    const 带项目 = await 记({ projectId: 项.id });
    expect(带项目).toMatchObject({ ok: true });
    expect(带项目).not.toHaveProperty("领取了");
    expect(await 挂在((带项目 as { id: string }).id)).toBe(项.id);
    // 没选：能记的只有这一个，自动挂它
    const 没选 = await 记({ content: "又聊了一次" });
    expect(没选).toMatchObject({ ok: true });
    expect(await 挂在((没选 as { id: string }).id)).toBe(项.id);
    expect(await prisma.customerPool.count({ where: { customerId: 客户 } })).toBe(1);
    const 客 = await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } });
    expect(客.salesOwnerId).toBe(同事);
    expect(客.poolInvalidAt).not.toBeNull();
  });

  it("标了无效的公海客户：待办 / 提醒、背调存档照旧能存（只挂客户），不领客户", async () => {
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 同事, poolInvalidAt: new Date() } });
    await prisma.customerPool.create({ data: { customerId: 客户, reason: "手动", userId: 同事 } });
    const 后天 = dayjs().add(2, "day").format("YYYY-MM-DD HH:mm");
    expect(await 记({ type: "TASK", content: "要做的事", status: "待处理", dueAt: 后天, dueHasTime: true })).toMatchObject({ ok: true });
    expect(await 存背调到客户(客户, { ...初始状态({ name: "客户甲" }), done: true })).toMatchObject({ ok: true });
    expect(await prisma.followUp.count({ where: { customerId: 客户 } })).toBe(2);
    expect(await prisma.customerPool.count({ where: { customerId: 客户 } })).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 客户 } })).salesOwnerId).toBe(同事);
  });

  it("没挂项目的待办改成沟通：拦；挂了项目的、老的客户沟通照旧能改", async () => {
    await prisma.entMember.update({ where: { userId: 我 }, data: { bizRole: "sales_mgr" } });
    const 待办 = await prisma.followUp.create({ data: { title: "", customerId: 客户, type: "TASK", content: "要做", status: "已完成", occurredAt: new Date(), ownerId: 我 } });
    const 改 = (id: string, type: string, 版本: Date) => saveFollowUp({ id, 版本: 版本.toISOString(), customerId: 客户, type, content: "改了", status: "已完成", occurredAt: dayjs().subtract(1, "hour").format("YYYY-MM-DD HH:mm") });
    expect(await 改(待办.id, "PHONE", 待办.updatedAt)).toEqual({ ok: false, error: 待办改沟通话 });
    const 老沟通 = await prisma.followUp.create({ data: { title: "", customerId: 客户, type: "PHONE", content: "老的", status: "已完成", occurredAt: new Date(), ownerId: 我 } });
    expect(await 改(老沟通.id, "WECHAT", 老沟通.updatedAt)).toMatchObject({ ok: true });
  });
});

describe("完成跟进计划时顺带记的一笔", () => {
  const 计划 = () => prisma.followPlan.create({ data: { subject: "发报价", plannedAt: new Date(), method: "电话沟通", customerId: 客户, ownerId: 我 } });
  const 完成着记 = (planId: string, 补: Partial<FollowUpInput> = {}) => 记({ ...补, 附带: { tasks: [], 完成计划: planId } });

  it("有项目：照常记一笔挂上项目，计划完成", async () => {
    const p = await 项目();
    const plan = await 计划();
    const r = await 完成着记(plan.id);
    expect(r).toMatchObject({ ok: true });
    expect(await 挂在((r as { id: string }).id)).toBe(p.id);
    expect((await prisma.followPlan.findUniqueOrThrow({ where: { id: plan.id } })).done).toBe(true);
  });

  it("没项目：整条不存，计划不动（小框只标完成那条路走 completePlan）；小框拿到的可选项目是空的", async () => {
    const plan = await 计划();
    expect(await 完成着记(plan.id)).toMatchObject({ ok: false, error: 沟通没项目话 });
    expect(await prisma.followUp.count()).toBe(0);
    expect((await prisma.followPlan.findUniqueOrThrow({ where: { id: plan.id } })).done).toBe(false);
    expect(await 沟通可选项目(客户)).toEqual({ ok: true, 项目们: [], 能建项目: true });
  });

  it("沟通可选项目：只列我能记的在推项目，组员进组的也算", async () => {
    const 我的 = await 项目({ name: "我的" });
    const 同事的 = await 项目({ name: "同事的", ownerId: 同事, creatorId: 同事 });
    await prisma.projectMember.create({ data: { projectId: 同事的.id, userId: 我, inviteStatus: "JOINED" } });
    await 项目({ name: "别人的", ownerId: 同事, creatorId: 同事 });
    await 项目({ name: "结束的", result: "丢单" });
    const r = await 沟通可选项目(客户);
    expect(r.ok && r.项目们?.map((x) => x.id).sort()).toEqual([我的.id, 同事的.id].sort());
  });
});

describe("项目详情记沟通（记项目沟通）", () => {
  const 向导 = { type: "PHONE", content: "项目上聊了", occurredAt: dayjs().subtract(1, "hour").toISOString(), 下一步: "发报价", 阶段: "商机" };

  it("已进组的组员能记：记录是组员记的，项目负责人不变；只是被邀请的不能记", async () => {
    const p = await 项目({ ownerId: 同事, creatorId: 同事 });
    await prisma.projectMember.create({ data: { projectId: p.id, userId: 我, inviteStatus: "INVITED" } });
    expect(await 记项目沟通({ id: 我, role: "SALES" }, p.id, 向导)).toEqual({ ok: false, error: 沟通不是组员话 });
    await prisma.projectMember.update({ where: { projectId_userId: { projectId: p.id, userId: 我 } }, data: { inviteStatus: "JOINED" } });
    const r = await 记项目沟通({ id: 我, role: "SALES" }, p.id, 向导);
    expect(r).toMatchObject({ ok: true });
    const f = await prisma.followUp.findUniqueOrThrow({ where: { id: r.followUpId! } });
    expect(f.ownerId).toBe(我);
    expect(await 挂在(f.id)).toBe(p.id);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(同事);
  });

  it("已结束的项目：不记", async () => {
    const p = await 项目({ result: "丢单" });
    expect(await 记项目沟通({ id: 我, role: "SALES" }, p.id, 向导)).toEqual({ ok: false, error: 沟通项目已结束话 });
    expect(await prisma.followUp.count()).toBe(0);
  });
});

describe("首页 AI 记沟通卡", () => {
  beforeEach(async () => {
    await setSetting("business", { projectMode: true });
    invalidateSettingsCache();
  });
  const 卡 = (补: Record<string, unknown> = {}) => applyProposal({
    id: `f${++序}`, kind: "add_followup", customerId: 客户, customerName: "客户甲", reason: "测试",
    type: "PHONE", title: "", content: `电话聊了报价 ${序}`, occurredAt: dayjs().subtract(1, "hour").toISOString(), ...补,
  });
  const 最新挂在 = async () => 挂在((await prisma.followUp.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).id);

  it("没项目：拦下说先建项目", async () => {
    expect(await 卡()).toMatchObject({ ok: false, error: 沟通没项目话 });
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("几个在推项目没选：要选；卡上选了就挂选的那个", async () => {
    await 项目();
    const 二 = await 项目();
    expect(await 卡()).toMatchObject({ ok: false, error: 沟通要选项目话 });
    expect(await 卡({ projectId: 二.id })).toMatchObject({ ok: true });
    expect(await 最新挂在()).toBe(二.id);
  });

  it("唯一在推项目是同事的、我已进组：挂上（组员可记）", async () => {
    const p = await 项目({ ownerId: 同事, creatorId: 同事 });
    await prisma.projectMember.create({ data: { projectId: p.id, userId: 我, inviteStatus: "JOINED" } });
    expect(await 卡()).toMatchObject({ ok: true });
    expect(await 最新挂在()).toBe(p.id);
  });

  it("待办卡：没项目照样记在客户下", async () => {
    expect(await 卡({ type: "TASK" })).toMatchObject({ ok: true });
    expect(await 最新挂在()).toBeNull();
  });
});
