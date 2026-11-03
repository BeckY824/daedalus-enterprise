/**
 * 离职交接（企业版 D-36，2026-10-24；11-03 C4-4 / B7-2 改）：企业版办离职只停用、名下原地不动，
 * 不再有「放进公海」方式；之后在「项目 → 离职交接」里一键「全部交给」接手人——
 *   全给接手人（原来的转交），他负责、挂在别人客户上的没结局项目也一起转
 * 停用前的清点和全部交给同一套分法，数要对得上；200 条以内一次做完不卡
 * 不是企业版（CRM_ENTERPRISE 不设）：没有公海方式、不清点，转交和原来一样（别处的项目不动）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "甲", email: "a@x", role: "ADMIN", title: "管理员", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { deactivateUser, 停用清点 } from "@/app/(app)/settings/actions";
import { 领取 } from "@/app/(app)/customers/pool-actions";
import { 交接全部 } from "@/app/(app)/projects/handover/actions";
import { 公海超时收回 } from "@/lib/project/db";
import { 默认组织规则 } from "@/lib/project/org-rules";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";

let 甲: string;
let 乙: string;
let 丙: string;
let 号 = 0;

const 客户 = (name: string, salesOwnerId: string, followStatus = "跟进中") =>
  prisma.customer.create({ data: { name, phone: `1380000${String(++号).padStart(4, "0")}`, salesOwnerId, followStatus } });
const 项目 = (name: string, ownerId: string, customerId: string, phase = "线索", node = "潜客培育") =>
  prisma.project.create({ data: { name, customerId, ownerId, creatorId: ownerId, phase, node } });
const 项目of = (id: string) => prisma.project.findUniqueOrThrow({ where: { id } });
const 客户of = (id: string) => prisma.customer.findUniqueOrThrow({ where: { id }, include: { pool: true } });

beforeEach(async () => {
  await resetDb();
  号 = 0;
  甲 = (await prisma.user.create({ data: { email: "jia", name: "甲", title: "", role: "ADMIN", password: "x" } })).id;
  乙 = (await prisma.user.create({ data: { email: "yi", name: "乙", title: "", role: "SALES", password: "x" } })).id;
  丙 = (await prisma.user.create({ data: { email: "bing", name: "丙", title: "", role: "SALES", password: "x" } })).id;
  // 11-01 权限只认业务角色：甲（账号 ADMIN）要有总管理才能办离职，业务员要有销售
  await prisma.entMember.createMany({ data: [{ userId: 甲, bizRole: "director" }, { userId: 乙, bizRole: "sales" }, { userId: 丙, bizRole: "sales" }] });
  mocks.user = { ...mocks.user, id: 甲, role: "ADMIN" };
  vi.stubEnv("CRM_ENTERPRISE", "1");
});
afterEach(() => { vi.unstubAllEnvs(); });

afterAll(async () => { await prisma.$disconnect(); });

/** 企业版办离职（原地不动）+ 离职交接看板「全部交给」 */
async function 离职全部交给(from: string, to: string) {
  expect(await deactivateUser(from, "")).toEqual({ ok: true });
  expect((await 交接全部(from, to)).ok).toBe(true);
}

describe("不是企业版", () => {
  beforeEach(() => { vi.stubEnv("CRM_ENTERPRISE", ""); });

  it("放进公海方式直接拒，什么都不动；清点也不给", async () => {
    const c = await 客户("乙的客户", 乙);
    const p = await 项目("乙的", 乙, c.id);
    expect(await deactivateUser(乙, 丙, "公海")).toMatchObject({ ok: false, error: expect.stringContaining("企业版") });
    expect((await 客户of(c.id))).toMatchObject({ salesOwnerId: 乙, pool: null });
    expect((await 项目of(p.id)).ownerId).toBe(乙);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 乙 } })).active).toBe(true);
    expect(await 停用清点(乙)).toMatchObject({ ok: false, error: expect.stringContaining("企业版") });
  });

  it("转交和原来一样：项目只跟着转走的客户走，他挂在别人客户上的项目留着", async () => {
    const c = await 客户("乙的客户", 乙);
    const 丙的客户 = await 客户("丙的客户", 丙);
    const p1 = await 项目("乙的", 乙, c.id);
    const p2 = await 项目("别处的", 乙, 丙的客户.id);
    expect(await deactivateUser(乙, 甲)).toEqual({ ok: true });
    expect((await 客户of(c.id)).salesOwnerId).toBe(甲);
    expect((await 项目of(p1.id)).ownerId).toBe(甲);
    expect((await 项目of(p2.id)).ownerId).toBe(乙);
    expect(await prisma.customerPool.count()).toBe(0);
    // 审计详情和加开关前一字不差：键和顺序都一样，不多记方式、进公海清单
    const 记 = await prisma.auditLog.findFirstOrThrow({ where: { action: "deactivate", entityId: 乙 } });
    expect(Object.keys(JSON.parse(记.detail!))).toEqual(["userId", "transferToId", "转走了"]);
    expect(Object.keys(JSON.parse(记.detail!).转走了)).toEqual(["客户", "商机", "待办", "计划", "线索", "渠道", "项目"]);
  });

  it("名下一个项目都没有：审计详情不写「项目」这个键（和加开关前一样）", async () => {
    await 客户("乙的客户", 乙);
    expect(await deactivateUser(乙, 甲)).toEqual({ ok: true });
    const 记 = await prisma.auditLog.findFirstOrThrow({ where: { action: "deactivate", entityId: 乙 } });
    expect(Object.keys(JSON.parse(记.detail!))).toEqual(["userId", "transferToId", "转走了"]);
    expect(Object.keys(JSON.parse(记.detail!).转走了)).toEqual(["客户", "商机", "待办", "计划", "线索", "渠道"]);
  });
});

describe("全部交给（原来的转交）", () => {
  it("客户、活、项目全给接手人；他挂在别人客户上的没结局项目也转，有结局的留着；跟进和建档人照旧", async () => {
    const c = await 客户("乙的客户", 乙);
    const 丙的客户 = await 客户("丙的客户", 丙);
    const 跟进 = await prisma.followUp.create({ data: { type: "PHONE", title: "打过电话", content: "聊了", customerId: c.id, ownerId: 乙 } });
    const 待办 = await prisma.task.create({ data: { title: "回电", customerId: c.id, ownerId: 乙 } });
    const 计划 = await prisma.followPlan.create({ data: { subject: "下周见", plannedAt: new Date(), customerId: 丙的客户.id, ownerId: 乙 } });
    const 商机 = await prisma.opportunity.create({ data: { name: "一单", customerId: 丙的客户.id, ownerId: 乙 } });
    const 赢了的 = await prisma.opportunity.create({ data: { name: "赢了", customerId: c.id, ownerId: 乙, status: "WON", stage: "赢单成交" } });
    const p1 = await 项目("乙的", 乙, c.id);
    const p2 = await 项目("别处的", 乙, 丙的客户.id, "订单", "签约");
    const p3 = await prisma.project.update({ where: { id: (await 项目("收尾的", 乙, 丙的客户.id)).id }, data: { result: "成功交付" } });

    expect(await deactivateUser(乙, 丙)).toEqual({ ok: true });
    // 办离职原地不动
    expect((await 客户of(c.id)).salesOwnerId).toBe(乙);
    expect((await 项目of(p2.id)).ownerId).toBe(乙);
    expect((await 交接全部(乙, 丙)).ok).toBe(true);

    expect((await 客户of(c.id)).salesOwnerId).toBe(丙);
    expect((await 客户of(c.id)).pool).toBeNull();
    expect((await prisma.task.findUniqueOrThrow({ where: { id: 待办.id } })).ownerId).toBe(丙);
    expect((await prisma.followPlan.findUniqueOrThrow({ where: { id: 计划.id } })).ownerId).toBe(丙);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: 商机.id } })).ownerId).toBe(丙);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: 赢了的.id } })).ownerId).toBe(乙);
    expect((await 项目of(p1.id)).ownerId).toBe(丙);
    expect((await 项目of(p2.id)).ownerId).toBe(丙);
    expect((await 项目of(p3.id)).ownerId).toBe(乙);
    // 历史：写过的跟进、建的项目照旧显示是他；转让痕记下从他到接手人、谁操作的
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: 跟进.id } })).ownerId).toBe(乙);
    expect((await 项目of(p1.id)).creatorId).toBe(乙);
    const 痕 = await prisma.projectNodeLog.findMany({ where: { kind: "transfer" }, select: { projectId: true, userId: true, fromOwnerId: true, toOwnerId: true } });
    expect(new Set(痕.map((x) => x.projectId))).toEqual(new Set([p1.id, p2.id]));
    expect(痕.every((x) => x.userId === 甲 && x.fromOwnerId === 乙 && x.toOwnerId === 丙)).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 乙 } })).active).toBe(false);
  });

  it("交接方式传错了直接拒，什么都不动", async () => {
    const c = await 客户("乙的客户", 乙);
    expect(await deactivateUser(乙, 丙, "随便" as never)).toMatchObject({ ok: false });
    expect((await 客户of(c.id)).salesOwnerId).toBe(乙);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 乙 } })).active).toBe(true);
  });
});

describe("放进公海（11-03 C4-4 去掉）", () => {
  it("企业版办离职传公海方式：直接拒，人还在职、什么都不动", async () => {
    const c = await 客户("乙的客户", 乙);
    expect(await deactivateUser(乙, 丙, "公海")).toMatchObject({ ok: false, error: expect.stringContaining("不再放进公海") });
    expect((await 客户of(c.id)).pool).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 乙 } })).active).toBe(true);
  });

  it("离职后客户被放进公海：上面没做完的活留在他名下，有人领了跟着走", async () => {
    const 去公海 = await 客户("去公海", 乙);
    const 公海上的待办 = await prisma.task.create({ data: { title: "回电", customerId: 去公海.id, ownerId: 乙 } });
    const 公海上的商机 = await prisma.opportunity.create({ data: { name: "一单", customerId: 去公海.id, ownerId: 乙 } });
    expect(await deactivateUser(乙, "")).toEqual({ ok: true });
    await prisma.customerPool.create({ data: { customerId: 去公海.id, userId: 甲, reason: "手动" } });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: 公海上的待办.id } })).ownerId).toBe(乙);

    // 丙从公海领走：客户、他没做完的活一起归丙
    mocks.user = { ...mocks.user, id: 丙, role: "SALES" };
    expect(await 领取([去公海.id])).toMatchObject({ ok: true, updated: 1 });
    expect(await 客户of(去公海.id)).toMatchObject({ salesOwnerId: 丙, pool: null });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: 公海上的待办.id } })).ownerId).toBe(丙);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: 公海上的商机.id } })).ownerId).toBe(丙);
  });
});

describe("进公海客户上的项目跟着客户（第四节）", () => {
  it("离职后客户在公海里：客户上的项目留在原负责人名下、超时不收；谁领客户谁带走项目", async () => {
    await setSetting("orgRules", { ...默认组织规则, 超时回收: { 开: true, 起算日: null, 节点天数: { 潜客培育: 1, 明确需求: 1 } } });
    const 去公海 = await 客户("去公海", 乙);
    const 跟客户的 = await 项目("跟客户的", 乙, 去公海.id);
    const 同事的 = await 项目("同事负责的", 甲, 去公海.id, "商机", "明确需求");

    expect(await deactivateUser(乙, "")).toEqual({ ok: true });
    await prisma.customerPool.create({ data: { customerId: 去公海.id, userId: 甲, reason: "手动" } });
    expect(await 项目of(跟客户的.id)).toMatchObject({ ownerId: 乙, pooledAt: null });

    // 过了时长也不收进项目公海：收了就和客户拆开，领客户的人拿不到
    invalidateSettingsCache();
    expect(await 公海超时收回({ id: 甲, name: "甲" }, dayjs().add(30, "day").toDate())).toBe(0);
    expect(await 项目of(跟客户的.id)).toMatchObject({ pooledAt: null });

    mocks.user = { ...mocks.user, id: 丙, role: "SALES" };
    expect(await 领取([去公海.id])).toMatchObject({ ok: true, updated: 1 });
    expect(await 项目of(跟客户的.id)).toMatchObject({ ownerId: 丙, pooledAt: null });
    expect(await 项目of(同事的.id)).toMatchObject({ ownerId: 丙, pooledAt: null });
    const 痕 = await prisma.projectNodeLog.findFirstOrThrow({ where: { projectId: 跟客户的.id, kind: "transfer" }, orderBy: { at: "desc" } });
    expect(痕).toMatchObject({ fromOwnerId: 乙, toOwnerId: 丙 });
  });
});

describe("停用清点", () => {
  it("清点的数和停用后「全部交给」做的对得上", async () => {
    const c1 = await 客户("跟进中", 乙);
    await 客户("签约", 乙, "已签约");
    const 本来在公海 = await 客户("本来在公海", 乙);
    await prisma.customerPool.create({ data: { customerId: 本来在公海.id, userId: 乙 } });
    const 丙的客户 = await 客户("丙的客户", 丙);
    await 项目("跟客户的", 丙, c1.id);
    await 项目("别处线索", 乙, 丙的客户.id);
    await 项目("别处订单", 乙, 丙的客户.id, "订单", "签约");

    const 点 = await 停用清点(乙);
    // 本来在公海的那位不算、不转（11-03 完成度 C4-1）
    expect(点).toEqual({ ok: true, 原地: { 客户: 2, 项目: 3 } });

    await 离职全部交给(乙, 甲);
    expect(await prisma.customer.count({ where: { salesOwnerId: 甲 } })).toBe(2);
    expect(await prisma.customerPool.count()).toBe(1);
    expect(await prisma.project.count({ where: { ownerId: 甲 } })).toBe(3);
  });

  it("业务员不能清点", async () => {
    mocks.user = { ...mocks.user, id: 丙, role: "SALES" };
    await expect(停用清点(乙)).rejects.toThrow();
  });
});

describe("一次 200 条", () => {
  const 造 = async () => {
    const 丙的客户 = await 客户("丙的客户", 丙);
    const 客户们 = Array.from({ length: 200 }, (_, i) => ({ name: `客户${i}`, phone: `1390000${String(i).padStart(4, "0")}`, salesOwnerId: 乙 }));
    await prisma.customer.createMany({ data: 客户们 });
    const ids = (await prisma.customer.findMany({ where: { salesOwnerId: 乙 }, select: { id: true } })).map((c) => c.id);
    await prisma.task.createMany({ data: ids.map((customerId) => ({ title: "回电", customerId, ownerId: 乙 })) });
    await prisma.project.createMany({ data: ids.map((customerId, i) => ({ name: `项目${i}`, customerId, ownerId: 乙, creatorId: 乙 })) });
    await prisma.project.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ name: `别处${i}`, customerId: 丙的客户.id, ownerId: 乙, creatorId: 乙 })) });
  };

  it("办离职 + 全部交给：200 位客户、400 个项目一次转完，每个项目都留转让痕", async () => {
    await 造();
    const 起 = Date.now();
    await 离职全部交给(乙, 甲);
    expect(Date.now() - 起).toBeLessThan(15_000);
    expect(await prisma.customer.count({ where: { salesOwnerId: 乙 } })).toBe(0);
    expect(await prisma.project.count({ where: { ownerId: 甲 } })).toBe(400);
    expect(await prisma.projectNodeLog.count({ where: { kind: "transfer" } })).toBe(400);
  }, 60_000);

});
