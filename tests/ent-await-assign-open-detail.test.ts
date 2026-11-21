/**
 * 待分配对本线管理放开（P-转-42）审查补的三处：
 * - 必修 1：客户看得到时「首页和列表有，点进去找不到」——能看项目 的调用方 select 少了待分配那几格。外贸销售管理看得到客户 X（下属名下），
 *   市场给 X 建了待分配新线索：/projects/<id> 跳客户页，客户页项目区页签里有这条、停在这条；收藏左栏、站内链接、客户列表项目数也认它
 * - 小修 2：「按组织看客户」关着（数据层不限定）时，「线索分配」开关照样管住详情（能看项目）
 * - 小修 3：直接改放开的那条，提示「只能看」而不是原始的「不在了」
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "", role: "SALES", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/projects/[id]/ProjectDetail", () => ({ default: () => null }));
vi.mock("@/app/(app)/projects/[id]/SameNumberBanner", () => ({ default: () => null }));
vi.mock("@/app/(app)/customers/[id]/CustomerDetail", () => ({ default: () => null }));

import type { ReactElement } from "react";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读组织 } from "@/lib/enterprise/org";
import { 能看项目, 权限项目列 } from "@/lib/enterprise/permissions";
import { 只读错误, 待分配只能看话 } from "@/lib/team-scope";
import CustomerPage from "@/app/(app)/customers/[id]/page";
import type { 项目区数据 } from "@/app/(app)/customers/[id]/ProjectZone";
import { 项目页去向 } from "@/app/(app)/projects/[id]/load";
import { 项目链接们 } from "@/lib/project/customer-detail-direct";
import { 点得开的项目 } from "@/lib/favorites";
import { 客户项目概况们, 项目名另比 } from "@/lib/project/customer-list-projects";

type 人 = { id: string; name: string; email: string; role: string; title: string; avatar: null };
const 造人 = async (key: string, bizRole: string, x: { line?: string; managerId?: string } = {}): Promise<人> => {
  const email = `${key}@x`;
  const u = await prisma.user.create({ data: { email, name: key, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, line: x.line ?? null, managerId: x.managerId ?? null } });
  return { id: u.id, name: key, email, role: "SALES", title: "", avatar: null };
};
const 以 = <T,>(u: 人, fn: () => Promise<T>): Promise<T> => { mocks.user = { ...u }; return 以谁的身份(u.id, fn); };
const 区 = async (u: 人, c: string, project?: string): Promise<项目区数据 | null> => {
  const el = (await 以(u, () => CustomerPage({ params: Promise.resolve({ id: c }), searchParams: Promise.resolve(project ? { project } : {}) } as never))) as ReactElement<{ 项目数据: 项目区数据 | null }>;
  return el.props.项目数据;
};
const 开关 = async (按组织: boolean, 分配: boolean) => {
  await setSetting(规则.按组织看客户.key, 按组织);
  await setSetting(规则.线索分配.key, 分配);
  忘掉企业版范围();
};

let 市场管: 人, 外管: 人, 外销: 人;
let 客户X: string, 老项目: string, 待分: string;
beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  市场管 = await 造人("mkt", "marketing_mgr");
  外管 = await 造人("wmgr", "sales_mgr", { line: "外贸" });
  外销 = await 造人("ws", "sales", { line: "外贸", managerId: 外管.id });
  // 下属名下的老客户：外贸销售管理按组织看得到
  客户X = (await prisma.customer.create({ data: { name: "老客户X", phone: "13900000021", salesOwnerId: 外销.id } })).id;
  老项目 = (await prisma.project.create({ data: { name: "下属在推的项目", customerId: 客户X, ownerId: 外销.id, creatorId: 外销.id, phase: "商机", node: "需求确认" } })).id;
  // 市场给 X 建的新线索，留在待分配（负责人那格是市场管理占着）
  待分 = (await prisma.project.create({
    data: { name: "市场建的待分配", customerId: 客户X, ownerId: 市场管.id, creatorId: 市场管.id, phase: "线索", bizLine: "外贸", awaitAssignAt: new Date("2026-11-20T08:00:00Z") },
  })).id;
  await 开关(true, true);
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

describe("必修 1：客户看得到时，待分配线索点进去找得到", () => {
  it("/projects/<id> 跳客户页；客户页项目区页签里有这条、停在这条", async () => {
    expect(await 以(外管, () => 项目页去向(外管 as never, 待分))).toEqual({ 种: "客户页", 到: `/customers/${客户X}?project=${待分}` });
    const r = (await 区(外管, 客户X, 待分))!;
    expect(r.页签们.map((t) => t.id).sort()).toEqual([老项目, 待分].sort());
    expect(r.当前?.p.id).toBe(待分);
  });

  it("站内链接直接给客户页地址、收藏左栏留着、客户列表项目数算上", async () => {
    expect((await 以(外管, () => 项目链接们(外管 as never, [待分]))).get(待分)).toBe(`/customers/${客户X}?project=${待分}`);
    expect((await 以(外管, () => 点得开的项目(外管, [待分]))).map((x) => x.id)).toEqual([待分]);
    expect((await 以(外管, () => 客户项目概况们(外管, [客户X])))[客户X]?.项目数).toBe(2);
  });

  it("客户列表搜项目名（裸 SQL 候选那条路）：搜得出这条的客户", async () => {
    const 比 = 项目名另比(async () => 外管)!;
    const r = await 以(外管, () => 比("市场建的待分配"));
    expect(r && JSON.parse(String(r.values[0]))).toEqual([客户X]);
  });

  it("分给非下属后：照原范围，页签里没有了", async () => {
    const 外销散 = await 造人("ws2", "sales", { line: "外贸" });
    await prisma.project.update({ where: { id: 待分 }, data: { ownerId: 外销散.id, awaitAssignAt: null } });
    忘掉企业版范围();
    expect((await 区(外管, 客户X, 待分))!.页签们.map((t) => t.id)).toEqual([老项目]);
    expect(await 以(外管, () => 项目页去向(外管 as never, 待分))).toEqual({ 种: "无" });
  });

  it("权限项目列 带全了 能看项目 判待分配放开要的格", () => {
    expect(Object.keys(权限项目列).sort()).toEqual(["awaitAssignAt", "bizLine", "creatorId", "deletedAt", "ownerId", "phase", "pooledAt", "result", "scheduledAssignAt"].sort());
  });
});

describe("小修 2：「按组织看客户」关着时，「线索分配」开关照样管住详情", () => {
  it("线索分配关着：能看项目 不放开，/projects/<id> 是「无」；开着才放", async () => {
    await 开关(false, false);
    const p = await prisma.project.findUniqueOrThrow({ where: { id: 待分 }, select: 权限项目列 });
    expect((await 读组织()).线索分配开着).toBe(false);
    expect(能看项目(外管, p, await 读组织())).toBe(false);
    expect(await 以(外管, () => 项目页去向(外管 as never, 待分))).toEqual({ 种: "无" });

    await 开关(false, true);
    expect((await 读组织()).线索分配开着).toBe(true);
    expect(能看项目(外管, p, await 读组织())).toBe(true);
    expect(await 以(外管, () => 项目页去向(外管 as never, 待分))).toEqual({ 种: "客户页", 到: `/customers/${客户X}?project=${待分}` });
  });
});

describe("小修 3：直接改放开的那条，提示只能看", () => {
  it("改名、删：抛只读错误（只能看和分配），不是原始的找不到；数据没动", async () => {
    const 改 = await 以(外管, () => prisma.project.update({ where: { id: 待分 }, data: { name: "改了" } }).then(() => null, (e: unknown) => e));
    expect(改).toBeInstanceOf(只读错误);
    expect((改 as Error).message).toBe(待分配只能看话);
    const 删 = await 以(外管, () => prisma.project.delete({ where: { id: 待分 } }).then(() => null, (e: unknown) => e));
    expect(删).toBeInstanceOf(只读错误);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 待分 } })).name).toBe("市场建的待分配");
  });

  it("别的表真不在了：照旧原样抛（不借待分配的话）", async () => {
    const e = await 以(外管, () => prisma.customer.update({ where: { id: "没有这位" }, data: { name: "x" } }).then(() => null, (x: unknown) => x));
    expect(e).not.toBeInstanceOf(只读错误);
    expect((e as { code?: string }).code).toBe("P2025");
  });
});
