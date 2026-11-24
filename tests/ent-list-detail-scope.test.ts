/**
 * 列表（数据层）不比详情宽（可见范围修复单 11-24 ②）：各角色在 以谁的身份 下 prisma.project.findMany 回来的每一行都过详情的 能看项目，
 * 列表看得到、点进去 404 的不许有。
 * ② 管理者按下属认组员：数据层组员条件原来按「本人 + 实线 / 虚线下属 + 条线成员」整串人认，详情 能看项目 只认本人进组（p.已加入.includes(me.id)）。
 *   收窄跟详情走：组员条件（项目、组员的客户、卡点、裸 SQL）只认本人；只看某人详情不认组员，数据层也不认。
 * ① 按部门认的市场成员只挂销售角色（现库 0 人）：市场的人 只给有市场角色、或在项目页算市场视角的放开；
 *   有市场角色的兼任（渠运兼销售、条线总管理 + 销管 + 市场管理）照旧并集。
 * 口径：P-看-01（销管看实线下属 + 自己 + 公海）、P-看-08（项目组员只看自己加入的项目，连带看到挂着的客户）、P-看-12（同客户下同事的项目看不到）。
 * 「按组织看客户」开着（c2 的组合）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
const mocks = vi.hoisted(() => ({ user: { id: "", role: "SALES", name: "" } }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));

import { prisma, defaultClient } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 只看某人键 } from "@/lib/enterprise/org-core";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读组织 } from "@/lib/enterprise/org";
import { 能看项目, 权限项目选, 带已加入 } from "@/lib/enterprise/permissions";
import { 看得到的范围SQL } from "@/lib/scope-sql";
import { 全局搜索 } from "@/app/(app)/global-search";
import { TOOLS } from "@/lib/agent/tools";
import { DEFAULT_BUSINESS } from "@/lib/business-config";

type 人 = { id: string; role: string; 名: string };
let 总管: 人, 销管: 人, 下属: 人, 链外: 人, 同事: 人, 虚线上级: 人, 虚线下属: 人, 线总: 人, 线内: 人, 线读: 人, 盯的人: 人, 被盯: 人, 渠运: 人, 市管: 人, 市管下级: 人, 市场部销售: 人, 渠运兼销售: 人, 组合: 人, 组合下级: 人;
let 序 = 0;

// 客户的建档人 = 项目的建的人（市场相关客户按客户建档人认）
const 建客户 = async (负责人: 人, 建的人: 人) => {
  序++;
  return (
    await prisma.customer.create({
      data: { name: `客户${序}`, phone: `1390000${String(序).padStart(4, "0")}`, salesOwnerId: 负责人.id, creator: { create: { userId: 建的人.id } } },
    })
  ).id;
};
async function 项目(name: string, 负责人: 人, 建的人: 人 = 负责人, 组员: 人[] = []) {
  const customerId = await 建客户(负责人, 建的人);
  const p = await prisma.project.create({ data: { name, customerId, ownerId: 负责人.id, creatorId: 建的人.id } });
  for (const u of 组员) await prisma.projectMember.create({ data: { projectId: p.id, userId: u.id, inviteStatus: "JOINED" } });
  return { id: p.id, customerId };
}

/** 数据层回来的项目，详情点不进的那些（能看项目 不过） */
async function 点不进的(谁: 人): Promise<string[]> {
  const org = await 读组织();
  const 行 = await 以谁的身份(谁.id, () => prisma.project.findMany({ select: { ...权限项目选, name: true } }));
  return 行.filter((p) => !能看项目(谁, 带已加入(p), org)).map((p) => p.name).sort();
}
const 项目名 = async (谁: 人) => (await 以谁的身份(谁.id, () => prisma.project.findMany({ select: { name: true } }))).map((p) => p.name).sort();
const 客户编号 = async (谁: 人) => (await 以谁的身份(谁.id, () => prisma.customer.findMany({ select: { id: true } }))).map((c) => c.id);
/** 裸 SQL 快路（scope-sql.ts）名下那一路挑出来的客户；null = 这个人走 Prisma */
async function 裸SQL客户(谁: 人): Promise<string[] | null> {
  return 以谁的身份(谁.id, async () => {
    const 范围 = await 看得到的范围SQL();
    if (!范围) return null;
    return (await defaultClient.$queryRawUnsafe<{ id: string }[]>(`SELECT c.id FROM "Customer" c WHERE ${范围.名下.where}`, ...范围.名下.参数)).map((r) => r.id);
  });
}

/** 入口层：顶部全局搜索、首页 AI 找客户（scope=team）都按 以谁的身份 + requireUser 跑 */
const 以 = <T,>(谁: 人, fn: () => Promise<T>): Promise<T> => {
  mocks.user = { id: 谁.id, role: 谁.role, name: 谁.名 };
  return 以谁的身份(谁.id, fn);
};
const 搜项目 = async (谁: 人, 词: string) => (await 以(谁, () => 全局搜索(词))).项目.map((p) => p.name);
const 搜客户 = async (谁: 人, 词: string) => (await 以(谁, () => 全局搜索(词))).客户.map((c) => c.id);
async function AI团队客户(谁: 人): Promise<string[]> {
  const 工具 = TOOLS.find((t) => t.name === "search_customers")!;
  const r = await 以(谁, () => 工具.run({ scope: "team" }, { userId: 谁.id, userName: 谁.名, b: { ...DEFAULT_BUSINESS, projectMode: true }, recordOffset: 0, proposals: [] } as never));
  return ((r as { data?: { customers?: { id: string }[] } }).data?.customers ?? []).map((c) => c.id);
}

let 链外的: { id: string; customerId: string };
let 盯的人进组的: { id: string; customerId: string };

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  序 = 0;
  const 建 = async (名: string, bizRole: string, extra: { managerId?: string; dottedManagerId?: string; deptId?: string; line?: string } = {}): Promise<人> => {
    const u = await prisma.user.create({ data: { email: 名, name: 名, title: "", role: "SALES", password: "x" } });
    await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId: extra.managerId ?? null, dottedManagerId: extra.dottedManagerId ?? null, deptId: extra.deptId ?? null, line: extra.line ?? null } });
    return { id: u.id, role: u.role, 名 };
  };
  const 市场部 = (await prisma.entDept.create({ data: { name: "市场部" } })).id;
  总管 = await 建("boss", "director");
  销管 = await 建("mgr", "sales_mgr");
  下属 = await 建("sub", "sales", { managerId: 销管.id });
  链外 = await 建("other", "sales");
  同事 = await 建("peer", "sales");
  虚线上级 = await 建("dmgr", "sales_mgr");
  虚线下属 = await 建("dsub", "sales", { dottedManagerId: 虚线上级.id });
  线总 = await 建("linedir", "director", { line: "外贸" });
  线内 = await 建("lineman", "sales", { line: "外贸" });
  线读 = await 建("lineadmin", "admin", { line: "外贸" });
  盯的人 = await 建("watcher", "sales");
  被盯 = await 建("watched", "sales");
  渠运 = await 建("chan", "channel_ops");
  市管 = await 建("mktmgr", "marketing_mgr");
  市管下级 = await 建("mktsub", "sales", { managerId: 市管.id });
  市场部销售 = await 建("mkts", "sales", { deptId: 市场部 });
  渠运兼销售 = await 建("chansales", "channel_ops,sales", { deptId: 市场部 });
  // 条线总管理 + 销管 + 市场管理（同现库那位总管理的组合），挂在市场部
  组合 = await 建("combo", "director,sales_mgr,marketing_mgr", { line: "内贸", deptId: 市场部 });
  组合下级 = await 建("combosub", "sales", { managerId: 组合.id, line: "内贸", deptId: 市场部 });
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting(规则.按组织看客户.key, true);
  await setSetting(只看某人键, JSON.stringify({ [盯的人.id]: 被盯.id }));

  // 负责人、建的人都是链外同事；各角色「管得到的人」（下属、虚线下属、条线成员、被盯的人、市场管理的直属下级）点了同意进组
  链外的 = await 项目("链外的", 链外, 链外, [下属, 虚线下属, 线内, 被盯, 市管下级]);
  // 管理者自己进组的照常看得到（P-看-08）
  await 项目("销管进组的", 链外, 链外, [销管]);
  await 项目("市管进组的", 链外, 链外, [市管]);
  // 只看某人详情不认组员（permissions.ts 能看项目「只看某人」那一支），自己进组的也点不进
  盯的人进组的 = await 项目("盯的人进组的", 链外, 链外, [盯的人]);
  await 项目("下属的", 下属);
  await 项目("虚线下属的", 虚线下属);
  await 项目("线内的", 线内);
  await 项目("被盯的", 被盯);
  await 项目("渠运建的", 同事, 渠运);
  await 项目("市管下级建的", 同事, 市管下级);
  await 项目("同事的", 同事);
  忘掉企业版范围();
});
afterEach(() => {
  vi.unstubAllEnvs();
  忘掉企业版范围();
});

describe("不变式：数据层回的项目每一行都点得进详情（②）", () => {
  it("各角色 prisma.project.findMany 没有点不进的", async () => {
    const 角色们 = [总管, 销管, 下属, 链外, 同事, 虚线上级, 虚线下属, 线总, 线内, 线读, 盯的人, 被盯, 渠运, 市管, 市管下级];
    const 结果: Record<string, string[]> = {};
    for (const 谁 of 角色们) 结果[谁.名] = await 点不进的(谁);
    expect(结果).toEqual(Object.fromEntries(角色们.map((x) => [x.名, []])));
  });
});

describe("销售管理：下属进组、负责人不在他管辖的项目不出（P-看-01 / P-看-08）", () => {
  it("项目列表不出，自己进组的、下属负责的照出", async () => {
    const 名 = await 项目名(销管);
    expect(名).not.toContain("链外的");
    expect(名).toEqual(expect.arrayContaining(["销管进组的", "下属的"]));
  });

  it("客户 findMany 不出链外那位客户；裸 SQL 快路同样不出", async () => {
    expect(await 客户编号(销管)).not.toContain(链外的.customerId);
    const 裸 = await 裸SQL客户(销管);
    expect(裸).not.toBeNull();
    expect(裸).not.toContain(链外的.customerId);
  });

  it("进组的下属本人照常看得到项目和挂着的客户（P-看-08 回归）", async () => {
    expect(await 项目名(下属)).toContain("链外的");
    expect(await 客户编号(下属)).toContain(链外的.customerId);
    expect(await 裸SQL客户(下属)).toContain(链外的.customerId);
  });
});

describe("入口：销管场景（下属进组、负责人不在他管辖）", () => {
  it("顶部全局搜索：销管搜不到链外的项目和客户，自己进组的搜得到；进组的下属本人搜得到", async () => {
    const 链外客户名 = (await prisma.customer.findUniqueOrThrow({ where: { id: 链外的.customerId }, select: { name: true } })).name;
    expect(await 搜项目(销管, "链外的")).toEqual([]);
    expect(await 搜客户(销管, 链外客户名)).not.toContain(链外的.customerId);
    expect(await 搜项目(销管, "销管进组的")).toEqual(["销管进组的"]);
    expect(await 搜项目(下属, "链外的")).toEqual(["链外的"]);
    expect(await 搜客户(下属, 链外客户名)).toContain(链外的.customerId);
  });

  it("首页 AI 找客户（团队范围）：销管不出链外那位客户；进组的下属本人照出", async () => {
    expect(await AI团队客户(销管)).not.toContain(链外的.customerId);
    expect(await AI团队客户(下属)).toContain(链外的.customerId);
  });
});

describe("其他管辖类角色：组员条件只认本人", () => {
  it("虚线上级、条线总管理、按线只读、市场管理：链外的项目和客户都不出", async () => {
    for (const 谁 of [虚线上级, 线总, 线读, 市管]) {
      expect({ 谁: 谁.名, 有: (await 项目名(谁)).includes("链外的") }).toEqual({ 谁: 谁.名, 有: false });
      expect({ 谁: 谁.名, 有: (await 客户编号(谁)).includes(链外的.customerId) }).toEqual({ 谁: 谁.名, 有: false });
    }
  });

  it("只看某人：被盯的人进组的、自己进组的都不出（详情不认组员）；被盯的人负责的照出", async () => {
    const 名 = await 项目名(盯的人);
    expect(名).not.toContain("链外的");
    expect(名).not.toContain("盯的人进组的");
    expect(名).toContain("被盯的");
    const 客户 = await 客户编号(盯的人);
    expect(客户).not.toContain(链外的.customerId);
    expect(客户).not.toContain(盯的人进组的.customerId);
  });

  it("渠运建的、分给同事的照出（详情认市场角色的建档人）；市管下级建的市场管理照出", async () => {
    expect(await 项目名(渠运)).toContain("渠运建的");
    expect(await 项目名(市管)).toEqual(expect.arrayContaining(["市管下级建的", "市管进组的"]));
  });
});

describe("① 按部门认的市场成员只挂销售角色", () => {
  it("市场部销售：自己建的、已分给同事的项目和客户不出", async () => {
    const p = await 项目("市场部销售建的", 同事, 市场部销售);
    忘掉企业版范围();
    expect(await 点不进的(市场部销售)).toEqual([]);
    expect(await 项目名(市场部销售)).not.toContain("市场部销售建的");
    expect(await 客户编号(市场部销售)).not.toContain(p.customerId);
  });

  it("市场部销售自己负责的照出（P-看-01 回归）", async () => {
    const p = await 项目("市场部销售负责的", 市场部销售);
    忘掉企业版范围();
    expect(await 项目名(市场部销售)).toContain("市场部销售负责的");
    expect(await 客户编号(市场部销售)).toContain(p.customerId);
  });

  it("渠运兼销售（有市场角色）：自己建的、分给同事的项目和客户照出，且都点得进", async () => {
    const p = await 项目("渠运兼销售建的", 同事, 渠运兼销售);
    忘掉企业版范围();
    expect(await 项目名(渠运兼销售)).toContain("渠运兼销售建的");
    expect(await 客户编号(渠运兼销售)).toContain(p.customerId);
    expect(await 点不进的(渠运兼销售)).toEqual([]);
  });

  it("条线总管理 + 销管 + 市场管理：直属下级建的、分给同事的照出（市场管理那一支不动），且都点得进", async () => {
    const p = await 项目("组合下级建的", 同事, 组合下级);
    忘掉企业版范围();
    expect(await 项目名(组合)).toContain("组合下级建的");
    expect(await 客户编号(组合)).toContain(p.customerId);
    expect(await 点不进的(组合)).toEqual([]);
  });
});
