import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/enterprise/objection-guard", async (原) => {
  const m = await 原<typeof import("@/lib/enterprise/objection-guard")>();
  return { ...m, 读全部待裁定行: vi.fn(m.读全部待裁定行), 项目有未裁定异议: vi.fn(m.项目有未裁定异议) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";
import { assignSalesOwner } from "@/app/(app)/customers/actions";
import { 待确认的交接, 确认交接 } from "@/app/(app)/customers/handover-actions";
import { 读全部待裁定行, 项目有未裁定异议 } from "@/lib/enterprise/objection-guard";
import { 超时转扫一遍, 客户随线索, 超时转生效key, 超时通知种类 } from "@/lib/enterprise/reply-overdue";

/**
 * 12-22 审查 M5：转让异议「待裁定」时的再转拦截漏口（口径 A7、B3 默认）。
 * 确认交接、导入改负责人（见 ent-import-objection.test.ts）被拦；新线索超时自动转跳过并暂停计时；离职交接照常放行。人名、客户名都是编造的。
 */
type 人 = { id: string; role: string; name: string };
let 老板: 人, 组长: 人, 销售: 人, 接手: 人, 同事: 人;
let 号 = 0;
const 日 = 86_400_000;
const 京 = (s: string) => new Date(`${s.replace(" ", "T")}:00+08:00`);

async function 建(email: string, role = "SALES"): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: `名${email}`, title: "", role, password: "x" } });
  return { id: u.id, role, name: u.name };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.name }; };
const 客户 = (salesOwnerId: string) =>
  prisma.customer.create({ data: { name: `客户${++号}`, phone: "", salesOwnerId, followStatus: "待跟进", contacts: { create: { name: `联系人${号}`, phone: `1390000${String(号).padStart(4, "0")}`, isPrimary: true } } } });
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
/** 一行「待裁定」的异议：对象是 customerId 这位客户（或其 projectId 项目） */
const 记待裁定 = (customerId: string, 异议人: string, 接手人: string, projectId?: string) =>
  prisma.entTransferObjection.create({
    data: {
      ownerLogId: `log${++号}`, customerId, projectId: projectId ?? null, kind: projectId ? "项目" : "客户", targetKey: projectId ?? "customer", targetName: "某对象",
      objectorUserId: 异议人, operatorUserId: 老板.id, toOwnerId: 接手人, status: "待裁定", expiresAt: new Date(Date.now() + 30 * 日), reason: "不同意",
    },
  });
const 裁完 = (id: string) => prisma.entTransferObjection.update({ where: { id }, data: { status: "维持" } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  号 = 0;
  老板 = await 建("boss", "ADMIN");
  组长 = await 建("lead", "MANAGER");
  销售 = await 建("sales");
  接手 = await 建("taker");
  同事 = await 建("peer");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 组长.id, bizRole: "sales_mgr", line: "内贸" },
      ...[销售, 接手, 同事].map((u) => ({ userId: u.id, managerId: 组长.id, bizRole: "sales", line: "内贸" })),
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("enterprise.rule.org_scope", true);
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  await setSetting(自动分配不参与key, { [老板.id]: "禁止" });
  await setSetting(超时转生效key, 京("2026-01-01 00:00").toISOString());
  invalidateSettingsCache();
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); invalidateSettingsCache(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("确认交接：客户上有待裁定异议时拦，裁定后放行", () => {
  it("申请移交的客户上有待裁定的客户异议：接手人确认被拦、交接留在待确认、客户没动；裁定完再确认才转", async () => {
    const c = await 客户(销售.id);
    当(销售);
    expect(await assignSalesOwner([c.id], 接手.id, null, undefined, { 说明: "我想交给他" })).toMatchObject({ ok: true, 申请移交: true });
    const 异议 = await 记待裁定(c.id, 销售.id, 同事.id);
    当(接手);
    const 交接 = (await 待确认的交接()).等我确认[0];
    expect(await 确认交接(交接.id)).toMatchObject({ ok: false, error: expect.stringContaining("这条有异议还没裁定") });
    expect(await 归谁(c.id)).toBe(销售.id);
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: 交接.id } })).status).toBe("待确认");
    await 裁完(异议.id);
    expect(await 确认交接(交接.id)).toMatchObject({ ok: true, 客户: 1 });
    expect(await 归谁(c.id)).toBe(接手.id);
  });

  it("客户上只有别的项目的项目异议（待裁定）也拦：整客户转会把项目带走", async () => {
    const c = await 客户(销售.id);
    const p = await prisma.project.create({ data: { name: "某项目", customerId: c.id, ownerId: 同事.id, creatorId: 同事.id, phase: "线索" } });
    当(销售);
    expect(await assignSalesOwner([c.id], 接手.id, null, undefined, { 说明: "交出去" })).toMatchObject({ ok: true, 申请移交: true });
    await 记待裁定(c.id, 同事.id, 接手.id, p.id);
    当(接手);
    const 交接 = (await 待确认的交接()).等我确认[0];
    expect(await 确认交接(交接.id)).toMatchObject({ ok: false });
    expect(await 归谁(c.id)).toBe(销售.id);
  });

  it("离职交接照常放行（口径 B3 默认）：旧的离职交接确认时，待裁定异议的客户照样交给接手人", async () => {
    const c = await 客户(销售.id);
    await 记待裁定(c.id, 销售.id, 同事.id);
    await prisma.user.update({ where: { id: 销售.id }, data: { active: false } });
    await prisma.entHandover.create({
      data: { kind: "离职", way: "转交", fromUserId: 销售.id, toUserId: 接手.id, byUserId: 老板.id, customerIds: JSON.stringify([c.id]), counts: JSON.stringify({ 客户: 1 }) },
    });
    当(接手);
    const 交接 = (await 待确认的交接()).等我确认[0];
    expect(await 确认交接(交接.id)).toMatchObject({ ok: true });
    expect(await 归谁(c.id)).toBe(接手.id);
  });
});

describe("新线索超时自动转：碰到待裁定异议跳过、计时暂停到裁定为止", () => {
  async function 线索(owner: 人, replyEnd: string) {
    const cid = (await 客户(owner.id)).id;
    const p = await prisma.project.create({ data: { name: `线索${++号}`, customerId: cid, ownerId: owner.id, creatorId: 老板.id, phase: "线索", node: "潜客培育", bizLine: "内贸", replyEndAt: 京(replyEnd) } });
    await prisma.entLeadAssign.create({ data: { projectId: p.id, toUserId: owner.id, fromUserId: 老板.id, byUserId: 老板.id, month: "2026-11", counted: false, createdAt: p.createdAt } });
    return { id: p.id, customerId: cid };
  }
  const 超时通知们 = (userId: string) => prisma.entNotice.findMany({ where: { userId, kind: 超时通知种类 } });

  it("项目上有待裁定异议：到点不提醒、不转，计时停表；裁定后接着走（不清零）", async () => {
    const { id, customerId } = await 线索(销售, "2026-11-20 15:00");
    const 异议 = await 记待裁定(customerId, 同事.id, 销售.id, id);
    await prisma.entTransferObjection.update({ where: { id: 异议.id }, data: { createdAt: 京("2026-11-20 15:30") } }); // 已走 30 分钟时提的
    expect(await 超时转扫一遍(京("2026-11-20 16:00"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 16:30"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时通知们(销售.id)).toHaveLength(0);
    expect((await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId).toBe(销售.id);
    // 停表：16:30 时仍是「已走 30 分钟」（起点 16:00），裁定后还差 30 分钟，不是再等整 1 小时
    await 裁完(异议.id);
    expect(await 超时转扫一遍(京("2026-11-20 16:59"))).toMatchObject({ 提醒: 0, 转出: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 17:00"))).toMatchObject({ 提醒: 1 });
  });

  it("停表：停了 2 小时，起点只往后推 2 小时（已走的 30 分钟保留）；每遍扫描只读一次待裁定行、不按项目各查", async () => {
    const { id, customerId } = await 线索(销售, "2026-11-20 15:00");
    const 另 = await 线索(同事, "2026-11-20 15:00"); // 链上第二条项目（没被挡）
    const 异议 = await 记待裁定(customerId, 同事.id, 销售.id, id);
    await prisma.entTransferObjection.update({ where: { id: 异议.id }, data: { createdAt: 京("2026-11-20 15:30") } });
    vi.mocked(读全部待裁定行).mockClear();
    vi.mocked(项目有未裁定异议).mockClear();
    for (const t of ["16:00", "16:30", "17:00", "17:30"]) await 超时转扫一遍(京(`2026-11-20 ${t}`));
    expect(vi.mocked(读全部待裁定行)).toHaveBeenCalledTimes(4); // 每遍 1 次
    expect(vi.mocked(项目有未裁定异议)).not.toHaveBeenCalled();
    const 行 = await prisma.entReplyOverdue.findUniqueOrThrow({ where: { projectId: id } });
    expect(行.since.getTime()).toBe(京("2026-11-20 17:00").getTime()); // 15:00 + 停了的 2 小时
    await 裁完(异议.id);
    expect(await 超时转扫一遍(京("2026-11-20 17:59"))).toMatchObject({ 提醒: 0 });
    expect(await 超时转扫一遍(京("2026-11-20 18:00"))).toMatchObject({ 提醒: 1 });
    // 没被挡的那条照常走（到点提醒过），不受影响
    expect((await 超时通知们(同事.id)).length).toBeGreaterThan(0);
    expect(另.id).toBeTruthy();
  });

  it("客户上有待裁定的客户异议：线索照转，客户不跟着走（留在原负责人名下）", async () => {
    const { id, customerId } = await 线索(销售, "2026-11-20 15:00");
    await 记待裁定(customerId, 销售.id, 销售.id);
    const r = await 客户随线索(id, customerId, 销售.id, 接手.id);
    expect(r).toMatchObject({ 去向: "不动" });
    expect(await 归谁(customerId)).toBe(销售.id);
    // 没有异议的对照：照旧跟着走
    const 另 = await 线索(销售, "2026-11-20 15:00");
    expect(await 客户随线索(另.id, 另.customerId, 销售.id, 接手.id)).toMatchObject({ 去向: "跟着走" });
    expect(await 归谁(另.customerId)).toBe(接手.id);
  });
});
