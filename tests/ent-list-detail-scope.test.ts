/**
 * 列表（数据层）不比详情宽（可见范围修复单 11-24 ②）：各角色在 以谁的身份 下 prisma.project.findMany 回来的每一行都过详情的 能看项目，
 * 列表看得到、点进去 404 的不许有。
 * ② 管理者按下属认组员：数据层组员条件原来按「本人 + 实线 / 虚线下属 + 条线成员」整串人认，详情 能看项目 只认本人进组（p.已加入.includes(me.id)）。
 *   收窄跟详情走：组员条件（项目、组员的客户、卡点、裸 SQL）只认本人。
 * P-看-19（用户 11-24，照 P-看-08）：设了「只看某人」的人，自己进组的项目和挂着的客户列表、详情都能看；被盯的人进组、自己没进的照旧不露。
 * ① P-看-17（用户 11-24；X-165 11-25 扩到没有市场角色、不论兼什么业务角色，兼销管、兼项目组员的一样）：按部门认的市场成员（现库 0 人），列表照 P-看-05 放开（自己建的、分给同事的项目和客户看得到）；
 *   项目详情照旧进不去（P-看-06），点进去不落 404、跳市场视角页（P-界面-11，load.ts 市场去向）。所以不变式对他放宽成「详情过，或者落到这条跳转」：
 *   列表里有、详情进不去的那几行正是 P-看-06 定的「分配后只看进度」，跳转落点就是列表里的那一行，不借跳转露出列表外的项目。
 *   有市场角色的兼任（渠运兼销售、条线总管理 + 销管 + 市场管理）照旧并集，两条回归照跑。
 * P-看-18（用户 11-24）：条线总管理的列表和详情一致、不收窄详情——项目补「创建人在本线」的（详情 能看项目 早认），
 *   客户补名下有本线建的项目的，只读（看得到、写范围不放宽）；销管下属建的、负责人不在他管辖的照旧拿不到（详情也不认）。
 * 口径：P-看-01（销管看实线下属 + 自己 + 公海）、P-看-08（项目组员只看自己加入的项目，连带看到挂着的客户）、P-看-12（同客户下同事的项目看不到）、P-角色-01。
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
import { 以谁的身份, 忘掉企业版范围, 组织范围of, 条线只读话, 条线或市场只读话 } from "@/lib/enterprise/visibility";
import { 条线范围of, 本线建的客户条件 } from "@/lib/enterprise/line-viewer";
import { 读组织 } from "@/lib/enterprise/org";
import { 能看项目, 权限项目选, 带已加入 } from "@/lib/enterprise/permissions";
import { 项目页去向 } from "@/app/(app)/projects/[id]/load";
import { 看得到的范围SQL } from "@/lib/scope-sql";
import { 限定条件, 只读客户, 现在的条线建的客户, 只读话, 虚线只读挡 } from "@/lib/team-scope";
import { 全局搜索 } from "@/app/(app)/global-search";
import { 关键词分页 } from "@/app/(app)/customers/query";
import { TOOLS } from "@/lib/agent/tools";
import { DEFAULT_BUSINESS } from "@/lib/business-config";

type 人 = { id: string; role: string; 名: string };
let 总管: 人, 销管: 人, 下属: 人, 链外: 人, 同事: 人, 虚线上级: 人, 虚线下属: 人, 线总: 人, 线内: 人, 线读: 人, 盯的人: 人, 被盯: 人, 渠运: 人, 市管: 人, 市管下级: 人, 市场部销售: 人, 渠运兼销售: 人, 组合: 人, 组合下级: 人, 市场部销管: 人, 销管下属: 人, 市场部销管组员: 人, 组员下属: 人;
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
/** 本线成员建的、负责人是线外同事（P-看-18）；销管下属建的、负责人是线外同事（详情不认建的人，照旧拿不到） */
let 线内建的: { id: string; customerId: string };
let 下属建的: { id: string; customerId: string };
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
  // X-165：市场部里兼销售 + 销管、兼销管 + 项目组员的（没有市场角色），各带一个实线下属
  市场部销管 = await 建("mktmgr2", "sales,sales_mgr", { deptId: 市场部 });
  销管下属 = await 建("mktmgr2sub", "sales", { managerId: 市场部销管.id });
  市场部销管组员 = await 建("mktpo", "sales_mgr,project_ops", { deptId: 市场部 });
  组员下属 = await 建("mktposub", "sales", { managerId: 市场部销管组员.id });
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
  // 只看某人自己进组的（P-看-19）：列表、详情都认
  盯的人进组的 = await 项目("盯的人进组的", 链外, 链外, [盯的人]);
  await 项目("下属的", 下属);
  await 项目("虚线下属的", 虚线下属);
  await 项目("线内的", 线内);
  await 项目("被盯的", 被盯);
  await 项目("渠运建的", 同事, 渠运);
  await 项目("市管下级建的", 同事, 市管下级);
  await 项目("同事的", 同事);
  线内建的 = await 项目("线内建的", 同事, 线内);
  下属建的 = await 项目("下属建的", 同事, 下属);
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

/** 详情 能看项目 认得的项目：全部没进回收站的项目（底层客户端，不过限定）逐个判 */
async function 详情看得到的(谁: 人): Promise<string[]> {
  const org = await 读组织();
  const 全部 = await defaultClient.project.findMany({ where: { deletedAt: null }, select: { ...权限项目选, name: true } });
  return 全部.filter((p) => 能看项目(谁, 带已加入(p), org)).map((p) => p.name).sort();
}

describe("反向不变式：详情点得进的项目，列表（数据层）一个不少——两边是同一个集合（P-看-18、P-看-19）", () => {
  it("各角色：全部项目逐个跑 能看项目 = 以谁的身份 下 project.findMany", async () => {
    // 部门市场无市场角色自己建的、分给同事的（P-看-17）：列表有、详情进不去、点进去跳市场视角页（文件头的放宽）
    const 跳的 = await 项目("市场部销售建的", 同事, 市场部销售);
    // X-165 兼销管、兼项目组员的：分给同事的落到跳转；分给自己下属的按销管口径详情本来就进得去，两边都有
    const 跳的们 = { [市场部销管.名]: await 项目("市场部销管建的", 同事, 市场部销管), [市场部销管组员.名]: await 项目("市场部销管组员建的", 同事, 市场部销管组员) };
    await 项目("市场部销管给下属的", 销管下属, 市场部销管);
    await 项目("市场部销管组员给下属的", 组员下属, 市场部销管组员);
    忘掉企业版范围();
    const 角色们 = [总管, 销管, 下属, 链外, 同事, 虚线上级, 虚线下属, 线总, 线内, 线读, 盯的人, 被盯, 渠运, 市管, 市管下级, 市场部销售, 渠运兼销售, 组合, 组合下级, 市场部销管, 销管下属, 市场部销管组员, 组员下属];
    const 列表: Record<string, string[]> = {};
    const 详情: Record<string, string[]> = {};
    for (const 谁 of 角色们) {
      详情[谁.名] = await 详情看得到的(谁);
      列表[谁.名] = await 项目名(谁);
    }
    // 不是空比空：条线总管理本线建的（P-看-18）、只看某人自己进组的（P-看-19）详情都认
    expect(详情[线总.名]).toContain("线内建的");
    expect(详情[盯的人.名]).toContain("盯的人进组的");
    // 部门市场无市场角色：列表比详情多的只许是落到跳转的那一行，去掉再比
    const 多的 = 列表[市场部销售.名].filter((n) => !详情[市场部销售.名].includes(n));
    expect(多的).toEqual(["市场部销售建的"]);
    expect((await 去向(市场部销售, 跳的.id)).种).toBe("转向");
    列表[市场部销售.名] = 列表[市场部销售.名].filter((n) => !多的.includes(n));
    for (const 谁 of [市场部销管, 市场部销管组员]) {
      expect(详情[谁.名]).toContain(`${谁 === 市场部销管 ? "市场部销管" : "市场部销管组员"}给下属的`);
      const 多 = 列表[谁.名].filter((n) => !详情[谁.名].includes(n));
      expect(多).toEqual([`${谁 === 市场部销管 ? "市场部销管" : "市场部销管组员"}建的`]);
      expect((await 去向(谁, 跳的们[谁.名].id)).种).toBe("转向");
      列表[谁.名] = 列表[谁.名].filter((n) => !多.includes(n));
    }
    expect(列表).toEqual(详情);
  });
});

describe("条线总管理：本线建的客户，名单和过上限退回的子查询挑出同一批（审查 11-24）", () => {
  /** 按 line-viewer 口径直接算（不过限定层）：负责人在 读 里 + 公海 + 名下有本线建的、没进回收站的项目；客户不在回收站 */
  async function 口径(谁: 人): Promise<string[]> {
    const org = await 读组织();
    const 读 = 组织范围of(org, null, 谁.id)!.读!;
    const 行 = await defaultClient.customer.findMany({
      where: { deletedAt: null, OR: [{ salesOwnerId: { in: 读 } }, { pool: { isNot: null } }, 本线建的客户条件(条线范围of(org, 谁.id)!)] },
      select: { id: true },
    });
    return 行.map((c) => c.id).sort();
  }
  const 排 = (xs: string[]) => [...xs].sort();
  it("名单（≤300）：整批 = 口径，列表、详情、裸 SQL 快路都带上", async () => {
    const 名单 = await 以谁的身份(线总.id, () => 现在的条线建的客户(defaultClient));
    expect(名单).toEqual([线内建的.customerId]);
    expect(排(await 客户编号(线总))).toEqual(await 口径(线总));
    expect(await 以谁的身份(线总.id, () => prisma.customer.findUnique({ where: { id: 线内建的.customerId }, select: { id: true } }))).not.toBeNull();
    // 裸 SQL 名下那一路 = 不在公海的；夹具里没有公海客户，整批同口径
    expect(排((await 裸SQL客户(线总))!)).toEqual(await 口径(线总));
  });

  it("过上限（>300）：退回子查询、裸 SQL 快路改走 Prisma；整批 = 口径，不含项目进了回收站的；只读改不到", async () => {
    const 多的: string[] = [];
    for (let i = 0; i < 305; i++) 多的.push(`lnb_${String(i).padStart(3, "0")}`);
    await defaultClient.customer.createMany({ data: 多的.map((id, i) => ({ id, name: `线建客户${i}`, phone: `1880000${String(i).padStart(4, "0")}`, salesOwnerId: 同事.id })) });
    await defaultClient.project.createMany({ data: 多的.map((customerId, i) => ({ id: `lnbp_${i}`, name: `线建项目${i}`, customerId, ownerId: 同事.id, creatorId: 线内.id })) });
    await defaultClient.project.update({ where: { id: "lnbp_1" }, data: { deletedAt: new Date() } });
    忘掉企业版范围();
    expect(await 以谁的身份(线总.id, () => 现在的条线建的客户(defaultClient))).toBeNull();
    expect(await 裸SQL客户(线总)).toBeNull();
    const 名 = "线建客户300";
    expect(await 以(线总, () => 关键词分页({ keyword: 名 }, 1, 50))).toBeNull();
    const 列表 = 排(await 客户编号(线总));
    expect(列表).toEqual(await 口径(线总));
    expect(列表).toEqual(expect.arrayContaining(["lnb_000", "lnb_002", 线内建的.customerId]));
    expect(列表).not.toContain("lnb_001");
    expect(await 搜客户(线总, 名)).toEqual(["lnb_300"]);
    expect(await 以谁的身份(线总.id, () => prisma.customer.findUnique({ where: { id: "lnb_000" }, select: { id: true } }))).not.toBeNull();
    expect((await 以谁的身份(线总.id, () => prisma.customer.updateMany({ where: { id: { in: ["lnb_000", "lnb_002"] } }, data: { remark: "改" } }))).count).toBe(0);
    // 线外的人照旧拿不到
    expect(await 客户编号(销管)).not.toContain("lnb_002");
  });
});

describe("条线总管理：列表补「创建人在本线」，和详情一致（P-看-18）", () => {
  it("项目：本线建的、负责人不在本线的进列表，且详情点得进", async () => {
    expect(await 项目名(线总)).toContain("线内建的");
    expect(await 点不进的(线总)).toEqual([]);
  });

  it("客户：名下有本线建的项目的进列表、详情拿得到；裸 SQL 快路同样带上", async () => {
    expect(await 客户编号(线总)).toContain(线内建的.customerId);
    expect(await 以谁的身份(线总.id, () => prisma.customer.findUnique({ where: { id: 线内建的.customerId }, select: { id: true } }))).not.toBeNull();
    const 裸 = await 裸SQL客户(线总);
    expect(裸).not.toBeNull();
    expect(裸).toContain(线内建的.customerId);
  });

  it("只读：客户详情按只读认，updateMany 改到 0 位，单条改抛只读", async () => {
    expect(await 以谁的身份(线总.id, () => 只读客户(defaultClient, { id: 线内建的.customerId, salesOwnerId: 同事.id, pool: null }))).toBe("全");
    const 改 = await 以谁的身份(线总.id, () => prisma.customer.updateMany({ where: { id: 线内建的.customerId }, data: { remark: "改" } }));
    expect(改.count).toBe(0);
    await expect(以谁的身份(线总.id, () => prisma.customer.update({ where: { id: 线内建的.customerId }, data: { remark: "改" } }))).rejects.toThrow(/只能看/);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: 线内建的.customerId }, select: { remark: true } })).remark).not.toBe("改");
    // 挡下那句说本线，不说「虚线下属」（审查 11-24）；兼市场管理的说本线或市场；多选那句同一个原因
    expect(await 以谁的身份(线总.id, () => 只读话(defaultClient))).toBe(条线只读话);
    expect(await 以谁的身份(组合.id, () => 只读话(defaultClient))).toBe(条线或市场只读话);
    const 另一位 = await 项目("线内建的二", 同事, 线内);
    忘掉企业版范围();
    expect(await 以谁的身份(线总.id, () => 虚线只读挡(defaultClient, [线内建的.customerId, 另一位.customerId]))).toBe(
      "选中的有 2 位是本线同事负责的客户，或本线同事建的项目挂着的客户：只能看，不能改、不能转、不能删。去掉这几位再试",
    );
    // 项目照旧改不到（别人负责的只看，P-角色-01）
    const 改项目 = await 以谁的身份(线总.id, () => prisma.project.updateMany({ where: { id: 线内建的.id }, data: { name: "改" } }));
    expect(改项目.count).toBe(0);
  });

  it("入口：全局搜索、AI 找客户（团队范围）都带上", async () => {
    const 名 = (await prisma.customer.findUniqueOrThrow({ where: { id: 线内建的.customerId }, select: { name: true } })).name;
    expect(await 搜客户(线总, 名)).toContain(线内建的.customerId);
    expect(await 搜项目(线总, "线内建的")).toEqual(["线内建的"]);
    expect(await AI团队客户(线总)).toContain(线内建的.customerId);
    // 客户列表搜关键词的裸 SQL 快路（customers/query.ts 关键词分页）
    const 快 = await 以(线总, () => 关键词分页({ keyword: 名 }, 1, 50));
    expect(快).not.toBeNull();
    expect(快!.ids).toContain(线内建的.customerId);
  });

  it("别的角色不变：销管下属建的、负责人不在他管辖的项目和客户照旧拿不到（详情也不认）；线外的人拿不到本线建的", async () => {
    expect(await 项目名(销管)).not.toContain("下属建的");
    expect(await 客户编号(销管)).not.toContain(下属建的.customerId);
    expect(await 裸SQL客户(销管)).not.toContain(下属建的.customerId);
    expect(await AI团队客户(销管)).not.toContain(下属建的.customerId);
    const org = await 读组织();
    const p = await prisma.project.findUniqueOrThrow({ where: { id: 下属建的.id }, select: 权限项目选 });
    expect(能看项目(销管, 带已加入(p), org)).toBe(false);
    for (const 谁 of [销管, 虚线上级, 市管, 链外]) {
      expect({ 谁: 谁.名, 有: (await 项目名(谁)).includes("线内建的") }).toEqual({ 谁: 谁.名, 有: false });
      expect({ 谁: 谁.名, 有: (await 客户编号(谁)).includes(线内建的.customerId) }).toEqual({ 谁: 谁.名, 有: false });
    }
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

describe("销售管理：卡点、写范围的组员条件也只认本人（team-scope 组员人、写范围条件 传 本人）", () => {
  let 序号 = 0;
  /** 卡点建的人 = 项目负责人（链外），没人认领：销管只能按组员那一支沾上 */
  const 建卡点 = async (项: { id: string; customerId: string }, 建的人: 人) => {
    序号++;
    const k = await prisma.entBlocker.create({
      data: {
        code: `BLK-20261124-${String(序号).padStart(3, "0")}`, title: `卡点${序号}`, projectId: 项.id, customerId: 项.customerId, phase: "线索", type: "中度卡点", impact: "短期不影响",
        obstacle: "其他", description: "x", dueDays: 3, dueAt: new Date(), creatorId: 建的人.id,
      },
    });
    await prisma.entBlockerLog.create({ data: { blockerId: k.id, userId: 建的人.id, action: "发布" } });
    return k.id;
  };
  const 名下项目 = async (name: string) => {
    const p = await prisma.project.findFirstOrThrow({ where: { name }, select: { id: true, customerId: true } });
    return { id: p.id, customerId: p.customerId };
  };

  it("entBlocker / entBlockerLog：下属进组的链外项目的卡点拿不到，自己进组的拿得到", async () => {
    const 链外卡 = await 建卡点(链外的, 链外);
    const 自己卡 = await 建卡点(await 名下项目("销管进组的"), 链外);
    忘掉企业版范围();
    const 卡 = (await 以谁的身份(销管.id, () => prisma.entBlocker.findMany({ select: { id: true } }))).map((k) => k.id);
    expect(卡).not.toContain(链外卡);
    expect(卡).toContain(自己卡);
    const 日志 = (await 以谁的身份(销管.id, () => prisma.entBlockerLog.findMany({ select: { blockerId: true } }))).map((l) => l.blockerId);
    expect(日志).not.toContain(链外卡);
    expect(日志).toContain(自己卡);
    // 进组的下属本人照拿得到（P-看-08 回归）
    expect((await 以谁的身份(下属.id, () => prisma.entBlocker.findMany({ select: { id: true } }))).map((k) => k.id)).toContain(链外卡);
  });

  it("互看读那一支（企业版不开互看，直接调 限定条件）：传 本人 后同样只认本人进的组", async () => {
    const 链外卡 = await 建卡点(链外的, 链外);
    const 自己卡 = await 建卡点(await 名下项目("销管进组的"), 链外);
    const 谁们 = [销管.id, 下属.id];
    const 卡 = (await prisma.entBlocker.findMany({ where: 限定条件("EntBlocker", 谁们, true, undefined, undefined, undefined, undefined, undefined, false, undefined, 销管.id)!, select: { id: true } })).map((k) => k.id);
    expect(卡).not.toContain(链外卡);
    expect(卡).toContain(自己卡);
    const 日志 = (await prisma.entBlockerLog.findMany({ where: 限定条件("EntBlockerLog", 谁们, true, undefined, undefined, undefined, undefined, undefined, false, undefined, 销管.id)!, select: { blockerId: true } })).map((l) => l.blockerId);
    expect(日志).not.toContain(链外卡);
    expect(日志).toContain(自己卡);
  });

  it("写范围：销管对下属进组的链外项目改不到，下属负责的照改得到", async () => {
    忘掉企业版范围();
    const 改链外 = await 以谁的身份(销管.id, () => prisma.project.updateMany({ where: { id: 链外的.id }, data: { name: "链外的-改" } }));
    expect(改链外.count).toBe(0);
    expect((await prisma.project.findUniqueOrThrow({ where: { id: 链外的.id }, select: { name: true } })).name).toBe("链外的");
    const 下属的 = await 名下项目("下属的");
    const 改下属 = await 以谁的身份(销管.id, () => prisma.project.updateMany({ where: { id: 下属的.id }, data: { name: "下属的-改" } }));
    expect(改下属.count).toBe(1);
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

  it("只看某人（P-看-19）：自己进组的项目和挂着的客户出、详情点得进、客户只读；被盯的人进组、自己没进的不出；被盯的人负责的照出", async () => {
    const 名 = await 项目名(盯的人);
    expect(名).not.toContain("链外的");
    expect(名).toContain("盯的人进组的");
    expect(名).toContain("被盯的");
    expect(await 点不进的(盯的人)).toEqual([]);
    const 客户 = await 客户编号(盯的人);
    expect(客户).not.toContain(链外的.customerId);
    expect(客户).toContain(盯的人进组的.customerId);
    // 客户详情那句 findUnique 拿得到；裸 SQL 快路同样带上
    expect(await 以谁的身份(盯的人.id, () => prisma.customer.findUnique({ where: { id: 盯的人进组的.customerId }, select: { id: true } }))).not.toBeNull();
    const 裸 = await 裸SQL客户(盯的人);
    if (裸) {
      expect(裸).toContain(盯的人进组的.customerId);
      expect(裸).not.toContain(链外的.customerId);
    }
    // 只读：改不到
    expect(await 以谁的身份(盯的人.id, () => 只读客户(defaultClient, { id: 盯的人进组的.customerId, salesOwnerId: 链外.id, pool: null }))).toBeTruthy();
    expect((await 以谁的身份(盯的人.id, () => prisma.customer.updateMany({ where: { id: 盯的人进组的.customerId }, data: { remark: "x" } }))).count).toBe(0);
  });

  it("渠运建的、分给同事的照出（详情认市场角色的建档人）；市管下级建的市场管理照出", async () => {
    expect(await 项目名(渠运)).toContain("渠运建的");
    expect(await 项目名(市管)).toEqual(expect.arrayContaining(["市管下级建的", "市管进组的"]));
  });
});

/** 点项目详情（/projects/<id> 先走的 项目页去向）：转向 = 跳哪儿，无 = 404 */
const 去向 = (谁: 人, id: string) => 以(谁, () => 项目页去向({ id: 谁.id, role: 谁.role, name: 谁.名 } as never, id));

describe("① 按部门认的市场成员、没有市场角色（P-看-17，用户 11-24；X-165 扩到兼销管、兼项目组员）", () => {
  it("列表照 P-看-05 放开：自己建的、分给同事的项目和客户都出；客户详情进得去（X-163：客户详情照 P-看-05）", async () => {
    const p = await 项目("市场部销售建的", 同事, 市场部销售);
    忘掉企业版范围();
    expect(await 项目名(市场部销售)).toContain("市场部销售建的");
    expect(await 客户编号(市场部销售)).toContain(p.customerId);
    expect(await 以谁的身份(市场部销售.id, () => prisma.customer.findUnique({ where: { id: p.customerId }, select: { id: true } }))).not.toBeNull();
  });

  it("不变式放宽：列表里每一行，详情过或者落到市场视角跳转（P-界面-11），不落 404", async () => {
    const p = await 项目("市场部销售建的 A&B/二期", 同事, 市场部销售);
    忘掉企业版范围();
    // 进不去详情的只有自己建的、分给同事的那一行（P-看-06 分配后只看进度）
    expect(await 点不进的(市场部销售)).toEqual(["市场部销售建的 A&B/二期"]);
    const 名 = "市场部销售建的 A&B/二期";
    expect(await 去向(市场部销售, p.id)).toEqual({ 种: "转向", 到: `/customers?q=${encodeURIComponent(名)}&hl=${encodeURIComponent(p.id)}` });
  });

  it("不借跳转露项目名：同事建的、分给同事的照旧 404；不在市场部的销售自己建的、分给同事的也照旧 404", async () => {
    const 别人的 = await 项目("同事建的", 同事, 链外);
    const 普通销售建的 = await 项目("普通销售建的", 同事, 链外);
    忘掉企业版范围();
    expect(await 去向(市场部销售, 别人的.id)).toEqual({ 种: "无" });
    expect(await 项目名(链外)).not.toContain("普通销售建的");
    expect(await 去向(链外, 普通销售建的.id)).toEqual({ 种: "无" });
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

  it("X-165 兼销售 + 销管、兼销管 + 项目组员：列表里每一行详情过或者落到跳转；分给自己下属的按销管口径照常进、不跳", async () => {
    for (const [谁, 下] of [[市场部销管, 销管下属], [市场部销管组员, 组员下属]] as const) {
      const 跳 = await 项目(`${谁.名}建的`, 同事, 谁);
      const 进 = await 项目(`${谁.名}给下属的`, 下, 谁);
      忘掉企业版范围();
      expect(await 项目名(谁)).toEqual(expect.arrayContaining([`${谁.名}建的`, `${谁.名}给下属的`]));
      expect(await 点不进的(谁)).toEqual([`${谁.名}建的`]);
      expect(await 去向(谁, 跳.id)).toEqual({ 种: "转向", 到: `/customers?q=${encodeURIComponent(`${谁.名}建的`)}&hl=${encodeURIComponent(跳.id)}` });
      expect((await 去向(谁, 进.id)).种).toBe("客户页");
    }
  });

  it("条线总管理 + 销管 + 市场管理：直属下级建的、分给同事的照出（市场管理那一支不动），且都点得进", async () => {
    const p = await 项目("组合下级建的", 同事, 组合下级);
    忘掉企业版范围();
    expect(await 项目名(组合)).toContain("组合下级建的");
    expect(await 客户编号(组合)).toContain(p.customerId);
    expect(await 点不进的(组合)).toEqual([]);
  });
});
