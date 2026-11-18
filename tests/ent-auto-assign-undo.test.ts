/**
 * 撤销行末「自动分配」= 整批还原（原型 pr.autoone 6 秒撤销；P-撤销-01 按原样回滚、不半撤）。
 * 原来撤销只把项目负责人改回去（走编辑项目），待分配标记、市场转销售连带过去的客户和项目、分配记录（占额度）都留在接手人那边。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 自动分配线索, 撤销自动分配, type 自动分配结果 } from "@/app/(app)/leads/assign-actions";
import { 自动分配不参与key, 不设配额key } from "@/lib/enterprise/lead-assign";
import { 规整还原单 } from "@/lib/enterprise/auto-assign-undo";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
let 总管: 人, 市场: 人, 甲: 人, 乙: 人;
const 造人 = async (key: string, name: string, role: string, bizRole: string): Promise<人> => {
  const u = await prisma.user.create({ data: { email: `${key}@x`, name, title: "", role, password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...(bizRole === "sales" ? { line: "内贸" } : {}) } });
  return { id: u.id, name, email: `${key}@x`, role, title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
let 序号 = 0;
const 客户 = async (ownerId: string) => (await prisma.customer.create({ data: { name: `客户${++序号}`, phone: `139${String(序号).padStart(8, "0")}`, salesOwnerId: ownerId } })).id;
const 项目 = async (customerId: string, ownerId: string, extra: Record<string, unknown> = {}) =>
  (await prisma.project.create({ data: { name: `项目${++序号}`, customerId, ownerId, creatorId: ownerId, ...extra } })).id;
const 项目of = (p: string) => prisma.project.findUniqueOrThrow({ where: { id: p } });
const 只留参与 = async (...们: 人[]) => {
  const 全部 = await prisma.entMember.findMany({ select: { userId: true } });
  await setSetting(自动分配不参与key, 全部.map((x) => x.userId).filter((id) => !们.some((u) => u.id === id)));
  invalidateSettingsCache();
};
const 成了 = (r: 自动分配结果) => { if (!r.ok) throw new Error(r.error); return r; };

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  总管 = await 造人("dir", "总管理", "ADMIN", "director");
  市场 = await 造人("mkt", "市场同事", "SALES", "marketing_mgr");
  甲 = await 造人("jia", "销售甲某", "SALES", "sales");
  乙 = await 造人("yi", "销售乙某", "SALES", "sales");
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(规则.线索分配.key, true);
  await setSetting(不设配额key, true);
  await 只留参与(甲);
  忘掉企业版范围();
});
afterEach(() => { vi.unstubAllEnvs(); invalidateSettingsCache(); });

describe("撤销自动分配：整批还原", () => {
  it("待分配的新线索：负责人、待分配时刻还原，转让痕和分配记录删掉（不占额度）", async () => {
    const c = await 客户(乙.id);
    const 时刻 = new Date("2026-11-10T08:00:00.000Z");
    const p = await 项目(c, 乙.id, { awaitAssignAt: 时刻 });
    const r = 成了(await 以(总管, () => 自动分配线索(p, { 项目: true, 原负责人: 乙.id })));
    expect(r.toUserId).toBe(甲.id);
    expect(r.还原).toEqual({ 原: 乙.id, 待分配: 时刻.toISOString(), 公海: null });
    expect(await 项目of(p)).toMatchObject({ ownerId: 甲.id, awaitAssignAt: null });
    expect(await prisma.entLeadAssign.count({ where: { projectId: p } })).toBe(1);

    expect(await 以(总管, () => 撤销自动分配(p, r.还原))).toEqual({ ok: true });
    expect(await 项目of(p)).toMatchObject({ ownerId: 乙.id, awaitAssignAt: 时刻 });
    expect(await prisma.entLeadAssign.count({ where: { projectId: p } })).toBe(0);
    expect(await prisma.projectNodeLog.count({ where: { projectId: p, kind: "transfer" } })).toBe(0);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c } })).toMatchObject({ salesOwnerId: 乙.id });
    // 操作日志照留（谁撤的）
    expect(await prisma.auditLog.count({ where: { entityId: p, summary: { contains: "撤销了刚才的自动分配" } } })).toBe(1);
  });

  it("市场第一次分给销售（X-18）：客户、一起带过去的项目、它们的待分配一并还原", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    const 别的 = await 项目(c, 市场.id);
    const 时刻 = new Date("2026-11-11T09:30:00.000Z");
    const 待分配的 = await 项目(c, 市场.id, { awaitAssignAt: 时刻 });
    const r = 成了(await 以(市场, () => 自动分配线索(p, { 项目: true, 原负责人: 市场.id })));
    expect(r.还原?.客户).toMatchObject({ customerId: c, 原: 市场.id });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(甲.id);
    for (const id of [p, 别的, 待分配的]) expect((await 项目of(id)).ownerId).toBe(甲.id);
    const 换人记录前 = await prisma.customerOwnerLog.count({ where: { customerId: c } });

    expect(await 以(市场, () => 撤销自动分配(p, r.还原))).toEqual({ ok: true });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(市场.id);
    for (const id of [p, 别的]) expect(await 项目of(id)).toMatchObject({ ownerId: 市场.id, awaitAssignAt: null });
    expect(await 项目of(待分配的)).toMatchObject({ ownerId: 市场.id, awaitAssignAt: 时刻 });
    expect(await prisma.customerOwnerLog.count({ where: { customerId: c } })).toBe(换人记录前 - 1);
    expect(await prisma.entLeadAssign.count()).toBe(0);
  });

  it("分完又被改过：整批不动，回原因", async () => {
    const c = await 客户(市场.id);
    const p = await 项目(c, 市场.id);
    const 别的 = await 项目(c, 市场.id);
    const r = 成了(await 以(市场, () => 自动分配线索(p, { 项目: true, 原负责人: 市场.id })));
    // 一起带过去的那个项目被人改给了乙：对不上，客户、这一条都不还
    await prisma.project.update({ where: { id: 别的 }, data: { ownerId: 乙.id } });
    const x = await 以(市场, () => 撤销自动分配(p, r.还原));
    expect(x).toMatchObject({ ok: false });
    expect(!x.ok && x.error).toContain("要改回请手工改");
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c } })).salesOwnerId).toBe(甲.id);
    expect((await 项目of(p)).ownerId).toBe(甲.id);
    expect(await prisma.entLeadAssign.count()).toBe(1);
  });

  it("还原单不可信：原负责人对不上留痕、别人来撤、不能分配的人来撤都挡", async () => {
    const c = await 客户(乙.id);
    const p = await 项目(c, 乙.id);
    const r = 成了(await 以(总管, () => 自动分配线索(p, { 项目: true, 原负责人: 乙.id })));
    expect(await 以(总管, () => 撤销自动分配(p, { ...r.还原, 原: 市场.id }))).toMatchObject({ ok: false });
    expect(await 以(市场, () => 撤销自动分配(p, r.还原))).toMatchObject({ ok: false });
    expect(await 以(甲, () => 撤销自动分配(p, r.还原))).toMatchObject({ ok: false });
    expect(await 以(总管, () => 撤销自动分配(p, "乱传"))).toMatchObject({ ok: false });
    expect((await 项目of(p)).ownerId).toBe(甲.id);
    expect(await 以(总管, () => 撤销自动分配(p, r.还原))).toEqual({ ok: true });
    expect((await 项目of(p)).ownerId).toBe(乙.id);
  });

  it("规整还原单：只留形状对的", () => {
    expect(规整还原单(null)).toBeNull();
    expect(规整还原单({ 原: 1, 待分配: "x", 客户: { customerId: "c", 原: "m", 带过来: { 项目: ["a", 2], 清待分配: [{ id: "a", at: "t" }, { id: 3 }] } } })).toEqual({
      原: null, 待分配: "x", 公海: null,
      客户: { customerId: "c", 原: "m", 带过来: { 计划: [], 待办: [], 商机: [], 项目: ["a"], 公海项目: [], 清待分配: [{ id: "a", at: "t" }], 补方式: [], 转方式: [], 补分配: [], 推节点: [] } },
    });
    // 暂不分配（审核 11-18 第 11 项）：只认 true，别的值丢掉
    expect(规整还原单({ 原: "m", 暂不分配: true })).toEqual({ 原: "m", 待分配: null, 公海: null, 暂不分配: true });
    expect(规整还原单({ 原: "m", 暂不分配: "yes" })).toEqual({ 原: "m", 待分配: null, 公海: null });
  });
});
