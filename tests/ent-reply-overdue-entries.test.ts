/**
 * 超时未跟进自动转「按分配」起算（没填指定回复时间，11-20）：用真实入口写出来的留痕，核哪些算「别人把它分给他」。
 *   起算：管理从线索公海分配（分配公海项目）、自动 / 指定分配（定时分出去 → 分项目给）、手动转让（改项目）
 *   不起算：销售自己去公海领（领取公海项目，留痕带历史负责人）、客户转让带项目、离职交接（带走一位）、
 *          市场转客户带项目（市场转一位，「随客户转走」）、从回收站恢复跟客户现负责人（恢复）
 * 入口写的留痕时刻是真实时钟：扫的时刻取「留痕 + 61 分钟」（夜里顺延到早上 08:00），只用只读的 盘点超时链 判进没进链
 * 查重领取新建的那条见 tests/ent-dedupe-claim.test.ts
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
import { 定时分出去 } from "@/app/(app)/leads/assign-actions";
import { 定时分配令牌 } from "@/lib/enterprise/scheduled-assign-token";
import { 系统操作人 } from "@/lib/enterprise/scheduled-assign";
import { 带走一位 } from "@/lib/carry-over-db";
import { 市场转一位 } from "@/lib/enterprise/market-transfer";
import { 软删一条, 恢复 } from "@/lib/enterprise/soft-delete";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 盘点超时链, 超时转扫一遍, 顺延到白天 } from "@/lib/enterprise/reply-overdue";

type 人 = { id: string; name: string; role: string };
let 老板: 人, 甲: 人, 乙: 人, 丙: 人;
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
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 甲.id, bizRole: "sales", line: "内贸" },
      { userId: 乙.id, bizRole: "sales", line: "内贸" },
      { userId: 丙.id, bizRole: "sales", line: "内贸" },
    ],
  });
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  await setSetting(自动分配不参与key, { [老板.id]: "禁止" });
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
    expect(await 最近痕(p)).toMatchObject({ kind: "pool-claim", userId: 老板.id, toOwnerId: 丙.id });
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

  it("手动转让（改项目，原因是待办痕）：进链", async () => {
    const { p } = await 线索(乙.id, {}, 老板.id);
    expect(await 改项目(老板, p, { name: "x", ownerId: 丙.id, amount: 0 }, false)).toMatchObject({ ok: true });
    expect(await 在链上(p)).toBe(true);
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

  it("客户转让带项目、离职交接（带走一位，原因空、同一刻客户换了人）：不进链", async () => {
    const 转让 = await 线索(乙.id);
    await prisma.$transaction((tx) => 带走一位(tx, 转让.c, 乙.id, 丙.id, 老板.id, "assign"));
    expect(await 最近痕(转让.p)).toMatchObject({ kind: "transfer", toOwnerId: 丙.id, reason: null });
    expect(await 在链上(转让.p)).toBe(false);
    const 交接 = await 线索(乙.id);
    await prisma.$transaction((tx) => 带走一位(tx, 交接.c, 乙.id, 甲.id, 老板.id, "deactivate"));
    expect(await 最近痕(交接.p)).toMatchObject({ toOwnerId: 甲.id });
    expect(await 在链上(交接.p)).toBe(false);
  });

  it("市场转客户带项目（市场转一位，「随客户转走」）：不进链", async () => {
    const { c, p } = await 线索(乙.id);
    await prisma.$transaction((tx) => 市场转一位(tx, c, 乙.id, 丙.id, 老板.id, "指定分配", false));
    expect(await 最近痕(p)).toMatchObject({ toOwnerId: 丙.id, reason: "随客户转走" });
    expect(await 在链上(p)).toBe(false);
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
