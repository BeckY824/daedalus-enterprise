/**
 * 后售培育阶段 1 显示（11-26，客户 E-290；总表 P-界面-63 / 64；方案第四节入口 #2–#8、第六节「1 后售显示」）：
 *   - 项目列表：进程那格写后售培育（行带 后售）；筛「后售培育」/「潜客培育」两边不重不漏，加起来 = 停在潜客培育
 *   - 看板：列不拆（后售的照落潜客培育那列），卡片小字写后售培育
 *   - 客户列表：「全部进程」筛后售培育 / 潜客培育；「当前节点」写后售培育
 *   - 客户详情：项目页签的节点字、进程条（读项目详情 带 后售）；抬头节点（客户没简称 / 全称 / 类型时）
 *   - 新建项目向导：新项目分配数据 带「客户有交付结清」，下拉的潜客培育那项显示后售培育，存的仍是潜客培育
 *   - 只改显示：库里的 node 一直是潜客培育
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import type { ReactElement } from "react";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss", role: "ADMIN", title: "", avatar: null as string | null },
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

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读项目列表, 读名单项目 } from "@/lib/project/list";
import { 卡片小字, 看板分列 } from "@/lib/project/board";
import { 企业版字典 } from "@/lib/project/stage-dict";
import { 后售项目们 } from "@/lib/project/after-sale";
import { 项目阶段客户条件, 客户项目概况们 } from "@/lib/project/customer-list-projects";
import { 抬头节点们 } from "@/lib/enterprise/customer-title";
import { 新项目分配数据 } from "@/app/(app)/customers/[id]/project-actions";
import CustomerPage from "@/app/(app)/customers/[id]/page";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import { 客户参与的项目 } from "@/lib/project/relate";
import { TOOLS } from "@/lib/agent/tools";
import { DEFAULT_BUSINESS } from "@/lib/business-config";
import type { 项目区数据 } from "@/app/(app)/customers/[id]/ProjectZone";

let 老板: { id: string; name: string; email: string; role: string; title: string; avatar: null };
/** 甲：名下有交付结清 → 停在潜客培育的「甲培育」是后售；乙：只有丢单 → 「乙培育」是潜客 */
let 甲: string, 乙: string, 甲培育: string, 乙培育: string, 甲交付: string;
const 建 = (name: string, customerId: string, x: object = {}) =>
  prisma.project.create({ data: { name, customerId, ownerId: 老板.id, creatorId: 老板.id, phase: "线索", node: "潜客培育", ...x } }).then((p) => p.id);
const 以 = <T,>(fn: () => Promise<T>) => { mocks.user = { ...老板 }; return 以谁的身份(老板.id, fn); };

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const u = await prisma.user.create({ data: { email: "boss", name: "老板", title: "", role: "ADMIN", password: "x" } });
  老板 = { id: u.id, name: "老板", email: "boss", role: "ADMIN", title: "", avatar: null };
  await prisma.entMember.create({ data: { userId: u.id, bizRole: "director" } });
  甲 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13900000001", salesOwnerId: u.id } })).id;
  乙 = (await prisma.customer.create({ data: { name: "客户乙", phone: "13900000002", salesOwnerId: u.id } })).id;
  甲交付 = await 建("甲交付", 甲, { phase: "订单", node: "尾款结算", result: "交付结清", closedAt: new Date("2026-06-01T00:00:00Z") });
  甲培育 = await 建("甲培育", 甲);
  await 建("甲验证", 甲, { node: "线索验证" });
  await 建("乙丢单", 乙, { phase: "商机", node: "成交推进", result: "丢单" });
  乙培育 = await 建("乙培育", 乙);
  忘掉企业版范围();
});
afterAll(async () => { vi.unstubAllEnvs(); invalidateSettingsCache(); await prisma.$disconnect(); });

const 列表 = (sp: Record<string, string> = {}) => 以(() => 读项目列表(老板, sp));
const 名们 = async (sp: Record<string, string>) => (await 列表(sp)).行.map((r) => r.name).sort();

describe("项目列表", () => {
  it("行带 后售：只有停在潜客培育、客户有交付结清的那一个；别的不带", async () => {
    const r = await 列表();
    const 后售的 = r.行.filter((x) => x.后售).map((x) => x.name);
    expect(后售的).toEqual(["甲培育"]);
    // 只改显示：库里存的照旧潜客培育
    expect(r.行.find((x) => x.id === 甲培育)?.node).toBe("潜客培育");
  });

  it("筛后售培育 / 潜客培育：两边不重不漏，加起来 = 停在潜客培育；filters 回认出的值", async () => {
    // 去掉「潜客培育排掉后售」（潜客不含后售条件 的 NOT）这条会红：潜客培育那边会多出甲培育
    expect(await 名们({ node: "潜客培育" })).toEqual(["乙培育"]);
    expect(await 名们({ node: "后售培育" })).toEqual(["甲培育"]);
    expect((await 列表({ node: "后售培育" })).filters.node).toBe("后售培育");
    expect((await 列表({ node: "后售培育" })).总数 + (await 列表({ node: "潜客培育" })).总数)
      .toBe(await prisma.project.count({ where: { phase: "线索", node: "潜客培育", result: null } }));
    // 阶段对不上：空；阶段是线索照筛
    expect(await 名们({ phase: "商机", node: "后售培育" })).toEqual([]);
    expect(await 名们({ phase: "线索", node: "后售培育" })).toEqual(["甲培育"]);
  });

  it("交付结清撤回（不再是交付结清）：立刻回到潜客培育，两边跟着换", async () => {
    await prisma.project.update({ where: { id: 甲交付 }, data: { result: null, closedAt: null } });
    expect(await 名们({ node: "后售培育" })).toEqual([]);
    expect(await 名们({ node: "潜客培育" })).toEqual(["乙培育", "甲培育"].sort());
    expect((await 列表()).行.some((x) => x.后售)).toBe(false);
  });
});

describe("项目详情中栏名单", () => {
  it("进程那格写后售培育；别的照旧", async () => {
    const r = await 以(() => 读名单项目(老板, 企业版字典));
    expect(r.rows.find((x) => x.id === 甲培育)?.进程).toBe("后售培育");
    expect(r.rows.find((x) => x.id === 乙培育)?.进程).toBe("潜客培育");
  });
});

describe("看板", () => {
  it("列不拆：后售的照落潜客培育那列；卡片小字写后售培育", async () => {
    const r = await 列表();
    const 列们 = 看板分列(r.行, 企业版字典);
    expect(列们.some((c) => c.列 === "后售培育")).toBe(false);
    const 潜客列 = 列们.find((c) => c.列 === "潜客培育")!;
    expect(潜客列.行.map((x) => x.name).sort()).toEqual(["乙培育", "甲培育"].sort());
    const 卡 = (id: string) => 卡片小字(r.行.find((x) => x.id === id)!, 企业版字典);
    expect(卡(甲培育)).toBe("后售培育");
    expect(卡(乙培育)).toBe("潜客培育");
  });
});

describe("客户列表", () => {
  it("「全部进程」筛后售培育 = 甲，筛潜客培育 = 乙", async () => {
    const 客户们 = async (node: string) => {
      const w = await 以(() => 项目阶段客户条件(老板, { node }));
      return (await prisma.customer.findMany({ where: w ?? {}, select: { name: true } })).map((c) => c.name).sort();
    };
    expect(await 客户们("后售培育")).toEqual(["客户甲"]);
    expect(await 客户们("潜客培育")).toEqual(["客户乙"]);
  });

  it("「当前节点」：选中的项目判成后售写后售培育；不是照旧", async () => {
    // 让甲最近动过的是甲培育、乙最近动过的是乙培育
    await prisma.project.update({ where: { id: 甲培育 }, data: { updatedAt: new Date("2030-01-01T00:00:00Z") } });
    await prisma.project.update({ where: { id: 乙培育 }, data: { updatedAt: new Date("2030-01-01T00:00:00Z") } });
    const r = await 以(() => 客户项目概况们(老板, [甲, 乙]));
    expect(r[甲].当前节点).toBe("后售培育");
    expect(r[乙].当前节点).toBe("潜客培育");
  });

  it("抬头节点（没简称 / 全称 / 类型的客户）：传了 后售项目们 写后售培育，不传照旧", async () => {
    const 丙 = (await prisma.customer.create({ data: { name: "", phone: "13900000003", salesOwnerId: 老板.id } })).id;
    await 建("丙交付", 丙, { phase: "订单", node: "尾款结算", result: "交付结清", updatedAt: new Date("2029-01-01T00:00:00Z") });
    await 建("丙培育", 丙, { updatedAt: new Date("2030-01-01T00:00:00Z") });
    const 料 = await prisma.customer.findUniqueOrThrow({ where: { id: 丙 } });
    expect((await 抬头节点们(prisma, [料], 后售项目们))[丙]?.节点).toBe("后售培育");
    expect((await 抬头节点们(prisma, [料]))[丙]?.节点).toBe("潜客培育");
  });
});

describe("客户详情", () => {
  const 区 = async (c: string, project?: string) => {
    const el = (await 以(() => CustomerPage({ params: Promise.resolve({ id: c }), searchParams: Promise.resolve(project ? { project } : {}) } as never))) as ReactElement<{ 项目数据: 项目区数据 | null }>;
    return el.props.项目数据!;
  };

  it("项目页签的节点字写后售培育；进程条（当前项目）带 后售；别的客户 / 别的项目不带", async () => {
    const z = await 区(甲, 甲培育);
    expect(z.页签们.find((t) => t.id === 甲培育)?.节点).toBe("后售培育");
    expect(z.页签们.find((t) => t.name === "甲验证")?.节点).toBe("线索验证");
    expect(z.当前?.p.id).toBe(甲培育);
    expect(z.当前?.p.后售).toBe(true);
    const 乙区 = await 区(乙, 乙培育);
    expect(乙区.页签们.find((t) => t.id === 乙培育)?.节点).toBe("潜客培育");
    expect(乙区.当前?.p.后售).toBeUndefined();
  });
});

describe("新建项目向导", () => {
  it("新项目分配数据 带「客户有交付结清」：甲 true、乙 false", async () => {
    mocks.user = { ...老板 };
    expect((await 新项目分配数据(甲))?.客户有交付结清).toBe(true);
    expect((await 新项目分配数据(乙))?.客户有交付结清).toBe(false);
  });
});

describe("公海「当前进程」", () => {
  it("公海客户名下最新的项目判成后售：写「线索-后售培育」；没交付结清的照旧", async () => {
    const 丁 = (await prisma.customer.create({ data: { name: "客户丁", phone: "13900000004", salesOwnerId: 老板.id } })).id;
    const 戊 = (await prisma.customer.create({ data: { name: "客户戊", phone: "13900000005", salesOwnerId: 老板.id } })).id;
    await 建("丁交付", 丁, { phase: "订单", node: "尾款结算", result: "交付结清", createdAt: new Date("2026-01-01T00:00:00Z") });
    await 建("丁培育", 丁, { createdAt: new Date("2026-02-01T00:00:00Z") });
    await 建("戊培育", 戊);
    await prisma.customerPool.createMany({ data: [{ customerId: 丁, reason: "手动" }, { customerId: 戊, reason: "手动" }] });
    忘掉企业版范围();
    const 页 = await 以(() => 读公海页(老板, {}, 1, 20));
    const 行 = (c: string) => 页.行.find((r) => r.种 === "客户" && r.customerId === c);
    expect(行(丁)?.进程).toBe("线索-后售培育");
    expect(行(丁)?.进程明细).toContain("丁培育：线索-后售培育");
    expect(行(戊)?.进程).toBe("线索-潜客培育");
  });
});

describe("关联客户：客户页「参与的项目」", () => {
  it("概览名称的当前进程写后售培育", async () => {
    await prisma.projectCustomer.create({ data: { projectId: 甲培育, customerId: 乙 } });
    const 行 = (await 以(() => 客户参与的项目(乙, 企业版字典)))!;
    expect(行.find((r) => r.projectId === 甲培育)?.名.startsWith("后售培育|")).toBe(true);
  });
});

describe("首页 AI 问数", () => {
  const 跑 = (name: string, args: Record<string, unknown>) => 以(() => TOOLS.find((t) => t.name === name)!.run(args, { userId: 老板.id, userName: 老板.name, b: { ...DEFAULT_BUSINESS, projectMode: true }, recordOffset: 0, proposals: [] } as never));
  type 列 = { 总数: number; 项目: { 名称: string; 节点: string }[] };

  it("list_projects：node=后售培育 数出 1 个（不是 0）；node=潜客培育 排掉后售；不带 node 时节点按显示名写", async () => {
    const 后 = (await 跑("list_projects", { node: "后售培育" })).data as 列;
    expect(后.总数).toBe(1);
    expect(后.项目.map((p) => [p.名称, p.节点])).toEqual([["甲培育", "后售培育"]]);
    const 潜 = (await 跑("list_projects", { node: "潜客培育" })).data as 列;
    expect(潜.项目.map((p) => p.名称)).toEqual(["乙培育"]);
    const 全 = (await 跑("list_projects", {})).data as 列;
    expect(全.项目.find((p) => p.名称 === "甲培育")?.节点).toBe("后售培育");
    expect(全.项目.find((p) => p.名称 === "乙培育")?.节点).toBe("潜客培育");
  });

  it("query_records：节点 = 后售培育 / 潜客培育 两边不重不漏，加起来 = 节点是潜客培育的；不等于 后售培育 排掉它", async () => {
    const 数 = async (条件: unknown[]) => ((await 跑("query_records", { 表: "项目", 条件 })).data as { 总数: number }).总数;
    expect(await 数([{ 字段: "节点", 运算: "等于", 值: "后售培育" }])).toBe(1);
    expect(await 数([{ 字段: "节点", 运算: "等于", 值: "潜客培育" }])).toBe(1);
    expect(await 数([{ 字段: "节点", 运算: "属于", 值: ["潜客培育", "后售培育"] }])).toBe(2);
    expect(await 数([{ 字段: "节点", 运算: "属于", 值: ["后售培育", "线索验证"] }])).toBe(2);
    const 全 = await 数([]);
    expect(await 数([{ 字段: "节点", 运算: "不等于", 值: "后售培育" }])).toBe(全 - 1);
  });

  it("get_customer：名下项目的节点按显示名写", async () => {
    const r = (await 跑("get_customer", { id: 甲 })).data as { 项目: { 名称: string; 节点: string }[] };
    expect(r.项目.find((p) => p.名称 === "甲培育")?.节点).toBe("后售培育");
    expect(r.项目.find((p) => p.名称 === "甲验证")?.节点).toBe("线索验证");
  });
});
