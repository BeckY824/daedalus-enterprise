/**
 * 流转线（32G，Even 11-20 口径 + 用户 11-20 拍板）：每条线索一条固定的线（Project.flowLine），客户跟着写（Customer.flowLine）。
 *   - 纯函数（flow-line-core.ts）：新建线of / 换人后的线 / 超时转的线
 *   - 真实入口：市场指定分配按方向、管理指定 = 改线（接收人事业部）、自动分配按方向、新增按新增人事业部、公海领取不改、写客户线不碰 updatedAt
 * 超时转只在线里转、转完线不变见 tests/ent-reply-overdue.test.ts「[32G] 超时转按流转线」
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "老板", email: "boss@local", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/llm", () => ({ llmEnabled: async () => false }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 公海规则 } from "@/lib/enterprise/pool-rules";
import { 建组织 } from "@/lib/enterprise/org-core";
import { 换人后的线, 新建线of, 超时转的线 } from "@/lib/enterprise/flow-line-core";
import { 新建后定线, 写流转线 } from "@/lib/enterprise/flow-line";
import { 分配线索, 定时分出去 } from "@/app/(app)/leads/assign-actions";
import { 定时分配令牌 } from "@/lib/enterprise/scheduled-assign-token";
import { 系统操作人 } from "@/lib/enterprise/scheduled-assign";
import { 放回公海, 领取公海项目 } from "@/lib/project/db";

describe("纯函数", () => {
  const 行 = (userId: string, bizRole: string, line: string | null = null) => ({ userId, deptId: null, bizRole, line, managerId: null, dottedManagerId: null });
  const org = 建组织(
    ["总", "销管内", "市", "甲", "丁", "己", "教"].map((id) => ({ id, role: "SALES", active: true })),
    [行("总", "director"), 行("销管内", "sales_mgr", "内贸"), 行("市", "marketing_mgr", "内贸"), 行("甲", "sales", "内贸"), 行("丁", "sales", "外贸"), 行("己", "sales"), 行("教", "coach", "内贸")],
    [],
  );
  it("新建线of：新增人所在事业部；判不出 = null（先空着）", () => {
    expect(新建线of(org, null, "甲")).toBe("内贸");
    expect(新建线of(org, null, "丁")).toBe("外贸");
    expect(新建线of(org, null, "己")).toBeNull();
  });
  it("换人后的线：自动分配按方向（没方向按接收人）", () => {
    expect(换人后的线(org, null, { 操作人: null, 接手人: "甲", 方向: "外贸", 自动: true })).toBe("外贸");
    expect(换人后的线(org, null, { 操作人: null, 接手人: "丁", 自动: true })).toBe("外贸");
  });
  it("换人后的线：市场指定按方向（P-转-26，含手改），没方向按接收人", () => {
    expect(换人后的线(org, null, { 操作人: "市", 接手人: "甲", 方向: "外贸" })).toBe("外贸");
    expect(换人后的线(org, null, { 操作人: "市", 接手人: "丁" })).toBe("外贸");
  });
  it("换人后的线：管理指定 = 改线，写接收人事业部（方向不认）；系统管理员（没设线的总管理）同", () => {
    expect(换人后的线(org, null, { 操作人: "销管内", 接手人: "丁", 方向: "内贸" })).toBe("外贸");
    expect(换人后的线(org, null, { 操作人: "总", 接手人: "甲", 方向: "外贸" })).toBe("内贸");
    // 接收人判不出事业部：退到方向
    expect(换人后的线(org, null, { 操作人: "总", 接手人: "己", 方向: "外贸" })).toBe("外贸");
  });
  it("换人后的线：自己领 / 销售自己转 / 教练 / 没操作人 = 不改", () => {
    expect(换人后的线(org, null, { 操作人: "甲", 接手人: "甲", 方向: "外贸" })).toBeUndefined();
    expect(换人后的线(org, null, { 操作人: "甲", 接手人: "丁" })).toBeUndefined();
    expect(换人后的线(org, null, { 操作人: "教", 接手人: "丁" })).toBeUndefined();
    expect(换人后的线(org, null, { 操作人: null, 接手人: "丁" })).toBeUndefined();
  });
  it("超时转的线：存的线优先；没存按当时负责人事业部；都没有 = null（不转）", () => {
    expect(超时转的线(org, null, "外贸", "甲")).toBe("外贸");
    expect(超时转的线(org, null, null, "丁")).toBe("外贸");
    expect(超时转的线(org, null, "暂不分配", "甲")).toBe("内贸");
    expect(超时转的线(org, null, null, "己")).toBeNull();
  });
});

type 人 = { id: string; name: string; role: string };
let 老板: 人, 销管内: 人, 市场: 人, 甲: 人, 乙: 人, 丁: 人, 戊: 人, 己: 人;
async function 造人(email: string, name: string, role = "SALES"): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name, role };
}
const 当 = (p: 人) => { mocks.user = { ...mocks.user, id: p.id, name: p.name, role: p.role }; 忘掉企业版范围(); };
let 序 = 0;
async function 线索(owner: string, 补: Record<string, unknown> = {}) {
  序++;
  // 企业版客户没有电话（E-260）：号记在主要联系人上（放回公海查联系方式按联系人的号判）
  const c = (await prisma.customer.create({ data: { name: `客户${序}`, phone: "", salesOwnerId: owner, contacts: { create: { name: `联系人${序}`, phone: `1390000${String(序).padStart(4, "0")}`, isPrimary: true } } } })).id;
  const p = (await prisma.project.create({
    data: { name: `线索${序}`, customerId: c, ownerId: owner, creatorId: 老板.id, phase: "线索", node: "潜客培育", bizLine: "内贸", ...补 },
  })).id;
  return { c, p };
}
const 线of = async (r: { c: string; p: string }) => ({
  项目: (await prisma.project.findUniqueOrThrow({ where: { id: r.p }, select: { flowLine: true } })).flowLine,
  客户: (await prisma.customer.findUniqueOrThrow({ where: { id: r.c }, select: { flowLine: true } })).flowLine,
});

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  公海规则.项目能单独领 = true;
  老板 = await 造人("boss", "老板", "ADMIN");
  销管内 = await 造人("smgr", "销管内");
  市场 = await 造人("mkt", "市场");
  甲 = await 造人("jia", "甲");
  乙 = await 造人("yi", "乙");
  丁 = await 造人("ding", "丁");
  戊 = await 造人("wu", "戊");
  己 = await 造人("ji", "己");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 销管内.id, bizRole: "sales_mgr", line: "内贸" },
      { userId: 市场.id, bizRole: "marketing_mgr", line: "内贸" },
      { userId: 甲.id, bizRole: "sales", line: "内贸" },
      { userId: 乙.id, bizRole: "sales", line: "内贸" },
      { userId: 丁.id, bizRole: "sales", line: "外贸" },
      { userId: 戊.id, bizRole: "sales", line: "外贸" },
      { userId: 己.id, bizRole: "sales" },
    ],
  });
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  invalidateSettingsCache();
  当(老板);
});
afterEach(() => { vi.unstubAllEnvs(); 公海规则.项目能单独领 = false; 忘掉企业版范围(); invalidateSettingsCache(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("首次定线：新增", () => {
  it("销售自己新增：按自己所在事业部写项目和客户；判不出事业部的先空着", async () => {
    const 内 = await 线索(甲.id, { creatorId: 甲.id });
    await 新建后定线(内.p, 甲.id);
    expect(await 线of(内)).toEqual({ 项目: "内贸", 客户: "内贸" });
    const 外 = await 线索(丁.id, { creatorId: 丁.id, bizLine: "内贸" });
    await 新建后定线(外.p, 丁.id);
    expect(await 线of(外)).toEqual({ 项目: "外贸", 客户: "外贸" });
    const 空 = await 线索(己.id, { creatorId: 己.id });
    await 新建后定线(空.p, 己.id);
    expect(await 线of(空)).toEqual({ 项目: null, 客户: null });
  });
  it("市场新增、建的时候直接指给外贸销售：按接收人（之后分配那一刻再按方向写）；市场自留按市场自己所在事业部", async () => {
    const 指 = await 线索(丁.id, { creatorId: 市场.id });
    await 新建后定线(指.p, 市场.id);
    expect(await 线of(指)).toEqual({ 项目: "外贸", 客户: "外贸" });
    const 留 = await 线索(市场.id, { creatorId: 市场.id });
    await 新建后定线(留.p, 市场.id);
    expect(await 线of(留)).toEqual({ 项目: "内贸", 客户: "内贸" });
  });
});

describe("分配写线 / 改线", () => {
  it("市场管理指定分配（分配线索）：写成这次的线", async () => {
    const r = await 线索(市场.id, { bizLine: "外贸" });
    当(市场);
    expect(await 分配线索({ projectId: r.p, toUserId: 丁.id })).toMatchObject({ ok: true });
    expect(await 线of(r)).toEqual({ 项目: "外贸", 客户: "外贸" });
  });
  it("管理手动跨线指定 = 改线：外贸线索被销售管理指给内贸销售，线改成内贸", async () => {
    const r = await 线索(丁.id, { flowLine: "外贸", bizLine: "内贸" });
    当(销管内);
    expect(await 分配线索({ projectId: r.p, toUserId: 甲.id })).toMatchObject({ ok: true });
    expect(await 线of(r)).toEqual({ 项目: "内贸", 客户: "内贸" });
  });
  it("自动分配（定时分出去）：按分配方向写", async () => {
    const r = await 线索(老板.id, { bizLine: "外贸", awaitAssignAt: new Date(Date.now() - 60_000) });
    expect(await 定时分出去(定时分配令牌, 系统操作人, r.p, null, "到点")).toMatchObject({ ok: true });
    expect((await prisma.project.findUniqueOrThrow({ where: { id: r.p } })).ownerId).toMatch(new RegExp(`^(${丁.id}|${戊.id})$`));
    expect(await 线of(r)).toEqual({ 项目: "外贸", 客户: "外贸" });
  });
  it("公海领取不改线：内贸线索进公海，外贸销售领走，线还是内贸", async () => {
    const r = await 线索(甲.id, { flowLine: "内贸" });
    await prisma.$executeRawUnsafe(`UPDATE "Customer" SET "flowLine" = '内贸' WHERE id = ?`, r.c);
    expect(await 放回公海({ id: 甲.id, role: "SALES" }, r.p)).toMatchObject({ ok: true });
    当(丁);
    expect(await 领取公海项目(丁, r.p)).toMatchObject({ ok: true });
    expect(await 线of(r)).toEqual({ 项目: "内贸", 客户: "内贸" });
  });
  it("写客户的线不碰客户 updatedAt（客户编辑框按它做乐观锁）", async () => {
    const r = await 线索(甲.id);
    const 前 = (await prisma.customer.findUniqueOrThrow({ where: { id: r.c } })).updatedAt;
    await 写流转线(prisma, "外贸", { 项目: [r.p] });
    const 后 = await prisma.customer.findUniqueOrThrow({ where: { id: r.c } });
    expect(后.flowLine).toBe("外贸");
    expect(后.updatedAt).toEqual(前);
  });
});
