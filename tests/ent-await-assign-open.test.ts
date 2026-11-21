/**
 * 待分配对本线管理放开（P-转-42，用户 11-21 定「放开给本线管理」；3703 实操：销售管理可见只到下属，市场同事占着负责人格的待分配线索数成 0、分不了）：
 * - 还在待分配的新线索：本线销售管理、条线总管理看得到（列表、详情）、能手动分配；首页那一行和提醒都有他们
 * - 别线的看不到；定时的、分出去以后照原来的可见范围（分给非下属后外贸销售管理就看不到了）
 * - 只放开看和分配：改字段、推进、删、转让照旧拒（权限函数 + 数据层写范围）；客户本身不跟着放开
 * - 市场管理、系统管理员不变；「线索分配」开关关着不放开
 * 「按组织看客户」开着（c2 的组合）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 数待分配, 读项目列表 } from "@/lib/project/list";
import { 待分配筛 } from "@/lib/enterprise/await-assign-core";
import { 发待分配提醒 } from "@/lib/enterprise/lead-full-notice";
import { 读组织 } from "@/lib/enterprise/org";
import { 分配线索 } from "@/app/(app)/leads/assign-actions";
import { 能看项目, 能编辑项目, 能转让项目, 能删除 } from "@/lib/enterprise/permissions";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: string | null };
let 老板: 人, 外条线: 人, 市场管: 人, 内管: 人, 外管: 人, 外销: 人, 外销散: 人;
let 外贸待分: string, 内贸待分: string, 暂不待分: string, 外贸定时: string;
let 序 = 0;

async function 线索(name: string, 建的人: 人, bizLine: string, 另: { scheduledAssignAt?: Date } = {}) {
  序++;
  const c = (await prisma.customer.create({ data: { name: `客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: 建的人.id } })).id;
  return (await prisma.project.create({
    data: { name, customerId: c, ownerId: 建的人.id, creatorId: 建的人.id, phase: "线索", bizLine, awaitAssignAt: new Date("2026-11-20T08:00:00Z"), scheduledAssignAt: 另.scheduledAssignAt ?? null },
  })).id;
}
/** 按这个人的身份（范围限定按他算）跑 */
const 当 = <T>(谁: 人, fn: () => Promise<T>) => { mocks.user = 谁; return 以谁的身份(谁.id, fn); };
const 看得到 = async (谁: 人, id: string) => !!(await 当(谁, () => prisma.project.findUnique({ where: { id }, select: { id: true } })));
const 首页 = async (谁: 人) => (await 当(谁, () => 数待分配(谁)))?.条数 ?? 0;
const 列表 = async (谁: 人) => (await 当(谁, () => 读项目列表(谁, { f: 待分配筛, pageSize: "100" }, "线索"))).行.map((r) => r.name).sort();
const 权限项目 = async (id: string) => prisma.project.findUniqueOrThrow({ where: { id }, select: { ownerId: true, creatorId: true, pooledAt: true, bizLine: true, phase: true, result: true, awaitAssignAt: true, scheduledAssignAt: true, deletedAt: true } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  序 = 0;
  const 建 = async (email: string, bizRole: string, extra: { line?: string; managerId?: string } = {}): Promise<人> => {
    const u = await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } });
    await prisma.entMember.create({ data: { userId: u.id, bizRole, line: extra.line ?? null, managerId: extra.managerId ?? null } });
    return { id: u.id, name: u.name, email: u.email, role: u.role, title: "", avatar: null };
  };
  老板 = await 建("boss", "director");
  外条线 = await 建("wdir", "director", { line: "外贸" });
  市场管 = await 建("mkt", "marketing_mgr");
  内管 = await 建("nmgr", "sales_mgr", { line: "内贸" });
  await 建("ns", "sales", { line: "内贸", managerId: 内管.id });
  外管 = await 建("wmgr", "sales_mgr", { line: "外贸" });
  外销 = await 建("ws", "sales", { line: "外贸", managerId: 外管.id });
  外销散 = await 建("ws2", "sales", { line: "外贸" });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(规则.线索分配.key, true);
  忘掉企业版范围();
  // 市场管理建的、留在待分配（负责人那格是他占着）
  外贸待分 = await 线索("外贸待分", 市场管, "外贸");
  内贸待分 = await 线索("内贸待分", 市场管, "内贸");
  暂不待分 = await 线索("暂不待分", 市场管, "暂不分配");
  外贸定时 = await 线索("外贸定时", 市场管, "外贸", { scheduledAssignAt: new Date("2026-12-01T00:00:00Z") });
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });

describe("看得到：本线管理放开，别线不放", () => {
  it("外贸销售管理：看得到外贸、暂不分配的待分配，看不到内贸的、定时的；首页数和新线索页行数一致", async () => {
    expect([await 看得到(外管, 外贸待分), await 看得到(外管, 暂不待分), await 看得到(外管, 内贸待分), await 看得到(外管, 外贸定时)]).toEqual([true, true, false, false]);
    expect(await 首页(外管)).toBe(2);
    expect(await 列表(外管)).toEqual(["外贸待分", "暂不待分"].sort());
  });

  it("内贸销售管理：反过来", async () => {
    expect([await 看得到(内管, 内贸待分), await 看得到(内管, 暂不待分), await 看得到(内管, 外贸待分)]).toEqual([true, true, false]);
    expect(await 列表(内管)).toEqual(["内贸待分", "暂不待分"].sort());
    expect(await 首页(内管)).toBe(2);
  });

  it("外贸条线总管理：同外贸销售管理", async () => {
    expect([await 看得到(外条线, 外贸待分), await 看得到(外条线, 内贸待分)]).toEqual([true, false]);
    expect(await 列表(外条线)).toEqual(["外贸待分", "暂不待分"].sort());
  });

  it("销售：不放开", async () => {
    expect(await 看得到(外销, 外贸待分)).toBe(false);
    expect(await 首页(外销)).toBe(0);
  });

  it("市场管理、系统管理员不变：市场管理看自己建的全部，系统管理员全看", async () => {
    expect(await 列表(市场管)).toEqual(["内贸待分", "外贸待分", "暂不待分"].sort());
    expect(await 列表(老板)).toEqual(["内贸待分", "外贸待分", "暂不待分"].sort());
    expect(await 看得到(老板, 外贸定时)).toBe(true);
  });

  it("客户本身不跟着放开：外贸销售管理读不到那位客户", async () => {
    const { customerId } = await prisma.project.findUniqueOrThrow({ where: { id: 外贸待分 }, select: { customerId: true } });
    expect(await 当(外管, () => prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))).toBeNull();
  });

  it("「线索分配」开关关着：不放开", async () => {
    await setSetting(规则.线索分配.key, false);
    忘掉企业版范围();
    expect(await 看得到(外管, 外贸待分)).toBe(false);
    expect(await 首页(外管)).toBe(0);
  });
});

describe("分配：本线管理能手动分；分出去后照原可见范围", () => {
  it("外贸销售管理把市场建的外贸待分配分给自己的下属：分得出去；分给非下属后他就看不到了", async () => {
    expect(await 当(外管, () => 分配线索({ projectId: 外贸待分, toUserId: 外销.id }))).toEqual({ ok: true });
    const p = await prisma.project.findUniqueOrThrow({ where: { id: 外贸待分 } });
    expect([p.ownerId, p.awaitAssignAt]).toEqual([外销.id, null]);
    // 下属名下：照原范围看得到
    expect(await 看得到(外管, 外贸待分)).toBe(true);

    // 外贸条线总管理把暂不分配那条分给不在外贸销售管理下面的外贸销售：外贸销售管理不再看得到
    expect(await 看得到(外管, 暂不待分)).toBe(true);
    expect(await 当(外条线, () => 分配线索({ projectId: 暂不待分, toUserId: 外销散.id }))).toEqual({ ok: true });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 暂不待分 } })).ownerId).toBe(外销散.id);
    expect(await 看得到(外管, 暂不待分)).toBe(false);
  });
});

describe("只放开看和分配：改、推进、删、转让照旧拒", () => {
  it("权限函数：外贸销售管理能看，不能编辑（字段、推进、初判都走它）、不能转让、不能删", async () => {
    const org = await 读组织();
    const p = await 权限项目(外贸待分);
    expect(能看项目(外管, p, org)).toBe(true);
    expect(能编辑项目(外管, p, org)).toBe(false);
    expect(能转让项目(外管, p, org)).toBe(false);
    expect(能删除(外管, org, p.ownerId)).toBe(false);
    expect([能看项目(外条线, p, org), 能编辑项目(外条线, p, org), 能删除(外条线, org, p.ownerId)]).toEqual([true, false, false]);
    // 别线、不在待分配的不放
    expect(能看项目(内管, p, org)).toBe(false);
    expect(能看项目(外管, { ...p, awaitAssignAt: null }, org)).toBe(false);
    expect(能看项目(外管, { ...p, scheduledAssignAt: new Date() }, org)).toBe(false);
  });

  it("数据层写范围不放：外贸销售管理直接改名、删都改不到", async () => {
    const 改 = await 当(外管, () => prisma.project.updateMany({ where: { id: 外贸待分 }, data: { name: "改了" } }));
    expect(改.count).toBe(0);
    const 删 = await 当(外管, () => prisma.project.deleteMany({ where: { id: 外贸待分 } }));
    expect(删.count).toBe(0);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 外贸待分 } })).name).toBe("外贸待分");
  });
});

describe("提醒收件人包含本线管理", () => {
  it("外贸待分配：外贸销售管理、外贸条线总管理、系统管理员、市场管理（自己建的）收到；内贸销售管理收不到", async () => {
    await 发待分配提醒(await 读组织(), [{ id: 外贸待分, 名: "外贸待分" }], "市场", "外贸线没人可分");
    const 收 = (await prisma.entNotice.findMany({ where: { kind: "待分配" } })).map((n) => n.userId).sort();
    expect(收).toEqual([老板.id, 外条线.id, 市场管.id, 外管.id].sort());
  });
});
