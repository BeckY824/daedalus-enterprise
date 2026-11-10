/**
 * X-77「验证中不能改派，要改先撤回验证」（M-线索-02）：分配线索、改项目之外，换负责人的另三处也拦——
 *   - 客户转让（批量转让、就地改、申请移交确认那一步）：名下有验证中的线索整批拦，客户、项目都不动
 *   - 分配公海项目：验证中的（老数据）不分
 *   - 回收站恢复项目：要跟客户现负责人换人的、验证中就不恢复
 * 撤回验证：提交验证的人（初判无效交复核的那位）、系统管理员能撤；线索回到提交验证前（暂未判定、不在等），留一行痕；撤完能改派
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { assignSalesOwner, patchCustomer } from "@/app/(app)/customers/actions";
import { 确认交接 } from "@/app/(app)/customers/handover-actions";
import { 分配公海项目 } from "@/app/(app)/pool/actions";
import { 恢复, 看已删 } from "@/lib/enterprise/soft-delete";
import { 销售初判, 撤回验证, 读线索验证 } from "@/lib/project/lead-verify";
import { 改项目 } from "@/lib/project/db";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";

type 人 = { id: string; role: string };
let 老板: 人, 组长: 人, 销售: 人, 接手: 人, 市场: 人;
let 号 = 0;

async function 建(email: string, role = "SALES"): Promise<人> {
  const u = await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } });
  return { id: u.id, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, role: p.role, name: p.id }; };
const 客户 = async (salesOwnerId: string) =>
  (await prisma.customer.create({ data: { name: `客户${++号}`, phone: `1390000${String(号).padStart(4, "0")}`, salesOwnerId } })).id;
const 项目 = async (customerId: string, ownerId: string, 补: Record<string, unknown> = {}) =>
  (await prisma.project.create({ data: { name: `项目${++号}`, customerId, ownerId, creatorId: 市场.id, phase: "线索", node: "线索验证", ...补 } })).id;
const 挂验证 = (projectId: string, pending = "市场复核") =>
  prisma.entLeadVerify.create({ data: { projectId, verdict: "初验无效", invalidReason: "联系方式无效", pending, verifiedById: 销售.id, verifiedAt: new Date() } });
const 归谁 = async (id: string) => (await prisma.customer.findUniqueOrThrow({ where: { id } })).salesOwnerId;
const 负责 = async (id: string) => (await prisma.project.findUniqueOrThrow({ where: { id } })).ownerId;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  号 = 0;
  老板 = await 建("boss", "ADMIN");
  组长 = await 建("lead", "MANAGER");
  销售 = await 建("sales");
  接手 = await 建("taker");
  市场 = await 建("mkt");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 组长.id, bizRole: "sales_mgr" },
      { userId: 销售.id, managerId: 组长.id, bizRole: "sales" },
      { userId: 接手.id, managerId: 组长.id, bizRole: "sales" },
      { userId: 市场.id, bizRole: "marketing_mgr" },
    ],
  });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true, poolDays: 30 });
  await setSetting("enterprise.rule.handover_confirm", false);
  invalidateSettingsCache();
  当(老板);
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("X-77 客户转让：名下有验证中的线索不能换负责人", () => {
  it("系统管理员批量转让、就地改：整批拦，客户和项目都不动；验证走完照常转", async () => {
    const a = await 客户(销售.id);
    const b = await 客户(销售.id);
    const p = await 项目(a, 销售.id);
    const q = await 项目(b, 销售.id);
    await 挂验证(p);
    const r = await assignSalesOwner([a, b], 接手.id);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("验证中") });
    expect(r.ok === false && r.error).toContain("撤回验证");
    expect(await patchCustomer(a, "salesOwnerId", 接手.id)).toMatchObject({ ok: false, error: expect.stringContaining("验证中") });
    expect([await 归谁(a), await 归谁(b), await 负责(p), await 负责(q)]).toEqual([销售.id, 销售.id, 销售.id, 销售.id]);
    // 在公海里的项目不跟着走，不算
    await prisma.project.update({ where: { id: p }, data: { pooledAt: new Date(), ownerId: "" } });
    expect(await assignSalesOwner([a, b], 接手.id)).toMatchObject({ ok: true, updated: 2 });
  });

  it("负责人本人申请移交，发起之后线索进了验证：接手人确认被拦，交接留在待确认；撤回验证后能确认", async () => {
    const a = await 客户(销售.id);
    const p = await 项目(a, 销售.id);
    当(销售);
    expect(await assignSalesOwner([a], 接手.id)).toMatchObject({ ok: true, 交接中: 1, 申请移交: true });
    const h = await prisma.entHandover.findFirstOrThrow();
    await 挂验证(p);
    当(接手);
    expect(await 确认交接(h.id)).toMatchObject({ ok: false, error: expect.stringContaining("验证中") });
    expect((await prisma.entHandover.findUniqueOrThrow({ where: { id: h.id } })).status).toBe("待确认");
    expect(await 归谁(a)).toBe(销售.id);
    expect((await 撤回验证(销售, p)).ok).toBe(true);
    expect(await 确认交接(h.id)).toEqual({ ok: true, 客户: 1 });
    expect([await 归谁(a), await 负责(p)]).toEqual([接手.id, 接手.id]);
  });

  it("验证中的发起申请也拦（不先挂一笔交接）", async () => {
    const a = await 客户(销售.id);
    await 挂验证(await 项目(a, 销售.id), "销售终验");
    当(销售);
    expect(await assignSalesOwner([a], 接手.id)).toMatchObject({ ok: false, error: expect.stringContaining("验证中") });
    expect(await prisma.entHandover.count()).toBe(0);
  });
});

describe("X-77 分配公海项目、回收站恢复", () => {
  it("公海里还挂着验证的（老数据）不分，别的照分", async () => {
    const 挂着 = await 项目(await 客户(老板.id), "", { pooledAt: new Date() });
    const 没挂 = await 项目(await 客户(老板.id), "", { pooledAt: new Date() });
    await 挂验证(挂着);
    const r = await 分配公海项目([挂着, 没挂], 接手.id);
    expect(r).toMatchObject({ ok: true, 分到: [没挂], 没分到: [{ id: 挂着, 原因: expect.stringContaining("验证中") }] });
    expect(await 负责(挂着)).toBe("");
  });

  it("恢复项目要换成客户现负责人的、在验证中就不恢复；撤回验证后恢复并换人", async () => {
    const c = await 客户(销售.id);
    const p = await 项目(c, 销售.id);
    await 挂验证(p);
    await prisma.customer.update({ where: { id: c }, data: { salesOwnerId: 接手.id } });
    await prisma.project.update({ where: { id: p }, data: { deletedAt: new Date() } });
    const r = await 恢复(老板, "Project", p);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("撤回验证") });
    expect((await 看已删(() => prisma.project.findUniqueOrThrow({ where: { id: p } }))).deletedAt).not.toBeNull();
    // 不用换人的（负责人就是客户现负责人）照常恢复
    const q = await 项目(c, 接手.id, { deletedAt: new Date() });
    await 挂验证(q);
    expect((await 恢复(老板, "Project", q)).ok).toBe(true);
    expect((await 撤回验证(老板, p)).ok).toBe(true);
    expect((await 恢复(老板, "Project", p)).ok).toBe(true);
    expect(await 负责(p)).toBe(接手.id);
  });
});

describe("撤回验证", () => {
  it("提交验证的人撤回：回到验证前（暂未判定、不在等、初判那几格清空），留一行痕，项目不动；之后能改负责人、能重新初判", async () => {
    const p = await 项目(await 客户(销售.id), 销售.id);
    expect((await 销售初判(销售, p, "无效", { invalidReason: "联系方式无效", verifyNote: "打不通" })).ok).toBe(true);
    expect((await prisma.entLeadVerify.findUniqueOrThrow({ where: { projectId: p } })).pending).toBe("市场复核");
    const 项 = await prisma.project.findUniqueOrThrow({ where: { id: p } });
    expect((await 读线索验证(销售, 项))?.能撤回).toBe(true);
    expect((await 读线索验证(接手, 项))?.能撤回).toBe(false);

    expect(await 撤回验证(接手, p)).toMatchObject({ ok: false, error: expect.stringContaining("提交验证的人或系统管理员") });
    expect(await 撤回验证(组长, p)).toMatchObject({ ok: false });
    expect(await 撤回验证(销售, p)).toEqual({ ok: true });
    expect(await prisma.entLeadVerify.findUniqueOrThrow({ where: { projectId: p } })).toMatchObject({
      verdict: "暂未判定", pending: null, invalidReason: null, verifyNote: null, verifiedById: null, verifiedAt: null, reviewResult: null, finalResult: null,
    });
    const 痕 = await prisma.entLeadVerifyLog.findMany({ where: { projectId: p }, orderBy: { at: "asc" } });
    expect(痕.map((l) => [l.step, l.verdict, l.userId])).toEqual([["销售初判", "无效", 销售.id], ["撤回验证", "撤回", 销售.id]]);
    const 后 = await prisma.project.findUniqueOrThrow({ where: { id: p } });
    expect([后.node, 后.result, 后.ownerId]).toEqual(["线索验证", null, 销售.id]);
    expect((await 读线索验证(销售, 后))?.能撤回).toBe(false);
    // 没在验证中：再撤回拦
    expect(await 撤回验证(销售, p)).toMatchObject({ ok: false, error: expect.stringContaining("没在验证中") });
    // 能改负责人了
    expect((await 改项目(组长, p, { ownerId: 接手.id })).ok).toBe(true);
    expect(await 负责(p)).toBe(接手.id);
  });

  it("系统管理员能撤（等销售终验、等认领也算验证中）；不是企业版一律拦", async () => {
    const p = await 项目(await 客户(销售.id), 销售.id);
    await 挂验证(p, "销售认领");
    expect(await 撤回验证(老板, p)).toEqual({ ok: true });
    expect((await prisma.entLeadVerify.findUniqueOrThrow({ where: { projectId: p } })).pending).toBeNull();
    await prisma.entLeadVerify.update({ where: { projectId: p }, data: { pending: "销售终验", verifiedById: 销售.id } });
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect((await 撤回验证(老板, p)).ok).toBe(false);
    expect((await prisma.entLeadVerify.findUniqueOrThrow({ where: { projectId: p } })).pending).toBe("销售终验");
  });
});
