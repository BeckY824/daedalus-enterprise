/**
 * 超时未跟进自动转「按分配」起算（没填指定回复时间，11-20）：用真实入口写出来的留痕，核哪些算「别人把它分给他」。
 *   起算：管理从线索公海分配（分配公海项目，「从线索公海分配」；客户还在市场手里、跟着市场转的也算）、管理从客户公海分客户带出的线索公海项目（分配公海，「从客户公海分配」）、
 *        自动 / 指定分配（定时分出去 → 分项目给）、手动转让（改项目；换负责人带待办关着时记「手动转让」）
 *   不起算：销售自己去公海领（领取公海项目，留痕带历史负责人）、客户转让带项目和带出的公海项目（带走一位，「跟着客户转过来」）、
 *          离职交接（交客户 带走一位 / 只交项目 确认离职交接 / 全部交给的其余和同事两组 离职转给接手人，「离职交接」）、
 *          市场转客户带项目和带出的公海项目（市场转一位，「随客户转走」）、从回收站恢复跟客户现负责人（恢复）
 * 入口写的留痕时刻是真实时钟：扫的时刻取「留痕 + 61 分钟」（夜里顺延到早上 08:00），只用只读的 盘点超时链 判进没进链
 * 查重领取（新建的那条进链、带出线索公海的旧项目不进）见 tests/ent-dedupe-claim.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 公海规则 } from "@/lib/enterprise/pool-rules";
import { 放回公海, 领取公海项目, 改项目 } from "@/lib/project/db";
import { 分配公海项目 } from "@/app/(app)/pool/actions";
import { 分配公海 } from "@/app/(app)/customers/pool-actions";
import { 确认离职交接 } from "@/lib/enterprise/offboard-handover";
import { 离职转给接手人 } from "@/lib/offboard-move";
import type { 停用分拣结果 } from "@/lib/offboard-db";
import { 定时分出去 } from "@/app/(app)/leads/assign-actions";
import { 定时分配令牌 } from "@/lib/enterprise/scheduled-assign-token";
import { 系统操作人 } from "@/lib/enterprise/scheduled-assign";
import { 带走一位 } from "@/lib/carry-over-db";
import { 市场转一位 } from "@/lib/enterprise/market-transfer";
import { 软删一条, 恢复 } from "@/lib/enterprise/soft-delete";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 盘点超时链, 超时转扫一遍, 顺延到白天, 超时转生效key } from "@/lib/enterprise/reply-overdue";

type 人 = { id: string; name: string; role: string };
let 老板: 人, 甲: 人, 乙: 人, 丙: 人, 市场: 人;
async function 造人(email: string, name: string, role: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name, role };
}
let 序 = 0;
/** 一位客户 + 一条线索：负责人 owner、老板建的（分出去的）、十天前建档（不靠建档时刻进初筛） */
async function 线索(owner: string, 补: Record<string, unknown> = {}, 客户负责人 = owner) {
  序++;
  const c = (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1380000${String(序).padStart(4, "0")}`, salesOwnerId: 客户负责人 } })).id;
  const p = (await prisma.project.create({
    data: { name: `线索${序}`, customerId: c, ownerId: owner, creatorId: 老板.id, phase: "线索", node: "潜客培育", bizLine: "内贸", createdAt: new Date(Date.now() - 10 * 86_400_000), ...补 },
  })).id;
  return { c, p };
}
/** 一位客户 + 一条放回了线索公海的线索（原负责人 owner），客户归 客户负责人 */
async function 公海线索(owner: string, 客户负责人 = owner) {
  const r = await 线索(owner, {}, 客户负责人);
  expect(await 放回公海({ id: owner, role: "SALES" }, r.p)).toMatchObject({ ok: true });
  return r;
}
/** 最近一行换人留痕 */
const 最近痕 = (projectId: string) => prisma.projectNodeLog.findFirstOrThrow({ where: { projectId, kind: { in: ["transfer", "pool-claim"] } }, orderBy: [{ at: "desc" }, { id: "desc" }] });
/** 留痕 + 61 分钟（夜里顺延到早上）这一刻，这条在不在链上 */
async function 在链上(projectId: string): Promise<boolean> {
  const 扫于 = 顺延到白天(new Date((await 最近痕(projectId)).at.getTime() + 61 * 60_000));
  return (await 盘点超时链(扫于)).some((r) => r.id === projectId && r.按分配);
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  公海规则.项目能单独领 = true;
  老板 = await 造人("boss", "老板", "ADMIN");
  甲 = await 造人("jia", "甲", "SALES");
  乙 = await 造人("yi", "乙", "SALES");
  丙 = await 造人("bing", "丙", "SALES");
  市场 = await 造人("mkt", "市场", "SALES");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 甲.id, bizRole: "sales", line: "内贸" },
      { userId: 乙.id, bizRole: "sales", line: "内贸" },
      { userId: 丙.id, bizRole: "sales", line: "内贸" },
      { userId: 市场.id, bizRole: "channel_ops" },
    ],
  });
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  await setSetting(自动分配不参与key, { [老板.id]: "禁止" });
  // 超时转生效时刻（11-20）：留痕用真实时钟，按早就生效了算
  await setSetting(超时转生效key, "2020-01-01T00:00:00.000Z");
  invalidateSettingsCache();
  mocks.user = { ...mocks.user, id: 老板.id, name: 老板.name, role: 老板.role };
});
afterEach(() => { vi.unstubAllEnvs(); 公海规则.项目能单独领 = false; 忘掉企业版范围(); invalidateSettingsCache(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("起算的入口", () => {
  it("管理从线索公海分给销售（分配公海项目）：进链，到点照发超时提醒", async () => {
    const { p } = await 线索(乙.id);
    expect(await 放回公海(乙, p)).toMatchObject({ ok: true });
    expect(await 分配公海项目([p], 丙.id)).toMatchObject({ ok: true, 分到: [p] });
    expect(await 最近痕(p)).toMatchObject({ kind: "pool-claim", userId: 老板.id, toOwnerId: 丙.id, reason: expect.stringMatching(/^从线索公海分配/) });
    expect(await 在链上(p)).toBe(true);
    const 扫于 = 顺延到白天(new Date((await 最近痕(p)).at.getTime() + 61 * 60_000));
    expect(await 超时转扫一遍(扫于)).toMatchObject({ 提醒: 1 });
  });

  it("自动分配 / 指定分配（定时分出去 → 分项目给，原因「分配方式：…」）：进链", async () => {
    const 自动 = await 线索(老板.id, { awaitAssignAt: new Date(Date.now() - 60_000) });
    expect(await 定时分出去(定时分配令牌, 系统操作人, 自动.p, null, "到点")).toMatchObject({ ok: true });
    expect((await 最近痕(自动.p)).reason).toMatch(/^分配方式：/);
    expect(await 在链上(自动.p)).toBe(true);
    const 指定 = await 线索(老板.id, { awaitAssignAt: new Date(Date.now() - 60_000) });
    expect(await 定时分出去(定时分配令牌, 系统操作人, 指定.p, 丙.id, "到点")).toMatchObject({ ok: true });
    expect(await 在链上(指定.p)).toBe(true);
  });

  it("管理从线索公海分配、客户还在市场成员手里（分配公海项目 → 跟着市场转，客户换人记 market-assign，P-公海-11）：进链", async () => {
    const { c, p } = await 公海线索(市场.id);
    expect(await 分配公海项目([p], 丙.id)).toMatchObject({ ok: true, 分到: [p] });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(丙.id);
    expect(await prisma.customerOwnerLog.findFirst({ where: { customerId: c, toOwnerId: 丙.id } })).toMatchObject({ kind: "market-assign", userId: 老板.id });
    expect(await 最近痕(p)).toMatchObject({ kind: "pool-claim", userId: 老板.id, toOwnerId: 丙.id, reason: expect.stringMatching(/^从线索公海分配/) });
    expect(await 在链上(p)).toBe(true);
  });

  it("管理从客户公海分客户、带出线索公海里的项目（分配公海，「从客户公海分配」）：带出的那条进链", async () => {
    const { c, p } = await 公海线索(乙.id);
    await prisma.customerPool.create({ data: { customerId: c, userId: 乙.id, reason: "手动" } });
    expect(await 分配公海([c], 丙.id)).toMatchObject({ ok: true, updated: 1 });
    expect(await 最近痕(p)).toMatchObject({ kind: "pool-claim", userId: 老板.id, toOwnerId: 丙.id, reason: expect.stringMatching(/^从客户公海分配/) });
    expect(await 在链上(p)).toBe(true);
  });

  it("手动转让（改项目，原因是待办痕；换负责人带待办关着时记「手动转让」）：进链", async () => {
    const { p } = await 线索(乙.id, {}, 老板.id);
    expect(await 改项目(老板, p, { name: "x", ownerId: 丙.id, amount: 0 }, false)).toMatchObject({ ok: true });
    expect((await 最近痕(p)).reason).toMatch(/^原负责人没做完的待办/);
    expect(await 在链上(p)).toBe(true);
    const 关着 = await 线索(乙.id, {}, 老板.id);
    const 原 = 公海规则.换负责人带待办;
    公海规则.换负责人带待办 = false;
    try {
      expect(await 改项目(老板, 关着.p, { name: "y", ownerId: 丙.id, amount: 0 }, true)).toMatchObject({ ok: true });
    } finally { 公海规则.换负责人带待办 = 原; }
    expect(await 最近痕(关着.p)).toMatchObject({ kind: "transfer", userId: 老板.id, toOwnerId: 丙.id, reason: "手动转让" });
    expect(await 在链上(关着.p)).toBe(true);
  });
});

describe("不起算的入口", () => {
  it("销售自己去公海领（领取公海项目：操作人 = 接手人、从 = 历史负责人）：不进链", async () => {
    const { p } = await 线索(乙.id);
    await 放回公海(乙, p);
    expect(await 领取公海项目(丙, p)).toMatchObject({ ok: true });
    expect(await 最近痕(p)).toMatchObject({ kind: "pool-claim", userId: 丙.id, toOwnerId: 丙.id, fromOwnerId: 乙.id });
    expect(await 在链上(p)).toBe(false);
  });

  it("客户转让带项目、离职交一位客户（带走一位，「跟着客户转过来」/「离职交接」）：不进链", async () => {
    const 转让 = await 线索(乙.id);
    await prisma.$transaction((tx) => 带走一位(tx, 转让.c, 乙.id, 丙.id, 老板.id, "assign"));
    expect(await 最近痕(转让.p)).toMatchObject({ kind: "transfer", userId: 老板.id, toOwnerId: 丙.id, reason: "跟着客户转过来" });
    expect(await 在链上(转让.p)).toBe(false);
    const 交接 = await 线索(乙.id);
    await prisma.$transaction((tx) => 带走一位(tx, 交接.c, 乙.id, 甲.id, 老板.id, "deactivate"));
    expect(await 最近痕(交接.p)).toMatchObject({ kind: "transfer", userId: 老板.id, toOwnerId: 甲.id, reason: "离职交接" });
    expect(await 在链上(交接.p)).toBe(false);
  });

  it("客户转让带出线索公海里的项目（带走一位 assign → 带走公海项目，pool-claim「跟着客户转过来」）：不进链", async () => {
    const { c, p } = await 公海线索(乙.id);
    await prisma.customer.update({ where: { id: c }, data: { salesOwnerId: 丙.id } });
    await prisma.$transaction((tx) => 带走一位(tx, c, 乙.id, 丙.id, 老板.id, "assign"));
    expect(await 最近痕(p)).toMatchObject({ kind: "pool-claim", userId: 老板.id, toOwnerId: 丙.id, reason: "跟着客户转过来" });
    expect(await 在链上(p)).toBe(false);
  });

  it("离职交接只交项目（确认离职交接，范围 = 项目）：转让留痕「离职交接」、客户不换人，不进链", async () => {
    const { p } = await 线索(乙.id, {}, 老板.id);
    const h = await prisma.entHandover.create({ data: { kind: "离职", way: "项目", fromUserId: 乙.id, toUserId: 丙.id, byUserId: 老板.id, projectIds: JSON.stringify([p]) } });
    expect(await 确认离职交接({ id: 丙.id, role: "SALES" }, h)).toMatchObject({ 项目: [p] });
    expect(await 最近痕(p)).toMatchObject({ kind: "transfer", userId: 老板.id, toOwnerId: 丙.id, reason: "离职交接" });
    expect(await prisma.customerOwnerLog.count()).toBe(0);
    expect(await 在链上(p)).toBe(false);
  });

  it("全部交给里的「其余」和「同事」两组（离职转给接手人 → 转项目）：「离职交接」，不进链", async () => {
    const 其余 = await 线索(乙.id, {}, 老板.id);
    const 同事 = await 线索(甲.id, {}, 老板.id);
    const 分 = { 客户: [], 进公海客户: [], 本来在公海: [], 商机: [], 待办: [], 计划: [], 线索: [], 渠道: [], 主渠道: [], 项目: [其余.p, 同事.p], 清待分配: [], 停用同事: [同事.p], 进公海项目: [], 订单项目: 0 } as unknown as 停用分拣结果;
    await prisma.$transaction((tx) => 离职转给接手人(tx, 分, 乙.id, 丙.id, 老板.id, false));
    for (const p of [其余.p, 同事.p]) {
      expect(await 最近痕(p)).toMatchObject({ kind: "transfer", userId: 老板.id, toOwnerId: 丙.id, reason: "离职交接" });
      expect(await 在链上(p)).toBe(false);
    }
  });

  it("市场转客户带项目、带出线索公海里的项目（市场转一位，「随客户转走」）：不进链", async () => {
    const { c, p } = await 线索(乙.id);
    const 公海 = await 线索(乙.id);
    await prisma.project.update({ where: { id: 公海.p }, data: { customerId: c } });
    expect(await 放回公海({ id: 乙.id, role: "SALES" }, 公海.p)).toMatchObject({ ok: true });
    await prisma.customer.update({ where: { id: c }, data: { salesOwnerId: 丙.id } });
    await prisma.$transaction((tx) => 市场转一位(tx, c, 乙.id, 丙.id, 老板.id, "指定分配", false));
    expect(await 最近痕(p)).toMatchObject({ kind: "transfer", toOwnerId: 丙.id, reason: "随客户转走" });
    expect(await 最近痕(公海.p)).toMatchObject({ kind: "pool-claim", userId: 老板.id, toOwnerId: 丙.id, reason: "随客户转走" });
    for (const x of [p, 公海.p]) expect(await 在链上(x)).toBe(false);
  });

  it("从回收站恢复跟客户现负责人（恢复）：不进链，原来停了的链也不重启", async () => {
    const { c, p } = await 线索(乙.id);
    await prisma.$transaction((tx) => 看已删(() => 软删一条(tx, "Project", p)));
    await prisma.customer.update({ where: { id: c }, data: { salesOwnerId: 丙.id } });
    expect(await 恢复({ id: 老板.id, role: "ADMIN" }, "Project", p)).toMatchObject({ ok: true });
    expect(await 最近痕(p)).toMatchObject({ toOwnerId: 丙.id, reason: "从回收站恢复，跟客户现负责人" });
    expect(await 在链上(p)).toBe(false);
  });
});
