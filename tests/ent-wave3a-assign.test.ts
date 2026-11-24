/**
 * 11-18 客户定的分配口径（第 2、3、7、8、9 题）和审核 11-18「分配与归属」P1-1 并发、「通知」快轮到：
 *   - 第 3 题 B：休假回来 / 月中加入的人按「同池正常参与的其他人最少的本月已分」起算（lead-assign 起算补），「快轮到我」估算同口径
 *   - 第 2 题：线索公海里的项目从项目列表分出去不计名额（counted=false，和公海页一致）；删除照算（维持）
 *   - 第 7 题 A：营销企划部的人判不出事业部时默认内贸（customer-region 本人事业部 部门兜底线）
 *   - 第 8 题 B：新建线索「指定分配」和新线索列表「分配」同一条：只给参与状态正常的；义乌档口整组不进自动分配，但正常的能被指定
 *   - 第 9 题 B：内贸销售管理参加自动分配，外贸销售管理不参加
 *   - P1-1：同一刻两条自动分配不会给同一个人（事务里按重读的数复核挑人）
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "市场", email: "a@x", role: "SALES", title: "", avatar: null } as Record<string, unknown>,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));

import { prisma } from "@/lib/prisma";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { resetDb } from "./reset";
import { 分配线索, 自动分配线索, 设线部门, 设自动分配参与 } from "@/app/(app)/leads/assign-actions";
import { 不设配额key, 起算补, 挑接手人, 前面几条, 月份, 本月已分, 自动分配不参与key, type 候选人, type 分配行 } from "@/lib/enterprise/lead-assign";
import { 估算轮到, 自动分配池, 读线部门, 指定问题, 可指定的人 } from "@/lib/enterprise/assign-eta";
import { 本人事业部 } from "@/lib/enterprise/customer-region";
import { 读组织 } from "@/lib/enterprise/org";
import { 规则 } from "@/lib/enterprise/rules";

const 当 = (id: string, name: string) => { mocks.user = { ...mocks.user, id, name }; };

describe("第 3 题 B：起算补（纯函数）", () => {
  const 月初 = new Date("2026-11-01T00:00:00+08:00");
  const 回来 = new Date("2026-11-18T10:00:00+08:00");
  const 早 = (i: number) => new Date(2026, 0, i + 1);
  // 池 7 人：6 人本月各 20 条（都在他回来之前），第 7 人休假回来是 0 条
  const 六人行: 分配行[] = [];
  for (let i = 0; i < 6; i++) for (let k = 0; k < 20; k++) 六人行.push({ toUserId: `s${i}`, at: new Date("2026-11-10T10:00:00+08:00") });
  const 候选 = (): 候选人[] => [...Array.from({ length: 6 }, (_, i) => ({ userId: `s${i}`, 已分: 20, 配额: null, 进池: 早(i) })), { userId: "back", 已分: 0, 配额: null, 进池: 早(6) }];

  it("回来的人按池里当前最少的 20 条起算：接下来 7 条大家轮流，他只收 1 条，不会连收 20 条", () => {
    const 补过 = 起算补(候选(), new Map([["back", 回来]]), 六人行, new Set(), 月初);
    expect(补过.find((c) => c.userId === "back")).toMatchObject({ 已分: 20, 起算: 20 });
    const 们 = 补过.map((c) => ({ ...c }));
    const 给了: string[] = [];
    for (let n = 0; n < 7; n++) {
      const 谁 = 挑接手人(们, new Set(), true, true)!;
      给了.push(谁);
      们.find((c) => c.userId === 谁)!.已分++;
    }
    expect(给了.filter((x) => x === "back")).toHaveLength(1);
    expect(new Set(给了).size).toBe(7);
    // 「快轮到我」同口径：前面约 6 条（建号最晚，并列排在最后）
    expect(前面几条(补过, new Set(), true, true, "back")).toBe(6);
  });

  it("没补的时候（老规矩）他会连收 20 条：对照", () => {
    const 们 = 候选();
    for (let n = 0; n < 20; n++) {
      const 谁 = 挑接手人(们, new Set(), true, true)!;
      expect(谁).toBe("back");
      们.find((c) => c.userId === 谁)!.已分++;
    }
  });

  it("基数只看现在正常参与、那一刻已在池里的人；自己走之前有几条照扣；起算点在上个月 = 不补", () => {
    const 行们: 分配行[] = [...六人行, ...Array.from({ length: 5 }, () => ({ toUserId: "back", at: new Date("2026-11-03T10:00:00+08:00") }))];
    const 有 = 候选().map((c) => (c.userId === "back" ? { ...c, 已分: 5 } : c));
    // 自己之前有 5 条：补 15，按 20 排
    expect(起算补(有, new Map([["back", 回来]]), 行们, new Set(), 月初).find((c) => c.userId === "back")!.已分).toBe(20);
    // 暂停着的 s0 是 0 条也不拉低基数（他不参与）
    const 带零 = [...候选(), { userId: "zero", 已分: 0, 配额: null, 进池: 早(9) }];
    expect(起算补(带零, new Map([["back", 回来]]), 六人行, new Set(["zero"]), 月初).find((c) => c.userId === "back")!.已分).toBe(20);
    // 起算点在上个月：不补
    expect(起算补(候选(), new Map([["back", new Date("2026-10-20T10:00:00+08:00")]]), 六人行, new Set(), 月初).find((c) => c.userId === "back")!.已分).toBe(0);
    // 月中新建的账号（进池在本月）不用记起算时刻，按建号时间起算
    const 新人 = 候选().map((c) => (c.userId === "back" ? { ...c, 进池: 回来 } : c));
    expect(起算补(新人, new Map(), 六人行, new Set(), 月初).find((c) => c.userId === "back")!.已分).toBe(20);
  });
});

// —— 连库 ——

let 老板: string, 市场: string, 企划: string, 内一: string, 内二: string, 内管: string, 外一: string, 外二: string, 外管: string, 档口销售: string;
let MVP: string, 内销: string, 外贸部: string;
let 客户号 = 0;
let 第几 = 0;

const 部 = async (name: string, parentId: string | null = null) => (await prisma.entDept.create({ data: { name, parentId } })).id;
const 人 = async (name: string, bizRole: string, deptId: string | null, line: string | null = null) => {
  第几++;
  const id = (await prisma.user.create({ data: { email: `u${第几}@x`, name, title: "", role: "SALES", password: "x", active: true, createdAt: new Date(2026, 0, 第几) } })).id;
  await prisma.entMember.create({ data: { userId: id, bizRole, deptId, line } });
  return id;
};
const 建项目 = async (name: string, extra: { pooledAt?: Date; ownerId?: string; bizLine?: string; 国家?: string } = {}) => {
  const 客户 = (await prisma.customer.create({ data: { name: `客户${++客户号}`, phone: `1390000${String(客户号).padStart(4, "0")}`, salesOwnerId: extra.ownerId ?? 市场, addrCountry: extra.国家 ?? "美国" } })).id;
  return (await prisma.project.create({ data: { name, customerId: 客户, ownerId: extra.ownerId ?? 市场, creatorId: 市场, bizLine: extra.bizLine ?? "外贸", ...(extra.pooledAt ? { pooledAt: extra.pooledAt } : {}) } })).id;
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  第几 = 0;
  外贸部 = await 部("外贸事业部");
  MVP = await 部("MVP战队", 外贸部);
  const 档口 = await 部("义乌档口", 外贸部);
  const 内贸部 = await 部("内贸事业部");
  内销 = await 部("销售部", 内贸部);
  const 企划部 = await 部("营销企划部");
  老板 = await 人("老板", "director", null);
  市场 = await 人("市场", "marketing_mgr", null, "外贸");
  企划 = await 人("企划", "channel_ops", 企划部);
  内一 = await 人("内贸销售一", "sales", 内销);
  内二 = await 人("内贸销售二", "sales", 内销);
  内管 = await 人("内贸销管", "sales_mgr", 内销);
  外一 = await 人("外贸销售一", "sales", MVP);
  外二 = await 人("外贸销售二", "sales", MVP);
  外管 = await 人("外贸销管", "sales_mgr", MVP);
  档口销售 = await 人("档口销售", "sales", 档口);
  for (const k of [规则.线索分配.key]) await setSetting(k, true);
  await setSetting(不设配额key, true);
  当(老板, "老板");
  // 同正式库：外贸只勾战队，义乌档口没勾
  expect(await 设线部门({ 内贸: [内销], 外贸: [MVP] })).toEqual({ ok: true });
  当(市场, "市场");
});
afterAll(async () => { await prisma.$disconnect(); });

describe("第 9 题 B / 第 8 题 B：自动分配池", () => {
  it("内贸池含内贸销售管理、外贸池含外贸销售管理（11-23），各进本线不跨线；义乌档口整组不进（外贸勾的是整个外贸事业部也一样）", async () => {
    当(老板, "老板");
    expect(await 设线部门({ 内贸: [内销], 外贸: [外贸部] })).toEqual({ ok: true });
    const org = await 读组织();
    const 设 = await 读线部门();
    expect(new Set(自动分配池(org, null, "内贸", 设))).toEqual(new Set([内一, 内二, 内管]));
    expect(new Set(自动分配池(org, null, "外贸", 设))).toEqual(new Set([外一, 外二, 外管]));
    expect(自动分配池(org, null, "内贸", 设)).not.toContain(外管);
    expect(自动分配池(org, null, "外贸", 设)).not.toContain(内管);
  });

  it("内贸销售管理第一次进池按池里最少的数起算，不从 0 追（上线当天他本月 0 条）", async () => {
    const 月 = 月份();
    for (const 谁 of [内一, 内二]) for (let i = 0; i < 3; i++) {
      const p = await 建项目(`老${谁}${i}`, { bizLine: "内贸", ownerId: 谁 });
      await prisma.entLeadAssign.create({ data: { projectId: p, toUserId: 谁, byUserId: 市场, month: 月, counted: true, createdAt: new Date(Date.now() - 3_600_000) } });
    }
    const 估 = await 估算轮到(await 读组织());
    // 三人都按 3 条排：内管不是「下一条就轮到你」连收，按建号先后排在最后
    expect(估.get(内管)).toEqual({ 数: 2 });
    const 给了: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await 自动分配线索(await 建项目(`新${i}`, { 国家: "中国" }), { 项目: true });
      if (!r.ok) throw new Error(r.error);
      给了.push(r.toUserId);
    }
    expect(new Set(给了)).toEqual(new Set([内一, 内二, 内管]));
  });
});

describe("第 3 题 B：参与状态回到正常记起算时刻", () => {
  it("内贸销售二暂停期间别人各收 3 条；恢复后按 3 条起算，下一条不是非他不可", async () => {
    const 月 = 月份();
    当(老板, "老板");
    expect(await 设自动分配参与(内二, "暂停")).toEqual({ ok: true });
    for (const 谁 of [内一, 内管]) for (let i = 0; i < 3; i++) {
      const p = await 建项目(`老${谁}${i}`, { bizLine: "内贸", ownerId: 谁 });
      await prisma.entLeadAssign.create({ data: { projectId: p, toUserId: 谁, byUserId: 市场, month: 月, counted: true, createdAt: new Date(Date.now() - 3_600_000) } });
    }
    expect(await 设自动分配参与(内二, "允许")).toEqual({ ok: true });
    当(市场, "市场");
    const 给了: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await 自动分配线索(await 建项目(`回来后${i}`, { 国家: "中国" }), { 项目: true });
      if (!r.ok) throw new Error(r.error);
      给了.push(r.toUserId);
      if (r.toUserId === 内二) expect(r.为什么).toContain("中途回来按 3 条起算");
    }
    expect(给了.filter((x) => x === 内二)).toHaveLength(1);
  });
});

describe("P1-1：同一刻两条自动分配", () => {
  it("两条同时点自动分配，分给两个人（事务里复核挑人）", async () => {
    const [P1, P2] = [await 建项目("并发一"), await 建项目("并发二")];
    const [r1, r2] = await Promise.all([自动分配线索(P1, { 项目: true }), 自动分配线索(P2, { 项目: true })]);
    if (!r1.ok || !r2.ok) throw new Error(`${!r1.ok ? r1.error : ""} ${!r2.ok ? r2.error : ""}`);
    expect(r1.toUserId).not.toBe(r2.toUserId);
    expect(await prisma.entLeadAssign.count({ where: { toUserId: r1.toUserId } })).toBe(1);
  });
});

describe("第 2 题：本月已分只数市场分出去的新线索", () => {
  it("线索公海里的项目从项目列表分出去：记一行但不计名额（和公海页一样都不算）", async () => {
    当(老板, "老板");
    const P = await 建项目("公海线索", { pooledAt: new Date(), ownerId: 外二 });
    expect(await 分配线索({ projectId: P, toUserId: 外一 })).toEqual({ ok: true });
    const 行 = await prisma.entLeadAssign.findFirstOrThrow({ where: { projectId: P } });
    expect(行.counted).toBe(false);
    expect(await 本月已分(外一)).toBe(0);
  });

  it("新线索（不在公海）照算；分出去以后删了也照算，不退名额（维持）", async () => {
    const P = await 建项目("新线索");
    expect(await 分配线索({ projectId: P, toUserId: 外一 })).toEqual({ ok: true });
    expect(await 本月已分(外一)).toBe(1);
    await prisma.project.update({ where: { id: P }, data: { deletedAt: new Date() } });
    expect(await 本月已分(外一)).toBe(1);
  });
});

describe("第 8 题 B：指定分配两个入口同一条", () => {
  it("新线索列表「分配」：义乌档口的人参与状态正常就能指定（部门没勾、不进自动分配）", async () => {
    const P = await 建项目("给档口");
    expect(await 分配线索({ projectId: P, toUserId: 档口销售 })).toEqual({ ok: true });
  });

  it("暂停、禁止的人：列表「分配」和新建「指定分配」（指定问题）都拒", async () => {
    当(老板, "老板");
    expect(await 设自动分配参与(档口销售, "禁止")).toEqual({ ok: true });
    当(市场, "市场");
    const r = await 分配线索({ projectId: await 建项目("给禁止的"), toUserId: 档口销售 });
    expect(r.ok).toBe(false);
    expect(await 指定问题(await 读组织(), 档口销售)).toContain("参与状态「正常」");
    expect(await 指定问题(await 读组织(), 外一)).toBeNull();
  });
});

describe("第 7 题 A：营销企划部判不出事业部默认内贸", () => {
  it("营销企划部的人（没设业务线）= 内贸；给他设了业务线按设的", async () => {
    const org = await 读组织();
    expect(本人事业部(org, await 读线部门(), 企划)).toBe("内贸");
    await prisma.entMember.update({ where: { userId: 企划 }, data: { line: "外贸" } });
    expect(本人事业部(await 读组织(), await 读线部门(), 企划)).toBe("外贸");
  });
});

describe("参与状态变了推一次「快轮到」", () => {
  it("恢复参与以后池里的人重算，进 3 条以内的收到提醒", async () => {
    const 月 = 月份();
    const p = await 建项目("有一条记录");
    await prisma.entLeadAssign.create({ data: { projectId: p, toUserId: 外一, byUserId: 市场, month: 月, counted: true } });
    当(老板, "老板");
    await setSetting(自动分配不参与key, { [外二]: "暂停" });
    invalidateSettingsCache();
    expect(await prisma.entNotice.count({ where: { userId: 外二, kind: "快轮到" } })).toBe(0);
    expect(await 设自动分配参与(外二, "允许")).toEqual({ ok: true });
    expect(await prisma.entNotice.count({ where: { userId: 外二, kind: "快轮到" } })).toBe(1);
  });
});

describe("审核追加：一人多角色任一放行 / 指定下拉只列能指定的", () => {
  it("外贸兼「销售 + 销售管理」的：作为销售照常进外贸自动分配池；纯外贸销售管理也进（11-23），被暂停的照旧分不到", async () => {
    const 外兼 = await 人("外贸兼管", "sales,sales_mgr", MVP);
    const org = await 读组织();
    const 池 = 自动分配池(org, null, "外贸", await 读线部门());
    expect(池).toContain(外兼);
    expect(池).toContain(外管);
    // 外管开号更早、本月也 0 条：暂停他，这条才轮到外兼（参与状态照旧生效）
    await setSetting(自动分配不参与key, { [外管]: "暂停" });
    invalidateSettingsCache();
    // 自动分配真能分到他（外一外二各先有一条）
    for (const 谁 of [外一, 外二]) await prisma.entLeadAssign.create({ data: { toUserId: 谁, byUserId: 市场, month: 月份(), counted: true, kind: "营销" } });
    const r = await 自动分配线索(await 建项目("兼管能接"), { 项目: true, 原负责人: 市场 });
    expect(r).toMatchObject({ ok: true, toUserId: 外兼 });
  });

  it("可指定的人 = 指定问题放行的：在职销售 / 销售管理、参与正常；暂停、禁止、市场、总管理都不在", async () => {
    await setSetting(自动分配不参与key, { [外二]: "暂停", [内二]: "禁止" });
    invalidateSettingsCache();
    const org = await 读组织();
    const 们 = await 可指定的人(org);
    expect(new Set(们)).toEqual(new Set([内一, 内管, 外一, 外管, 档口销售]));
    for (const id of [...org.成员.keys()]) expect(们.includes(id), id).toBe((await 指定问题(org, id)) === null);
  });
});
