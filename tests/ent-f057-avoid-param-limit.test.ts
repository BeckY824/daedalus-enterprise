/**
 * F-057（11-27 客户服务器）：一位退过很多客户进公海的销售，打开任何客户详情页都报「这一页没能打开」——
 * 我回避的公海项目 整串塞进 id notIn，超过 SQLite 一句 999 个参数，Prisma 遇否定条件不能拆（P2029）。
 * 这里造一位销售回避 N 个公海项目（批量造数），N 分小名单（走 notIn）、过上限（走按关联写的条件 + 例外）、上千（过 999）三档，
 * 钉：客户页项目列表、项目列表（含分页总数）、跟进流（汇总的项目 / 跨客户可见条件）、卡点看板都不报错，回避的照样看不到，口径和小名单一致。
 * 用例里的人名、项目名全是编造的
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读项目列表 } from "@/lib/project/list";
import { 客户页项目列表 } from "@/app/(app)/customers/[id]/project-zone";
import { 汇总的项目, 跨客户跟进可见条件 } from "@/lib/enterprise/customer-follow-feed";
import { 卡点看板, 交接卡点 } from "@/lib/project/blocker";
import { 公海规则 } from "@/lib/enterprise/pool-rules";
import { 项目现在, 项目一段 } from "@/app/(app)/overview/project-stats";
import { 不回避条件, 是我放回的公海项目条件 } from "@/lib/project/pool-owner";
import { 回填放回人列 } from "./helpers/pool-prev-owner-seed";

type 人 = { id: string; role: string; name: string; email: string; title: string; avatar: string | null };
const 时刻 = (i: number) => new Date(Date.UTC(2026, 9, 1) + i * 1000);

async function 造人(key: string, bizRole: string, extra: { managerId?: string } = {}): Promise<人> {
  const u = await prisma.user.create({ data: { email: `${key}@test`, name: key, title: "", role: bizRole === "director" ? "ADMIN" : "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, ...extra } });
  return { id: u.id, role: u.role, name: key, email: u.email, title: "", avatar: null };
}

describe.each([5, 150, 1500])("F-057 回避 %i 个公海项目", (N) => {
  let 乙: 人, 丙: 人, 老板: 人;
  let 回避们: string[]; // 乙放回、现在还在公海
  let 放走又被放回的: string; // 乙早先放、后来别人领走又放回：不回避
  let 丙放的: string[];
  let 客户X: string; // 客户页：2 个自己的在推、1 个回避的、1 个丙放的
  let X自己: string[], X回避: string, X丙: string;

  beforeEach(async () => {
    await resetDb();
    invalidateSettingsCache();
    忘掉企业版范围();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    公海规则.原负责人看得到公海项目 = false;
    老板 = await 造人("boss", "director");
    乙 = await 造人("yi", "sales");
    丙 = await 造人("bing", "sales");
    await setSetting("business", { projectMode: true });
    invalidateSettingsCache();
    await prisma.customer.create({ data: { id: "big", name: "大客户", phone: "", salesOwnerId: 丙.id } });
    const 号 = Array.from({ length: N }, (_, i) => i);
    回避们 = 号.map((i) => `av${i}`);
    await prisma.project.createMany({ data: 号.map((i) => ({ id: `av${i}`, name: `公海项目${i}`, customerId: "big", ownerId: "", creatorId: 乙.id, pooledAt: 时刻(i) })) });
    const 痕 = (projectId: string, from: string, i: number) => ({ projectId, kind: "pool-release", fromOwnerId: from, userId: from, toPhase: "线索", toNode: "x", at: 时刻(i) });
    await prisma.projectNodeLog.createMany({ data: 号.map((i) => 痕(`av${i}`, 乙.id, i)) });
    // 乙早先放、别人领走后丙放回：最后一次不是乙 → 不回避（走关联写的条件时靠例外放出来）
    放走又被放回的 = "ex1";
    await prisma.project.create({ data: { id: 放走又被放回的, name: "例外项目", customerId: "big", ownerId: "", creatorId: 丙.id, pooledAt: 时刻(5000) } });
    await prisma.projectNodeLog.createMany({ data: [痕(放走又被放回的, 乙.id, 4000), 痕(放走又被放回的, 丙.id, 4500)] });
    丙放的 = ["pb1", "pb2", ...Array.from({ length: 25 }, (_, i) => `pc${i}`)];
    await prisma.project.createMany({ data: 丙放的.map((id, i) => ({ id, name: `丙放的${i}`, customerId: "big", ownerId: "", creatorId: 丙.id, pooledAt: 时刻(6000 + i) })) });
    await prisma.projectNodeLog.createMany({ data: 丙放的.map((id, i) => 痕(id, 丙.id, 6000 + i)) });
    // 客户页
    客户X = (await prisma.customer.create({ data: { name: "客户X", phone: "", salesOwnerId: 乙.id } })).id;
    X自己 = ["xa1", "xa2"];
    await prisma.project.createMany({ data: X自己.map((id, i) => ({ id, name: `X自己${i}`, customerId: 客户X, ownerId: 乙.id, creatorId: 乙.id })) });
    X回避 = "xav";
    X丙 = "xbing";
    await prisma.project.createMany({ data: [
      { id: X回避, name: "X回避", customerId: 客户X, ownerId: "", creatorId: 乙.id, pooledAt: 时刻(7000) },
      { id: X丙, name: "X丙放的", customerId: 客户X, ownerId: "", creatorId: 丙.id, pooledAt: 时刻(7001) },
    ] });
    await prisma.projectNodeLog.createMany({ data: [痕(X回避, 乙.id, 7000), 痕(X丙, 丙.id, 7001)] });
    await 回填放回人列(prisma); // 直接塞留痕的造数，补两列（回避只认 poolPrevOwnerId，E-417 包 2）
    忘掉企业版范围();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    公海规则.原负责人看得到公海项目 = false;
    忘掉企业版范围();
  });

  it("客户页项目列表：不报错，回避的不列，自己的、别人放的照列，总管理照列", async () => {
    const r = await 以谁的身份(乙.id, () => 客户页项目列表(乙, 客户X));
    expect(r.map((p) => p.id).sort()).toEqual([...X自己, X丙].sort());
    const 全 = await 以谁的身份(老板.id, () => 客户页项目列表(老板, 客户X));
    expect(全.map((p) => p.id).sort()).toEqual([...X自己, X回避, X丙].sort());
  });

  it("项目列表（公海）：不报错，回避的都不在，例外和别人放的在，总数和页数对（每页 10 条翻页对）", async () => {
    const 期望 = [放走又被放回的, ...丙放的, X丙].sort();
    const 读 = (u: 人, page?: string, pageSize?: string) => 以谁的身份(u.id, async () => 读项目列表(u as never, { pool: "1", ...(page ? { page } : {}), ...(pageSize ? { pageSize } : {}) }));
    const r = await 读(乙, "1", "100");
    expect(r.总数).toBe(期望.length);
    expect(r.行.map((x) => x.id).sort()).toEqual(期望);
    // 每页 10 条分页：页数、总数照旧
    const 页们 = [] as string[];
    for (const p of ["1", "2", "3"]) 页们.push(...(await 读(乙, p, "10")).行.map((x) => x.id));
    expect(页们.sort()).toEqual(期望);
    expect((await 读(乙, "2", "10")).行).toHaveLength(10);
    // 总管理看全部
    expect((await 读(老板, "1", "100")).总数).toBe(N + 1 + 丙放的.length + 2);
  });

  it("跟进流：汇总的项目不报错且去掉回避的；跨客户可见条件能查、回避的项目上的沟通不出，别人放的出", async () => {
    const 项目们 = await 以谁的身份(乙.id, () => 汇总的项目(乙, 客户X));
    expect([...项目们.keys()].sort()).toEqual([...X自己, X丙].sort());
    const f = async (projectId: string, owner: string, afterSale = false) => {
      const x = await prisma.followUp.create({ data: { type: "PHONE", title: projectId, content: projectId, customerId: projectId === X回避 || projectId === X丙 || X自己.includes(projectId) ? 客户X : "big", ownerId: owner, afterSale } });
      await prisma.followUpProject.create({ data: { followUpId: x.id, projectId, node: "线索" } });
      return x.id;
    };
    const 回避那条 = await f(X回避, 乙.id);
    const 丙那条 = await f(X丙, 丙.id);
    const 自己那条 = await f(X自己[0], 乙.id);
    const 回避售后 = await f(X回避, 乙.id, true);
    const 条件 = await 以谁的身份(乙.id, () => 跨客户跟进可见条件(乙));
    expect(条件).not.toBeNull();
    const 查 = await 以谁的身份(乙.id, () => prisma.followUp.findMany({ where: { AND: [条件!] }, select: { id: true } }));
    const 出 = new Set(查.map((x) => x.id));
    expect(出.has(回避那条)).toBe(false);
    expect(出.has(回避售后)).toBe(false);
    expect(出.has(自己那条)).toBe(true);
    expect(出.has(丙那条)).toBe(true);
  });

  it("卡点看板：不报错，回避的项目上的卡点（自己建的也算）不出，别的出", async () => {
    const 蓝 = (projectId: string, code: string, customerId: string) => ({ code, projectId, customerId, phase: "线索", type: "中度卡点", impact: "短期不影响", obstacle: "价格", description: "x", dueDays: 3, dueAt: new Date(), status: "待接受", creatorId: 乙.id });
    await prisma.entBlocker.createMany({ data: [蓝(X回避, "BLK-1", 客户X), 蓝(X自己[0], "BLK-2", 客户X), 蓝(X丙, "BLK-3", 客户X)] });
    const r = await 以谁的身份(乙.id, () => 卡点看板(乙));
    expect(r.开).toBe(true);
    const 码 = r.栏.待接受.map((x) => x.code).sort();
    expect(码).toEqual(["BLK-2", "BLK-3"]);
  });

  it("数据页（project-stats）：销售只看自己 / 总管理看全员，名单上千不报错，退回公海数和小名单口径一致", async () => {
    const 退回 = (r: Awaited<ReturnType<typeof 项目现在>>) => r.线索节点.reduce((n, x) => n + x.退回公海, 0);
    // 乙：自己放回、现在还在公海的 N 个 + X回避 1 个；例外（丙最后放）和别人放的不算
    expect(退回(await 项目现在("CNY", 乙.id))).toBe(N + 1);
    // 全员（乙 + 丙）：公海里所有最后有人放的：N + 例外 1 + 丙放的 + X回避 + X丙
    expect(退回(await 项目现在("CNY", [乙.id, 丙.id]))).toBe(N + 1 + 1 + 丙放的.length + 1);
    // 项目一段（走同一个条件）：不报错、线索瀑布的退回公海数也对
    const 段 = await 项目一段(new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2030, 0, 1)), "month" as never, "CNY", 乙.id);
    expect(段.线索节点.reduce((n, x) => n + x.退回公海, 0)).toBeLessThanOrEqual(N + 1);
    await 项目一段(new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2030, 0, 1)), "month" as never, "CNY", [乙.id, 丙.id]);
  });

  it("离职交接卡点：跟着进公海的项目名单上千也不报错，那些项目上的认领行不挪", async () => {
    const 接手 = await 造人("recv", "sales");
    const 蓝 = (projectId: string, code: string) => ({ code, projectId, customerId: 客户X, phase: "线索", type: "中度卡点", impact: "短期不影响", obstacle: "价格", description: "x", dueDays: 3, dueAt: new Date(), status: "处理中", creatorId: 乙.id });
    const 甲 = await prisma.entBlocker.create({ data: 蓝(X自己[0], "BLK-H1") });
    const 乙卡 = await prisma.entBlocker.create({ data: 蓝(X自己[1], "BLK-H2") });
    await prisma.entBlockerClaim.createMany({ data: [{ blockerId: 甲.id, userId: 乙.id }, { blockerId: 乙卡.id, userId: 乙.id }] });
    const 名单 = [X自己[1], ...回避们, ...回避们.map((x) => `${x}-pad`), ...Array.from({ length: 1200 }, (_, i) => `pad${i}`)];
    await prisma.$transaction(async (tx) => { await 交接卡点(tx, 乙.id, 接手.id, 老板.id, 名单); });
    // 接手人只拿到 X自己[0] 那条；跟着进公海的那条（名单里）不挪（交给上级 / 去掉）
    const 到接手 = await prisma.entBlockerClaim.findMany({ where: { userId: 接手.id }, select: { blockerId: true } });
    expect(到接手.map((c) => c.blockerId)).toEqual([甲.id]);
  });
});

describe("F-057 早先放过、最后一次是别人放的（原来的「例外」）：按列写，不再宽挡 / 窄算", () => {
  const 例外数 = 130; // 早先乙放、后来丙放回：最后不是乙（> 名单上限 100）
  const 自己数 = 120; // 只有乙放过
  it("不回避条件：回避的挡住、最后一次是别人放的照样放出来；是我放回的公海项目条件：只含最后一次是我放的", async () => {
    await resetDb();
    invalidateSettingsCache();
    忘掉企业版范围();
    vi.stubEnv("CRM_ENTERPRISE", "1");
    公海规则.原负责人看得到公海项目 = false;
    const 乙 = await 造人("yi", "sales");
    const 丙 = await 造人("bing", "sales");
    await prisma.customer.create({ data: { id: "big", name: "大客户", phone: "", salesOwnerId: 丙.id } });
    const 自己ids = Array.from({ length: 自己数 }, (_, i) => `own${i}`);
    const 例外ids = Array.from({ length: 例外数 }, (_, i) => `exc${i}`);
    const 全 = [...自己ids, ...例外ids];
    await prisma.project.createMany({ data: 全.map((id, i) => ({ id, name: `公海${i}`, customerId: "big", ownerId: "", creatorId: 乙.id, pooledAt: 时刻(i) })) });
    const 痕 = (projectId: string, from: string, i: number) => ({ projectId, kind: "pool-release", fromOwnerId: from, userId: from, toPhase: "线索", toNode: "x", at: 时刻(i) });
    await prisma.projectNodeLog.createMany({ data: [
      ...自己ids.map((id, i) => 痕(id, 乙.id, i)),
      ...例外ids.flatMap((id, i) => [痕(id, 乙.id, 1000 + i), 痕(id, 丙.id, 2000 + i)]),
    ] });
    await 回填放回人列(prisma);
    const 查 = async (w: object) => new Set((await prisma.project.findMany({ where: w, select: { id: true } })).map((r) => r.id));
    // 不回避条件（乙看）：乙回避的 120 个一个都不能出现；最后一次是丙放的 130 个照样出现（按列写，没有多挡）
    const 不回避 = await 以谁的身份(乙.id, () => 不回避条件(prisma, 乙.id));
    expect(不回避).not.toBeNull();
    const 出 = await 查(不回避!);
    for (const id of 自己ids) expect(出.has(id)).toBe(false);
    for (const id of 例外ids) expect(出.has(id)).toBe(true);
    // 正向条件（乙的）：不含最后是丙放的；含自己放的 120 个
    const 正 = await 是我放回的公海项目条件(prisma, [乙.id]);
    expect(正).not.toBeNull();
    const 中 = await 查(正!);
    for (const id of 例外ids) expect(中.has(id)).toBe(false);
    for (const id of 自己ids) expect(中.has(id)).toBe(true);
    // 全员（乙 + 丙）：丙最后放的 130 个也算，不报错
    const 全员 = await 是我放回的公海项目条件(prisma, [乙.id, 丙.id]);
    expect((await 查(全员!)).size).toBe(自己数 + 例外数);
    vi.unstubAllEnvs();
    忘掉企业版范围();
  });
});
